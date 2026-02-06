import { describe, it, expect, beforeEach } from 'vitest';
import { state, ContigInfo, MapData } from '../../src/core/State';
import { parseBedGraph, bedGraphToTrack } from '../../src/formats/BedGraphParser';
import { MetricsTracker } from '../../src/curation/QualityMetrics';
import { contigExclusion } from '../../src/curation/ContigExclusion';
import { selectByPattern } from '../../src/curation/BatchOperations';
import { parseFASTA } from '../../src/formats/FASTAParser';
import { exportFASTA } from '../../src/export/FASTAWriter';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContig(
  name: string,
  index: number,
  pixelStart: number,
  pixelEnd: number,
  length: number,
  inverted = false,
  scaffoldId: number | null = null,
): ContigInfo {
  return {
    name,
    originalIndex: index,
    length,
    pixelStart,
    pixelEnd,
    inverted,
    scaffoldId,
  };
}

function makeTestMap(contigs: ContigInfo[]): MapData {
  const lastContig = contigs[contigs.length - 1];
  return {
    filename: 'test.pretext',
    textureSize: lastContig ? lastContig.pixelEnd : 0,
    numMipMaps: 1,
    tileResolution: 1024,
    tilesPerDimension: 1,
    contigs,
    contactMap: null,
    rawTiles: null,
    parsedHeader: null,
    extensions: new Map(),
  };
}

function setupState(
  contigs: Array<{ name: string; length: number; pixelStart: number; pixelEnd: number }>,
): void {
  const contigInfos = contigs.map((c, i) =>
    makeContig(c.name, i, c.pixelStart, c.pixelEnd, c.length),
  );
  const map = makeTestMap(contigInfos);
  state.update({
    map,
    contigOrder: contigs.map((_, i) => i),
    undoStack: [],
    redoStack: [],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Feature Integration', () => {
  beforeEach(() => {
    state.reset();
    contigExclusion.clearAll();
  });

  // -------------------------------------------------------------------------
  // BedGraph -> TrackConfig conversion
  // -------------------------------------------------------------------------
  describe('BedGraph -> TrackConfig conversion', () => {
    it('should parse bedGraph and convert to a TrackConfig with correct metadata', () => {
      const bedGraphText = [
        'track type=bedGraph name="GC Content"',
        'chr1\t0\t5000\t0.45',
        'chr1\t5000\t10000\t0.62',
        'chr2\t0\t8000\t0.38',
      ].join('\n');

      const parsed = parseBedGraph(bedGraphText);
      expect(parsed.entries).toHaveLength(3);
      expect(parsed.trackName).toBe('GC Content');
      expect(parsed.chroms).toEqual(['chr1', 'chr2']);

      const contigs = [
        makeContig('chr1', 0, 0, 100, 10000),
        makeContig('chr2', 1, 100, 200, 8000),
      ];
      const contigOrder = [0, 1];
      const textureSize = 200;

      const track = bedGraphToTrack(parsed, contigs, contigOrder, textureSize);

      expect(track.name).toBe('GC Content');
      expect(track.type).toBe('line');
      expect(track.data).toBeInstanceOf(Float32Array);
      expect(track.data.length).toBe(textureSize);
      expect(track.visible).toBe(true);
      expect(track.height).toBe(40);
    });

    it('should normalise bedGraph values to [0, 1] in the data array', () => {
      const bedGraphText = [
        'chr1\t0\t10000\t10',
        'chr1\t10000\t20000\t30',
      ].join('\n');

      const parsed = parseBedGraph(bedGraphText);

      const contigs = [makeContig('chr1', 0, 0, 200, 20000)];
      const contigOrder = [0];
      const textureSize = 200;

      const track = bedGraphToTrack(parsed, contigs, contigOrder, textureSize);

      // Value range: min=10, max=30, range=20
      // 10 -> (10-10)/20 = 0.0
      // 30 -> (30-10)/20 = 1.0
      // First half of pixels should be 0.0, second half should be 1.0
      expect(track.data[0]).toBeCloseTo(0.0, 1);
      expect(track.data[199]).toBeCloseTo(1.0, 1);
    });

    it('should apply custom options to the resulting TrackConfig', () => {
      const bedGraphText = 'chr1\t0\t1000\t5.0\n';
      const parsed = parseBedGraph(bedGraphText);

      const contigs = [makeContig('chr1', 0, 0, 100, 1000)];

      const track = bedGraphToTrack(parsed, contigs, [0], 100, {
        name: 'Custom Track',
        type: 'bar',
        color: 'red',
        height: 60,
      });

      expect(track.name).toBe('Custom Track');
      expect(track.type).toBe('bar');
      expect(track.color).toBe('red');
      expect(track.height).toBe(60);
    });
  });

  // -------------------------------------------------------------------------
  // Quality metrics snapshot chain
  // -------------------------------------------------------------------------
  describe('Quality metrics snapshot chain', () => {
    it('should return null summary when fewer than two snapshots exist', () => {
      const tracker = new MetricsTracker();
      expect(tracker.getSummary()).toBeNull();

      const contigs = [makeContig('c1', 0, 0, 100, 50000)];
      tracker.snapshot(contigs, [0], 0);
      expect(tracker.getSummary()).toBeNull();
    });

    it('should compute correct deltas across multiple snapshots', () => {
      const tracker = new MetricsTracker();

      // Initial state: 3 contigs
      const initialContigs = [
        makeContig('c1', 0, 0, 100, 50000),
        makeContig('c2', 1, 100, 200, 30000),
        makeContig('c3', 2, 200, 300, 20000),
      ];
      tracker.snapshot(initialContigs, [0, 1, 2], 0);

      // After one operation: joined c1+c2 into a single contig
      const afterJoin = [
        makeContig('c1', 0, 0, 200, 80000),
        makeContig('c3', 1, 200, 300, 20000),
      ];
      tracker.snapshot(afterJoin, [0, 1], 1);

      // After a second operation: cut c3 into two pieces
      const afterCut = [
        makeContig('c1', 0, 0, 200, 80000),
        makeContig('c3_left', 1, 200, 250, 10000),
        makeContig('c3_right', 2, 250, 300, 10000),
      ];
      tracker.snapshot(afterCut, [0, 1, 2], 2);

      const summary = tracker.getSummary();
      expect(summary).not.toBeNull();

      // Initial had 3 contigs, current has 3 contigs -> delta 0
      expect(summary!.contigCountDelta).toBe(0);
      expect(summary!.operationCount).toBe(2);
      expect(summary!.initial.contigCount).toBe(3);
      expect(summary!.current.contigCount).toBe(3);
      expect(summary!.initial.totalLength).toBe(100000);
      expect(summary!.current.totalLength).toBe(100000);
    });

    it('should track N50 changes through the snapshot history', () => {
      const tracker = new MetricsTracker();

      // Two equal-size contigs: N50 = 50000
      const contigs2 = [
        makeContig('c1', 0, 0, 100, 50000),
        makeContig('c2', 1, 100, 200, 50000),
      ];
      tracker.snapshot(contigs2, [0, 1], 0);

      // One large contig after join: N50 = 100000
      const contigs1 = [makeContig('c1', 0, 0, 200, 100000)];
      tracker.snapshot(contigs1, [0], 1);

      const summary = tracker.getSummary()!;
      expect(summary.n50Delta).toBe(50000); // 100000 - 50000
      expect(summary.initial.n50).toBe(50000);
      expect(summary.current.n50).toBe(100000);
    });
  });

  // -------------------------------------------------------------------------
  // Contig exclusion + getIncludedOrder
  // -------------------------------------------------------------------------
  describe('Contig exclusion + getIncludedOrder', () => {
    it('should filter excluded indices from the contig order', () => {
      contigExclusion.set(1, true);
      contigExclusion.set(3, true);

      const included = contigExclusion.getIncludedOrder([0, 1, 2, 3, 4]);

      // Positions 1 and 3 are excluded, so their values (1, 3) are removed
      expect(included).toEqual([0, 2, 4]);
    });

    it('should return the full order when nothing is excluded', () => {
      const included = contigExclusion.getIncludedOrder([0, 1, 2, 3, 4]);
      expect(included).toEqual([0, 1, 2, 3, 4]);
    });

    it('should return empty array when all are excluded', () => {
      contigExclusion.excludeMany([0, 1, 2]);

      const included = contigExclusion.getIncludedOrder([10, 20, 30]);
      expect(included).toEqual([]);
    });

    it('should reflect toggling exclusion on and off', () => {
      contigExclusion.toggle(2);
      expect(contigExclusion.isExcluded(2)).toBe(true);

      let included = contigExclusion.getIncludedOrder([0, 1, 2, 3, 4]);
      expect(included).toEqual([0, 1, 3, 4]);

      contigExclusion.toggle(2);
      expect(contigExclusion.isExcluded(2)).toBe(false);

      included = contigExclusion.getIncludedOrder([0, 1, 2, 3, 4]);
      expect(included).toEqual([0, 1, 2, 3, 4]);
    });
  });

  // -------------------------------------------------------------------------
  // Batch operations selectByPattern
  // -------------------------------------------------------------------------
  describe('Batch operations selectByPattern', () => {
    it('should select contigs matching a wildcard prefix pattern', () => {
      setupState([
        { name: 'chr1', length: 50000, pixelStart: 0, pixelEnd: 100 },
        { name: 'chr2', length: 30000, pixelStart: 100, pixelEnd: 200 },
        { name: 'scaffold_1', length: 5000, pixelStart: 200, pixelEnd: 250 },
        { name: 'scaffold_2', length: 2000, pixelStart: 250, pixelEnd: 300 },
      ]);

      const chrMatches = selectByPattern('chr*');
      expect(chrMatches).toEqual([0, 1]);

      const scaffoldMatches = selectByPattern('scaffold_*');
      expect(scaffoldMatches).toEqual([2, 3]);
    });

    it('should return empty array when pattern matches nothing', () => {
      setupState([
        { name: 'chr1', length: 10000, pixelStart: 0, pixelEnd: 100 },
      ]);

      const matches = selectByPattern('zzz*');
      expect(matches).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // FASTA export round-trip
  // -------------------------------------------------------------------------
  describe('FASTA export round-trip', () => {
    it('should parse FASTA and re-export preserving sequence content', () => {
      const originalFasta = [
        '>contig1 some description',
        'ATCGATCGATCG',
        '>contig2 another desc',
        'GGCCAATTGGCC',
      ].join('\n') + '\n';

      const records = parseFASTA(originalFasta);
      expect(records).toHaveLength(2);
      expect(records[0].name).toBe('contig1');
      expect(records[0].sequence).toBe('ATCGATCGATCG');
      expect(records[1].name).toBe('contig2');
      expect(records[1].sequence).toBe('GGCCAATTGGCC');

      // Build sequences map from parsed records
      const sequences = new Map<string, string>();
      for (const rec of records) {
        sequences.set(rec.name, rec.sequence);
      }

      // Build a minimal AppState with matching contigs
      const contigs = [
        makeContig('contig1', 0, 0, 100, 12),
        makeContig('contig2', 1, 100, 200, 12),
      ];
      const map = makeTestMap(contigs);
      const appState = {
        ...state.get(),
        map,
        contigOrder: [0, 1],
      };

      const exported = exportFASTA(appState, sequences);

      // The exported FASTA should contain the same sequences
      expect(exported).toContain('>contig1');
      expect(exported).toContain('ATCGATCGATCG');
      expect(exported).toContain('>contig2');
      expect(exported).toContain('GGCCAATTGGCC');

      // Re-parse the exported FASTA to verify round-trip integrity
      const reParsed = parseFASTA(exported);
      expect(reParsed).toHaveLength(2);
      expect(reParsed[0].name).toBe('contig1');
      expect(reParsed[0].sequence).toBe('ATCGATCGATCG');
      expect(reParsed[1].name).toBe('contig2');
      expect(reParsed[1].sequence).toBe('GGCCAATTGGCC');
    });

    it('should reverse-complement sequences for inverted contigs', () => {
      const fastaInput = '>myContig\nATCG\n';
      const records = parseFASTA(fastaInput);
      expect(records[0].sequence).toBe('ATCG');

      const sequences = new Map<string, string>();
      sequences.set('myContig', records[0].sequence);

      // Create an inverted contig
      const contigs = [makeContig('myContig', 0, 0, 100, 4, true)];
      const map = makeTestMap(contigs);
      const appState = {
        ...state.get(),
        map,
        contigOrder: [0],
      };

      const exported = exportFASTA(appState, sequences);

      // ATCG reverse-complement is CGAT
      expect(exported).toContain('CGAT');
      expect(exported).toContain('orientation=-');
    });
  });
});
