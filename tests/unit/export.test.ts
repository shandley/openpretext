import { describe, it, expect, beforeEach } from 'vitest';
import type { AppState, ContigInfo, MapData } from '../../src/core/State';
import {
  exportAGP,
  groupContigsByScaffold,
  buildScaffoldAGPLines,
  formatAGPLine,
} from '../../src/export/AGPWriter';
import {
  CurationLog,
  takeSnapshot,
  replayLog,
  snapshotsMatch,
} from '../../src/export/CurationLog';
import type { StateSnapshot, CurationLogEntry } from '../../src/export/CurationLog';

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
// AGPWriter tests
// ---------------------------------------------------------------------------

describe('AGPWriter', () => {
  describe('groupContigsByScaffold', () => {
    it('should group contigs by scaffoldId', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1),
        makeContig('ctg3', 2, 1500, 2),
      ];
      const order = [0, 1, 2];

      const groups = groupContigsByScaffold(contigs, order);
      expect(groups.size).toBe(2);
      expect(groups.get('scaffold_1')!.length).toBe(2);
      expect(groups.get('scaffold_2')!.length).toBe(1);
    });

    it('should place unscaffolded contigs in separate groups', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, null),
        makeContig('ctg2', 1, 2000, null),
        makeContig('ctg3', 2, 1500, 1),
      ];
      const order = [0, 1, 2];

      const groups = groupContigsByScaffold(contigs, order);
      expect(groups.size).toBe(3);
      expect(groups.has('unplaced_0')).toBe(true);
      expect(groups.has('unplaced_1')).toBe(true);
      expect(groups.has('scaffold_1')).toBe(true);
    });

    it('should respect contigOrder for grouping', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1),
        makeContig('ctg3', 2, 1500, 1),
      ];
      // Only include contigs 0 and 2 in the order
      const order = [0, 2];

      const groups = groupContigsByScaffold(contigs, order);
      expect(groups.get('scaffold_1')!.length).toBe(2);
      expect(groups.get('scaffold_1')![0].name).toBe('ctg1');
      expect(groups.get('scaffold_1')![1].name).toBe('ctg3');
    });
  });

  describe('buildScaffoldAGPLines', () => {
    it('should produce contig lines with correct coordinates', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1),
      ];

      const lines = buildScaffoldAGPLines('scaffold_1', contigs, {
        gapSize: 200,
        gapType: 'scaffold',
        linkageEvidence: 'proximity_ligation',
        includeHeader: true,
        scaffoldPrefix: 'scaffold_',
      });

      // Should produce: contig1, gap, contig2 = 3 lines
      expect(lines.length).toBe(3);

      // First contig
      expect(lines[0].componentType).toBe('W');
      expect(lines[0].objectBeg).toBe(1);
      expect(lines[0].objectEnd).toBe(1000);
      expect(lines[0].componentId).toBe('ctg1');
      expect(lines[0].partNumber).toBe(1);

      // Gap
      expect(lines[1].componentType).toBe('N');
      expect(lines[1].objectBeg).toBe(1001);
      expect(lines[1].objectEnd).toBe(1200);
      expect(lines[1].gapLength).toBe(200);
      expect(lines[1].linkage).toBe('yes');
      expect(lines[1].partNumber).toBe(2);

      // Second contig
      expect(lines[2].componentType).toBe('W');
      expect(lines[2].objectBeg).toBe(1201);
      expect(lines[2].objectEnd).toBe(3200);
      expect(lines[2].componentId).toBe('ctg2');
      expect(lines[2].partNumber).toBe(3);
    });

    it('should handle a single contig with no gaps', () => {
      const contigs = [makeContig('ctg_solo', 0, 5000, 1)];
      const lines = buildScaffoldAGPLines('scaffold_1', contigs, {
        gapSize: 200,
        gapType: 'scaffold',
        linkageEvidence: 'proximity_ligation',
        includeHeader: true,
        scaffoldPrefix: 'scaffold_',
      });

      expect(lines.length).toBe(1);
      expect(lines[0].componentType).toBe('W');
      expect(lines[0].objectBeg).toBe(1);
      expect(lines[0].objectEnd).toBe(5000);
    });

    it('should set orientation to - for inverted contigs', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1, false),
        makeContig('ctg2', 1, 2000, 1, true),
      ];

      const lines = buildScaffoldAGPLines('scaffold_1', contigs, {
        gapSize: 200,
        gapType: 'scaffold',
        linkageEvidence: 'proximity_ligation',
        includeHeader: true,
        scaffoldPrefix: 'scaffold_',
      });

      const contigLines = lines.filter((l) => l.componentType === 'W');
      expect(contigLines[0].orientation).toBe('+');
      expect(contigLines[1].orientation).toBe('-');
    });

    it('should handle zero gap size (no gap lines)', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1),
      ];

      const lines = buildScaffoldAGPLines('scaffold_1', contigs, {
        gapSize: 0,
        gapType: 'scaffold',
        linkageEvidence: 'proximity_ligation',
        includeHeader: true,
        scaffoldPrefix: 'scaffold_',
      });

      // No gap lines when gapSize is 0
      expect(lines.length).toBe(2);
      expect(lines[0].objectBeg).toBe(1);
      expect(lines[0].objectEnd).toBe(1000);
      expect(lines[1].objectBeg).toBe(1001);
      expect(lines[1].objectEnd).toBe(3000);
    });
  });

  describe('formatAGPLine', () => {
    it('should format a contig line as tab-separated', () => {
      const result = formatAGPLine({
        object: 'scaffold_1',
        objectBeg: 1,
        objectEnd: 1000,
        partNumber: 1,
        componentType: 'W',
        componentId: 'ctg1',
        componentBeg: 1,
        componentEnd: 1000,
        orientation: '+',
      });

      expect(result).toBe('scaffold_1\t1\t1000\t1\tW\tctg1\t1\t1000\t+');
    });

    it('should format a gap line as tab-separated', () => {
      const result = formatAGPLine({
        object: 'scaffold_1',
        objectBeg: 1001,
        objectEnd: 1200,
        partNumber: 2,
        componentType: 'N',
        gapLength: 200,
        gapType: 'scaffold',
        linkage: 'yes',
        linkageEvidence: 'proximity_ligation',
      });

      expect(result).toBe(
        'scaffold_1\t1001\t1200\t2\tN\t200\tscaffold\tyes\tproximity_ligation'
      );
    });
  });

  describe('exportAGP', () => {
    it('should produce a complete AGP file for a simple assembly', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1),
        makeContig('ctg3', 2, 3000, 2),
      ];
      const state = makeAppState(contigs, [0, 1, 2]);

      const agp = exportAGP(state);

      // Should start with header
      expect(agp).toContain('##agp-version\t2.1');

      // Should contain all three contigs
      expect(agp).toContain('ctg1');
      expect(agp).toContain('ctg2');
      expect(agp).toContain('ctg3');

      // Should end with newline
      expect(agp.endsWith('\n')).toBe(true);

      // Parse lines (skip comment lines)
      const dataLines = agp
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      // scaffold_1: ctg1 + gap + ctg2 = 3 lines
      // scaffold_2: ctg3 = 1 line
      // Total = 4 data lines
      expect(dataLines.length).toBe(4);
    });

    it('should produce correct AGP without header when requested', () => {
      const contigs = [makeContig('ctg1', 0, 5000, 1)];
      const state = makeAppState(contigs, [0]);

      const agp = exportAGP(state, { includeHeader: false });

      expect(agp).not.toContain('##agp-version');
      const lines = agp.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBe(1);
    });

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

      expect(() => exportAGP(state)).toThrow('no map data loaded');
    });

    it('should throw when contig order is empty', () => {
      const contigs = [makeContig('ctg1', 0, 1000, 1)];
      const state = makeAppState(contigs, []);

      expect(() => exportAGP(state)).toThrow('contig order is empty');
    });

    it('should handle mixed scaffolded and unscaffolded contigs', () => {
      const contigs = [
        makeContig('chr1_ctg1', 0, 10000, 1),
        makeContig('chr1_ctg2', 1, 20000, 1),
        makeContig('unplaced1', 2, 5000, null),
      ];
      const state = makeAppState(contigs, [0, 1, 2]);

      const agp = exportAGP(state);
      const dataLines = agp
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      // scaffold_1: 2 contigs + 1 gap = 3 lines
      // unplaced_0: 1 contig = 1 line
      expect(dataLines.length).toBe(4);

      // Check the unplaced contig
      const unplacedLine = dataLines.find((l) => l.startsWith('unplaced_'));
      expect(unplacedLine).toBeDefined();
      expect(unplacedLine).toContain('unplaced1');
    });

    it('should handle inverted contigs with - orientation', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1, false),
        makeContig('ctg2', 1, 2000, 1, true),
      ];
      const state = makeAppState(contigs, [0, 1]);

      const agp = exportAGP(state);
      const dataLines = agp
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      // Find contig lines (W type)
      const contigLines = dataLines.filter((l) => l.split('\t')[4] === 'W');
      expect(contigLines.length).toBe(2);

      // First contig should be +
      expect(contigLines[0].split('\t')[8]).toBe('+');
      // Second contig should be -
      expect(contigLines[1].split('\t')[8]).toBe('-');
    });

    it('should use custom gap settings', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1),
      ];
      const state = makeAppState(contigs, [0, 1]);

      const agp = exportAGP(state, {
        gapSize: 500,
        gapType: 'contig',
        linkageEvidence: 'map',
      });

      const dataLines = agp
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));
      const gapLine = dataLines.find((l) => l.split('\t')[4] === 'N');
      expect(gapLine).toBeDefined();

      const fields = gapLine!.split('\t');
      expect(fields[5]).toBe('500');
      expect(fields[6]).toBe('contig');
      expect(fields[7]).toBe('yes');
      expect(fields[8]).toBe('map');
    });

    it('should have correct coordinate continuity within a scaffold', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1),
        makeContig('ctg3', 2, 3000, 1),
      ];
      const state = makeAppState(contigs, [0, 1, 2]);

      const agp = exportAGP(state, { gapSize: 100 });
      const dataLines = agp
        .split('\n')
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      // Verify coordinate continuity: each line's objectBeg = previous objectEnd + 1
      for (let i = 1; i < dataLines.length; i++) {
        const prevEnd = parseInt(dataLines[i - 1].split('\t')[2], 10);
        const currBeg = parseInt(dataLines[i].split('\t')[1], 10);
        expect(currBeg).toBe(prevEnd + 1);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// CurationLog tests
// ---------------------------------------------------------------------------

describe('CurationLog', () => {
  let log: CurationLog;

  beforeEach(() => {
    log = new CurationLog();
  });

  describe('record and getEntries', () => {
    it('should record an operation and retrieve it', () => {
      const before: StateSnapshot = {
        contigOrder: [0, 1, 2],
        contigStates: [
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: null },
          { index: 1, name: 'ctg2', inverted: false, scaffoldId: null },
          { index: 2, name: 'ctg3', inverted: false, scaffoldId: null },
        ],
      };

      const after: StateSnapshot = {
        contigOrder: [0, 1, 2],
        contigStates: [
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: null },
          { index: 1, name: 'ctg2', inverted: true, scaffoldId: null },
          { index: 2, name: 'ctg3', inverted: false, scaffoldId: null },
        ],
      };

      log.record(
        {
          type: 'invert',
          timestamp: Date.now(),
          description: 'Invert ctg2',
          data: { contigIndex: 1 },
        },
        before,
        after
      );

      expect(log.length).toBe(1);

      const entries = log.getEntries();
      expect(entries[0].sequence).toBe(0);
      expect(entries[0].operationType).toBe('invert');
      expect(entries[0].description).toBe('Invert ctg2');
      expect(entries[0].parameters.contigIndex).toBe(1);
      expect(entries[0].before.contigStates[1].inverted).toBe(false);
      expect(entries[0].after.contigStates[1].inverted).toBe(true);
    });

    it('should assign sequential sequence numbers', () => {
      const snapshot: StateSnapshot = {
        contigOrder: [0],
        contigStates: [{ index: 0, name: 'ctg1', inverted: false, scaffoldId: null }],
      };

      for (let i = 0; i < 5; i++) {
        log.record(
          {
            type: 'invert',
            timestamp: Date.now(),
            description: `Op ${i}`,
            data: {},
          },
          snapshot,
          snapshot
        );
      }

      const entries = log.getEntries();
      expect(entries.length).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(entries[i].sequence).toBe(i);
      }
    });
  });

  describe('removeLast', () => {
    it('should remove the last entry', () => {
      const snapshot: StateSnapshot = {
        contigOrder: [0],
        contigStates: [{ index: 0, name: 'ctg1', inverted: false, scaffoldId: null }],
      };

      log.record(
        { type: 'invert', timestamp: 1000, description: 'Op 1', data: {} },
        snapshot,
        snapshot
      );
      log.record(
        { type: 'move', timestamp: 2000, description: 'Op 2', data: {} },
        snapshot,
        snapshot
      );

      expect(log.length).toBe(2);
      const removed = log.removeLast();
      expect(removed.length).toBe(1);
      expect(removed[0].description).toBe('Op 2');
      expect(log.length).toBe(1);
    });

    it('should remove multiple entries at once', () => {
      const snapshot: StateSnapshot = {
        contigOrder: [0],
        contigStates: [{ index: 0, name: 'ctg1', inverted: false, scaffoldId: null }],
      };

      for (let i = 0; i < 5; i++) {
        log.record(
          { type: 'invert', timestamp: i * 1000, description: `Op ${i}`, data: {} },
          snapshot,
          snapshot
        );
      }

      const removed = log.removeLast(3);
      expect(removed.length).toBe(3);
      expect(log.length).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const snapshot: StateSnapshot = {
        contigOrder: [0],
        contigStates: [{ index: 0, name: 'ctg1', inverted: false, scaffoldId: null }],
      };

      log.record(
        { type: 'invert', timestamp: 1000, description: 'Op 1', data: {} },
        snapshot,
        snapshot
      );
      log.record(
        { type: 'move', timestamp: 2000, description: 'Op 2', data: {} },
        snapshot,
        snapshot
      );

      log.clear();
      expect(log.length).toBe(0);
      expect(log.getEntries().length).toBe(0);
    });
  });

  describe('JSON export and import', () => {
    it('should round-trip through JSON serialization', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1),
        makeContig('ctg2', 1, 2000, 1),
      ];
      const state = makeAppState(contigs, [0, 1]);

      log.initialize(state);

      const before = takeSnapshot(state);
      // Simulate an invert
      contigs[1].inverted = true;
      const after = takeSnapshot(state);

      log.record(
        {
          type: 'invert',
          timestamp: Date.now(),
          description: 'Invert ctg2',
          data: { contigIndex: 1 },
        },
        before,
        after
      );

      const json = log.toJSON();
      const restored = CurationLog.fromJSON(json);

      expect(restored.length).toBe(1);
      const entry = restored.getEntries()[0];
      expect(entry.operationType).toBe('invert');
      expect(entry.before.contigStates[1].inverted).toBe(false);
      expect(entry.after.contigStates[1].inverted).toBe(true);
    });

    it('should include metadata in the exported document', () => {
      const contigs = [makeContig('ctg1', 0, 1000, null)];
      const state = makeAppState(contigs, [0]);
      log.initialize(state);

      const doc = log.exportJSON();
      expect(doc.version).toBe('1.0.0');
      expect(doc.tool).toBe('OpenPretext');
      expect(doc.sourceFile).toBe('test_assembly.pretext');
      expect(doc.totalContigs).toBe(1);
      expect(doc.createdAt).toBeDefined();
      expect(doc.lastModifiedAt).toBeDefined();
    });

    it('should throw on invalid JSON', () => {
      expect(() => CurationLog.fromJSON('{}')).toThrow('missing version');
    });

    it('should throw on missing entries', () => {
      expect(() => CurationLog.fromJSON('{"version":"1.0.0"}')).toThrow(
        'missing entries'
      );
    });
  });

  describe('takeSnapshot', () => {
    it('should capture contig order and states', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, 1, false),
        makeContig('ctg2', 1, 2000, 2, true),
      ];
      const state = makeAppState(contigs, [1, 0]);

      const snapshot = takeSnapshot(state);
      expect(snapshot.contigOrder).toEqual([1, 0]);
      expect(snapshot.contigStates.length).toBe(2);
      expect(snapshot.contigStates[0].name).toBe('ctg2');
      expect(snapshot.contigStates[0].inverted).toBe(true);
      expect(snapshot.contigStates[1].name).toBe('ctg1');
      expect(snapshot.contigStates[1].inverted).toBe(false);
    });
  });

  describe('snapshotsMatch', () => {
    it('should return true for identical snapshots', () => {
      const snapshot: StateSnapshot = {
        contigOrder: [0, 1],
        contigStates: [
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: 1 },
          { index: 1, name: 'ctg2', inverted: true, scaffoldId: 1 },
        ],
      };

      expect(snapshotsMatch(snapshot, { ...snapshot })).toBe(true);
    });

    it('should return false when contig order differs', () => {
      const a: StateSnapshot = {
        contigOrder: [0, 1],
        contigStates: [
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: null },
          { index: 1, name: 'ctg2', inverted: false, scaffoldId: null },
        ],
      };
      const b: StateSnapshot = {
        contigOrder: [1, 0],
        contigStates: [
          { index: 1, name: 'ctg2', inverted: false, scaffoldId: null },
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: null },
        ],
      };

      expect(snapshotsMatch(a, b)).toBe(false);
    });

    it('should return false when inversion state differs', () => {
      const a: StateSnapshot = {
        contigOrder: [0],
        contigStates: [{ index: 0, name: 'ctg1', inverted: false, scaffoldId: null }],
      };
      const b: StateSnapshot = {
        contigOrder: [0],
        contigStates: [{ index: 0, name: 'ctg1', inverted: true, scaffoldId: null }],
      };

      expect(snapshotsMatch(a, b)).toBe(false);
    });
  });

  describe('replayLog', () => {
    it('should replay operations and validate results', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, null, false),
        makeContig('ctg2', 1, 2000, null, false),
        makeContig('ctg3', 2, 3000, null, false),
      ];
      const initialState = makeAppState(contigs, [0, 1, 2]);

      // Record an invert operation
      const before = takeSnapshot(initialState);

      // Simulate the invert
      contigs[1].inverted = true;
      const afterState = makeAppState(contigs, [0, 1, 2]);
      const after = takeSnapshot(afterState);

      log.record(
        {
          type: 'invert',
          timestamp: Date.now(),
          description: 'Invert ctg2',
          data: { contigIndex: 1 },
        },
        before,
        after
      );

      // Reset for replay
      contigs[1].inverted = false;
      const freshState = makeAppState(contigs, [0, 1, 2]);

      // Replay with a handler that applies the invert
      const result = replayLog(log, freshState, (state, entry) => {
        if (entry.operationType === 'invert') {
          const idx = entry.parameters.contigIndex;
          const newContigs = state.map!.contigs.map((c, i) =>
            i === idx ? { ...c, inverted: !c.inverted } : c
          );
          return {
            ...state,
            map: { ...state.map!, contigs: newContigs },
          };
        }
        return state;
      });

      expect(result.validationResults.length).toBe(1);
      expect(result.validationResults[0].matches).toBe(true);
      expect(result.finalState.map!.contigs[1].inverted).toBe(true);
    });

    it('should detect mismatches during replay', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, null, false),
        makeContig('ctg2', 1, 2000, null, false),
      ];
      const state = makeAppState(contigs, [0, 1]);

      const before: StateSnapshot = {
        contigOrder: [0, 1],
        contigStates: [
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: null },
          { index: 1, name: 'ctg2', inverted: false, scaffoldId: null },
        ],
      };
      const after: StateSnapshot = {
        contigOrder: [0, 1],
        contigStates: [
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: null },
          { index: 1, name: 'ctg2', inverted: true, scaffoldId: null },
        ],
      };

      log.record(
        {
          type: 'invert',
          timestamp: Date.now(),
          description: 'Invert ctg2',
          data: { contigIndex: 1 },
        },
        before,
        after
      );

      // Replay with a no-op handler (does nothing) so the result will not match
      const result = replayLog(log, state, (s) => s);

      expect(result.validationResults.length).toBe(1);
      expect(result.validationResults[0].matches).toBe(false);
    });

    it('should replay multiple operations in sequence', () => {
      const contigs = [
        makeContig('ctg1', 0, 1000, null, false),
        makeContig('ctg2', 1, 2000, null, false),
        makeContig('ctg3', 2, 3000, null, false),
      ];

      // Op 1: Invert ctg2
      const snap0: StateSnapshot = {
        contigOrder: [0, 1, 2],
        contigStates: [
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: null },
          { index: 1, name: 'ctg2', inverted: false, scaffoldId: null },
          { index: 2, name: 'ctg3', inverted: false, scaffoldId: null },
        ],
      };
      const snap1: StateSnapshot = {
        contigOrder: [0, 1, 2],
        contigStates: [
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: null },
          { index: 1, name: 'ctg2', inverted: true, scaffoldId: null },
          { index: 2, name: 'ctg3', inverted: false, scaffoldId: null },
        ],
      };

      // Op 2: Move ctg3 to position 0 (reorder to [2, 0, 1])
      const snap2: StateSnapshot = {
        contigOrder: [2, 0, 1],
        contigStates: [
          { index: 2, name: 'ctg3', inverted: false, scaffoldId: null },
          { index: 0, name: 'ctg1', inverted: false, scaffoldId: null },
          { index: 1, name: 'ctg2', inverted: true, scaffoldId: null },
        ],
      };

      log.record(
        {
          type: 'invert',
          timestamp: 1000,
          description: 'Invert ctg2',
          data: { contigIndex: 1 },
        },
        snap0,
        snap1
      );
      log.record(
        {
          type: 'move',
          timestamp: 2000,
          description: 'Move ctg3 to front',
          data: { fromIndex: 2, toIndex: 0 },
        },
        snap1,
        snap2
      );

      const initialState = makeAppState(contigs, [0, 1, 2]);

      const result = replayLog(log, initialState, (state, entry) => {
        if (entry.operationType === 'invert') {
          const idx = entry.parameters.contigIndex;
          const newContigs = state.map!.contigs.map((c, i) =>
            i === idx ? { ...c, inverted: !c.inverted } : c
          );
          return { ...state, map: { ...state.map!, contigs: newContigs } };
        }
        if (entry.operationType === 'move') {
          const from = entry.parameters.fromIndex as number;
          const to = entry.parameters.toIndex as number;
          const newOrder = [...state.contigOrder];
          const [moved] = newOrder.splice(from, 1);
          newOrder.splice(to, 0, moved);
          return { ...state, contigOrder: newOrder };
        }
        return state;
      });

      expect(result.validationResults.length).toBe(2);
      expect(result.validationResults[0].matches).toBe(true);
      expect(result.validationResults[1].matches).toBe(true);
      expect(result.finalState.contigOrder).toEqual([2, 0, 1]);
      expect(result.finalState.map!.contigs[1].inverted).toBe(true);
    });
  });
});
