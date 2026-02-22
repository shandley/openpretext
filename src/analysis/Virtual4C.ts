/**
 * Virtual4C — Virtual 4C contact profiling from a single viewpoint.
 *
 * Extracts the contact row at a given viewpoint bin, optionally normalizes
 * by distance-expected values, and optionally log2-transforms.
 *
 * Pure algorithm — no DOM dependencies.
 */

import { computeExpectedContacts } from './CompartmentAnalysis';
import type { TrackConfig } from '../renderer/TrackRenderer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Virtual4CParams {
  /** Viewpoint bin index. */
  viewpoint: number;
  /** Normalize by distance-expected. Default: true. */
  normalize: boolean;
  /** Log2 transform after normalization. Default: false. */
  logTransform: boolean;
}

export interface Virtual4CResult {
  /** Raw contact values from the viewpoint row. Length = size. */
  rawProfile: Float32Array;
  /** Distance-normalized profile (O/E). Length = size. */
  normalizedProfile: Float32Array;
  /** Display profile (normalized, optionally log-transformed, [0,1] scaled). Length = size. */
  displayProfile: Float32Array;
  /** Viewpoint bin index. */
  viewpoint: number;
}

const DEFAULT_PARAMS: Virtual4CParams = {
  viewpoint: 0,
  normalize: true,
  logTransform: false,
};

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Extract a contact profile from a single viewpoint bin.
 */
export function extractViewpointRow(
  contactMap: Float32Array,
  size: number,
  viewpoint: number,
): Float32Array {
  const profile = new Float32Array(size);
  if (viewpoint < 0 || viewpoint >= size) return profile;

  for (let j = 0; j < size; j++) {
    profile[j] = contactMap[viewpoint * size + j];
  }
  return profile;
}

/**
 * Normalize a contact profile by distance-expected values.
 */
export function normalizeByExpected(
  profile: Float32Array,
  expected: Float64Array,
  viewpoint: number,
): Float32Array {
  const n = profile.length;
  const result = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const d = Math.abs(j - viewpoint);
    const exp = d < expected.length ? expected[d] : 0;
    result[j] = exp > 0 ? profile[j] / exp : 0;
  }
  return result;
}

/**
 * Scale values to [0, 1] for track display.
 * Optionally applies log2 transform before scaling.
 */
export function scaleForDisplay(
  profile: Float32Array,
  logTransform: boolean,
): Float32Array {
  const n = profile.length;
  if (n === 0) return new Float32Array(0);

  const transformed = new Float32Array(n);

  if (logTransform) {
    for (let i = 0; i < n; i++) {
      transformed[i] = profile[i] > 0 ? Math.log2(profile[i]) : 0;
    }
  } else {
    for (let i = 0; i < n; i++) {
      transformed[i] = profile[i];
    }
  }

  // Min-max scale to [0, 1]
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (transformed[i] < min) min = transformed[i];
    if (transformed[i] > max) max = transformed[i];
  }

  const range = max - min;
  const result = new Float32Array(n);
  if (range <= 0) {
    result.fill(0.5);
    return result;
  }

  for (let i = 0; i < n; i++) {
    result[i] = (transformed[i] - min) / range;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Compute Virtual 4C profile from a viewpoint bin.
 */
export function computeVirtual4C(
  contactMap: Float32Array,
  size: number,
  params?: Partial<Virtual4CParams>,
): Virtual4CResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  if (size === 0 || p.viewpoint < 0 || p.viewpoint >= size) {
    return {
      rawProfile: new Float32Array(0),
      normalizedProfile: new Float32Array(0),
      displayProfile: new Float32Array(0),
      viewpoint: p.viewpoint,
    };
  }

  const rawProfile = extractViewpointRow(contactMap, size, p.viewpoint);

  let normalizedProfile: Float32Array;
  if (p.normalize) {
    const expected = computeExpectedContacts(contactMap, size);
    normalizedProfile = normalizeByExpected(rawProfile, expected, p.viewpoint);
  } else {
    normalizedProfile = Float32Array.from(rawProfile);
  }

  const displayProfile = scaleForDisplay(normalizedProfile, p.logTransform);

  return { rawProfile, normalizedProfile, displayProfile, viewpoint: p.viewpoint };
}

// ---------------------------------------------------------------------------
// Track conversion
// ---------------------------------------------------------------------------

/**
 * Convert Virtual4C result to a track for display.
 */
export function virtual4CToTrack(
  result: Virtual4CResult,
  overviewSize: number,
  textureSize: number,
): TrackConfig {
  const data = new Float32Array(textureSize);
  for (let tp = 0; tp < textureSize; tp++) {
    const op = Math.min(
      Math.floor((tp / textureSize) * overviewSize),
      overviewSize - 1,
    );
    data[tp] = result.displayProfile[op];
  }

  return {
    name: `Virtual 4C (bin ${result.viewpoint})`,
    type: 'line',
    data,
    color: '#ff8c32',
    height: 40,
    visible: true,
  };
}
