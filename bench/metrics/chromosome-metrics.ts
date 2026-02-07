/**
 * Chromosome-level completeness scoring.
 *
 * Higher-level combined metrics that evaluate how well the predicted
 * ordering reconstructs whole chromosomes.
 */

import type { ContigInfo } from '../../src/core/State';
import type { ChainEntry } from '../../src/curation/AutoSort';

export interface ChromosomeCompletenessResult {
  /** Per-chromosome completeness (fraction of bp correctly placed). */
  perChromosome: Map<number, number>;
  /** Macro-average completeness (average across chromosomes). */
  macroAverage: number;
  /** Micro-average completeness (weighted by chromosome size). */
  microAverage: number;
  /** Count of chromosomes with >90% completeness. */
  highCompleteness: number;
  /** Total number of chromosomes. */
  totalChromosomes: number;
}

/**
 * Compute chromosome completeness: for each true chromosome, what fraction
 * of its base pairs are placed in the correct chain (the chain containing
 * the most bp from that chromosome).
 *
 * @param predictedChains - Predicted chains from autoSort.
 * @param contigs - Contigs array with base-pair lengths.
 * @param trueChromAssignments - Contig order index -> chromosome index.
 */
export function computeChromosomeCompleteness(
  predictedChains: ChainEntry[][],
  contigs: ContigInfo[],
  contigOrder: number[],
  trueChromAssignments: number[],
): ChromosomeCompletenessResult {
  // Group contigs by true chromosome with their bp sizes
  const chromBp = new Map<number, number>(); // chrom -> total bp
  const chromContigs = new Map<number, Set<number>>(); // chrom -> set of orderIndices

  for (let i = 0; i < trueChromAssignments.length; i++) {
    const chrom = trueChromAssignments[i];
    const contigId = contigOrder[i];
    const bp = contigs[contigId]?.length ?? 0;

    chromBp.set(chrom, (chromBp.get(chrom) ?? 0) + bp);
    if (!chromContigs.has(chrom)) chromContigs.set(chrom, new Set());
    chromContigs.get(chrom)!.add(i);
  }

  const perChromosome = new Map<number, number>();
  let totalCorrectBp = 0;
  let totalBp = 0;

  for (const [chrom, members] of chromContigs) {
    const chromTotalBp = chromBp.get(chrom) ?? 0;
    totalBp += chromTotalBp;

    // Find the chain with the most bp from this chromosome
    let bestChainBp = 0;

    for (const chain of predictedChains) {
      let chainBp = 0;
      for (const entry of chain) {
        if (members.has(entry.orderIndex)) {
          const contigId = contigOrder[entry.orderIndex];
          chainBp += contigs[contigId]?.length ?? 0;
        }
      }
      bestChainBp = Math.max(bestChainBp, chainBp);
    }

    const completeness = chromTotalBp > 0 ? bestChainBp / chromTotalBp : 0;
    perChromosome.set(chrom, completeness);
    totalCorrectBp += bestChainBp;
  }

  const totalChromosomes = perChromosome.size;
  const macroAverage =
    totalChromosomes > 0
      ? [...perChromosome.values()].reduce((s, v) => s + v, 0) / totalChromosomes
      : 0;
  const microAverage = totalBp > 0 ? totalCorrectBp / totalBp : 0;
  const highCompleteness = [...perChromosome.values()].filter(v => v > 0.9).length;

  return {
    perChromosome,
    macroAverage,
    microAverage,
    highCompleteness,
    totalChromosomes,
  };
}
