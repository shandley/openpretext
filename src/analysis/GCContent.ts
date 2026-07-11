/**
 * GCContent - orient the A/B compartment eigenvector using GC content.
 *
 * The compartment eigenvector separates the two compartments but its sign is
 * arbitrary, so "A" (active/gene-rich) vs "B" cannot be assigned from Hi-C
 * alone. GC content is the standard external proxy: the A compartment is
 * gene-rich and GC-rich. When a reference FASTA is loaded we compute GC per
 * overview bin and flip the eigenvector so the positive lobe is the higher-GC
 * one, making the A/B labels meaningful. Without a FASTA the sign stays
 * arbitrary and the labels are reported as unoriented.
 *
 * GC is computed in the file (original) bin order, matching the overview
 * `contactMap` the eigenvector is derived from.
 */

import type { MapData } from '../core/State';

/** Sampled GC fraction of a sequence (stride-sampled so a whole genome is cheap). */
function sampledGC(seq: string): number {
  const stride = Math.max(1, Math.floor(seq.length / 2000));
  let gc = 0;
  let valid = 0;
  for (let i = 0; i < seq.length; i += stride) {
    const ch = seq.charCodeAt(i) & ~0x20; // upper-case
    if (ch === 71 || ch === 67) { gc++; valid++; } // G, C
    else if (ch === 65 || ch === 84) { valid++; } // A, T
  }
  return valid > 0 ? gc / valid : NaN;
}

/**
 * Per-overview-bin GC content, in file (original) order. Bins with no covering
 * sequence are NaN. `size` is the overview dimension.
 */
export function computeBinGC(
  map: MapData,
  referenceSequences: Map<string, string>,
  size: number,
): Float32Array {
  const ts = map.textureSize;
  const gcSum = new Float64Array(size);
  const wSum = new Float64Array(size);

  for (const c of map.contigs) {
    const seq = referenceSequences.get(c.name);
    if (!seq) continue;
    const gc = sampledGC(seq);
    if (Number.isNaN(gc)) continue;

    const b0 = Math.max(0, Math.min(size, Math.round((c.pixelStart / ts) * size)));
    const b1 = Math.max(0, Math.min(size, Math.round((c.pixelEnd / ts) * size)));
    const span = Math.max(1, b1 - b0);
    const w = (c.pixelEnd - c.pixelStart) / span; // pixel weight per bin
    const lastBin = b1 > b0 ? b1 : b0 + 1;
    for (let b = b0; b < lastBin && b < size; b++) {
      gcSum[b] += gc * w;
      wSum[b] += w;
    }
  }

  const out = new Float32Array(size).fill(NaN);
  for (let b = 0; b < size; b++) {
    if (wSum[b] > 0) out[b] = gcSum[b] / wSum[b];
  }
  return out;
}

/**
 * Orient an eigenvector so its positive lobe is the higher-GC (A) compartment.
 * Flips the eigenvector in place when the positive lobe has lower mean GC.
 * Returns true when it could be oriented (both lobes had GC data).
 */
export function orientEigenvectorByGC(eigenvector: Float32Array, gcPerBin: Float32Array): boolean {
  let posGC = 0, posN = 0, negGC = 0, negN = 0;
  const n = Math.min(eigenvector.length, gcPerBin.length);
  for (let i = 0; i < n; i++) {
    const g = gcPerBin[i];
    if (Number.isNaN(g)) continue;
    const e = eigenvector[i];
    if (e > 0) { posGC += g; posN++; }
    else if (e < 0) { negGC += g; negN++; }
  }
  if (posN === 0 || negN === 0) return false;
  if (posGC / posN < negGC / negN) {
    for (let i = 0; i < eigenvector.length; i++) eigenvector[i] = -eigenvector[i];
  }
  return true;
}
