/**
 * PatternGallery — visual reference of Hi-C curation patterns.
 *
 * Displays a modal with descriptions of common Hi-C patterns.
 * Clicking a pattern can navigate the camera to the example region
 * if the relevant specimen is loaded.
 */

import type { AppContext } from './AppContext';

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

function renderPatterns(ctx: AppContext, modal: HTMLElement, patterns: PatternEntry[]): void {
  const content = modal.querySelector('.pattern-gallery-content');
  if (!content) return;

  content.innerHTML = patterns.map(p => `
    <div class="pattern-card" data-pattern-id="${p.id}">
      <div class="pattern-card-title">${p.title}</div>
      <div class="pattern-card-desc">${p.description}</div>
      <div class="pattern-card-look"><strong>Look for:</strong> ${p.whatToLookFor}</div>
      <div class="pattern-card-specimen">Specimen: ${p.specimenId}</div>
    </div>
  `).join('');

  content.querySelectorAll('.pattern-card').forEach((card, i) => {
    card.addEventListener('click', () => {
      const pattern = patterns[i];
      const region = pattern.exampleRegion;
      const cx = (region.x1 + region.x2) / 2;
      const cy = (region.y1 + region.y2) / 2;
      const span = Math.max(region.x2 - region.x1, region.y2 - region.y1);
      const zoom = 1 / Math.max(span, 0.05);
      ctx.camera.animateTo({ x: cx, y: cy, zoom }, 300);
      togglePatternGallery(ctx);
    });
  });
}

export function setupPatternGallery(): void {
  const closeBtn = document.querySelector('#pattern-gallery-modal .pattern-gallery-close');
  closeBtn?.addEventListener('click', () => {
    galleryVisible = false;
    document.getElementById('pattern-gallery-modal')?.classList.remove('visible');
  });
}
