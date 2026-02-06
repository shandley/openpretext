import { describe, it, expect, vi } from 'vitest';
import type { AppState, ContigInfo, MapData } from '../../src/core/State';
import { parseFASTA } from '../../src/formats/FASTAParser';
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
    textureSize: 1024,
    numMipMaps: 1,
    contigs,
    textures: [new Float32Array(0)],
    extensions: new Map(),
  };
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
