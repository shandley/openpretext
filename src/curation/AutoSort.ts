/**
 * AutoSort — Automated contig reordering using Hi-C link scores.
 *
 * Uses a Union Find greedy chaining algorithm that:
 * 1. Computes an intra-contig diagonal profile for normalization.
 * 2. Scores every contig pair across 4 orientations (HH/HT/TH/TT).
 * 3. Processes links from highest to lowest score, chaining contigs
 *    into chromosomes using a Union Find structure.
 *
 * Pure algorithm — no side effects or state mutations.
 */

import type { ContigInfo } from '../core/State';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Orientation of a contig pair: Head-Head, Head-Tail, Tail-Head, Tail-Tail. */
export type Orientation = 'HH' | 'HT' | 'TH' | 'TT';

export interface ContigLink {
  /** Index in contigOrder for the first contig. */
  i: number;
  /** Index in contigOrder for the second contig. */
  j: number;
  /** Best score across orientations. */
  score: number;
  /** Best orientation. */
  orientation: Orientation;
  /** Scores for all 4 orientations [HH, HT, TH, TT]. */
  allScores: [number, number, number, number];
}

export interface ChainEntry {
  /** Index in contigOrder. */
  orderIndex: number;
  /** Whether this contig should be inverted. */
  inverted: boolean;
}

export interface AutoSortResult {
  /** Chromosome chains, sorted largest-first. */
  chains: ChainEntry[][];
  /** All computed links (for diagnostics). */
  links: ContigLink[];
  /** Score threshold used. */
  threshold: number;
}

export interface AutoSortParams {
  /** Max diagonal distance to sample for scoring. */
  maxDiagonalDistance: number;
  /** Minimum signal to consider (avoid noise). */
  signalCutoff: number;
  /** Hard ceiling on threshold. */
  hardThreshold: number;
}

/** Contig range in overview pixels. */
export interface ContigRange {
  start: number;
  end: number;
  orderIndex: number;
}

const DEFAULT_PARAMS: AutoSortParams = {
  maxDiagonalDistance: 50,
  signalCutoff: 0.05,
  hardThreshold: 0.2,
};

// ---------------------------------------------------------------------------
// Intra-diagonal profile (normalization baseline)
// ---------------------------------------------------------------------------

/**
 * Compute the expected Hi-C intensity at each diagonal distance d,
 * averaged across all intra-contig diagonal pixels.
 *
 * @param contactMap - Flat Float32Array of size*size.
 * @param size - Contact map dimension.
 * @param contigRanges - Overview pixel ranges for each contig.
 * @param maxD - Maximum diagonal distance to compute.
 * @returns Float64Array of length maxD+1 where profile[d] is the average
 *          intensity at diagonal distance d.
 */
export function computeIntraDiagonalProfile(
  contactMap: Float32Array,
  size: number,
  contigRanges: ContigRange[],
  maxD: number,
): Float64Array {
  const sums = new Float64Array(maxD + 1);
  const counts = new Float64Array(maxD + 1);

  for (const range of contigRanges) {
    const len = range.end - range.start;
    for (let d = 1; d <= Math.min(maxD, len - 1); d++) {
      for (let p = range.start; p < range.end - d; p++) {
        const x = p;
        const y = p + d;
        if (x < size && y < size) {
          sums[d] += contactMap[y * size + x];
          counts[d]++;
        }
      }
    }
  }

  const profile = new Float64Array(maxD + 1);
  for (let d = 0; d <= maxD; d++) {
    profile[d] = counts[d] > 0 ? sums[d] / counts[d] : 0;
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Link scoring
// ---------------------------------------------------------------------------

/**
 * Score one contig pair for a given orientation.
 *
 * Samples anti-diagonal bands near the relevant corner of the inter-contig
 * block. For each band at distance d:
 *   bandScore = 1 - |observed - expected| / expected (clamped [0,1])
 * Weighted sum using 1/sqrt(d) weights.
 *
 * @param contactMap - Flat Float32Array.
 * @param size - Map dimension.
 * @param rangeI - Overview pixel range for contig I.
 * @param rangeJ - Overview pixel range for contig J.
 * @param invertI - Whether contig I is inverted in this orientation.
 * @param invertJ - Whether contig J is inverted in this orientation.
 * @param profile - Intra-diagonal normalization profile.
 * @param maxD - Maximum diagonal distance.
 * @returns Score in [0, 1].
 */
export function computeLinkScore(
  contactMap: Float32Array,
  size: number,
  rangeI: ContigRange,
  rangeJ: ContigRange,
  invertI: boolean,
  invertJ: boolean,
  profile: Float64Array,
  maxD: number,
): number {
  // Determine which corners to sample based on orientation.
  // The "relevant corner" is where the two contig ends are closest
  // on the diagonal — this is where Hi-C signal should be strongest
  // if the contigs are truly adjacent.
  //
  // For two contigs I (rows) and J (columns) in the inter-contig block:
  // - HH: tail of I, head of J → bottom-left corner of block
  // - HT: tail of I, tail of J → bottom-right corner
  // - TH: head of I, head of J → top-left corner
  // - TT: head of I, tail of J → top-right corner

  // Corner anchor points
  const iLen = rangeI.end - rangeI.start;
  const jLen = rangeJ.end - rangeJ.start;

  // The anchor pixel in I's range (row)
  const anchorI = invertI ? rangeI.start : rangeI.end - 1;
  // The anchor pixel in J's range (column)
  const anchorJ = invertJ ? rangeJ.end - 1 : rangeJ.start;

  let weightedSum = 0;
  let totalWeight = 0;

  for (let d = 1; d <= Math.min(maxD, Math.min(iLen, jLen)); d++) {
    // Sample a band at distance d from the corner
    let bandSum = 0;
    let bandCount = 0;

    for (let k = 0; k < d; k++) {
      // Two sample points per band distance
      const row1 = invertI ? anchorI + (d - k) : anchorI - (d - k);
      const col1 = invertJ ? anchorJ - k : anchorJ + k;

      const row2 = invertI ? anchorI + k : anchorI - k;
      const col2 = invertJ ? anchorJ - (d - k) : anchorJ + (d - k);

      if (row1 >= 0 && row1 < size && col1 >= 0 && col1 < size) {
        bandSum += contactMap[row1 * size + col1];
        bandCount++;
      }
      if (row2 >= 0 && row2 < size && col2 >= 0 && col2 < size) {
        bandSum += contactMap[row2 * size + col2];
        bandCount++;
      }
    }

    if (bandCount === 0) continue;
    const observed = bandSum / bandCount;
    const expected = d < profile.length ? profile[d] : 0;

    if (expected <= 0) continue;

    const bandScore = Math.max(0, Math.min(1, 1 - Math.abs(observed - expected) / expected));
    const weight = 1 / Math.sqrt(d);
    weightedSum += bandScore * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Compute all pairwise link scores across all 4 orientations.
 *
 * @returns ContigLink[] sorted by score descending.
 */
export function computeAllLinkScores(
  contactMap: Float32Array,
  size: number,
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
  params: AutoSortParams,
): ContigLink[] {
  const maxD = params.maxDiagonalDistance;

  // Build overview pixel ranges for each contig
  const ranges: ContigRange[] = [];
  let accumulated = 0;
  for (let i = 0; i < contigOrder.length; i++) {
    const contigId = contigOrder[i];
    const contig = contigs[contigId];
    const contigPixelLength = contig.pixelEnd - contig.pixelStart;
    const start = Math.round((accumulated / textureSize) * size);
    accumulated += contigPixelLength;
    const end = Math.round((accumulated / textureSize) * size);
    ranges.push({ start, end, orderIndex: i });
  }

  // Compute normalization profile
  const profile = computeIntraDiagonalProfile(contactMap, size, ranges, maxD);

  // Score all pairs across 4 orientations
  const links: ContigLink[] = [];
  const orientations: Array<[boolean, boolean]> = [
    [false, false], // HH: tail of I → head of J
    [false, true],  // HT: tail of I → tail of J
    [true, false],  // TH: head of I → head of J
    [true, true],   // TT: head of I → tail of J
  ];

  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const scores: [number, number, number, number] = [0, 0, 0, 0];

      for (let o = 0; o < 4; o++) {
        scores[o] = computeLinkScore(
          contactMap, size, ranges[i], ranges[j],
          orientations[o][0], orientations[o][1],
          profile, maxD,
        );
      }

      const bestIdx = scores.indexOf(Math.max(...scores));
      const bestScore = scores[bestIdx];

      if (bestScore >= params.signalCutoff) {
        const orientationNames: Orientation[] = ['HH', 'HT', 'TH', 'TT'];
        links.push({
          i,
          j,
          score: bestScore,
          orientation: orientationNames[bestIdx],
          allScores: scores,
        });
      }
    }
  }

  // Sort by score descending
  links.sort((a, b) => b.score - a.score);
  return links;
}

// ---------------------------------------------------------------------------
// Union Find chaining
// ---------------------------------------------------------------------------

/**
 * Union Find sort: build chromosome chains from scored links.
 *
 * Each contig starts as its own single-element chain. Links are processed
 * in descending score order. For each link, if both contigs are at chain
 * endpoints, the chains are merged (flipping orientations as needed).
 *
 * @param links - Sorted links (descending score).
 * @param numContigs - Total number of contigs.
 * @param threshold - Minimum score to consider a link.
 * @returns AutoSortResult with chains sorted largest-first.
 */
export function unionFindSort(
  links: ContigLink[],
  numContigs: number,
  threshold: number,
): AutoSortResult {
  // Each chain is an ordered list of { orderIndex, inverted }
  // We track which chain each contig belongs to, and whether it's
  // at the head (first) or tail (last) of the chain.

  type ChainNode = {
    chainId: number;
    isHead: boolean; // at the start of its chain
    isTail: boolean; // at the end of its chain
  };

  const chains: ChainEntry[][] = [];
  const nodeInfo: ChainNode[] = [];

  // Initialize: each contig is its own chain
  for (let i = 0; i < numContigs; i++) {
    chains.push([{ orderIndex: i, inverted: false }]);
    nodeInfo.push({ chainId: i, isHead: true, isTail: true });
  }

  for (const link of links) {
    if (link.score < threshold) break;

    const nodeI = nodeInfo[link.i];
    const nodeJ = nodeInfo[link.j];

    // Both must be at endpoints of different chains
    if (nodeI.chainId === nodeJ.chainId) continue;
    if (!(nodeI.isHead || nodeI.isTail)) continue;
    if (!(nodeJ.isHead || nodeJ.isTail)) continue;

    const chainI = chains[nodeI.chainId];
    const chainJ = chains[nodeJ.chainId];
    if (!chainI || !chainJ || chainI.length === 0 || chainJ.length === 0) continue;

    // Determine how to connect based on orientation
    // HH: tail of I → head of J (I's tail connects to J's head)
    // HT: tail of I → tail of J (I's tail connects to J's tail, so reverse J)
    // TH: head of I → head of J (I's head connects to J's head, so reverse I)
    // TT: head of I → tail of J (I's head connects to J's tail)
    //
    // But we need to check which ends of the chains our contigs are at,
    // and flip chains accordingly.

    let chainA = chainI;
    let chainB = chainJ;
    let needsReverseA = false;
    let needsReverseB = false;

    // We want contig I at the connection end of chain A,
    // and contig J at the connection end of chain B.
    //
    // For HH/HT: I should be at the TAIL of chainA
    // For TH/TT: I should be at the HEAD of chainA
    //
    // For HH/TH: J should be at the HEAD of chainB
    // For HT/TT: J should be at the TAIL of chainB

    const iShouldBeTail = link.orientation === 'HH' || link.orientation === 'HT';
    const jShouldBeHead = link.orientation === 'HH' || link.orientation === 'TH';

    // If I is at the head but should be at the tail, reverse chain A
    if (iShouldBeTail && nodeI.isHead && !nodeI.isTail) {
      needsReverseA = true;
    } else if (!iShouldBeTail && nodeI.isTail && !nodeI.isHead) {
      needsReverseA = true;
    }

    // If J is at the tail but should be at the head, reverse chain B
    if (jShouldBeHead && nodeJ.isTail && !nodeJ.isHead) {
      needsReverseB = true;
    } else if (!jShouldBeHead && nodeJ.isHead && !nodeJ.isHead) {
      needsReverseB = true;
    }

    if (needsReverseA) {
      chainA.reverse();
      chainA.forEach(e => e.inverted = !e.inverted);
    }
    if (needsReverseB) {
      chainB.reverse();
      chainB.forEach(e => e.inverted = !e.inverted);
    }

    // Handle inversion based on orientation
    // HT: J needs to be inverted (tail connects to tail)
    // TH: I needs to be inverted (head connects to head)
    if (link.orientation === 'HT') {
      // Reverse chain B and flip inversions
      chainB.reverse();
      chainB.forEach(e => e.inverted = !e.inverted);
    } else if (link.orientation === 'TH') {
      // Reverse chain A and flip inversions
      chainA.reverse();
      chainA.forEach(e => e.inverted = !e.inverted);
    } else if (link.orientation === 'TT') {
      // Both ends: reverse chain A
      chainA.reverse();
      chainA.forEach(e => e.inverted = !e.inverted);
    }

    // Merge: append chainB to chainA
    const mergedChain = [...chainA, ...chainB];
    const newChainId = nodeI.chainId;

    // Replace chainA with merged
    chains[newChainId] = mergedChain;
    // Empty chainB
    chains[nodeJ.chainId] = [];

    // Update all node info for the merged chain
    for (let k = 0; k < mergedChain.length; k++) {
      const entry = mergedChain[k];
      nodeInfo[entry.orderIndex] = {
        chainId: newChainId,
        isHead: k === 0,
        isTail: k === mergedChain.length - 1,
      };
    }
  }

  // Collect non-empty chains, sorted by length descending
  const resultChains = chains
    .filter(c => c.length > 0)
    .sort((a, b) => b.length - a.length);

  return {
    chains: resultChains,
    links,
    threshold,
  };
}

// ---------------------------------------------------------------------------
// Top-level autoSort
// ---------------------------------------------------------------------------

/**
 * Compute the proposed contig ordering using Hi-C link scores
 * and Union Find chaining.
 *
 * @param contactMap - The overview contact map.
 * @param size - Contact map dimension.
 * @param contigs - Full contigs array from MapData.
 * @param contigOrder - Current contig ordering.
 * @param textureSize - The texture size from MapData.
 * @param params - Algorithm parameters.
 * @returns AutoSortResult with proposed chains.
 */
export function autoSort(
  contactMap: Float32Array,
  size: number,
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
  params?: Partial<AutoSortParams>,
): AutoSortResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  // Compute all pairwise link scores
  const links = computeAllLinkScores(contactMap, size, contigs, contigOrder, textureSize, p);

  // Derive threshold: min of 85th percentile score and hard threshold
  let threshold = p.hardThreshold;
  if (links.length > 0) {
    const idx85 = Math.floor(links.length * 0.15); // 85th percentile (sorted descending)
    const p85 = links[idx85]?.score ?? 0;
    threshold = Math.min(p85, p.hardThreshold);
  }

  // Run Union Find chaining
  return unionFindSort(links, contigOrder.length, threshold);
}
