/**
 * FileLoading — load .pretext files and demo data, file drop/input setup.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { events } from '../core/EventBus';
import { parsePretextFile, isPretextFile, tileLinearIndex } from '../formats/PretextParser';
import { generateSyntheticMap } from '../formats/SyntheticData';
import { generateDemoTracks } from '../formats/SyntheticTracks';
import { TileManager } from '../renderer/TileManager';
import { showLoading, updateLoading, hideLoading } from './LoadingOverlay';
import { loadSession } from './ExportSession';

async function loadPretextFromBuffer(
  ctx: AppContext,
  buffer: ArrayBuffer,
  filename: string,
): Promise<void> {
  const statusEl = document.getElementById('status-file')!;

  if (!isPretextFile(buffer)) {
    statusEl.textContent = 'Invalid file format';
    ctx.showToast('Invalid file — not a .pretext file');
    return;
  }

  updateLoading('Parsing header and metadata...', 20);
  const parsed = await parsePretextFile(buffer, { coarsestOnly: true });
  const h = parsed.header;
  const mapSize = h.numberOfPixels1D;

  updateLoading('Assembling contact map...', 50);

  const N = h.numberOfTextures1D;
  const coarsestMip = h.mipMapLevels - 1;
  const coarsestRes = h.textureResolution >> coarsestMip;
  const overviewSize = N * coarsestRes;
  const contactMap = new Float32Array(overviewSize * overviewSize);
  const totalTiles = (N * (N + 1)) / 2;
  let tilesDone = 0;

  for (let tx = 0; tx < N; tx++) {
    for (let ty = tx; ty < N; ty++) {
      const linIdx = tileLinearIndex(tx, ty, N);
      const tileData = parsed.tilesDecoded[linIdx]?.[coarsestMip];
      if (!tileData) { tilesDone++; continue; }

      for (let py = 0; py < coarsestRes; py++) {
        for (let px = 0; px < coarsestRes; px++) {
          const val = tileData[py * coarsestRes + px];
          const gx = tx * coarsestRes + px;
          const gy = ty * coarsestRes + py;
          if (gx < overviewSize && gy < overviewSize) {
            contactMap[gy * overviewSize + gx] = val;
            contactMap[gx * overviewSize + gy] = val;
          }
        }
      }

      tilesDone++;
      if (tilesDone % Math.max(1, Math.floor(totalTiles / 20)) === 0) {
        updateLoading(
          `Assembling tiles... (${tilesDone}/${totalTiles})`,
          50 + Math.round((tilesDone / totalTiles) * 40),
        );
      }
    }
  }

  updateLoading('Uploading to GPU...', 92);
  ctx.renderer.uploadContactMap(contactMap, overviewSize);
  ctx.minimap.updateThumbnail(contactMap, overviewSize);
  ctx.contigBoundaries = parsed.contigs.map(c => c.pixelEnd / mapSize);

  // Dispose previous tile manager and cancel in-flight decodes
  if (ctx.cancelTileDecode) { ctx.cancelTileDecode(); ctx.cancelTileDecode = null; }
  if (ctx.tileManager) { ctx.tileManager.dispose(); }
  ctx.tileManager = new TileManager(ctx.renderer.getGL());

  updateLoading('Finalizing...', 98);
  state.update({
    map: {
      filename,
      textureSize: mapSize,
      numMipMaps: h.mipMapLevels,
      tileResolution: h.textureResolution,
      tilesPerDimension: h.numberOfTextures1D,
      contigs: parsed.contigs.map((c, i) => ({
        name: c.name, originalIndex: i, length: c.length,
        pixelStart: c.pixelStart, pixelEnd: c.pixelEnd,
        inverted: false, scaffoldId: null,
      })),
      contactMap,
      rawTiles: parsed.tiles,
      parsedHeader: h,
      extensions: new Map(parsed.extensions.map(e => [e.name, e.data])),
    },
    contigOrder: parsed.contigs.map((_, i) => i),
  });
  statusEl.textContent = filename;
  document.getElementById('status-contigs')!.textContent = `${parsed.contigs.length} contigs`;
  events.emit('file:loaded', { filename, contigs: parsed.contigs.length, textureSize: mapSize });
  ctx.showToast(`Loaded ${filename} — ${parsed.contigs.length} contigs, ${mapSize}px`);
}

export async function loadPretextFile(ctx: AppContext, file: File): Promise<void> {
  const statusEl = document.getElementById('status-file')!;
  statusEl.textContent = `Loading ${file.name}...`;
  showLoading(`Loading ${file.name}`, 'Reading file...');

  try {
    updateLoading('Reading file into memory...', 10);
    const buffer = await file.arrayBuffer();
    await loadPretextFromBuffer(ctx, buffer, file.name);
  } catch (err) {
    console.error('Error loading file:', err);
    document.getElementById('status-file')!.textContent = 'Error loading file';
    ctx.showToast(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  hideLoading();
  document.getElementById('welcome')!.style.display = 'none';
}

export async function loadExampleDataset(ctx: AppContext): Promise<void> {
  // Use GitHub API asset endpoint (has CORS headers) instead of the releases
  // download URL (which returns a 302 without CORS headers).
  const EXAMPLE_URL = 'https://api.github.com/repos/shandley/openpretext/releases/assets/352230856';
  const EXAMPLE_FILENAME = 'Phascolarctos_cinereus.pretext';

  showLoading('Loading example dataset', 'Downloading koala genome...');

  try {
    const response = await fetch(EXAMPLE_URL, {
      headers: { 'Accept': 'application/octet-stream' },
    });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

    const contentLength = Number(response.headers.get('content-length')) || 0;
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0) {
        const pct = Math.round((received / contentLength) * 60); // 0-60% for download
        const mb = (received / 1048576).toFixed(0);
        const totalMb = (contentLength / 1048576).toFixed(0);
        updateLoading(`Downloading... ${mb}/${totalMb} MB`, pct);
      }
    }

    // Concatenate chunks into single ArrayBuffer
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    await loadPretextFromBuffer(ctx, combined.buffer, EXAMPLE_FILENAME);
  } catch (err) {
    console.error('Error loading example dataset:', err);
    document.getElementById('status-file')!.textContent = 'Error loading example';
    ctx.showToast(`Error: ${err instanceof Error ? err.message : 'Failed to download example dataset'}`);
  }

  hideLoading();
  document.getElementById('welcome')!.style.display = 'none';
}

export function loadDemoData(ctx: AppContext): void {
  const { data, size, contigs } = generateSyntheticMap(1024, 12);
  ctx.renderer.uploadContactMap(data, size);
  ctx.contigBoundaries = contigs.map(c => c.end / size);

  // Clean up tile streaming state for demo data
  if (ctx.cancelTileDecode) { ctx.cancelTileDecode(); ctx.cancelTileDecode = null; }
  if (ctx.tileManager) { ctx.tileManager.dispose(); ctx.tileManager = null; }

  state.update({
    map: {
      filename: 'demo',
      textureSize: size,
      numMipMaps: 1,
      tileResolution: size,
      tilesPerDimension: 1,
      contigs: contigs.map((c, i) => ({
        name: c.name, originalIndex: i,
        length: (c.end - c.start) * 1000000,
        pixelStart: c.start, pixelEnd: c.end,
        inverted: false, scaffoldId: null,
      })),
      contactMap: data,
      rawTiles: null,
      parsedHeader: null,
      extensions: new Map(),
    },
    contigOrder: contigs.map((_, i) => i),
  });

  // Generate minimap thumbnail
  ctx.minimap.updateThumbnail(data, size);

  // Generate synthetic annotation tracks
  if (ctx.trackRenderer) {
    const boundaries = contigs.map(c => c.end);
    const demoTracks = generateDemoTracks(size, boundaries);
    for (const track of demoTracks) {
      ctx.trackRenderer.addTrack(track);
    }
  }

  document.getElementById('status-file')!.textContent = 'Demo data';
  document.getElementById('status-contigs')!.textContent = `${contigs.length} contigs`;
  document.getElementById('welcome')!.style.display = 'none';

  events.emit('file:loaded', { filename: 'demo', contigs: contigs.length, textureSize: size });
}

export function setupFileDrop(ctx: AppContext): void {
  const overlay = document.getElementById('drop-overlay')!;

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    overlay.classList.add('visible');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) {
      overlay.classList.remove('visible');
    }
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    overlay.classList.remove('visible');
    const file = e.dataTransfer?.files[0];
    if (file) await loadPretextFile(ctx, file);
  });
}

export function setupFileInput(ctx: AppContext): void {
  const input = document.getElementById('file-input') as HTMLInputElement;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) await loadPretextFile(ctx, file);
    input.value = '';
  });

  const sessionInput = document.getElementById('session-file-input') as HTMLInputElement;
  sessionInput?.addEventListener('change', async () => {
    const file = sessionInput.files?.[0];
    if (file) await loadSession(ctx, file);
    sessionInput.value = '';
  });
}
