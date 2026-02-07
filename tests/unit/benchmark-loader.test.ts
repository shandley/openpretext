/**
 * Benchmark loader tests — smoke test with bTaeGut2.mat.pretext
 * and basic validation of the Node.js contact map assembly.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPretextFromDisk } from '../../bench/loader';
import { extractGroundTruth, detectSplits, buildChromosomeAssignments } from '../../bench/ground-truth';
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
