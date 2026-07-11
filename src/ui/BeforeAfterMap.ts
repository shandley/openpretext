/**
 * BeforeAfterMap - a side-by-side overview of the contact map as loaded versus
 * as curated.
 *
 * Both panels are rasterized from the same `originalContactMap`: the "before"
 * is the pristine file-order overview, the "after" is that same matrix
 * reordered by the current curation (inversion-aware, via reorderContactMap).
 * Curation permutes the contact signal, it never changes the underlying values,
 * so this is an honest view of how reordering, inverting, cutting and joining
 * rearranged the diagonal, not a claim that the data itself changed. It runs on
 * a 2D canvas, entirely outside the WebGL render path.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { reorderContactMap } from '../renderer/ContactMapReorder';
import { getColorMapData } from '../renderer/ColorMaps';
import { computeDiff, type DiffSummary } from './ComparisonMode';

const RENDER_PX = 320; // on-screen size of each panel
const GAMMA = 0.35; // match the Minimap thumbnail so panels read like the live map

/** One-line description of what curation changed, and whether anything did. */
export function describeCuration(summary: DiffSummary): { changed: boolean; text: string } {
  const parts: string[] = [];
  if (summary.moved > 0) parts.push(`${summary.moved} moved`);
  if (summary.inverted > 0) parts.push(`${summary.inverted} inverted`);
  if (summary.added > 0) parts.push(`${summary.added} new from cuts`);
  if (summary.removed > 0) parts.push(`${summary.removed} joined away`);
  return { changed: parts.length > 0, text: parts.join(', ') };
}

/** Draw an overview matrix into a canvas using a 256-entry RGBA colour LUT. */
function rasterizeOverview(
  canvas: HTMLCanvasElement,
  matrix: Float32Array,
  size: number,
  lut: Uint8Array,
): void {
  const c2d = canvas.getContext('2d');
  if (!c2d) return;
  canvas.width = RENDER_PX;
  canvas.height = RENDER_PX;
  const img = c2d.createImageData(RENDER_PX, RENDER_PX);
  const px = img.data;
  const scale = size / RENDER_PX;
  for (let y = 0; y < RENDER_PX; y++) {
    const sy = Math.min(size - 1, Math.floor(y * scale));
    for (let x = 0; x < RENDER_PX; x++) {
      const sx = Math.min(size - 1, Math.floor(x * scale));
      const v = matrix[sy * size + sx] ?? 0;
      const mapped = Math.pow(Math.min(1, Math.max(0, v)), GAMMA);
      const li = Math.max(0, Math.min(255, Math.round(mapped * 255))) * 4;
      const pi = (y * RENDER_PX + x) * 4;
      px[pi] = lut[li];
      px[pi + 1] = lut[li + 1];
      px[pi + 2] = lut[li + 2];
      px[pi + 3] = 255;
    }
  }
  c2d.putImageData(img, 0, 0);
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    #before-after-modal { position: fixed; inset: 0; z-index: 860; display: none;
      justify-content: center; align-items: center; background: rgba(0,0,0,0.5); }
    #before-after-modal.visible { display: flex; }
    #before-after-modal .ba-card { background: var(--bg-secondary); border: 1px solid var(--border);
      border-radius: 10px; max-width: 92vw; max-height: 88vh; display: flex; flex-direction: column;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5); overflow: auto; }
    #before-after-modal .ba-header { display: flex; justify-content: space-between; align-items: center;
      padding: 14px 18px; border-bottom: 1px solid var(--border); }
    #before-after-modal .ba-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    #before-after-modal .ba-close { background: none; border: none; color: var(--text-secondary);
      font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
    #before-after-modal .ba-close:hover { color: var(--text-primary); }
    #before-after-modal .ba-body { padding: 16px 18px; }
    #before-after-modal .ba-note { font-size: 11px; color: var(--text-secondary); margin-bottom: 12px;
      max-width: 680px; line-height: 1.5; }
    #before-after-modal .ba-note strong { color: var(--text-primary); font-weight: 600; }
    #before-after-modal .ba-panels { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
    #before-after-modal figure { margin: 0; display: flex; flex-direction: column; gap: 6px; align-items: center; }
    #before-after-modal canvas { width: ${RENDER_PX}px; height: ${RENDER_PX}px; border: 1px solid var(--border);
      border-radius: 4px; image-rendering: pixelated; background: var(--bg-primary); }
    #before-after-modal figcaption { font-size: 11px; color: var(--text-secondary); }
    #before-after-modal .ba-empty { font-size: 13px; color: var(--text-secondary); padding: 40px 20px; text-align: center; }
  `;
  document.head.appendChild(style);
}

function ensureModal(): HTMLElement {
  let modal = document.getElementById('before-after-modal');
  if (modal) return modal;
  injectStyles();
  modal = document.createElement('div');
  modal.id = 'before-after-modal';
  modal.innerHTML = `
    <div class="ba-card">
      <div class="ba-header">
        <span class="ba-title">Before / After map</span>
        <button class="ba-close" aria-label="Close">&times;</button>
      </div>
      <div class="ba-body">
        <div class="ba-note"></div>
        <div class="ba-panels"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal!.classList.remove('visible');
  modal.querySelector('.ba-close')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal!.classList.contains('visible')) close();
  });
  return modal;
}

/** Open the before/after overview comparison for the current assembly. */
export function openBeforeAfterMap(ctx: AppContext): void {
  const s = state.get();
  const original = s.map?.originalContactMap;
  if (!s.map || !original) {
    ctx.showToast('Load an assembly first');
    return;
  }

  const modal = ensureModal();
  const note = modal.querySelector('.ba-note') as HTMLElement;
  const panels = modal.querySelector('.ba-panels') as HTMLElement;

  const overviewSize = Math.round(Math.sqrt(original.length));

  // Is there anything to compare? Curation may not have touched the order yet.
  const snap = ctx.comparisonSnapshot;
  const summary = snap
    ? computeDiff(snap, ctx.comparisonInvertedSnapshot ?? new Map(), s.contigOrder, s.map.contigs).summary
    : null;
  const curation = summary ? describeCuration(summary) : { changed: false, text: '' };

  if (summary && !curation.changed) {
    panels.innerHTML = '';
    note.innerHTML = '';
    panels.innerHTML = '<div class="ba-empty">No curation to compare yet. Reorder, invert, cut or join contigs, then reopen this view.</div>';
    modal.classList.add('visible');
    return;
  }

  const lut = getColorMapData(ctx.currentColorMap);
  const before = original;
  const after = reorderContactMap(original, s.map.contigs, s.contigOrder, overviewSize);

  panels.innerHTML = `
    <figure><canvas id="ba-before"></canvas><figcaption>Before &mdash; as loaded</figcaption></figure>
    <figure><canvas id="ba-after"></canvas><figcaption>After &mdash; your curation</figcaption></figure>`;
  rasterizeOverview(document.getElementById('ba-before') as HTMLCanvasElement, before, overviewSize, lut);
  rasterizeOverview(document.getElementById('ba-after') as HTMLCanvasElement, after, overviewSize, lut);

  const changeText = curation.text ? ` This curation: ${curation.text}.` : '';
  note.innerHTML =
    `<strong>Same contacts, re-ordered by your curation.</strong> ` +
    `Both panels show the same Hi-C data; the "after" is the "before" reordered ` +
    `and inversion-corrected by your edits. A join reads well when the diagonal ` +
    `runs continuously across the old boundary; an inversion fixes an anti-diagonal.` +
    changeText;

  modal.classList.add('visible');
}
