/**
 * FastaTracks - compute curator overlay tracks from a reference FASTA, for
 * files that do not carry them embedded (i.e. were not built by
 * curationpretext). Produces the same per-pixel, file-order arrays as the
 * embedded graph extensions, so they flow through the same normalization and
 * display-order reorder path.
 *
 * Gaps are read from N-runs in each contig's sequence. Telomeres reuse the
 * existing motif detector. Coverage and repeat density need external data
 * (read alignments, a repeat masker) and are loaded via BedGraph import, not
 * computed here.
 */

import type { MapData } from '../core/State';
import { detectTelomeres } from './TelomereDetector';

/**
 * Compute per-pixel, file-order marker arrays (length textureSize) for the
 * tracks derivable from sequence: gaps and telomeres. Returns only the tracks
 * that have any signal. Keyed by a name that classifies to the right track
 * (e.g. "gaps" -> Gaps, "telomeres" -> Telomeres).
 */
export function computeFastaTrackData(
  map: MapData,
  referenceSequences: Map<string, string>,
): Map<string, Int32Array> {
  const ts = map.textureSize;
  const result = new Map<string, Int32Array>();

  // --- Gaps: runs of N in each contig's sequence ---
  const gaps = new Int32Array(ts);
  let anyGap = false;
  for (const c of map.contigs) {
    const seq = referenceSequences.get(c.name);
    if (!seq) continue;
    const span = c.pixelEnd - c.pixelStart;
    const len = c.length > 0 ? c.length : seq.length;
    if (span <= 0 || len <= 0) continue;
    const re = /[Nn]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seq)) !== null) {
      const bpStart = m.index;
      const bpEnd = m.index + m[0].length;
      const px0 = Math.max(0, Math.floor(c.pixelStart + (bpStart / len) * span));
      let px1 = Math.ceil(c.pixelStart + (bpEnd / len) * span);
      if (px1 <= px0) px1 = px0 + 1;
      for (let p = px0; p < px1 && p < ts; p++) {
        gaps[p] = 1;
        anyGap = true;
      }
    }
  }
  if (anyGap) result.set('gaps', gaps);

  // --- Telomeres: motif hits at contig ends (reuse the detector) ---
  const names = map.contigs.map((c) => c.name);
  const lengths = map.contigs.map((c) => c.length);
  const telo = detectTelomeres(referenceSequences, names, lengths);
  if (telo.hits.length > 0) {
    const tel = new Int32Array(ts);
    let anyTelo = false;
    for (const hit of telo.hits) {
      const c = map.contigs[hit.contigIndex];
      if (!c) continue;
      // 5p end -> the contig's start pixel, 3p end -> its last pixel, in file
      // coordinates; the display reorder flips these for inverted contigs.
      const px = hit.end === '5p' ? Math.round(c.pixelStart) : Math.round(c.pixelEnd) - 1;
      if (px >= 0 && px < ts) {
        tel[px] = 1;
        anyTelo = true;
      }
    }
    if (anyTelo) result.set('telomeres', tel);
  }

  return result;
}
