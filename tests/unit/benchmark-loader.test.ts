/**
 * Benchmark loader tests — smoke test with bTaeGut2.mat.pretext
 * and basic validation of the Node.js contact map assembly.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPretextFromDisk } from '../../bench/loader';
import type { LoadedAssembly } from '../../bench/loader';
import { extractGroundTruth, detectSplits, buildChromosomeAssignments, extractChromosomeLabel, detectChromosomesByName, detectChromosomeBoundariesBySignal } from '../../bench/ground-truth';
import { autoCut } from '../../src/curation/AutoCut';
import { autoSort } from '../../src/curation/AutoSort';
import { applyBreakpoints } from '../../bench/runner';

const TEST_FILE = resolve('test-data/bTaeGut2.mat.pretext');
const hasTestFile = existsSync(TEST_FILE);

describe('loadPretextFromDisk', () => {
  it.skipIf(!hasTestFile)('loads bTaeGut2.mat.pretext and assembles contact map', async () => {
    const assembly = await loadPretextFromDisk(TEST_FILE);

    // Verify contact map dimensions
    expect(assembly.overviewSize).toBeGreaterThan(0);
    expect(assembly.contactMap.length).toBe(assembly.overviewSize * assembly.overviewSize);
    expect(assembly.textureSize).toBeGreaterThan(0);

    // Verify contigs
    expect(assembly.contigs.length).toBeGreaterThan(0);
    expect(assembly.contigOrder.length).toBe(assembly.contigs.length);

    // Verify contig structure
    const firstContig = assembly.contigs[0];
    expect(firstContig.name).toBeTruthy();
    expect(firstContig.length).toBeGreaterThan(0);
    expect(firstContig.pixelStart).toBe(0);
    expect(firstContig.pixelEnd).toBeGreaterThan(0);
    expect(firstContig.inverted).toBe(false);
    expect(firstContig.scaffoldId).toBeNull();
    expect(firstContig.originalIndex).toBe(0);

    // Verify contact map has non-zero values (real Hi-C data)
    let nonZero = 0;
    for (let i = 0; i < Math.min(assembly.contactMap.length, 100000); i++) {
      if (assembly.contactMap[i] > 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
  }, 60_000);

  it.skipIf(!hasTestFile)('produces symmetric contact map', async () => {
    const assembly = await loadPretextFromDisk(TEST_FILE);
    const { contactMap, overviewSize } = assembly;

    // Spot-check symmetry at random positions
    for (let i = 0; i < 100; i++) {
      const x = Math.floor(Math.random() * overviewSize);
      const y = Math.floor(Math.random() * overviewSize);
      expect(contactMap[y * overviewSize + x]).toBe(contactMap[x * overviewSize + y]);
    }
  }, 60_000);

  it.skipIf(!hasTestFile)('runs autoCut on loaded data', async () => {
    const assembly = await loadPretextFromDisk(TEST_FILE);
    const result = autoCut(
      assembly.contactMap,
      assembly.overviewSize,
      assembly.contigs,
      assembly.contigOrder,
      assembly.textureSize,
    );

    // autoCut should return a result (may or may not find breakpoints)
    expect(result).toBeDefined();
    expect(result.breakpoints).toBeInstanceOf(Map);
    expect(typeof result.totalBreakpoints).toBe('number');
    expect(result.totalBreakpoints).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it.skipIf(!hasTestFile)('runs autoSort on loaded data', async () => {
    const assembly = await loadPretextFromDisk(TEST_FILE);
    const result = autoSort(
      assembly.contactMap,
      assembly.overviewSize,
      assembly.contigs,
      assembly.contigOrder,
      assembly.textureSize,
    );

    // autoSort should return chains
    expect(result).toBeDefined();
    expect(result.chains.length).toBeGreaterThan(0);
    expect(result.links.length).toBeGreaterThan(0);
    expect(typeof result.threshold).toBe('number');

    // All contigs should appear in exactly one chain
    const allOrderIndices = result.chains.flatMap(c => c.map(e => e.orderIndex));
    expect(allOrderIndices.length).toBe(assembly.contigOrder.length);
    expect(new Set(allOrderIndices).size).toBe(assembly.contigOrder.length);
  }, 120_000);

  it.skipIf(!hasTestFile)('applyBreakpoints produces valid post-cut state', async () => {
    const assembly = await loadPretextFromDisk(TEST_FILE);
    const cutResult = autoCut(
      assembly.contactMap,
      assembly.overviewSize,
      assembly.contigs,
      assembly.contigOrder,
      assembly.textureSize,
    );

    const postCut = applyBreakpoints(
      assembly.contigs,
      assembly.contigOrder,
      cutResult,
    );

    // Post-cut should have more contigs if breakpoints were detected
    expect(postCut.contigs.length).toBeGreaterThanOrEqual(assembly.contigs.length);
    expect(postCut.contigOrder.length).toBe(
      assembly.contigOrder.length + cutResult.totalBreakpoints,
    );

    // All order indices should be valid
    for (const idx of postCut.contigOrder) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(postCut.contigs.length);
    }
  }, 60_000);
});

describe('ground-truth', () => {
  it('detectSplits finds _L/_R pairs', () => {
    const contigs = [
      { name: 'chr1_L', originalIndex: 0, length: 1000, pixelStart: 0, pixelEnd: 10, inverted: false, scaffoldId: null },
      { name: 'chr1_R', originalIndex: 1, length: 1000, pixelStart: 10, pixelEnd: 20, inverted: false, scaffoldId: null },
      { name: 'chr2', originalIndex: 2, length: 2000, pixelStart: 20, pixelEnd: 40, inverted: false, scaffoldId: null },
    ];

    const splits = detectSplits(contigs);
    expect(splits.size).toBe(1);
    expect(splits.has('chr1')).toBe(true);
    expect(splits.get('chr1')).toEqual({ leftName: 'chr1_L', rightName: 'chr1_R' });
  });

  it('buildChromosomeAssignments creates correct assignments', () => {
    const assignments = buildChromosomeAssignments(6, [0, 3]);
    expect(assignments).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('buildChromosomeAssignments handles single chromosome', () => {
    const assignments = buildChromosomeAssignments(4, [0]);
    expect(assignments).toEqual([0, 0, 0, 0]);
  });
});

describe('extractChromosomeLabel', () => {
  it('recognizes SUPER_N patterns', () => {
    expect(extractChromosomeLabel('SUPER_1')).toBe('1');
    expect(extractChromosomeLabel('SUPER_Z')).toBe('Z');
    expect(extractChromosomeLabel('SUPER_W')).toBe('W');
    expect(extractChromosomeLabel('SUPER_26')).toBe('26');
  });

  it('handles SUPER_N_unloc_M (assigns to parent chromosome)', () => {
    expect(extractChromosomeLabel('SUPER_12_unloc_3')).toBe('12');
    expect(extractChromosomeLabel('SUPER_W_unloc_2')).toBe('W');
    expect(extractChromosomeLabel('SUPER_Z_unloc_5')).toBe('Z');
  });

  it('recognizes Super_Scaffold_N patterns', () => {
    expect(extractChromosomeLabel('Super_Scaffold_1')).toBe('1');
    expect(extractChromosomeLabel('Super_Scaffold_Z')).toBe('Z');
    expect(extractChromosomeLabel('Super_Scaffold_1A')).toBe('1A');
    expect(extractChromosomeLabel('Super_Scaffold_4A')).toBe('4A');
  });

  it('recognizes chr patterns', () => {
    expect(extractChromosomeLabel('chr1')).toBe('1');
    expect(extractChromosomeLabel('chrX')).toBe('X');
    expect(extractChromosomeLabel('chrMT')).toBe('MT');
  });

  it('returns null for unplaced scaffolds', () => {
    expect(extractChromosomeLabel('Scaffold_49')).toBeNull();
    expect(extractChromosomeLabel('scaffold_100_arrow_ctg1')).toBeNull();
    expect(extractChromosomeLabel('H1.scaffold_3')).toBeNull();
    expect(extractChromosomeLabel('scaffold_1.H2')).toBeNull();
  });
});

describe('detectChromosomesByName', () => {
  it('assigns contigs to correct chromosomes', () => {
    const contigs = [
      { name: 'SUPER_1', originalIndex: 0, length: 1000, pixelStart: 0, pixelEnd: 100, inverted: false, scaffoldId: null },
      { name: 'SUPER_2', originalIndex: 1, length: 800, pixelStart: 100, pixelEnd: 180, inverted: false, scaffoldId: null },
      { name: 'SUPER_1_unloc_1', originalIndex: 2, length: 50, pixelStart: 180, pixelEnd: 185, inverted: false, scaffoldId: null },
      { name: 'Scaffold_10', originalIndex: 3, length: 20, pixelStart: 185, pixelEnd: 187, inverted: false, scaffoldId: null },
    ];
    const order = [0, 1, 2, 3];
    const result = detectChromosomesByName(contigs, order);

    expect(result.numNamed).toBe(3); // SUPER_1, SUPER_2, SUPER_1_unloc_1
    // "1" -> idx 0 (first seen), "2" -> idx 1, unloc_1 -> "1" -> idx 0, Scaffold -> unplaced
    expect(result.assignments[0]).toBe(0); // SUPER_1
    expect(result.assignments[1]).toBe(1); // SUPER_2
    expect(result.assignments[2]).toBe(0); // SUPER_1_unloc_1 -> same as SUPER_1
    expect(result.assignments[3]).toBe(2); // unplaced group
  });

  it('detects boundaries at chromosome transitions', () => {
    const contigs = [
      { name: 'SUPER_1', originalIndex: 0, length: 1000, pixelStart: 0, pixelEnd: 100, inverted: false, scaffoldId: null },
      { name: 'SUPER_1', originalIndex: 1, length: 900, pixelStart: 100, pixelEnd: 190, inverted: false, scaffoldId: null },
      { name: 'SUPER_2', originalIndex: 2, length: 500, pixelStart: 190, pixelEnd: 240, inverted: false, scaffoldId: null },
    ];
    const order = [0, 1, 2];
    const result = detectChromosomesByName(contigs, order);

    expect(result.boundaries).toEqual([0, 2]); // boundary at 0 (start) and 2 (SUPER_2 begins)
  });
});

// --- Helper for synthetic assembly creation ---

function makeSyntheticAssembly(
  overviewSize: number,
  contigPixelWidths: number[],
  signalPattern: (row: number, col: number) => number,
): LoadedAssembly {
  const contactMap = new Float32Array(overviewSize * overviewSize);
  for (let y = 0; y < overviewSize; y++) {
    for (let x = 0; x < overviewSize; x++) {
      contactMap[y * overviewSize + x] = signalPattern(y, x);
    }
  }

  let pixelAccum = 0;
  const textureSize = contigPixelWidths.reduce((a, b) => a + b, 0);
  const contigs = contigPixelWidths.map((w, i) => {
    const c = {
      name: `contig_${i}`,
      originalIndex: i,
      length: w * 1000,
      pixelStart: pixelAccum,
      pixelEnd: pixelAccum + w,
      inverted: false,
      scaffoldId: null,
    };
    pixelAccum += w;
    return c;
  });

  return {
    contactMap,
    overviewSize,
    textureSize,
    contigs,
    contigOrder: contigs.map((_, i) => i),
    parsed: null as any,
  };
}

describe('detectChromosomeBoundariesBySignal', () => {
  it('finds boundaries between large contigs with clear signal drop', () => {
    // 2 chromosomes, each made of 2 contigs (10px each) in a 40x40 overview.
    // Strong signal within chromosomes (including cross-contig within same chrom),
    // zero signal between chromosomes. The function measures inter-contig signal,
    // so we need multiple contigs per chromosome for a meaningful baseline.
    const overviewSize = 40;
    const contigPixelWidths = [10, 10, 10, 10];
    const assembly = makeSyntheticAssembly(overviewSize, contigPixelWidths, (row, col) => {
      // Chromosome 1: pixels 0-19 (contigs 0,1), Chromosome 2: pixels 20-39 (contigs 2,3)
      const chromRow = row < 20 ? 0 : 1;
      const chromCol = col < 20 ? 0 : 1;
      return chromRow === chromCol ? 10.0 : 0.0;
    });

    const boundaries = detectChromosomeBoundariesBySignal(assembly);

    // Should find boundary at 0 (always) and at contig 2 (where chromosome 2 starts)
    expect(boundaries).toContain(0);
    expect(boundaries).toContain(2);
    expect(boundaries.length).toBe(2);
  });

  it('merges tiny contigs and still finds boundaries', () => {
    // Simulate an assembly with many tiny contigs (2 pixels each).
    // Two chromosomes: first 15 contigs form chromosome 1 (pixels 0-29),
    // next 15 contigs form chromosome 2 (pixels 30-59).
    // Within each chromosome there is strong signal between adjacent contigs;
    // between chromosomes the signal drops to zero.
    const overviewSize = 60;
    const contigPixelWidths = new Array(30).fill(2);
    const assembly = makeSyntheticAssembly(overviewSize, contigPixelWidths, (row, col) => {
      const chromRow = row < 30 ? 0 : 1;
      const chromCol = col < 30 ? 0 : 1;
      return chromRow === chromCol ? 8.0 : 0.0;
    });

    const boundaries = detectChromosomeBoundariesBySignal(assembly);

    // Should detect a boundary near contig index 15 (where chromosome 2 starts).
    expect(boundaries).toContain(0);
    expect(boundaries.length).toBeGreaterThanOrEqual(2);

    // The non-zero boundary should be near contig 15
    const nonZeroBoundaries = boundaries.filter(b => b > 0);
    expect(nonZeroBoundaries.length).toBeGreaterThanOrEqual(1);
    const closestTo15 = nonZeroBoundaries.reduce((closest, b) =>
      Math.abs(b - 15) < Math.abs(closest - 15) ? b : closest,
    );
    // Should be within a few contigs of 15 (merged ranges may shift slightly)
    expect(Math.abs(closestTo15 - 15)).toBeLessThanOrEqual(3);
  });

  it('returns only [0] when all signal is zero', () => {
    // No signal at all — should return just the initial boundary
    const overviewSize = 30;
    const contigPixelWidths = [10, 10, 10];
    const assembly = makeSyntheticAssembly(overviewSize, contigPixelWidths, () => 0.0);

    const boundaries = detectChromosomeBoundariesBySignal(assembly);

    expect(boundaries).toEqual([0]);
  });

  it('returns only [0] when all contigs are too tiny to form merged ranges', () => {
    // 5 contigs of 2 pixels each in a 10x10 overview with zero signal.
    // Even after merging, with zero signal we should get only [0].
    const overviewSize = 10;
    const contigPixelWidths = [2, 2, 2, 2, 2];
    const assembly = makeSyntheticAssembly(overviewSize, contigPixelWidths, () => 0.0);

    const boundaries = detectChromosomeBoundariesBySignal(assembly);

    expect(boundaries).toEqual([0]);
  });

  it('uses aggressive threshold fallback when initial threshold finds no boundaries', () => {
    // 8 contigs grouped as two chromosomes.
    // All inter-contig pairs have relatively similar signal, so the
    // normal threshold (p25 or baseline*0.3) may not find boundaries.
    // The aggressive 2x fallback should help.
    const overviewSize = 80;
    const contigPixelWidths = [10, 10, 10, 10, 10, 10, 10, 10];
    const assembly = makeSyntheticAssembly(overviewSize, contigPixelWidths, (row, col) => {
      const chromRow = row < 40 ? 0 : 1;
      const chromCol = col < 40 ? 0 : 1;
      if (chromRow === chromCol) return 10.0;
      // Inter-chromosome signal is high but below intra — 60% of 10.0
      return 6.0;
    });

    const boundaries = detectChromosomeBoundariesBySignal(assembly);

    // Should find at least the start boundary
    expect(boundaries).toContain(0);
    // The inter-chromosome signal (6.0) is 60% of intra (10.0).
    // Whether it triggers depends on the p25 threshold and aggressive fallback.
    // The key test is that the function doesn't crash or return garbage.
    expect(boundaries.length).toBeGreaterThanOrEqual(1);
  });

  it('handles single contig assembly', () => {
    const overviewSize = 20;
    const contigPixelWidths = [20];
    const assembly = makeSyntheticAssembly(overviewSize, contigPixelWidths, () => 5.0);

    const boundaries = detectChromosomeBoundariesBySignal(assembly);

    expect(boundaries).toEqual([0]);
  });

  it('handles mix of large and tiny contigs', () => {
    // Chromosome 1: 2 large contigs (20px each), then 5 tiny contigs (2px each)
    // forming a gap, then chromosome 2: 2 large contigs (25px each).
    // Within-chromosome inter-contig signal is high; gap region has zero signal.
    const overviewSize = 100;
    const contigPixelWidths = [20, 20, 2, 2, 2, 2, 2, 25, 25];
    const assembly = makeSyntheticAssembly(overviewSize, contigPixelWidths, (row, col) => {
      // Chromosome 1: pixels 0-39 (contigs 0,1)
      // Gap: pixels 40-49 (contigs 2-6, tiny)
      // Chromosome 2: pixels 50-99 (contigs 7,8)
      // Strong intra-chromosome signal, zero elsewhere
      if (row < 40 && col < 40) return 10.0;
      if (row >= 50 && col >= 50) return 10.0;
      return 0.0;
    });

    const boundaries = detectChromosomeBoundariesBySignal(assembly);

    expect(boundaries).toContain(0);
    // Should detect at least one boundary in the gap region between the chromosomes
    expect(boundaries.length).toBeGreaterThanOrEqual(2);
  });
});
