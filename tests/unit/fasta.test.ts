import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppState, ContigInfo, MapData } from '../../src/core/State';
import { state } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { parseFASTA, parseFASTAStream } from '../../src/formats/FASTAParser';
import type { FASTARecord } from '../../src/formats/FASTAParser';
import {
  exportFASTA,
  downloadFASTA,
  reverseComplement,
  wrapSequence,
} from '../../src/export/FASTAWriter';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContig(
  name: string,
  index: number,
  length: number,
  scaffoldId: number | null = null,
  inverted: boolean = false
): ContigInfo {
  return {
    name,
    originalIndex: index,
    length,
    pixelStart: 0,
    pixelEnd: 0,
    inverted,
    scaffoldId,
  };
}

function makeMapData(contigs: ContigInfo[]): MapData {
  return {
    filename: 'test_assembly.pretext',
    // As wide as its contigs, as a real map is. (Contigs given no texels,
    // pixelStart = pixelEnd = 0, leave the width at a nominal 1024.)
    textureSize: Math.max(0, ...contigs.map((c) => c.pixelEnd)) || 1024,
    numMipMaps: 1,
    contigs,
    textures: [new Float32Array(0)],
    extensions: new Map(),
  } as unknown as MapData;
}

function makeAppState(
  contigs: ContigInfo[],
  contigOrder: number[]
): AppState {
  return {
    map: makeMapData(contigs),
    contigOrder,
    mode: 'navigate',
    showGrid: true,
    showTooltip: true,
    showIdBar: false,
    visibleTracks: new Set(),
    colorMapName: 'red-white',
    gamma: 0.35,
    selectedContigs: new Set(),
    camera: { x: 0, y: 0, zoom: 1 },
    undoStack: [],
    redoStack: [],
  };
}

// ---------------------------------------------------------------------------
// FASTAParser tests
// ---------------------------------------------------------------------------

describe('FASTAParser', () => {
  describe('parseFASTA - simple parsing', () => {
    it('should parse simple FASTA with 2 sequences', () => {
      const input = [
        '>seq1 first sequence',
        'ATCGATCG',
        '>seq2 second sequence',
        'GCTAGCTA',
      ].join('\n');

      const records = parseFASTA(input);

      expect(records.length).toBe(2);

      expect(records[0].name).toBe('seq1');
      expect(records[0].description).toBe('first sequence');
      expect(records[0].sequence).toBe('ATCGATCG');

      expect(records[1].name).toBe('seq2');
      expect(records[1].description).toBe('second sequence');
      expect(records[1].sequence).toBe('GCTAGCTA');
    });

    it('should handle header with no description', () => {
      const input = '>seq1\nATCG\n';
      const records = parseFASTA(input);

      expect(records.length).toBe(1);
      expect(records[0].name).toBe('seq1');
      expect(records[0].description).toBe('');
      expect(records[0].sequence).toBe('ATCG');
    });
  });

  describe('parseFASTA - multi-line sequences', () => {
    it('should concatenate multi-line sequences', () => {
      const input = [
        '>seq1 long sequence',
        'ATCGATCG',
        'GCTAGCTA',
        'NNNNNNNN',
      ].join('\n');

      const records = parseFASTA(input);

      expect(records.length).toBe(1);
      expect(records[0].sequence).toBe('ATCGATCGGCTAGCTANNNNNNNN');
    });
  });

  describe('parseFASTA - blank lines and comments', () => {
    it('should handle blank lines and comment lines starting with ;', () => {
      const input = [
        '; This is a comment',
        '',
        '>seq1 first',
        'ATCG',
        '',
        '; Another comment mid-file',
        'GCTA',
        '',
        '>seq2 second',
        '; comment between header and sequence',
        'TTTT',
      ].join('\n');

      const records = parseFASTA(input);

      expect(records.length).toBe(2);
      expect(records[0].name).toBe('seq1');
      expect(records[0].sequence).toBe('ATCGGCTA');
      expect(records[1].name).toBe('seq2');
      expect(records[1].sequence).toBe('TTTT');
    });
  });

  describe('parseFASTA - empty input', () => {
    it('should return empty array for empty input', () => {
      expect(parseFASTA('')).toEqual([]);
    });

    it('should return empty array for input with only comments and blank lines', () => {
      const input = '; just a comment\n\n; another\n';
      expect(parseFASTA(input)).toEqual([]);
    });
  });

  describe('parseFASTA - edge cases', () => {
    it('should handle Windows-style line endings', () => {
      const input = '>seq1\r\nATCG\r\nGCTA\r\n';
      const records = parseFASTA(input);

      expect(records.length).toBe(1);
      expect(records[0].sequence).toBe('ATCGGCTA');
    });

    it('should handle header with multiple spaces in description', () => {
      const input = '>seq1   multiple   spaces   here\nATCG\n';
      const records = parseFASTA(input);

      expect(records[0].name).toBe('seq1');
      expect(records[0].description).toBe('multiple   spaces   here');
    });
  });
});

// ---------------------------------------------------------------------------
// parseFASTAStream tests
// ---------------------------------------------------------------------------

/** Build a ReadableStream<string> from an array of string chunks. */
function makeStringStream(chunks: string[]): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('parseFASTAStream', () => {
  it('should parse two sequences delivered in one chunk', async () => {
    const input = '>seq1 first\nATCGATCG\n>seq2 second\nGCTAGCTA\n';
    const records = await parseFASTAStream(makeStringStream([input]));
    expect(records.length).toBe(2);
    expect(records[0].name).toBe('seq1');
    expect(records[0].description).toBe('first');
    expect(records[0].sequence).toBe('ATCGATCG');
    expect(records[1].name).toBe('seq2');
    expect(records[1].sequence).toBe('GCTAGCTA');
  });

  it('should handle chunk boundary in the middle of a line', async () => {
    // Split mid-header and mid-sequence
    const records = await parseFASTAStream(makeStringStream([
      '>seq',
      '1\nATCG',
      'GCTA\n',
    ]));
    expect(records.length).toBe(1);
    expect(records[0].name).toBe('seq1');
    expect(records[0].sequence).toBe('ATCGGCTA');
  });

  it('should handle chunk boundary splitting a header line', async () => {
    const records = await parseFASTAStream(makeStringStream([
      '>seq1 desc',
      'ription\nATCG\n',
    ]));
    expect(records.length).toBe(1);
    expect(records[0].description).toBe('description');
    expect(records[0].sequence).toBe('ATCG');
  });

  it('should handle one chunk per line', async () => {
    const records = await parseFASTAStream(makeStringStream([
      '>seq1\n', 'ATCG\n', 'GCTA\n',
      '>seq2\n', 'TTTT\n',
    ]));
    expect(records.length).toBe(2);
    expect(records[0].sequence).toBe('ATCGGCTA');
    expect(records[1].sequence).toBe('TTTT');
  });

  it('should handle CRLF line endings across chunks', async () => {
    const records = await parseFASTAStream(makeStringStream([
      '>seq1\r\nATCG\r\nGCTA\r\n',
    ]));
    expect(records.length).toBe(1);
    expect(records[0].sequence).toBe('ATCGGCTA');
  });

  it('should skip comment lines and blank lines', async () => {
    const input = '; comment\n\n>seq1\nATCG\n\n; mid\nGCTA\n';
    const records = await parseFASTAStream(makeStringStream([input]));
    expect(records.length).toBe(1);
    expect(records[0].sequence).toBe('ATCGGCTA');
  });

  it('should return empty array for empty stream', async () => {
    const records = await parseFASTAStream(makeStringStream([]));
    expect(records).toEqual([]);
  });

  it('should finalize last record even without trailing newline', async () => {
    const records = await parseFASTAStream(makeStringStream(['>seq1\nATCG']));
    expect(records.length).toBe(1);
    expect(records[0].sequence).toBe('ATCG');
  });

  it('produces same result as parseFASTA for identical input', async () => {
    const input = [
      '>chr1 chromosome 1',
      'ATCGATCGATCG',
      'GGGGCCCCTTTT',
      '>chr2',
      'NNNNNNNN',
    ].join('\n');
    const expected = parseFASTA(input);
    const actual = await parseFASTAStream(makeStringStream([input]));
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// FASTAWriter tests
// ---------------------------------------------------------------------------

describe('FASTAWriter', () => {
  describe('reverseComplement', () => {
    it('should reverse complement a simple sequence', () => {
      expect(reverseComplement('ATCG')).toBe('CGAT');
    });

    it('should handle lowercase bases', () => {
      expect(reverseComplement('atcg')).toBe('cgat');
    });

    it('should handle N bases', () => {
      expect(reverseComplement('ANNG')).toBe('CNNT');
    });

    it('should handle empty string', () => {
      expect(reverseComplement('')).toBe('');
    });

    it('should be its own inverse', () => {
      const seq = 'ATCGATCGNNACGT';
      expect(reverseComplement(reverseComplement(seq))).toBe(seq);
    });
  });

  describe('wrapSequence', () => {
    it('should wrap at specified width', () => {
      const seq = 'ATCGATCGATCG'; // 12 chars
      const wrapped = wrapSequence(seq, 4);
      expect(wrapped).toBe('ATCG\nATCG\nATCG');
    });

    it('should not add trailing newline for exact multiple', () => {
      const seq = 'ATCGATCG'; // 8 chars
      const wrapped = wrapSequence(seq, 4);
      expect(wrapped).toBe('ATCG\nATCG');
    });

    it('should handle sequence shorter than line width', () => {
      const seq = 'ATCG';
      const wrapped = wrapSequence(seq, 80);
      expect(wrapped).toBe('ATCG');
    });

    it('should handle last line shorter than width', () => {
      const seq = 'ATCGATCGATC'; // 11 chars
      const wrapped = wrapSequence(seq, 4);
      expect(wrapped).toBe('ATCG\nATCG\nATC');
    });
  });

  describe('exportFASTA - basic export', () => {
    it('should export 2 contigs in order with correct FASTA output', () => {
      const contigs = [
        makeContig('ctg1', 0, 8, null),
        makeContig('ctg2', 1, 8, null),
      ];
      const state = makeAppState(contigs, [0, 1]);
      const sequences = new Map([
        ['ctg1', 'ATCGATCG'],
        ['ctg2', 'GCTAGCTA'],
      ]);

      const fasta = exportFASTA(state, sequences);
      const lines = fasta.split('\n').filter((l) => l.length > 0);

      expect(lines[0]).toBe('>ctg1 orientation=+');
      expect(lines[1]).toBe('ATCGATCG');
      expect(lines[2]).toBe('>ctg2 orientation=+');
      expect(lines[3]).toBe('GCTAGCTA');
    });

    it('should follow contig order', () => {
      const contigs = [
        makeContig('ctg1', 0, 4, null),
        makeContig('ctg2', 1, 4, null),
      ];
      // Reversed order
      const state = makeAppState(contigs, [1, 0]);
      const sequences = new Map([
        ['ctg1', 'AAAA'],
        ['ctg2', 'TTTT'],
      ]);

      const fasta = exportFASTA(state, sequences);
      const lines = fasta.split('\n').filter((l) => l.length > 0);

      expect(lines[0]).toBe('>ctg2 orientation=+');
      expect(lines[1]).toBe('TTTT');
      expect(lines[2]).toBe('>ctg1 orientation=+');
      expect(lines[3]).toBe('AAAA');
    });
  });

  describe('exportFASTA - inverted contig', () => {
    it('should reverse complement sequence for inverted contig', () => {
      const contigs = [
        makeContig('ctg1', 0, 8, null, true), // inverted
      ];
      const state = makeAppState(contigs, [0]);
      const sequences = new Map([['ctg1', 'ATCGATCG']]);

      const fasta = exportFASTA(state, sequences);
      const lines = fasta.split('\n').filter((l) => l.length > 0);

      expect(lines[0]).toBe('>ctg1 orientation=-');
      expect(lines[1]).toBe(reverseComplement('ATCGATCG'));
      expect(lines[1]).toBe('CGATCGAT');
    });
  });

  describe('exportFASTA - line wrapping', () => {
    it('should wrap sequence lines at 80 characters by default', () => {
      const longSeq = 'A'.repeat(200);
      const contigs = [makeContig('ctg1', 0, 200, null)];
      const state = makeAppState(contigs, [0]);
      const sequences = new Map([['ctg1', longSeq]]);

      const fasta = exportFASTA(state, sequences);
      const lines = fasta.split('\n').filter((l) => l.length > 0);

      // Header + 3 sequence lines (80 + 80 + 40)
      expect(lines.length).toBe(4);
      expect(lines[0]).toBe('>ctg1 orientation=+');
      expect(lines[1].length).toBe(80);
      expect(lines[2].length).toBe(80);
      expect(lines[3].length).toBe(40);
    });

    it('should respect custom lineWidth option', () => {
      const seq = 'A'.repeat(30);
      const contigs = [makeContig('ctg1', 0, 30, null)];
      const state = makeAppState(contigs, [0]);
      const sequences = new Map([['ctg1', seq]]);

      const fasta = exportFASTA(state, sequences, { lineWidth: 10 });
      const lines = fasta.split('\n').filter((l) => l.length > 0);

      // Header + 3 sequence lines (10 + 10 + 10)
      expect(lines.length).toBe(4);
      expect(lines[1].length).toBe(10);
      expect(lines[2].length).toBe(10);
      expect(lines[3].length).toBe(10);
    });
  });

  describe('exportFASTA - missing sequence', () => {
    it('should emit a warning header for missing sequences', () => {
      const contigs = [
        makeContig('ctg1', 0, 8, null),
        makeContig('ctg2', 1, 8, null),
      ];
      const state = makeAppState(contigs, [0, 1]);
      // Only provide sequence for ctg1
      const sequences = new Map([['ctg1', 'ATCGATCG']]);

      const fasta = exportFASTA(state, sequences);
      const lines = fasta.split('\n').filter((l) => l.length > 0);

      // ctg1 should export normally
      expect(lines[0]).toBe('>ctg1 orientation=+');
      expect(lines[1]).toBe('ATCGATCG');

      // ctg2 should have a warning header with no sequence
      expect(lines[2]).toBe('>ctg2 WARNING:sequence_not_found');
    });
  });

  describe('exportFASTA - error handling', () => {
    it('should throw when no map data is loaded', () => {
      const state: AppState = {
        map: null,
        contigOrder: [],
        mode: 'navigate',
        showGrid: true,
        showTooltip: true,
        showIdBar: false,
        visibleTracks: new Set(),
        colorMapName: 'red-white',
        gamma: 0.35,
        selectedContigs: new Set(),
        camera: { x: 0, y: 0, zoom: 1 },
        undoStack: [],
        redoStack: [],
      };

      expect(() => exportFASTA(state, new Map())).toThrow(
        'no map data loaded'
      );
    });

    it('should throw when contig order is empty', () => {
      const contigs = [makeContig('ctg1', 0, 1000, null)];
      const state = makeAppState(contigs, []);

      expect(() => exportFASTA(state, new Map())).toThrow(
        'contig order is empty'
      );
    });
  });

  describe('exportFASTA + parseFASTA round-trip', () => {
    it('should preserve sequences through parse then export', () => {
      // Start with FASTA text
      const originalFasta = [
        '>ctg1 first contig',
        'ATCGATCGATCGATCG',
        '>ctg2 second contig',
        'GCTAGCTAGCTAGCTA',
      ].join('\n');

      // Parse it
      const records = parseFASTA(originalFasta);
      expect(records.length).toBe(2);

      // Build sequences map from parsed records
      const sequences = new Map<string, string>();
      for (const record of records) {
        sequences.set(record.name, record.sequence);
      }

      // Create matching app state (non-inverted)
      const contigs = [
        makeContig('ctg1', 0, 16, null, false),
        makeContig('ctg2', 1, 16, null, false),
      ];
      const state = makeAppState(contigs, [0, 1]);

      // Export it
      const exportedFasta = exportFASTA(state, sequences);

      // Parse the exported FASTA
      const reRecords = parseFASTA(exportedFasta);

      expect(reRecords.length).toBe(2);
      expect(reRecords[0].name).toBe('ctg1');
      expect(reRecords[0].sequence).toBe('ATCGATCGATCGATCG');
      expect(reRecords[1].name).toBe('ctg2');
      expect(reRecords[1].sequence).toBe('GCTAGCTAGCTAGCTA');
    });

    it('should round-trip with inverted contigs by double-inverting', () => {
      const originalSeq = 'ATCGATCG';
      const contigs = [makeContig('ctg1', 0, 8, null, true)];
      const state = makeAppState(contigs, [0]);
      const sequences = new Map([['ctg1', originalSeq]]);

      // Export (will reverse complement)
      const exported = exportFASTA(state, sequences);
      const records = parseFASTA(exported);

      // The exported sequence is the reverse complement
      const exportedSeq = records[0].sequence;
      expect(exportedSeq).toBe(reverseComplement(originalSeq));

      // Reverse complement again should give back original
      expect(reverseComplement(exportedSeq)).toBe(originalSeq);
    });
  });

  // Cut and joined contigs have names of their own (`chr1_L`, `chrA+chrB`)
  // that are not in the input FASTA. Their sequence is built from the input
  // sequences they are made of.
  describe('exportFASTA — cut/join products', () => {
    beforeEach(() => {
      state.reset();
    });

    function fullSpanContig(
      name: string,
      index: number,
      pixelStart: number,
      pixelEnd: number,
      length: number
    ): ContigInfo {
      return {
        name,
        originalIndex: index,
        length,
        pixelStart,
        pixelEnd,
        inverted: false,
        scaffoldId: null,
      };
    }

    it('exports both halves of a cut contig, not a sequence_not_found warning', () => {
      const original = 'A'.repeat(40) + 'C'.repeat(60); // 100 bases
      const contigs = [fullSpanContig('chr1', 0, 0, 100, 100)];
      state.update({ map: makeMapData(contigs), contigOrder: [0] });

      CurationEngine.cut(0, 40); // → chr1_L (40 bp) + chr1_R (60 bp)

      const sequences = new Map([['chr1', original]]);
      const fasta = exportFASTA(state.get(), sequences);

      expect(fasta).not.toContain('sequence_not_found');

      const byName = new Map(parseFASTA(fasta).map((r) => [r.name, r.sequence]));
      const left = byName.get('chr1_L') ?? '';
      const right = byName.get('chr1_R') ?? '';
      expect(left.length).toBe(40);
      expect(right.length).toBe(60);
      expect(left + right).toBe(original);
    });

    it('exports the concatenated sequence of a joined contig', () => {
      const contigs = [
        fullSpanContig('chrA', 0, 0, 100, 4),
        fullSpanContig('chrB', 1, 100, 200, 4),
      ];
      state.update({ map: makeMapData(contigs), contigOrder: [0, 1] });

      CurationEngine.join(0); // → chrA+chrB

      const sequences = new Map([
        ['chrA', 'AAAA'],
        ['chrB', 'TTTT'],
      ]);
      const fasta = exportFASTA(state.get(), sequences);

      expect(fasta).not.toContain('sequence_not_found');

      const byName = new Map(parseFASTA(fasta).map((r) => [r.name, r.sequence]));
      expect(byName.get('chrA+chrB')).toBe('AAAATTTT');
    });
  });

  // Composition guards: cut/join provenance must stay correct through inverted
  // inputs and subsequent inversion (exercises segment slicing + flipping).
  describe('exportFASTA — cut/join sequence composition (orientation)', () => {
    beforeEach(() => {
      state.reset();
    });

    function fullSpanContig(
      name: string,
      index: number,
      pixelStart: number,
      pixelEnd: number,
      length: number,
      inverted = false
    ): ContigInfo {
      return {
        name,
        originalIndex: index,
        length,
        pixelStart,
        pixelEnd,
        inverted,
        scaffoldId: null,
      };
    }

    /** Sequences emitted in display (contig-order) order. */
    function orderedSequences(fasta: string): string[] {
      return parseFASTA(fasta).map((r) => r.sequence);
    }

    it('cuts an inverted contig into correctly reverse-complemented halves', () => {
      // chr1 stored as ATCGATCG but displayed inverted → CGATCGAT.
      const contigs = [fullSpanContig('chr1', 0, 0, 8, 8, true)];
      state.update({ map: makeMapData(contigs), contigOrder: [0] });

      CurationEngine.cut(0, 3); // display halves: CGA | TCGAT

      const fasta = exportFASTA(state.get(), new Map([['chr1', 'ATCGATCG']]));
      expect(fasta).not.toContain('sequence_not_found');
      // Halves, in display order, must reconstruct the inverted display sequence.
      expect(orderedSequences(fasta).join('')).toBe(reverseComplement('ATCGATCG'));
    });

    it('reverse-complements a cut half when it is subsequently inverted', () => {
      const contigs = [fullSpanContig('chr1', 0, 0, 8, 8)];
      state.update({ map: makeMapData(contigs), contigOrder: [0] });

      CurationEngine.cut(0, 4); // chr1_L = AAAA, chr1_R = CCCC
      CurationEngine.invert(0); // invert chr1_L → TTTT

      const fasta = exportFASTA(state.get(), new Map([['chr1', 'AAAACCCC']]));
      const byName = new Map(parseFASTA(fasta).map((r) => [r.name, r.sequence]));
      expect(byName.get('chr1_L')).toBe('TTTT');
      expect(byName.get('chr1_R')).toBe('CCCC');
      expect(fasta).toContain('>chr1_L orientation=-');
    });

    it('joins two inverted contigs into the correct concatenated sequence', () => {
      const contigs = [
        fullSpanContig('chrA', 0, 0, 4, 4, true),
        fullSpanContig('chrB', 1, 4, 8, 4, true),
      ];
      state.update({ map: makeMapData(contigs), contigOrder: [0, 1] });

      CurationEngine.join(0);

      const fasta = exportFASTA(
        state.get(),
        new Map([
          ['chrA', 'AAAA'],
          ['chrB', 'GGGG'],
        ])
      );
      const byName = new Map(parseFASTA(fasta).map((r) => [r.name, r.sequence]));
      // display(A)+display(B) = revComp(AAAA)+revComp(GGGG) = TTTT + CCCC
      expect(byName.get('chrA+chrB')).toBe('TTTTCCCC');
      expect(fasta).toContain('>chrA+chrB orientation=-');
    });
  });

  describe('downloadFASTA', () => {
    it('should not throw when called with valid state (mocked DOM)', () => {
      const mockElement = {
        href: '',
        download: '',
        click: vi.fn(),
      };
      const mockBody = {
        appendChild: vi.fn((node: any) => node),
        removeChild: vi.fn((node: any) => node),
      };
      const mockDocument = {
        createElement: vi.fn(() => mockElement),
        body: mockBody,
      };
      vi.stubGlobal('document', mockDocument);
      vi.stubGlobal('Blob', class MockBlob {
        constructor(public parts: any[], public options: any) {}
      });
      const originalURL = globalThis.URL;
      globalThis.URL = {
        ...originalURL,
        createObjectURL: vi.fn(() => 'blob:mock-url'),
        revokeObjectURL: vi.fn(),
      } as any;

      const contigs = [makeContig('ctg1', 0, 4, null)];
      const state = makeAppState(contigs, [0]);
      const sequences = new Map([['ctg1', 'ATCG']]);

      expect(() => downloadFASTA(state, sequences)).not.toThrow();
      expect(mockElement.click).toHaveBeenCalled();
      expect(mockElement.download).toBe('test_assembly.fasta');

      globalThis.URL = originalURL;
      vi.unstubAllGlobals();
    });
  });
});

// ---------------------------------------------------------------------------
// The sequence written must be the sequence the AGP describes
// ---------------------------------------------------------------------------

import { exportAGP } from '../../src/export/AGPWriter';
import { ScaffoldManager } from '../../src/curation/ScaffoldManager';
import { contigExclusion } from '../../src/curation/ContigExclusion';
import { metaTags } from '../../src/curation/MetaTagManager';

describe('FASTA and AGP agree, and no base is lost at the end of a sequence', () => {
  // 64 texels over a genome the map header calls 6,400 bp: 100 bp per texel.
  // The real sequences are a little longer or shorter than their texels say,
  // as real ones are (the map stores lengths as rounded fractions).
  const LAYOUT: Array<[string, number, number, number]> = [
    // name, first texel, end texel, true length in bp
    ['s1', 0, 20, 2037],     // 37 bp longer than 20 texels
    ['s2', 20, 21, 61],      // one texel, really 61 bp
    ['s3', 21, 21, 12],      // owns no texel
    ['s4', 21, 64, 4290],    // 10 bp shorter than 43 texels
  ];
  const BASES = 'ACGT';
  const sequences = new Map(LAYOUT.map(([name, , , len], k) => [
    name,
    Array.from({ length: len }, (_, i) => BASES[(i * 7 + k * 3 + Math.floor(i / 5)) % 4]).join(''),
  ]));

  function load(): void {
    state.reset();
    contigExclusion.clearAll();
    metaTags.clearAll();
    CurationEngine.setScaffoldManager(new ScaffoldManager());
    const contigs: ContigInfo[] = LAYOUT.map(([name, s, e], i) => ({
      name, originalIndex: i, length: (e - s) * 100, pixelStart: s, pixelEnd: e, inverted: false, scaffoldId: null,
    }));
    state.update({
      map: {
        filename: 'm.pretext', textureSize: 64, numMipMaps: 1, tileResolution: 64, tilesPerDimension: 1,
        contigs, fileContigCount: contigs.length, genomeLength: 6400,
        contactMap: null, rawTiles: null, parsedHeader: null, extensions: new Map(),
      },
      contigOrder: [0, 1, 2, 3],
    });
  }

  /** Build each record from the AGP rows and the input sequences, independently of FASTAWriter. */
  function fromAGP(): string[] {
    const s = state.get();
    const rows = exportAGP(s).split('\n')   // the PretextView file keeps the map's orientation on every row
      .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')).filter((c) => c[4] === 'W');
    // The largest end coordinate of each sequence is its last texel boundary.
    const last = new Map<string, number>();
    for (const c of rows) last.set(c[5], Math.max(last.get(c[5]) ?? 0, Number(c[7])));
    return rows.map((c) => {
      const src = sequences.get(c[5])!;
      const end = Number(c[7]) === last.get(c[5]) ? src.length : Math.min(src.length, Number(c[7]));
      const piece = src.substring(Number(c[6]) - 1, end);
      return c[8] === '-' ? reverseComplement(piece) : piece;
    });
  }

  beforeEach(load);

  it('an untouched assembly exports every input sequence whole', () => {
    const records = parseFASTA(exportFASTA(state.get(), sequences));
    expect(records.map((r) => [r.name, r.sequence])).toEqual(LAYOUT.map(([name]) => [name, sequences.get(name)]));
  });

  it('the piece that reaches the end of a sequence carries its real last bases', () => {
    CurationEngine.cut(0, 5);                      // s1 at texel 5: bp 500
    const byName = new Map(parseFASTA(exportFASTA(state.get(), sequences)).map((r) => [r.name, r.sequence]));
    expect(byName.get('s1_L')).toBe(sequences.get('s1')!.substring(0, 500));
    expect(byName.get('s1_R')).toBe(sequences.get('s1')!.substring(500));
    expect(byName.get('s1_R')!.length).toBe(1537);   // 1500 by the texels, plus the 37 they do not show
    expect(byName.get('s1_L')! + byName.get('s1_R')!).toBe(sequences.get('s1'));
  });

  it('a sequence shorter than its texels say is not read past its end', () => {
    CurationEngine.cut(3, 42);                     // s4 one texel from its end: bp 4200 of 4290
    const byName = new Map(parseFASTA(exportFASTA(state.get(), sequences)).map((r) => [r.name, r.sequence]));
    expect(byName.get('s4_L')!.length).toBe(4200);
    expect(byName.get('s4_R')!.length).toBe(90);
    expect(byName.get('s4_L')! + byName.get('s4_R')!).toBe(sequences.get('s4'));
  });

  it('every base of every input sequence is exported exactly once, whatever the edits', () => {
    function mulberry32(seed: number): () => number {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    for (let seed = 1; seed <= 60; seed++) {
      load();
      const rnd = mulberry32(seed);
      for (let k = 0; k < 16; k++) {
        const s = state.get();
        const count = s.contigOrder.length;
        const i = Math.floor(rnd() * count);
        const r = rnd();
        const c = s.map!.contigs[s.contigOrder[i]];
        const w = c.pixelEnd - c.pixelStart;
        if (r < 0.35) { if (w >= 2) CurationEngine.cut(i, 1 + Math.floor(rnd() * (w - 1))); }
        else if (r < 0.5) { if (i < count - 1) CurationEngine.join(i); }
        else if (r < 0.75) CurationEngine.invert(i);
        else CurationEngine.move(i, Math.floor(rnd() * count));
      }
      const s = state.get();
      const records = parseFASTA(exportFASTA(s, sequences));
      expect(records.every((r) => !/sequence_not_found/.test(r.description ?? '')), `seed ${seed}`).toBe(true);

      // The same bases as the AGP's rows give. A joined contig is one record
      // and several rows, so compare the concatenation. s3 owns no texel: it
      // has a record and no row, so it is set aside here and checked below.
      const withTexels = records.filter((r) => r.name !== 's3');
      expect(withTexels.map((r) => r.sequence).join(''), `seed ${seed}`).toBe(fromAGP().join(''));

      // s3 is exported once, whole, even when it was joined into another
      // contig (it has no place on the map, so it comes out on its own).
      const s3 = records.filter((r) => r.name === 's3');
      expect(s3, `seed ${seed}`).toHaveLength(1);
      expect([sequences.get('s3'), reverseComplement(sequences.get('s3')!)], `seed ${seed}`).toContain(s3[0].sequence);

      // Every base once.
      const total = records.reduce((n, r) => n + r.sequence.length, 0);
      expect(total, `seed ${seed}`).toBe(LAYOUT.reduce((n, l) => n + l[3], 0));
    }
  });
});
