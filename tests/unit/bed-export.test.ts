import { describe, it, expect, vi } from 'vitest';
import type { AppState, ContigInfo, MapData } from '../../src/core/State';
import {
  exportBED,
  downloadBED,
  buildScaffoldBEDLines,
  formatBEDLine,
} from '../../src/export/BEDWriter';

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
// BEDWriter tests
// ---------------------------------------------------------------------------

describe('BEDWriter', () => {
  describe('exportBED - basic export with no scaffolds', () => {
    it('should produce 3 lines for 3 unscaffolded contigs, each in own scaffold', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, null),
        makeContig('ctg2', 1, 2000, null),
        makeContig('ctg3', 2, 1500, null),
      ];
      const state = makeAppState(contigs, [0, 1, 2]);

      const bed = exportBED(state);
      const dataLines = bed
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      expect(dataLines.length).toBe(3);

      // Each contig is in its own scaffold (unplaced_N)
      const chroms = dataLines.map((l) => l.split('\t')[0]);
      expect(chroms[0]).toBe('unplaced_0');
      expect(chroms[1]).toBe('unplaced_1');
      expect(chroms[2]).toBe('unplaced_2');

      // Each single-contig scaffold starts at 0
      for (const line of dataLines) {
        const fields = line.split('\t');
        expect(fields[1]).toBe('0');
      }

      // Verify lengths match contig sizes
      expect(dataLines[0].split('\t')[2]).toBe('1000');
      expect(dataLines[1].split('\t')[2]).toBe('2000');
      expect(dataLines[2].split('\t')[2]).toBe('1500');
    });
  });

  describe('exportBED - contigs with scaffold assignments', () => {
    it('should group contigs under same scaffold name with correct coordinates', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1),
        makeContig('ctg3', 2, 1500, 2),
      ];
      const state = makeAppState(contigs, [0, 1, 2]);

      const bed = exportBED(state, { gapSize: 200 });
      const dataLines = bed
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      expect(dataLines.length).toBe(3);

      // First two contigs in scaffold_1
      const fields0 = dataLines[0].split('\t');
      expect(fields0[0]).toBe('scaffold_1');
      expect(fields0[3]).toBe('ctg1');
      expect(fields0[1]).toBe('0');
      expect(fields0[2]).toBe('1000');

      const fields1 = dataLines[1].split('\t');
      expect(fields1[0]).toBe('scaffold_1');
      expect(fields1[3]).toBe('ctg2');
      // Start = 0 + 1000 (ctg1) + 200 (gap) = 1200
      expect(fields1[1]).toBe('1200');
      // End = 1200 + 2000 = 3200
      expect(fields1[2]).toBe('3200');

      // Third contig in scaffold_2
      const fields2 = dataLines[2].split('\t');
      expect(fields2[0]).toBe('scaffold_2');
      expect(fields2[3]).toBe('ctg3');
      expect(fields2[1]).toBe('0');
      expect(fields2[2]).toBe('1500');
    });
  });

  describe('exportBED - inverted contig', () => {
    it('should set strand to - for inverted contigs', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1, false),
        makeContig('ctg2', 1, 2000, 1, true),
      ];
      const state = makeAppState(contigs, [0, 1]);

      const bed = exportBED(state);
      const dataLines = bed
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      expect(dataLines[0].split('\t')[5]).toBe('+');
      expect(dataLines[1].split('\t')[5]).toBe('-');
    });
  });

  describe('exportBED - gap sizes', () => {
    it('should add correct gap sizes between contigs in same scaffold', () => {
      const contigs = [
        makeContig('ctg1', 0, 500, 1),
        makeContig('ctg2', 1, 300, 1),
        makeContig('ctg3', 2, 700, 1),
      ];
      const state = makeAppState(contigs, [0, 1, 2]);

      const bed = exportBED(state, { gapSize: 100 });
      const dataLines = bed
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      // ctg1: start=0, end=500
      const f0 = dataLines[0].split('\t');
      expect(parseInt(f0[1])).toBe(0);
      expect(parseInt(f0[2])).toBe(500);

      // ctg2: start=500+100=600, end=600+300=900
      const f1 = dataLines[1].split('\t');
      expect(parseInt(f1[1])).toBe(600);
      expect(parseInt(f1[2])).toBe(900);

      // ctg3: start=900+100=1000, end=1000+700=1700
      const f2 = dataLines[2].split('\t');
      expect(parseInt(f2[1])).toBe(1000);
      expect(parseInt(f2[2])).toBe(1700);

      // Total scaffold length = 500 + 100 + 300 + 100 + 700 = 1700
      // which matches the last chromEnd
    });

    it('should not add gaps between contigs in different scaffolds', () => {
      const contigs = [
        makeContig('ctg1', 0, 500, 1),
        makeContig('ctg2', 1, 300, 2),
      ];
      const state = makeAppState(contigs, [0, 1]);

      const bed = exportBED(state, { gapSize: 100 });
      const dataLines = bed
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      // Each scaffold starts at 0
      expect(dataLines[0].split('\t')[1]).toBe('0');
      expect(dataLines[1].split('\t')[1]).toBe('0');
    });
  });

  describe('exportBED - empty state', () => {
    it('should throw error when no map data is loaded', () => {
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

      expect(() => exportBED(state)).toThrow('no map data loaded');
    });

    it('should throw error when contig order is empty', () => {
      const contigs = [makeContig('ctg1', 0, 1000, 1)];
      const state = makeAppState(contigs, []);

      expect(() => exportBED(state)).toThrow('contig order is empty');
    });
  });

  describe('exportBED - header', () => {
    it('should include header line by default', () => {
      const contigs = [makeContig('ctg1', 0, 1000, null)];
      const state = makeAppState(contigs, [0]);

      const bed = exportBED(state);
      const lines = bed.split('\n');

      expect(lines[0]).toBe('#chrom\tchromStart\tchromEnd\tname\tscore\tstrand');
    });

    it('should omit header line when includeHeader is false', () => {
      const contigs = [makeContig('ctg1', 0, 1000, null)];
      const state = makeAppState(contigs, [0]);

      const bed = exportBED(state, { includeHeader: false });

      expect(bed).not.toContain('#chrom');
      const dataLines = bed.split('\n').filter((l) => l.length > 0);
      expect(dataLines.length).toBe(1);
    });
  });

  describe('exportBED - score column', () => {
    it('should always set score to 0', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1, true),
      ];
      const state = makeAppState(contigs, [0, 1]);

      const bed = exportBED(state);
      const dataLines = bed
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      for (const line of dataLines) {
        expect(line.split('\t')[4]).toBe('0');
      }
    });
  });

  describe('buildScaffoldBEDLines', () => {
    it('should build correct BED lines for a scaffold group', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1, true),
      ];

      const lines = buildScaffoldBEDLines('scaffold_1', contigs, 200);

      expect(lines.length).toBe(2);

      expect(lines[0].chrom).toBe('scaffold_1');
      expect(lines[0].chromStart).toBe(0);
      expect(lines[0].chromEnd).toBe(1000);
      expect(lines[0].name).toBe('ctg1');
      expect(lines[0].score).toBe(0);
      expect(lines[0].strand).toBe('+');

      expect(lines[1].chrom).toBe('scaffold_1');
      expect(lines[1].chromStart).toBe(1200);
      expect(lines[1].chromEnd).toBe(3200);
      expect(lines[1].name).toBe('ctg2');
      expect(lines[1].score).toBe(0);
      expect(lines[1].strand).toBe('-');
    });
  });

  describe('formatBEDLine', () => {
    it('should format a BED line as tab-separated', () => {
      const result = formatBEDLine({
        chrom: 'scaffold_1',
        chromStart: 1200,
        chromEnd: 3200,
        name: 'ctg2',
        score: 0,
        strand: '-',
      });

      expect(result).toBe('scaffold_1\t1200\t3200\tctg2\t0\t-');
    });
  });

  describe('downloadBED', () => {
    it('should not throw when called with valid state (mocked DOM)', () => {
      // Mock DOM APIs for node environment
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
      const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
      const mockRevokeObjectURL = vi.fn();
      globalThis.URL = {
        ...originalURL,
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL,
      } as any;

      const contigs = [makeContig('ctg1', 0, 1000, null)];
      const state = makeAppState(contigs, [0]);

      expect(() => downloadBED(state)).not.toThrow();
      expect(mockElement.click).toHaveBeenCalled();
      expect(mockElement.download).toBe('test_assembly.bed');

      globalThis.URL = originalURL;
      vi.unstubAllGlobals();
    });

    it('should use provided filename (mocked DOM)', () => {
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

      const contigs = [makeContig('ctg1', 0, 1000, null)];
      const state = makeAppState(contigs, [0]);

      downloadBED(state, 'custom.bed');
      expect(mockElement.download).toBe('custom.bed');

      globalThis.URL = originalURL;
      vi.unstubAllGlobals();
    });
  });
});
