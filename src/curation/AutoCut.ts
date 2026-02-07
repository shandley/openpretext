/**
 * AutoCut — Automated breakpoint detection for misassembly correction.
 *
 * Analyzes the diagonal Hi-C signal density in the overview contactMap
 * to detect discontinuities that indicate misassembly breakpoints.
 * Each detected breakpoint maps to a pixel offset within a contig that
 * can be passed to CurationEngine.cut().
 *
 * Pure algorithm — no side effects or state mutations.
 */

import type { ContigInfo } from '../core/State';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Breakpoint {
  /** Pixel offset within the contig (texture-space). */
  offset: number;
  /** Confidence score (higher = more certain). */
  confidence: number;
}

export interface AutoCutParams {
  /** Relative drop threshold to consider a breakpoint (0–1). */
  cutThreshold: number;
  /** Half-window size (in pixels) for density averaging. */
  windowSize: number;
  /** Minimum fragment size (in pixels) after cutting. */
  minFragmentSize: number;
  /** Off-diagonal signal ratio above which a candidate is rejected as centromeric. */
  offDiagonalThreshold: number;
}

export interface AutoCutResult {
  /** Breakpoints grouped by contigOrderIndex. */
  breakpoints: Map<number, Breakpoint[]>;
  /** Total number of breakpoints detected. */
  totalBreakpoints: number;
}

const DEFAULT_PARAMS: AutoCutParams = {
  cutThreshold: 0.30,
  windowSize: 8,
  minFragmentSize: 16,
  offDiagonalThreshold: 0.3,
};

// ---------------------------------------------------------------------------
// Diagonal density computation
// ---------------------------------------------------------------------------

/**
 * Compute the mean Hi-C intensity along the diagonal for a contig's range.
 *
 * For each pixel position p in [startPixel, endPixel), we average a small
 * window around the diagonal (p, p) in the contactMap.
 *
 * @param contactMap - Flat Float32Array of size*size.
 * @param size - Dimension of the contact map (e.g., 1024).
 * @param startPixel - Start pixel of the contig range in the overview map.
 * @param endPixel - End pixel of the contig range in the overview map.
 * @param windowSize - Half-window radius for averaging around the diagonal.
 * @returns Float64Array of length (endPixel - startPixel) with density values.
 */
export function computeDiagonalDensity(
  contactMap: Float32Array,
  size: number,
  startPixel: number,
  endPixel: number,
  windowSize: number,
): Float64Array {
  const len = endPixel - startPixel;
  const density = new Float64Array(len);

  for (let i = 0; i < len; i++) {
    const p = startPixel + i;
    let sum = 0;
    let count = 0;

    // Sample a small band around the diagonal at position p
    for (let d = 1; d <= windowSize; d++) {
      // Above diagonal: (p - d, p + d) and (p + d, p - d)
      const x1 = p;
      const y1 = p + d;
      const x2 = p + d;
      const y2 = p;

      if (y1 < size && x1 >= 0) {
        sum += contactMap[y1 * size + x1];
        count++;
      }
      if (x2 < size && y2 >= 0) {
        sum += contactMap[y2 * size + x2];
        count++;
      }
    }

    density[i] = count > 0 ? sum / count : 0;
  }

  return density;
}

// ---------------------------------------------------------------------------
// Off-diagonal verification
// ---------------------------------------------------------------------------

/**
 * Compute the ratio of off-diagonal signal at a breakpoint versus
 * the median off-diagonal signal at reference split positions within
 * the same contig.
 *
 * Centromeres dip on the diagonal but maintain strong off-diagonal signal
 * between chromosome arms (ratio ≈ 1).  Real misassemblies dip on BOTH
 * diagonal and off-diagonal because the two misjoined pieces lack
 * inter-contacts (ratio ≈ 0).
 *
 * @returns Ratio of BP off-diagonal mean to median reference off-diagonal.
 *          High (≥ threshold) → centromere; Low → real misassembly.
 */
function computeOffDiagonalScore(
  contactMap: Float32Array,
  size: number,
  overviewStart: number,
  overviewEnd: number,
  breakpointOverviewPos: number,
  _windowSize: number,
): number {
  const overviewLength = overviewEnd - overviewStart;
  if (overviewLength < 6) return 1; // too small to judge

  // Compute mean off-diagonal signal for a virtual split at `splitPos`
  // (absolute pixel coordinate) within [overviewStart, overviewEnd).
  function offDiagMean(splitPos: number): number {
    const leftLen = splitPos - overviewStart;
    const rightLen = overviewEnd - splitPos;
    if (leftLen < 2 || rightLen < 2) return 0;
    const maxSamples = 100;
    const leftStride = Math.max(1, Math.floor(leftLen / maxSamples));
    const rightStride = Math.max(1, Math.floor(rightLen / maxSamples));
    let sum = 0;
    let count = 0;
    for (let r = overviewStart; r < splitPos; r += leftStride) {
      for (let c = splitPos; c < overviewEnd; c += rightStride) {
        sum += contactMap[c * size + r] + contactMap[r * size + c];
        count += 2;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  // Off-diagonal at the breakpoint
  const bpAbsolute = overviewStart + breakpointOverviewPos;
  const bpOffDiag = offDiagMean(bpAbsolute);

  // Compute off-diagonal at reference positions (20%–80% of contig, step 10%)
  // excluding positions too close to the breakpoint.
  const refValues: number[] = [];
  for (let frac = 0.2; frac <= 0.8; frac += 0.1) {
    const pos = overviewStart + Math.floor(overviewLength * frac);
    if (Math.abs(pos - bpAbsolute) < overviewLength * 0.1) continue;
    const val = offDiagMean(pos);
    if (val > 0) refValues.push(val);
  }

  if (refValues.length === 0) return 1; // no reference — don't filter

  // Use median reference value
  refValues.sort((a, b) => a - b);
  const medianRef = refValues[Math.floor(refValues.length / 2)];

  if (medianRef <= 0) return 1;

  return bpOffDiag / medianRef;
}

// ---------------------------------------------------------------------------
// Breakpoint detection
// ---------------------------------------------------------------------------

/**
 * Detect breakpoints in a density curve by finding low-density regions.
 *
 * 1. Compute a smoothed baseline by averaging density over a wide window.
 * 2. Mark positions where density drops significantly below the baseline.
 * 3. Find contiguous low-density regions and pick the midpoint of each
 *    as a breakpoint.
 * 4. Enforce minimum fragment size.
 *
 * @param density - Float64Array density curve for a single contig.
 * @param windowSize - Window size for smoothing.
 * @param cutThreshold - Relative drop threshold (0–1).
 * @param minFragmentSize - Minimum pixels between breakpoints / edges.
 * @returns Array of breakpoints with offset (relative to density start) and confidence.
 */
export function detectBreakpoints(
  density: Float64Array,
  windowSize: number,
  cutThreshold: number,
  minFragmentSize: number,
): Breakpoint[] {
  const len = density.length;
  if (len < minFragmentSize * 2) return [];

  // Compute local baseline using a wide sliding window (4x windowSize)
  const baselineWindow = windowSize * 4;
  const localBaseline = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    let count = 0;
    const lo = Math.max(0, i - baselineWindow);
    const hi = Math.min(len, i + baselineWindow + 1);
    for (let j = lo; j < hi; j++) {
      if (density[j] > 0) {
        sum += density[j];
        count++;
      }
    }
    localBaseline[i] = count > 0 ? sum / count : 0;
  }

  // Check if there's any signal at all
  const hasSignal = localBaseline.some(v => v > 0);
  if (!hasSignal) return [];

  // Mark positions that are significantly below local baseline
  const isLow = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    if (localBaseline[i] <= 0) continue;
    const drop = (localBaseline[i] - density[i]) / localBaseline[i];
    if (drop > cutThreshold) {
      isLow[i] = 1;
    }
  }

  // Find contiguous low-density regions
  const regions: Array<{ start: number; end: number }> = [];
  let regionStart = -1;
  for (let i = 0; i < len; i++) {
    if (isLow[i]) {
      if (regionStart < 0) regionStart = i;
    } else {
      if (regionStart >= 0) {
        regions.push({ start: regionStart, end: i });
        regionStart = -1;
      }
    }
  }
  if (regionStart >= 0) {
    regions.push({ start: regionStart, end: len });
  }

  // Filter out narrow regions — real misassemblies create wider disruptions
  const minRegionWidth = Math.max(3, Math.floor(windowSize / 2));
  const wideRegions = regions.filter(r => (r.end - r.start) >= minRegionWidth);

  // For each region, pick the midpoint as the breakpoint
  const candidates: Breakpoint[] = [];
  for (const region of wideRegions) {
    const mid = Math.floor((region.start + region.end) / 2);
    const regionBaseline = localBaseline[mid];
    // Confidence: how much the region density drops relative to local baseline
    let regionSum = 0;
    for (let i = region.start; i < region.end; i++) {
      regionSum += density[i];
    }
    const regionAvg = regionSum / (region.end - region.start);
    const confidence = regionBaseline > 0 ? Math.max(0, (regionBaseline - regionAvg) / regionBaseline) : 0;
    candidates.push({ offset: mid, confidence });
  }

  // Enforce minimum fragment size from edges and between breakpoints
  return enforceMinFragmentSize(candidates, len, minFragmentSize);
}

/**
 * Merge breakpoints that are within `mergeDistance` of each other,
 * keeping the one with the highest confidence.
 */
function mergeNearbyBreakpoints(breakpoints: Breakpoint[], mergeDistance: number): Breakpoint[] {
  if (breakpoints.length === 0) return [];

  // Sort by offset
  const sorted = [...breakpoints].sort((a, b) => a.offset - b.offset);
  const result: Breakpoint[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = result[result.length - 1];
    if (sorted[i].offset - last.offset <= mergeDistance) {
      // Keep the higher confidence one
      if (sorted[i].confidence > last.confidence) {
        result[result.length - 1] = sorted[i];
      }
    } else {
      result.push(sorted[i]);
    }
  }

  return result;
}

/**
 * Remove breakpoints that would create fragments smaller than minSize
 * from the edges or from each other.
 */
function enforceMinFragmentSize(breakpoints: Breakpoint[], totalLength: number, minSize: number): Breakpoint[] {
  const result: Breakpoint[] = [];
  let lastPosition = 0;

  for (const bp of breakpoints) {
    // Check distance from last cut (or start)
    if (bp.offset - lastPosition < minSize) continue;
    // Check distance to end
    if (totalLength - bp.offset < minSize) continue;
    result.push(bp);
    lastPosition = bp.offset;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Top-level autoCut
// ---------------------------------------------------------------------------

/**
 * Compute breakpoints for all contigs in the current assembly.
 *
 * Maps overview-pixel offsets back to texture-space offsets suitable for
 * CurationEngine.cut().
 *
 * @param contactMap - The overview contact map (Float32Array, size*size).
 * @param size - Contact map dimension (e.g., 1024).
 * @param contigs - Full contigs array from MapData.
 * @param contigOrder - Current contig ordering.
 * @param textureSize - The texture size from MapData.
 * @param params - Algorithm parameters (optional, uses defaults).
 * @returns AutoCutResult with breakpoints per contig.
 */
export function autoCut(
  contactMap: Float32Array,
  size: number,
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
  params?: Partial<AutoCutParams>,
): AutoCutResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const breakpoints = new Map<number, Breakpoint[]>();
  let totalBreakpoints = 0;

  // Compute the pixel scale factor from overview to texture space.
  // The overview contactMap is `size x size` but contigs use texture-space
  // coordinates (pixelStart/pixelEnd in [0, textureSize]).
  // We need to map overview pixel positions to contig-relative offsets.

  // First, compute the accumulated overview position for each contig
  // (same logic as rebuildContigBoundaries but in pixel units).
  let overviewAccumulated = 0;

  for (let orderIdx = 0; orderIdx < contigOrder.length; orderIdx++) {
    const contigId = contigOrder[orderIdx];
    const contig = contigs[contigId];
    const contigPixelLength = contig.pixelEnd - contig.pixelStart;

    // Map contig's range to overview pixels
    const overviewStart = Math.round((overviewAccumulated / textureSize) * size);
    overviewAccumulated += contigPixelLength;
    const overviewEnd = Math.round((overviewAccumulated / textureSize) * size);

    const overviewLength = overviewEnd - overviewStart;
    if (overviewLength < p.minFragmentSize * 2) continue;

    // Compute diagonal density for this contig's overview region
    const density = computeDiagonalDensity(contactMap, size, overviewStart, overviewEnd, p.windowSize);

    // Detect breakpoints in the density curve
    const bps = detectBreakpoints(density, p.windowSize, p.cutThreshold, p.minFragmentSize);

    if (bps.length > 0) {
      // Verify candidates with off-diagonal signal — reject centromeric dips
      const verifiedBps = bps.filter(bp => {
        const offDiagScore = computeOffDiagonalScore(
          contactMap, size, overviewStart, overviewEnd, bp.offset, p.windowSize,
        );
        return offDiagScore < p.offDiagonalThreshold;
      });

      // Map overview-pixel offsets back to texture-space offsets
      const scale = contigPixelLength / overviewLength;
      const textureBreakpoints = verifiedBps.map(bp => ({
        offset: Math.round(bp.offset * scale),
        confidence: bp.confidence,
      })).filter(bp => bp.offset > 0 && bp.offset < contigPixelLength && bp.confidence > 0.5);

      if (textureBreakpoints.length > 0) {
        breakpoints.set(orderIdx, textureBreakpoints);
        totalBreakpoints += textureBreakpoints.length;
      }
    }
  }

  return { breakpoints, totalBreakpoints };
}
