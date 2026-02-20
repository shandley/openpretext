/**
 * AnalysisExport — Export analysis results as BedGraph and TSV files.
 *
 * Insulation scores and compartment eigenvectors export as BedGraph
 * (standard genomic interval format for IGV, UCSC, etc.).
 * P(s) decay curves export as TSV with a comment header.
 *
 * Pure functions (exportXXX → string) plus download triggers (downloadXXX).
 */

import type { AppState } from '../core/State';
import type { InsulationResult } from '../analysis/InsulationScore';
import type { ContactDecayResult } from '../analysis/ContactDecay';
import type { CompartmentResult } from '../analysis/CompartmentAnalysis';

// ---------------------------------------------------------------------------
// Coordinate mapping
// ---------------------------------------------------------------------------

export interface PixelContigMapping {
  contigName: string;
  bpStart: number;
  bpEnd: number;
}

/**
 * Map each overview pixel to its owning contig and base-pair range.
 * Returns an array of length `overviewSize`.
 */
export function buildPixelToContigMap(
  appState: AppState,
  overviewSize: number,
): PixelContigMapping[] {
  if (!appState.map) return [];

  const { contigs, textureSize } = appState.map;
  const { contigOrder } = appState;

  // Build cumulative pixel ranges for each contig in display order
  const ranges: { name: string; texStart: number; texEnd: number; length: number }[] = [];
  let accumulated = 0;
  for (const contigId of contigOrder) {
    const contig = contigs[contigId];
    const len = contig.pixelEnd - contig.pixelStart;
    ranges.push({
      name: contig.name,
      texStart: accumulated,
      texEnd: accumulated + len,
      length: contig.length,
    });
    accumulated += len;
  }

  const result: PixelContigMapping[] = [];

  for (let p = 0; p < overviewSize; p++) {
    // Texture-space midpoint for this overview pixel
    const texMid = ((p + 0.5) / overviewSize) * textureSize;
    const texStart = (p / overviewSize) * textureSize;
    const texEnd = ((p + 1) / overviewSize) * textureSize;

    // Find owning contig by midpoint
    let ownerIdx = 0;
    for (let i = 0; i < ranges.length; i++) {
      if (texMid >= ranges[i].texStart && texMid < ranges[i].texEnd) {
        ownerIdx = i;
        break;
      }
      // If past all ranges, use the last one
      if (i === ranges.length - 1) ownerIdx = i;
    }

    const r = ranges[ownerIdx];
    const contigPixelSpan = r.texEnd - r.texStart;
    if (contigPixelSpan === 0) {
      result.push({ contigName: r.name, bpStart: 0, bpEnd: 0 });
      continue;
    }

    // Clamp texture coords to contig range
    const clampedStart = Math.max(texStart, r.texStart);
    const clampedEnd = Math.min(texEnd, r.texEnd);

    const bpStart = Math.round(((clampedStart - r.texStart) / contigPixelSpan) * r.length);
    const bpEnd = Math.round(((clampedEnd - r.texStart) / contigPixelSpan) * r.length);

    result.push({ contigName: r.name, bpStart, bpEnd });
  }

  return result;
}

// ---------------------------------------------------------------------------
// BedGraph formatting
// ---------------------------------------------------------------------------

function formatAnalysisBedGraph(
  trackName: string,
  values: Float32Array | Float64Array,
  pixelMap: PixelContigMapping[],
): string {
  const lines: string[] = [`track type=bedGraph name="${trackName}"`];
  const len = Math.min(values.length, pixelMap.length);

  for (let i = 0; i < len; i++) {
    const m = pixelMap[i];
    if (m.bpStart === m.bpEnd) continue;
    const val = Number.isFinite(values[i]) ? values[i] : 0;
    lines.push(`${m.contigName}\t${m.bpStart}\t${m.bpEnd}\t${val.toPrecision(6)}`);
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Public export functions (pure → string)
// ---------------------------------------------------------------------------

/**
 * Export insulation raw scores as BedGraph.
 */
export function exportInsulationBedGraph(
  result: InsulationResult,
  appState: AppState,
  overviewSize: number,
): string {
  const pixelMap = buildPixelToContigMap(appState, overviewSize);
  return formatAnalysisBedGraph('Insulation Score', result.rawScores, pixelMap);
}

/**
 * Export compartment eigenvector (signed) as BedGraph.
 */
export function exportCompartmentBedGraph(
  result: CompartmentResult,
  appState: AppState,
  overviewSize: number,
): string {
  const pixelMap = buildPixelToContigMap(appState, overviewSize);
  return formatAnalysisBedGraph('A/B Compartment Eigenvector', result.eigenvector, pixelMap);
}

/**
 * Export P(s) decay curve as TSV with comment header.
 */
export function exportDecayTSV(result: ContactDecayResult): string {
  const lines: string[] = [
    `# P(s) decay curve`,
    `# Decay exponent: ${result.decayExponent.toFixed(4)}`,
    `# R-squared: ${result.rSquared.toFixed(4)}`,
    `# Distance range: 1-${result.maxDistance} px`,
    `distance\tmean_contacts\tlog10_distance\tlog10_contacts`,
  ];

  for (let i = 0; i < result.distances.length; i++) {
    lines.push(
      `${result.distances[i]}\t${result.meanContacts[i].toPrecision(6)}\t` +
      `${result.logDistances[i].toFixed(4)}\t${result.logContacts[i].toFixed(4)}`
    );
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Download triggers
// ---------------------------------------------------------------------------

function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function defaultBasename(appState: AppState): string {
  if (appState.map?.filename) {
    return appState.map.filename.replace(/\.pretext$/i, '');
  }
  return 'analysis';
}

export function downloadInsulationBedGraph(
  result: InsulationResult,
  appState: AppState,
  overviewSize: number,
  filename?: string,
): void {
  const content = exportInsulationBedGraph(result, appState, overviewSize);
  triggerDownload(content, filename ?? `${defaultBasename(appState)}_insulation.bedgraph`);
}

export function downloadCompartmentBedGraph(
  result: CompartmentResult,
  appState: AppState,
  overviewSize: number,
  filename?: string,
): void {
  const content = exportCompartmentBedGraph(result, appState, overviewSize);
  triggerDownload(content, filename ?? `${defaultBasename(appState)}_compartments.bedgraph`);
}

export function downloadDecayTSV(
  result: ContactDecayResult,
  filename?: string,
): void {
  const content = exportDecayTSV(result);
  triggerDownload(content, filename ?? 'decay_curve.tsv');
}
