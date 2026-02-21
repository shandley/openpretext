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
  /** Chains smaller than this are candidates for merging. */
  minChainSize: number;
  /** Minimum link score to merge chains. */
  mergeThreshold: number;
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
  minChainSize: 3,
  mergeThreshold: 0.05,
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
  // Corner anchor points
  const iLen = rangeI.end - rangeI.start;
  const jLen = rangeJ.end - rangeJ.start;

  // Too few pixels for reliable orientation scoring
  if (iLen < 4 || jLen < 4) return 0;

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
    } else if (!jShouldBeHead && nodeJ.isHead && !nodeJ.isTail) {
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
// Chain merge post-processing
// ---------------------------------------------------------------------------

/**
 * Legacy second-pass chain merge (kept for backward compatibility).
 * Only merges chains where at least one has fewer than `minChainSize` contigs.
 * @deprecated Use hierarchicalChainMerge instead.
 */
export function mergeSmallChains(
  result: AutoSortResult,
  links: ContigLink[],
  minChainSize: number = 3,
  mergeThreshold: number = 0.05,
): AutoSortResult {
  // Build a working copy of chains
  const chains: ChainEntry[][] = result.chains.map(c => [...c]);

  // Build a map from orderIndex -> index in chains array
  const chainIndexOf = new Map<number, number>();
  for (let ci = 0; ci < chains.length; ci++) {
    for (const entry of chains[ci]) {
      chainIndexOf.set(entry.orderIndex, ci);
    }
  }

  // Links are already sorted by score descending
  for (const link of links) {
    if (link.score < mergeThreshold) break;

    const ciA = chainIndexOf.get(link.i);
    const ciB = chainIndexOf.get(link.j);

    // Both must be found and in different chains
    if (ciA === undefined || ciB === undefined) continue;
    if (ciA === ciB) continue;

    const chainA = chains[ciA];
    const chainB = chains[ciB];

    // At least one chain must be small
    if (chainA.length >= minChainSize && chainB.length >= minChainSize) continue;

    // Merge smaller into larger (append smaller to end of larger)
    let keepIdx: number;
    let mergeIdx: number;
    if (chainA.length >= chainB.length) {
      keepIdx = ciA;
      mergeIdx = ciB;
    } else {
      keepIdx = ciB;
      mergeIdx = ciA;
    }

    const kept = chains[keepIdx];
    const merged = chains[mergeIdx];

    // Append merged chain entries to kept chain
    for (const entry of merged) {
      kept.push(entry);
      chainIndexOf.set(entry.orderIndex, keepIdx);
    }

    // Empty the merged chain
    chains[mergeIdx] = [];
  }

  // Collect non-empty chains, sorted by length descending
  const resultChains = chains
    .filter(c => c.length > 0)
    .sort((a, b) => b.length - a.length);

  return {
    chains: resultChains,
    links: result.links,
    threshold: result.threshold,
  };
}

// ---------------------------------------------------------------------------
// Hierarchical / agglomerative chain merge
// ---------------------------------------------------------------------------

/**
 * Compute the average intra-chain link score for a given chain.
 *
 * Measures how strongly the contigs within a chain are linked to each other.
 * Used as a baseline for the safety guard that prevents merging chains from
 * different chromosomes.
 */
function computeIntraChainScore(
  chain: ChainEntry[],
  links: ContigLink[],
): number {
  const members = new Set(chain.map(e => e.orderIndex));
  let sum = 0;
  let count = 0;
  for (const link of links) {
    if (members.has(link.i) && members.has(link.j)) {
      sum += link.score;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Information about the best inter-chain link between two chains.
 */
interface InterChainLink {
  /** Index of chain A in the chains array. */
  chainIdxA: number;
  /** Index of chain B in the chains array. */
  chainIdxB: number;
  /** Best inter-chain link score (max over all contig pairs). */
  score: number;
  /** The actual best link (for orientation info). */
  bestLink: ContigLink;
}

/**
 * Hierarchical (agglomerative) chain merge: iteratively merge the most
 * similar chain pair until no pair exceeds the merge threshold.
 *
 * Improvements over mergeSmallChains:
 * 1. No minimum chain size restriction -- any two chains can merge
 * 2. Orientation-aware: uses link orientation to correctly orient chains
 * 3. Multi-pass: repeatedly finds and merges the best pair
 * 4. Safety guard: won't merge if inter-chain affinity is < 50% of
 *    the average intra-chain score of either chain
 * 5. Adaptive threshold: uses max(mergeThreshold, threshold * 0.3)
 *
 * @param result - Initial AutoSortResult from unionFindSort.
 * @param links - All computed links (sorted by score descending).
 * @param mergeThreshold - Floor for the merge threshold.
 * @param unionFindThreshold - The threshold used by unionFindSort.
 * @returns AutoSortResult with merged chains.
 */
export function hierarchicalChainMerge(
  result: AutoSortResult,
  links: ContigLink[],
  mergeThreshold: number = 0.05,
  unionFindThreshold: number = 0.2,
): AutoSortResult {
  // Adaptive threshold: higher of mergeThreshold and 30% of UF threshold
  const effectiveThreshold = Math.max(mergeThreshold, unionFindThreshold * 0.3);

  // Build working copy of chains (filter out empties, deep copy entries)
  let chains: ChainEntry[][] = result.chains
    .filter(c => c.length > 0)
    .map(c => c.map(e => ({ ...e })));

  // Build index: orderIndex -> chain array index
  function rebuildIndex(): Map<number, number> {
    const idx = new Map<number, number>();
    for (let ci = 0; ci < chains.length; ci++) {
      for (const entry of chains[ci]) {
        idx.set(entry.orderIndex, ci);
      }
    }
    return idx;
  }

  /**
   * Find the best chain pair to merge (highest inter-chain affinity
   * above the effective threshold, passing the safety guard).
   */
  function findBestMerge(chainIndex: Map<number, number>): InterChainLink | null {
    // For each pair of distinct chains, find the maximum link score
    const pairBest = new Map<string, InterChainLink>();

    for (const link of links) {
      const ciA = chainIndex.get(link.i);
      const ciB = chainIndex.get(link.j);
      if (ciA === undefined || ciB === undefined) continue;
      if (ciA === ciB) continue;

      // Canonical key: smaller index first
      const lo = Math.min(ciA, ciB);
      const hi = Math.max(ciA, ciB);
      const key = `${lo}:${hi}`;

      const existing = pairBest.get(key);
      if (!existing || link.score > existing.score) {
        pairBest.set(key, {
          chainIdxA: ciA,
          chainIdxB: ciB,
          score: link.score,
          bestLink: link,
        });
      }
    }

    // Find the pair with the highest score that passes all guards
    let best: InterChainLink | null = null;
    for (const candidate of pairBest.values()) {
      if (candidate.score < effectiveThreshold) continue;

      const chainA = chains[candidate.chainIdxA];
      const chainB = chains[candidate.chainIdxB];

      // Safety guard: only apply when both chains have >= 2 contigs
      // (singletons have no intra-chain links so guard is not applicable)
      if (chainA.length >= 2 && chainB.length >= 2) {
        const intraA = computeIntraChainScore(chainA, links);
        const intraB = computeIntraChainScore(chainB, links);
        const minIntra = Math.min(intraA, intraB);

        if (minIntra > 0 && candidate.score < 0.5 * minIntra) {
          continue; // Safety guard: inter-chain affinity too weak
        }
      }

      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }

    return best;
  }

  // Iterative merging loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const chainIndex = rebuildIndex();
    const best = findBestMerge(chainIndex);
    if (!best) break;

    const chainA = chains[best.chainIdxA];
    const chainB = chains[best.chainIdxB];
    if (!chainA || !chainB || chainA.length === 0 || chainB.length === 0) break;

    // Determine which chain is larger (keep) and smaller (merge into it)
    let keepIdx: number;
    let mergeIdx: number;
    let keepIsI: boolean;

    if (chainA.length >= chainB.length) {
      keepIdx = best.chainIdxA;
      mergeIdx = best.chainIdxB;
      keepIsI = chainA.some(e => e.orderIndex === best.bestLink.i);
    } else {
      keepIdx = best.chainIdxB;
      mergeIdx = best.chainIdxA;
      keepIsI = chainB.some(e => e.orderIndex === best.bestLink.i);
    }

    const keepChain = chains[keepIdx];
    const mergeChain = chains[mergeIdx];

    // Orientation-aware merging using the best link's orientation
    const link = best.bestLink;
    const orientation = link.orientation;

    const iContig = link.i;
    const jContig = link.j;

    // Identify which working chain contains i and which contains j
    const iChain = keepIsI ? keepChain : mergeChain;
    const jChain = keepIsI ? mergeChain : keepChain;

    const iPosInChain = iChain.findIndex(e => e.orderIndex === iContig);
    const jPosInChain = jChain.findIndex(e => e.orderIndex === jContig);

    const iIsHead = iPosInChain === 0;
    const iIsTail = iPosInChain === iChain.length - 1;
    const jIsHead = jPosInChain === 0;
    const jIsTail = jPosInChain === jChain.length - 1;

    const iAtEndpoint = iIsHead || iIsTail;
    const jAtEndpoint = jIsHead || jIsTail;

    if (iAtEndpoint && jAtEndpoint) {
      // Orientation-aware merge: arrange chains so the connecting ends meet

      // Step 1: Position i at the correct end of iChain
      const iShouldBeTail = orientation === 'HH' || orientation === 'HT';
      if (iShouldBeTail && iIsHead && !iIsTail) {
        iChain.reverse();
        iChain.forEach(e => e.inverted = !e.inverted);
      } else if (!iShouldBeTail && iIsTail && !iIsHead) {
        iChain.reverse();
        iChain.forEach(e => e.inverted = !e.inverted);
      }

      // Step 2: Position j at the correct end of jChain
      const jShouldBeHead = orientation === 'HH' || orientation === 'TH';
      if (jShouldBeHead && jIsTail && !jIsHead) {
        jChain.reverse();
        jChain.forEach(e => e.inverted = !e.inverted);
      } else if (!jShouldBeHead && jIsHead && !jIsTail) {
        jChain.reverse();
        jChain.forEach(e => e.inverted = !e.inverted);
      }

      // Step 3: Handle inversion for non-HH orientations
      if (orientation === 'HT') {
        jChain.reverse();
        jChain.forEach(e => e.inverted = !e.inverted);
      } else if (orientation === 'TH') {
        iChain.reverse();
        iChain.forEach(e => e.inverted = !e.inverted);
      } else if (orientation === 'TT') {
        iChain.reverse();
        iChain.forEach(e => e.inverted = !e.inverted);
      }

      // Step 4: Concatenate iChain + jChain
      const merged = [...iChain, ...jChain];
      chains[keepIdx] = merged;
      chains[mergeIdx] = [];
    } else {
      // Fallback: simple append when linking contigs are not at endpoints
      const merged = [...keepChain, ...mergeChain];
      chains[keepIdx] = merged;
      chains[mergeIdx] = [];
    }

    // Remove empty chains to keep array compact
    chains = chains.filter(c => c.length > 0);
  }

  // Final sort: largest chains first
  chains.sort((a, b) => b.length - a.length);

  return {
    chains,
    links: result.links,
    threshold: result.threshold,
  };
}

// ---------------------------------------------------------------------------
// Top-level autoSort
// ---------------------------------------------------------------------------

/**
 * Core sort algorithm: link scoring → threshold → union-find → merge.
 * No minimum-contig guard — usable for per-scaffold subsets of any size.
 */
export function autoSortCore(
  contactMap: Float32Array,
  size: number,
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
  params?: Partial<AutoSortParams>,
): AutoSortResult {
  const p = { ...DEFAULT_PARAMS, ...params };

  const links = computeAllLinkScores(contactMap, size, contigs, contigOrder, textureSize, p);

  let threshold = p.hardThreshold;
  if (links.length > 0) {
    const idx85 = Math.floor(links.length * 0.15);
    const p85 = links[idx85]?.score ?? 0;
    threshold = Math.min(p85, p.hardThreshold);
  }

  const initial = unionFindSort(links, contigOrder.length, threshold);
  return hierarchicalChainMerge(initial, links, p.mergeThreshold ?? 0.05, threshold);
}

/**
 * Compute the proposed contig ordering using Hi-C link scores
 * and Union Find chaining.
 *
 * For assemblies with < 60 contigs, returns a trivial identity ordering
 * (the algorithm is noise-prone at low contig counts). Use autoSortCore()
 * to bypass this guard for per-scaffold sorting.
 */
export function autoSort(
  contactMap: Float32Array,
  size: number,
  contigs: ContigInfo[],
  contigOrder: number[],
  textureSize: number,
  params?: Partial<AutoSortParams>,
): AutoSortResult {
  if (contigOrder.length < 60) {
    const trivialChains: ChainEntry[][] = contigOrder.map((_, idx) => [
      { orderIndex: idx, inverted: false }
    ]);
    return {
      chains: trivialChains,
      links: [],
      threshold: 0,
    };
  }

  return autoSortCore(contactMap, size, contigs, contigOrder, textureSize, params);
}
