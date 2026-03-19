/**
 * SpecimenPicker — populates the welcome screen specimen card grid.
 */

import type { AppContext } from './AppContext';
import type { SpecimenEntry } from '../data/SpecimenCatalog';
import { loadSpecimenCatalog, getTutorialSpecimens } from '../data/SpecimenCatalog';
import { loadSpecimen } from './FileLoading';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildTooltip(specimen: SpecimenEntry): string {
  const parts = [specimen.commonName];
  const species = specimen.species.replace(/_/g, ' ');
  parts.push(species);
  parts.push(`${specimen.sizeMB} MB — ${specimen.contigCount} contigs`);
  if (specimen.chromosomeCount) {
    parts.push(`${specimen.chromosomeCount} chromosomes`);
  }
  if (specimen.teachingNotes) {
    parts.push(specimen.teachingNotes);
  }
  return parts.join('\n');
}

function createSpecimenCard(specimen: SpecimenEntry, ctx: AppContext): HTMLElement {
  const card = document.createElement('div');
  card.className = 'specimen-card';
  card.dataset.specimenId = specimen.id;
  card.title = buildTooltip(specimen);
  card.innerHTML =
    `<span class="specimen-name">${esc(specimen.commonName)}</span>` +
    `<span class="specimen-species">${esc(specimen.species.replace(/_/g, ' '))}</span>` +
    `<div class="specimen-meta">` +
      `<span class="specimen-size">${specimen.sizeMB} MB</span>` +
      `<span class="specimen-difficulty ${esc(specimen.difficulty)}">${esc(specimen.difficulty)}</span>` +
    `</div>`;
  card.addEventListener('click', () => loadSpecimen(ctx, specimen));
  return card;
}

export async function setupSpecimenPicker(ctx: AppContext): Promise<void> {
  const grid = document.getElementById('specimen-grid');
  if (!grid) return;

  try {
    const catalog = await loadSpecimenCatalog();
    const tutorial = getTutorialSpecimens(catalog);

    for (const specimen of tutorial) {
      grid.appendChild(createSpecimenCard(specimen, ctx));
    }
  } catch {
    // Catalog not available (e.g. dev without data/) — fall back silently
    grid.innerHTML = '<span style="color: var(--text-secondary); font-size: 13px;">Example datasets not available</span>';
  }
}
