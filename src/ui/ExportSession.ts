/**
 * ExportSession — AGP, BED, FASTA, screenshot, session save/load,
 *                 reference FASTA upload, BedGraph track upload.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { downloadAGP } from '../export/AGPWriter';
import { downloadBED } from '../export/BEDWriter';
import { downloadFASTA } from '../export/FASTAWriter';
import { parseFASTA, parseFASTAStream } from '../formats/FASTAParser';
import { parseBedGraph, bedGraphToTrack } from '../formats/BedGraphParser';
import { downloadSnapshot } from '../export/SnapshotExporter';
import { exportSession, importSession, downloadSession } from '../io/SessionManager';
import type { SessionData } from '../io/SessionManager';
import type { ColorMapName } from '../renderer/ColorMaps';
import { syncColormapDropdown, syncGammaSlider, syncFloorSlider, syncCeilSlider, syncOverviewModeSelect } from './ColorMapControls';
import { rebuildContigBoundaries, applyOverviewMode } from './EventWiring';
import { exportAnalysisState, restoreAnalysisState, updateFastaHint } from './AnalysisPanel';
import { inflate } from 'pako';
import { showLoading, updateLoading, hideLoading } from './LoadingOverlay';

export function exportAGP(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) {
    ctx.showToast('No data to export');
    return;
  }
  try {
    downloadAGP(s);
    ctx.showToast('AGP exported');
  } catch (err) {
    console.error('AGP export error:', err);
    ctx.showToast('Export failed');
  }
}

export function takeScreenshot(ctx: AppContext): void {
  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  if (!canvas) return;
  try {
    downloadSnapshot(canvas, { includeOverlays: true });
    ctx.showToast('Screenshot saved');
  } catch (err) {
    console.error('Screenshot error:', err);
    ctx.showToast('Screenshot failed');
  }
}

export function saveSession(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) {
    ctx.showToast('No data to save');
    return;
  }
  try {
    const sessionData: SessionData = exportSession(s, ctx.scaffoldManager, ctx.waypointManager);
    const analysisState = exportAnalysisState();
    if (analysisState) {
      sessionData.analysis = analysisState;
    }
    downloadSession(sessionData);
    ctx.showToast('Session saved');
  } catch (err) {
    console.error('Session save error:', err);
    ctx.showToast('Save failed');
  }
}

export async function loadSession(ctx: AppContext, file: File): Promise<void> {
  showLoading('Restoring session', 'Reading session file...');
  try {
    updateLoading('Reading session file...', 5);
    const text = await file.text();
    updateLoading('Parsing session...', 20);
    const session = importSession(text);

    // Apply session state to the app
    const s = state.get();
    if (!s.map) {
      ctx.showToast('Load a .pretext file first, then restore the session');
      return;
    }

    // Verify filename match
    if (session.filename !== s.map.filename && session.filename !== 'demo') {
      ctx.showToast(`Warning: session was for "${session.filename}", current file is "${s.map.filename}"`);
    }

    updateLoading('Applying assembly state...', 40);

    // Apply contig order
    if (session.contigOrder.length > 0) {
      state.update({ contigOrder: session.contigOrder });
    }

    // Apply contig states (inversions, scaffolds)
    const contigUpdates: Array<{ id: number; changes: Partial<import('../core/State').ContigInfo> }> = [];
    for (const [contigIdStr, override] of Object.entries(session.contigStates)) {
      const contigId = Number(contigIdStr);
      if (contigId >= 0 && contigId < s.map.contigs.length) {
        contigUpdates.push({
          id: contigId,
          changes: { inverted: override.inverted, scaffoldId: override.scaffoldId },
        });
      }
    }
    if (contigUpdates.length > 0) {
      state.updateContigs(contigUpdates);
    }

    // Restore scaffolds
    for (const sc of session.scaffolds) {
      if (!ctx.scaffoldManager.getScaffold(sc.id)) {
        ctx.scaffoldManager.createScaffold(sc.name);
      }
    }

    updateLoading('Restoring view and settings...', 65);

    // Restore camera
    ctx.camera.animateTo(session.camera, 300);

    // Restore settings
    const overviewMode = session.settings.overviewMode ?? 'clean';
    state.update({
      gamma: session.settings.gamma,
      signalFloor: session.settings.signalFloor ?? 0,
      signalCeil: session.settings.signalCeil ?? 1,
      overviewMode,
      showGrid: session.settings.showGrid,
      colorMapName: session.settings.colorMapName,
    });
    ctx.currentColorMap = session.settings.colorMapName as ColorMapName;
    ctx.renderer.setColorMap(ctx.currentColorMap);
    syncColormapDropdown(ctx.currentColorMap);
    syncGammaSlider(session.settings.gamma);
    syncFloorSlider(session.settings.signalFloor ?? 0);
    syncCeilSlider(session.settings.signalCeil ?? 1);
    syncOverviewModeSelect(overviewMode);
    await applyOverviewMode(ctx);

    // Restore waypoints
    ctx.waypointManager.clearAll();
    for (const wp of session.waypoints) {
      ctx.waypointManager.addWaypoint(wp.mapX, wp.mapY, wp.label);
    }

    rebuildContigBoundaries(ctx);
    ctx.updateSidebarContigList();
    ctx.updateSidebarScaffoldList();

    // Restore persisted analysis results if present
    if (session.analysis) {
      updateLoading('Restoring analysis results...', 85);
      restoreAnalysisState(ctx, session.analysis);
    }

    updateLoading('Finalizing...', 98);
    ctx.showToast(`Session restored (${session.operationLog.length} operations)`);
  } catch (err) {
    console.error('Session load error:', err);
    ctx.showToast(`Load failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    hideLoading();
  }
}

export function exportBEDFile(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) {
    ctx.showToast('No data to export');
    return;
  }
  try {
    downloadBED(s);
    ctx.showToast('BED exported');
  } catch (err) {
    console.error('BED export error:', err);
    ctx.showToast('BED export failed');
  }
}

export function exportFASTAFile(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) {
    ctx.showToast('No data to export');
    return;
  }
  if (!ctx.referenceSequences) {
    ctx.showToast('Load a reference FASTA first');
    return;
  }
  try {
    downloadFASTA(s, ctx.referenceSequences);
    ctx.showToast('FASTA exported');
  } catch (err) {
    console.error('FASTA export error:', err);
    ctx.showToast('FASTA export failed');
  }
}

// 500 MB compressed size guard for gzip FASTA files
const GZIP_SIZE_LIMIT = 500 * 1024 * 1024;

export async function loadReferenceFasta(ctx: AppContext, file: File): Promise<void> {
  const isGzip = file.name.toLowerCase().endsWith('.gz');
  showLoading('Loading FASTA', 'Reading file...');
  try {
    let records;

    if (isGzip) {
      if (file.size > GZIP_SIZE_LIMIT) {
        hideLoading();
        ctx.showToast(
          `Gzip FASTA files larger than 500 MB are not supported — decompress first with: gunzip ${file.name}`,
        );
        return;
      }
      updateLoading('Decompressing gzip FASTA...', 20);
      const buffer = await file.arrayBuffer();
      updateLoading('Decompressing gzip FASTA...', 50);
      const decompressed = inflate(new Uint8Array(buffer));
      updateLoading('Parsing sequences...', 75);
      const text = new TextDecoder().decode(decompressed);
      records = parseFASTA(text);
    } else {
      // Stream line-by-line to avoid V8's ~1 GB string length limit on large files
      updateLoading('Parsing FASTA sequences...', 10);
      const totalBytes = file.size;
      let bytesRead = 0;
      let lastPct = 10;

      const rawStream = file.stream();
      const progressStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytesRead += chunk.byteLength;
          const pct = totalBytes > 0 ? Math.round(10 + (bytesRead / totalBytes) * 85) : lastPct;
          if (pct !== lastPct) {
            lastPct = pct;
            const mb = (bytesRead / 1_048_576).toFixed(0);
            const total = (totalBytes / 1_048_576).toFixed(0);
            updateLoading(`Parsing FASTA... ${mb} / ${total} MB`, pct);
          }
          controller.enqueue(chunk);
        },
      });

      // TextDecoderStream.writable is WritableStream<BufferSource>, but TypeScript's
      // DOM types don't consider it assignable to WritableStream<Uint8Array>.
      // The cast is safe: Uint8Array is a BufferSource.
      const textStream = rawStream
        .pipeThrough(progressStream)
        .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>);

      records = await parseFASTAStream(textStream);
    }

    if (records.length === 0) {
      ctx.showToast(`No sequences found in ${file.name} — is this a valid FASTA file?`);
    } else {
      ctx.referenceSequences = new Map(records.map(r => [r.name, r.sequence]));
      ctx.showToast(`Loaded ${records.length} reference sequences`);
      updateFastaHint(ctx);
    }
  } catch (err) {
    console.error('FASTA parse error:', err);
    ctx.showToast(`FASTA load failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    hideLoading();
  }
}

export function setupFastaUpload(ctx: AppContext): void {
  const input = document.getElementById('fasta-file-input') as HTMLInputElement;
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) await loadReferenceFasta(ctx, file);
    input.value = '';
  });
}

export async function loadBedGraphTrack(ctx: AppContext, file: File): Promise<void> {
  const s = state.get();
  if (!s.map) {
    ctx.showToast('Load a map file first');
    return;
  }
  showLoading('Loading track', 'Reading track file...');
  try {
    updateLoading('Reading track file...', 15);
    const text = await file.text();
    updateLoading('Parsing track...', 55);
    const result = parseBedGraph(text);
    updateLoading('Building track...', 85);
    const track = bedGraphToTrack(
      result,
      s.map.contigs,
      s.contigOrder,
      s.map.textureSize,
      { name: result.trackName ?? file.name },
    );
    ctx.trackRenderer.addTrack(track);
    ctx.tracksVisible = true;
    ctx.showToast(`Track loaded: ${track.name}`);
    ctx.updateTrackConfigPanel();
  } catch (err) {
    console.error('BedGraph parse error:', err);
    ctx.showToast(`Track load failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    hideLoading();
  }
}

export function setupTrackUpload(ctx: AppContext): void {
  const input = document.getElementById('track-file-input') as HTMLInputElement;
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) await loadBedGraphTrack(ctx, file);
    input.value = '';
  });
}
