/**
 * PatternGallery — visual reference of Hi-C curation patterns.
 *
 * Displays a modal with descriptions of common Hi-C patterns.
 * Clicking a pattern can navigate the camera to the example region
 * if the relevant specimen is loaded.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { loadSpecimenCatalog, type SpecimenEntry } from '../data/SpecimenCatalog';
import { loadSpecimen } from './FileLoading';

interface PatternEntry {
  id: string;
  title: string;
  description: string;
  whatToLookFor: string;
  specimenId: string;
  exampleRegion: { x1: number; y1: number; x2: number; y2: number };
}

interface PatternGalleryData {
  version: string;
  patterns: PatternEntry[];
}

let galleryVisible = false;
let cachedPatterns: PatternEntry[] | null = null;

export function isPatternGalleryVisible(): boolean {
  return galleryVisible;
}

export function togglePatternGallery(ctx: AppContext): void {
  galleryVisible = !galleryVisible;
  const modal = document.getElementById('pattern-gallery-modal');
  if (!modal) return;
  modal.classList.toggle('visible', galleryVisible);

  if (galleryVisible && !cachedPatterns) {
    loadAndRender(ctx, modal);
  }
}

async function loadAndRender(ctx: AppContext, modal: HTMLElement): Promise<void> {
  try {
    const url = new URL('data/pattern-gallery.json', document.baseURI).href;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load pattern gallery: ${response.status}`);
    const data = await response.json() as PatternGalleryData;
    cachedPatterns = data.patterns;
    renderPatterns(ctx, modal, data.patterns);
  } catch {
    const content = modal.querySelector('.pattern-gallery-content');
    if (content) {
      content.innerHTML = '<div style="color: var(--text-secondary); padding: 20px;">Pattern gallery not available</div>';
    }
  }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPatterns(ctx: AppContext, modal: HTMLElement, patterns: PatternEntry[]): void {
  const content = modal.querySelector('.pattern-gallery-content');
  if (!content) return;

  content.innerHTML = patterns.map(p => `
    <div class="pattern-card" data-pattern-id="${esc(p.id)}">
      <div class="pattern-card-title">${esc(p.title)}</div>
      <div class="pattern-card-desc">${esc(p.description)}</div>
      <div class="pattern-card-look"><strong>Look for:</strong> ${esc(p.whatToLookFor)}</div>
      <div class="pattern-card-specimen">Specimen: ${esc(p.specimenId)}</div>
    </div>
  `).join('');

  content.querySelectorAll('.pattern-card').forEach((card, i) => {
    card.addEventListener('click', () => {
      void openPattern(ctx, patterns[i]);
    });
  });
}

/** Fly the camera to a pattern's example region on the currently-loaded map. */
function flyToRegion(ctx: AppContext, region: PatternEntry['exampleRegion']): void {
  const cx = (region.x1 + region.x2) / 2;
  const cy = (region.y1 + region.y2) / 2;
  const span = Math.max(region.x2 - region.x1, region.y2 - region.y1);
  const zoom = 1 / Math.max(span, 0.05);
  ctx.camera.animateTo({ x: cx, y: cy, zoom }, 300);
}

async function findSpecimen(id: string): Promise<SpecimenEntry | null> {
  try {
    const catalog = await loadSpecimenCatalog();
    return catalog.specimens.find(s => s.id === id) ?? null;
  } catch {
    return null;
  }
}

/**
 * What clicking a pattern card should do, given the pattern's specimen and what
 * is currently loaded. Kept pure so the decision is unit-testable without a DOM,
 * fetch, or WebGL context.
 *
 * - `navigate`  — the pattern's specimen is already loaded; just fly there.
 * - `load`      — download `specimen`, then fly to the region.
 * - `toast`     — can't act; show `message` instead (guard or missing data).
 */
export type PatternAction =
  | { kind: 'navigate' }
  | { kind: 'load'; specimen: SpecimenEntry }
  | { kind: 'toast'; message: string };

export function resolvePatternAction(
  specimen: SpecimenEntry | null,
  loadedFile: string | null,
  undoDepth: number,
): PatternAction {
  // Unknown specimen id: best effort on whatever is loaded, else guide the user.
  if (!specimen) {
    return loadedFile
      ? { kind: 'navigate' }
      : { kind: 'toast', message: 'Load a specimen to see this pattern' };
  }

  // The pattern's specimen is already loaded — just navigate.
  if (loadedFile === specimen.releaseAsset) return { kind: 'navigate' };

  // A different assembly is loaded with unsaved curation: don't discard it.
  if (loadedFile && undoDepth > 0) {
    return {
      kind: 'toast',
      message: `This pattern is shown on the ${specimen.commonName} specimen — finish or save your current work, then load it`,
    };
  }

  // Nothing loaded (the welcome-screen case) or a clean different specimen.
  return { kind: 'load', specimen };
}

/**
 * Handle a pattern card click. The example region only means anything on the
 * pattern's own specimen, so we make sure that specimen is loaded before flying
 * there. From the welcome screen nothing is loaded, so the gallery previously
 * closed and panned an empty map — the reported "non-functional" behaviour.
 */
async function openPattern(ctx: AppContext, pattern: PatternEntry): Promise<void> {
  togglePatternGallery(ctx); // close the modal first so loading UI is visible

  const specimen = await findSpecimen(pattern.specimenId);
  const action = resolvePatternAction(
    specimen,
    state.get().map?.filename ?? null,
    state.get().undoStack.length,
  );

  switch (action.kind) {
    case 'navigate':
      flyToRegion(ctx, pattern.exampleRegion);
      return;
    case 'toast':
      ctx.showToast(action.message);
      return;
    case 'load':
      await loadSpecimen(ctx, action.specimen);
      // Only navigate if the load actually succeeded (parse can still fail).
      if (state.get().map?.filename === action.specimen.releaseAsset) {
        flyToRegion(ctx, pattern.exampleRegion);
      }
      return;
  }
}

export function setupPatternGallery(): void {
  const closeBtn = document.querySelector('#pattern-gallery-modal .pattern-gallery-close');
  closeBtn?.addEventListener('click', () => {
    galleryVisible = false;
    document.getElementById('pattern-gallery-modal')?.classList.remove('visible');
  });
}
