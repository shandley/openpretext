/**
 * Auto-contrast — choose default signalFloor/signalCeil for a freshly loaded
 * overview so dense, compact genomes do not render as a saturated red block.
 *
 * The overview is already normalized to [0,1]. We look at the distribution of
 * OFF-DIAGONAL values (the main diagonal is always saturated and would skew the
 * estimate high; empty bins ARE included, because the signal we want is what
 * fraction of the off-diagonal is bright). When the typical off-diagonal value
 * is itself bright (a small, dense genome whose bins are nearly all in contact
 * at overview scale, so few are empty), we raise the floor to that background
 * level so it whitens and the real structure regains contrast. A clean assembly,
 * whose off-diagonal is mostly empty, has a background near 0 and is untouched.
 *
 * This is deliberately conservative. A map whose background is already low
 * (the common case, including every well-behaved vertebrate assembly) is left at
 * floor 0, so nothing that already renders well is altered. The floor only rises
 * for maps that were saturating, and it only whitens background that was already
 * an indistinguishable red wash, so no signal that a curator could actually see
 * is hidden. The result is a default; the floor/ceil sliders remain free to move.
 */

/** Below this background level, leave the floor at 0 (map already readable). */
const SATURATION_THRESHOLD = 0.25;
/** Never floor above this, so we whiten no more than necessary. */
const MAX_AUTO_FLOOR = 0.7;
/** Percentile of nonzero off-diagonal values used as the background estimate. */
const BACKGROUND_PERCENTILE = 0.5;

export interface AutoContrast {
  floor: number;
  ceil: number;
  /** Background estimate that drove the decision (for diagnostics/tests). */
  background: number;
}

export function computeAutoContrast(contactMap: Float32Array): AutoContrast {
  const dim = Math.round(Math.sqrt(contactMap.length));
  if (dim < 4) return { floor: 0, ceil: 1, background: 0 };

  const BINS = 256;
  const hist = new Uint32Array(BINS);
  let count = 0;
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      if (i === j) continue;                 // skip the always-saturated diagonal
      const v = contactMap[i * dim + j];     // empty bins (0) included on purpose
      hist[Math.min(BINS - 1, Math.max(0, (v * BINS) | 0))]++;
      count++;
    }
  }
  if (count === 0) return { floor: 0, ceil: 1, background: 0 };

  const target = BACKGROUND_PERCENTILE * count;
  let cum = 0;
  let background = 1;
  for (let b = 0; b < BINS; b++) {
    cum += hist[b];
    if (cum >= target) { background = b / BINS; break; }
  }

  const floor = background > SATURATION_THRESHOLD ? Math.min(background, MAX_AUTO_FLOOR) : 0;
  return { floor, ceil: 1, background };
}
