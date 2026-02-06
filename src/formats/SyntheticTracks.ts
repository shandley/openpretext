/**
 * Generate synthetic 1D annotation tracks for testing and demo purposes.
 *
 * Each function returns a Float32Array of the specified length with values
 * in the [0, 1] range, suitable for use with TrackRenderer.
 *
 * Available synthetic tracks:
 *   - Coverage: Gaussian-smoothed random values resembling read depth
 *   - GC content: Smooth sine-wave-based variation
 *   - Telomeres: Sparse markers at contig ends
 *   - Gaps: Markers at some contig boundaries
 */

import type { TrackConfig } from '../renderer/TrackRenderer';

// ---------------------------------------------------------------------------
// Individual track generators
// ---------------------------------------------------------------------------

/**
 * Generate a coverage-like track using Gaussian-smoothed random values.
 * Produces smooth rolling hills that resemble sequencing read depth.
 */
export function generateCoverageTrack(length: number, seed: number = 42): Float32Array {
  const data = new Float32Array(length);
  const rng = createSeededRng(seed);

  // Start with random noise
  for (let i = 0; i < length; i++) {
    data[i] = rng();
  }

  // Apply multiple passes of Gaussian-like smoothing (box blur approximation)
  const smoothed = gaussianSmooth(data, Math.max(4, Math.floor(length / 100)));

  // Add broad regional variation
  for (let i = 0; i < length; i++) {
    const regional = 0.3 * Math.sin(2 * Math.PI * i / length * 3.7)
      + 0.15 * Math.sin(2 * Math.PI * i / length * 7.3);
    smoothed[i] = smoothed[i] * 0.6 + (regional + 0.5) * 0.4;
  }

  // Normalize to [0, 1]
  normalizeArray(smoothed);

  return smoothed;
}

/**
 * Generate a GC content track using layered sine waves.
 * Produces smooth, slowly varying data that resembles GC% along a genome.
 */
export function generateGCContentTrack(length: number, seed: number = 137): Float32Array {
  const data = new Float32Array(length);
  const rng = createSeededRng(seed);

  for (let i = 0; i < length; i++) {
    const t = i / length;
    // Layered sine waves at different frequencies
    let value = 0.5;
    value += 0.15 * Math.sin(2 * Math.PI * t * 2.3 + 1.0);
    value += 0.10 * Math.sin(2 * Math.PI * t * 5.7 + 2.3);
    value += 0.08 * Math.sin(2 * Math.PI * t * 11.1 + 0.7);
    value += 0.05 * Math.sin(2 * Math.PI * t * 23.0 + 4.1);
    // Small random perturbation
    value += (rng() - 0.5) * 0.04;
    data[i] = value;
  }

  // Light smoothing
  const smoothed = gaussianSmooth(data, Math.max(2, Math.floor(length / 200)));

  normalizeArray(smoothed);
  return smoothed;
}

/**
 * Generate telomere markers at some contig ends.
 * Returns sparse data: 1.0 at marker positions, 0.0 elsewhere.
 *
 * @param length - Total number of pixels (textureSize)
 * @param contigBoundaries - Array of pixel positions where contigs end
 * @param probability - Probability that a contig end gets a telomere marker (0-1)
 */
export function generateTelomereTrack(
  length: number,
  contigBoundaries: number[],
  probability: number = 0.6,
  seed: number = 99,
): Float32Array {
  const data = new Float32Array(length);
  const rng = createSeededRng(seed);

  // Mark some contig starts and ends as telomeres
  let prevEnd = 0;
  for (const boundary of contigBoundaries) {
    // Mark start of contig
    if (rng() < probability && prevEnd >= 0 && prevEnd < length) {
      setMarkerRegion(data, prevEnd, length);
    }
    // Mark end of contig (just before boundary)
    const endPos = boundary - 1;
    if (rng() < probability && endPos >= 0 && endPos < length) {
      setMarkerRegion(data, endPos, length);
    }
    prevEnd = boundary;
  }

  return data;
}

/**
 * Generate gap markers at some contig boundaries.
 * Indicates assembly gaps between contigs.
 *
 * @param length - Total number of pixels (textureSize)
 * @param contigBoundaries - Array of pixel positions where contigs end
 * @param probability - Probability that a boundary gets a gap marker (0-1)
 */
export function generateGapTrack(
  length: number,
  contigBoundaries: number[],
  probability: number = 0.4,
  seed: number = 77,
): Float32Array {
  const data = new Float32Array(length);
  const rng = createSeededRng(seed);

  for (const boundary of contigBoundaries) {
    if (rng() < probability) {
      setMarkerRegion(data, boundary, length);
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// High-level helper: generate all demo tracks at once
// ---------------------------------------------------------------------------

/**
 * Generate a complete set of demo tracks for the given map dimensions.
 *
 * @param textureSize - Total 1D pixel dimension of the contact map
 * @param contigBoundaries - Pixel positions where contigs end (exclusive)
 * @returns Array of TrackConfig objects ready for TrackRenderer.addTrack()
 */
export function generateDemoTracks(
  textureSize: number,
  contigBoundaries: number[],
): TrackConfig[] {
  return [
    {
      name: 'Coverage',
      type: 'line',
      data: generateCoverageTrack(textureSize),
      color: 'rgb(100, 200, 255)',
      height: 40,
      visible: true,
    },
    {
      name: 'GC Content',
      type: 'heatmap',
      data: generateGCContentTrack(textureSize),
      color: 'rgb(255, 200, 50)',
      height: 12,
      visible: true,
    },
    {
      name: 'Telomeres',
      type: 'marker',
      data: generateTelomereTrack(textureSize, contigBoundaries),
      color: 'rgb(255, 80, 80)',
      height: 16,
      visible: true,
    },
    {
      name: 'Gaps',
      type: 'marker',
      data: generateGapTrack(textureSize, contigBoundaries),
      color: 'rgb(255, 200, 0)',
      height: 16,
      visible: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/**
 * Simple seeded pseudo-random number generator (mulberry32).
 * Returns values in [0, 1).
 */
function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Apply approximate Gaussian smoothing using three passes of a box blur.
 * This is the standard approach for an O(n) Gaussian approximation.
 */
function gaussianSmooth(input: Float32Array<ArrayBuffer>, radius: number): Float32Array<ArrayBuffer> {
  let current = new Float32Array(input.length);
  current.set(input);
  for (let pass = 0; pass < 3; pass++) {
    current = boxBlur(current, radius);
  }
  return current;
}

function boxBlur(input: Float32Array<ArrayBuffer>, radius: number): Float32Array<ArrayBuffer> {
  const len = input.length;
  const output = new Float32Array(len);
  const diameter = radius * 2 + 1;

  let sum = 0;
  // Initialize window
  for (let i = 0; i < Math.min(radius + 1, len); i++) {
    sum += input[i];
  }

  for (let i = 0; i < len; i++) {
    output[i] = sum / diameter;
    // Add the element entering the window on the right
    const addIdx = i + radius + 1;
    if (addIdx < len) {
      sum += input[addIdx];
    }
    // Remove the element leaving the window on the left
    const removeIdx = i - radius;
    if (removeIdx >= 0) {
      sum -= input[removeIdx];
    }
  }

  return output;
}

/**
 * Normalize a Float32Array in-place to the [0, 1] range.
 */
function normalizeArray(arr: Float32Array): void {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  const range = max - min;
  if (range === 0) {
    arr.fill(0.5);
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    arr[i] = (arr[i] - min) / range;
  }
}

/**
 * Set a small region around `position` to 1.0 in the marker array.
 * This gives markers a visible width even when zoomed out.
 */
function setMarkerRegion(data: Float32Array, position: number, length: number): void {
  const markerWidth = Math.max(1, Math.floor(length / 2000));
  const start = Math.max(0, position - markerWidth);
  const end = Math.min(length, position + markerWidth + 1);
  for (let i = start; i < end; i++) {
    data[i] = 1.0;
  }
}
