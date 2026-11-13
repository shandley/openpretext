import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AppState, ContigInfo, MapData } from '../../src/core/State';
import { exportAGP } from '../../src/export/AGPWriter';
import { exportBED } from '../../src/export/BEDWriter';
import { exportFASTA } from '../../src/export/FASTAWriter';
import { contigExclusion } from '../../src/curation/ContigExclusion';
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

// AGP export is tested in agp-export.test.ts, BED in bed-export.test.ts.

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

// ---------------------------------------------------------------------------
// Contig exclusion in exports
// ---------------------------------------------------------------------------

describe('Excluded contigs are omitted from the standard AGP, BED and FASTA', () => {
  const contigs: ContigInfo[] = [
    { name: 'ctg1', originalIndex: 0, length: 1000, pixelStart: 0, pixelEnd: 10, inverted: false, scaffoldId: null },
    { name: 'ctg2', originalIndex: 1, length: 2000, pixelStart: 10, pixelEnd: 30, inverted: false, scaffoldId: null },
    { name: 'ctg3', originalIndex: 2, length: 7000, pixelStart: 30, pixelEnd: 100, inverted: false, scaffoldId: null },
  ];

  const appState: AppState = {
    map: {
      filename: 'test.pretext',
      textureSize: 100,
      numMipMaps: 1,
      tileResolution: 100,
      tilesPerDimension: 1,
      contigs,
      contactMap: null,
      rawTiles: null,
      parsedHeader: null,
      extensions: new Map(),
    },
    contigOrder: [0, 1, 2],
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

  afterEach(() => {
    contigExclusion.clearAll();
  });

  it('the standard AGP omits excluded contigs', () => {
    contigExclusion.set(1, true); // exclude ctg2

    const agp = exportAGP(appState, { flavor: 'standard' });
    expect(agp).toContain('ctg1');
    expect(agp).toContain('ctg3');
    expect(agp).not.toContain('ctg2');
  });

  it('BED omits excluded contigs', () => {
    contigExclusion.set(1, true); // exclude ctg2

    const bed = exportBED(appState);
    expect(bed).toContain('ctg1');
    expect(bed).toContain('ctg3');
    expect(bed).not.toContain('ctg2');
  });

  it('FASTA omits excluded contigs', () => {
    contigExclusion.set(1, true); // exclude ctg2

    const sequences = new Map([
      ['ctg1', 'AAAA'],
      ['ctg2', 'CCCC'],
      ['ctg3', 'TTTT'],
    ]);
    const fasta = exportFASTA(appState, sequences);
    expect(fasta).toContain('>ctg1');
    expect(fasta).toContain('>ctg3');
    expect(fasta).not.toContain('>ctg2');
  });

  it('exports include all contigs when nothing is excluded', () => {
    const agp = exportAGP(appState);
    expect(agp).toContain('ctg1');
    expect(agp).toContain('ctg2');
    expect(agp).toContain('ctg3');
  });
});
