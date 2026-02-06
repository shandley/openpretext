/**
 * ExportSession — AGP, BED, FASTA, screenshot, session save/load,
 *                 reference FASTA upload, BedGraph track upload.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { downloadAGP } from '../export/AGPWriter';
import { downloadBED } from '../export/BEDWriter';
import { downloadFASTA } from '../export/FASTAWriter';
import { parseFASTA } from '../formats/FASTAParser';
import { parseBedGraph, bedGraphToTrack } from '../formats/BedGraphParser';
import { downloadSnapshot } from '../export/SnapshotExporter';
import { exportSession, importSession, downloadSession } from '../io/SessionManager';
import type { ColorMapName } from '../renderer/ColorMaps';
import { syncColormapDropdown, syncGammaSlider } from './ColorMapControls';
import { rebuildContigBoundaries } from './EventWiring';

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
    const sessionData = exportSession(s, ctx.scaffoldManager, ctx.waypointManager);
    downloadSession(sessionData);
    ctx.showToast('Session saved');
  } catch (err) {
    console.error('Session save error:', err);
    ctx.showToast('Save failed');
  }
}

export async function loadSession(ctx: AppContext, file: File): Promise<void> {
  try {
    const text = await file.text();
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

    // Restore camera
    ctx.camera.animateTo(session.camera, 300);

    // Restore settings
    state.update({
      gamma: session.settings.gamma,
      showGrid: session.settings.showGrid,
      colorMapName: session.settings.colorMapName,
    });
    ctx.currentColorMap = session.settings.colorMapName as ColorMapName;
    ctx.renderer.setColorMap(ctx.currentColorMap);
    syncColormapDropdown(ctx.currentColorMap);
    syncGammaSlider(session.settings.gamma);

    // Restore waypoints
    ctx.waypointManager.clearAll();
    for (const wp of session.waypoints) {
      ctx.waypointManager.addWaypoint(wp.mapX, wp.mapY, wp.label);
    }

    rebuildContigBoundaries(ctx);
    ctx.updateSidebarContigList();
    ctx.updateSidebarScaffoldList();
    ctx.showToast(`Session restored (${session.operationLog.length} operations)`);
  } catch (err) {
    console.error('Session load error:', err);
    ctx.showToast(`Load failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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

export async function loadReferenceFasta(ctx: AppContext, file: File): Promise<void> {
  try {
    const text = await file.text();
    const records = parseFASTA(text);
    ctx.referenceSequences = new Map(records.map(r => [r.name, r.sequence]));
    ctx.showToast(`Loaded ${records.length} reference sequences`);
  } catch (err) {
    console.error('FASTA parse error:', err);
    ctx.showToast(`FASTA load failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
  try {
    const text = await file.text();
    const result = parseBedGraph(text);
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
