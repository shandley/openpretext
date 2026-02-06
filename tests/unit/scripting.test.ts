import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseLine,
  parseScript,
  parseContigRef,
  tokenize,
  type ScriptCommand,
  type ContigRef,
} from '../../src/scripting/ScriptParser';
import {
  executeCommand,
  executeScript,
  resolveContigRef,
  type ScriptContext,
  type ScriptResult,
  type CurationEngineAPI,
  type SelectionAPI,
  type ScaffoldAPI,
  type StateAPI,
} from '../../src/scripting/ScriptExecutor';
import type { AppState, ContigInfo, MapData } from '../../src/core/State';
import type { Scaffold } from '../../src/curation/ScaffoldManager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContig(
  name: string,
  index: number,
  pixelStart: number,
  pixelEnd: number,
  length = 1000
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

function makeTestMap(contigs: ContigInfo[]): MapData {
  return {
    filename: 'test.pretext',
    textureSize: 1024,
    numMipMaps: 1,
    tileResolution: 512,
    tilesPerDimension: 2,
    contigs,
    contactMap: null,
    extensions: new Map(),
  };
}

/**
 * Build a mock ScriptContext with 4 contigs: chr1, chr2, chr3, chr4.
 * Records all calls to the curation/selection/scaffold APIs for assertions.
 */
function createMockContext(): {
  ctx: ScriptContext;
  calls: Record<string, any[][]>;
  scaffolds: Scaffold[];
  appState: AppState;
} {
  const contigs = [
    makeContig('chr1', 0, 0, 100, 10000),
    makeContig('chr2', 1, 100, 200, 8000),
    makeContig('chr3', 2, 200, 300, 6000),
    makeContig('chr4', 3, 300, 400, 4000),
  ];

  const scaffolds: Scaffold[] = [];
  let nextScaffoldId = 1;

  const appState: AppState = {
    map: makeTestMap(contigs),
    contigOrder: [0, 1, 2, 3],
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

  const calls: Record<string, any[][]> = {
    cut: [],
    join: [],
    invert: [],
    move: [],
    selectSingle: [],
    selectRange: [],
    selectAll: [],
    clearSelection: [],
    createScaffold: [],
    deleteScaffold: [],
    paintContigs: [],
    echo: [],
  };

  const stateApi: StateAPI = {
    get: () => appState,
    update: (partial: Partial<AppState>) => {
      Object.assign(appState, partial);
    },
  };

  const curation: CurationEngineAPI = {
    cut: (idx, offset) => { calls.cut.push([idx, offset]); },
    join: (idx) => { calls.join.push([idx]); },
    invert: (idx) => { calls.invert.push([idx]); },
    move: (from, to) => { calls.move.push([from, to]); },
  };

  const selection: SelectionAPI = {
    selectSingle: (idx) => {
      calls.selectSingle.push([idx]);
      appState.selectedContigs = new Set([idx]);
    },
    selectRange: (idx) => {
      calls.selectRange.push([idx]);
      // Simulate range selection from current selection anchor to idx
      const current = Array.from(appState.selectedContigs);
      if (current.length === 0) {
        appState.selectedContigs = new Set([idx]);
      } else {
        const anchor = Math.min(...current);
        const start = Math.min(anchor, idx);
        const end = Math.max(anchor, idx);
        const newSel = new Set<number>();
        for (let i = start; i <= end; i++) newSel.add(i);
        appState.selectedContigs = newSel;
      }
    },
    selectAll: () => {
      calls.selectAll.push([]);
      const newSel = new Set<number>();
      for (let i = 0; i < appState.contigOrder.length; i++) newSel.add(i);
      appState.selectedContigs = newSel;
    },
    clearSelection: () => {
      calls.clearSelection.push([]);
      appState.selectedContigs = new Set();
    },
  };

  const scaffold: ScaffoldAPI = {
    createScaffold: (name) => {
      const id = nextScaffoldId++;
      const s: Scaffold = { id, name: name ?? `Scaffold ${id}`, color: '#ff0000' };
      scaffolds.push(s);
      calls.createScaffold.push([name]);
      return id;
    },
    deleteScaffold: (id) => {
      const idx = scaffolds.findIndex(s => s.id === id);
      if (idx >= 0) scaffolds.splice(idx, 1);
      calls.deleteScaffold.push([id]);
    },
    paintContigs: (indices, scaffoldId) => {
      calls.paintContigs.push([indices, scaffoldId]);
    },
    getAllScaffolds: () => [...scaffolds],
  };

  const echoMessages: string[] = [];

  const ctx: ScriptContext = {
    curation,
    selection,
    scaffold,
    state: stateApi,
    onEcho: (msg) => {
      calls.echo.push([msg]);
      echoMessages.push(msg);
    },
  };

  return { ctx, calls, scaffolds, appState };
}

// ===========================================================================
// PARSER TESTS
// ===========================================================================

describe('ScriptParser', () => {

  // -----------------------------------------------------------------------
  // tokenize
  // -----------------------------------------------------------------------
  describe('tokenize', () => {
    it('should split simple whitespace-separated tokens', () => {
      expect(tokenize('cut chr1 50')).toEqual(['cut', 'chr1', '50']);
    });

    it('should handle multiple spaces between tokens', () => {
      expect(tokenize('cut    chr1    50')).toEqual(['cut', 'chr1', '50']);
    });

    it('should handle double-quoted strings', () => {
      expect(tokenize('scaffold create "My Scaffold"')).toEqual([
        'scaffold', 'create', 'My Scaffold',
      ]);
    });

    it('should handle single-quoted strings', () => {
      expect(tokenize("echo 'hello world'")).toEqual(['echo', 'hello world']);
    });

    it('should handle tabs and mixed whitespace', () => {
      expect(tokenize('cut\tchr1\t50')).toEqual(['cut', 'chr1', '50']);
    });

    it('should return empty array for empty string', () => {
      expect(tokenize('')).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // parseContigRef
  // -----------------------------------------------------------------------
  describe('parseContigRef', () => {
    it('should parse a name reference', () => {
      expect(parseContigRef('chr1')).toEqual({ kind: 'name', value: 'chr1' });
    });

    it('should parse an index reference', () => {
      expect(parseContigRef('#0')).toEqual({ kind: 'index', value: 0 });
    });

    it('should parse a larger index', () => {
      expect(parseContigRef('#42')).toEqual({ kind: 'index', value: 42 });
    });

    it('should treat # without digits as a name', () => {
      expect(parseContigRef('#abc')).toEqual({ kind: 'name', value: '#abc' });
    });

    it('should handle names with underscores and numbers', () => {
      expect(parseContigRef('chr1_L')).toEqual({ kind: 'name', value: 'chr1_L' });
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - comments and blanks
  // -----------------------------------------------------------------------
  describe('parseLine - blank lines and comments', () => {
    it('should return null for empty line', () => {
      expect(parseLine('')).toBeNull();
    });

    it('should return null for whitespace-only line', () => {
      expect(parseLine('   ')).toBeNull();
    });

    it('should return null for comment line', () => {
      expect(parseLine('# This is a comment')).toBeNull();
    });

    it('should return null for comment with leading whitespace', () => {
      expect(parseLine('   # indented comment')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - cut
  // -----------------------------------------------------------------------
  describe('parseLine - cut', () => {
    it('should parse cut with contig name and offset', () => {
      const cmd = parseLine('cut chr1 50');
      expect(cmd).not.toBeNull();
      expect(cmd!.type).toBe('cut');
      expect(cmd!.args.contig).toEqual({ kind: 'name', value: 'chr1' });
      expect(cmd!.args.pixelOffset).toBe(50);
    });

    it('should parse cut with index reference', () => {
      const cmd = parseLine('cut #0 25');
      expect(cmd!.args.contig).toEqual({ kind: 'index', value: 0 });
      expect(cmd!.args.pixelOffset).toBe(25);
    });

    it('should set line number', () => {
      const cmd = parseLine('cut chr1 50', 7);
      expect(cmd!.line).toBe(7);
    });

    it('should throw for missing arguments', () => {
      expect(() => parseLine('cut chr1')).toThrow("'cut' requires");
    });

    it('should throw for non-numeric pixel offset', () => {
      expect(() => parseLine('cut chr1 abc')).toThrow('pixel_offset must be a number');
    });

    it('should be case-insensitive for the command keyword', () => {
      const cmd = parseLine('CUT chr1 50');
      expect(cmd!.type).toBe('cut');
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - join
  // -----------------------------------------------------------------------
  describe('parseLine - join', () => {
    it('should parse join with two contig names', () => {
      const cmd = parseLine('join chr1 chr2');
      expect(cmd!.type).toBe('join');
      expect(cmd!.args.contig1).toEqual({ kind: 'name', value: 'chr1' });
      expect(cmd!.args.contig2).toEqual({ kind: 'name', value: 'chr2' });
    });

    it('should parse join with index references', () => {
      const cmd = parseLine('join #0 #1');
      expect(cmd!.args.contig1).toEqual({ kind: 'index', value: 0 });
      expect(cmd!.args.contig2).toEqual({ kind: 'index', value: 1 });
    });

    it('should throw for missing second contig', () => {
      expect(() => parseLine('join chr1')).toThrow("'join' requires");
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - invert
  // -----------------------------------------------------------------------
  describe('parseLine - invert', () => {
    it('should parse invert with contig name', () => {
      const cmd = parseLine('invert chr3');
      expect(cmd!.type).toBe('invert');
      expect(cmd!.args.contig).toEqual({ kind: 'name', value: 'chr3' });
    });

    it('should parse invert with index reference', () => {
      const cmd = parseLine('invert #2');
      expect(cmd!.args.contig).toEqual({ kind: 'index', value: 2 });
    });

    it('should throw for missing contig', () => {
      expect(() => parseLine('invert')).toThrow("'invert' requires");
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - move
  // -----------------------------------------------------------------------
  describe('parseLine - move', () => {
    it('should parse move to position', () => {
      const cmd = parseLine('move chr1 to 3');
      expect(cmd!.type).toBe('move_to');
      expect(cmd!.args.contig).toEqual({ kind: 'name', value: 'chr1' });
      expect(cmd!.args.position).toBe(3);
    });

    it('should parse move before target', () => {
      const cmd = parseLine('move chr1 before chr3');
      expect(cmd!.type).toBe('move_before');
      expect(cmd!.args.contig).toEqual({ kind: 'name', value: 'chr1' });
      expect(cmd!.args.target).toEqual({ kind: 'name', value: 'chr3' });
    });

    it('should parse move after target', () => {
      const cmd = parseLine('move #0 after #2');
      expect(cmd!.type).toBe('move_after');
      expect(cmd!.args.contig).toEqual({ kind: 'index', value: 0 });
      expect(cmd!.args.target).toEqual({ kind: 'index', value: 2 });
    });

    it('should throw for invalid direction', () => {
      expect(() => parseLine('move chr1 into 3')).toThrow("must be 'to', 'before', or 'after'");
    });

    it('should throw for non-numeric position with "to"', () => {
      expect(() => parseLine('move chr1 to abc')).toThrow('position must be a number');
    });

    it('should throw for missing arguments', () => {
      expect(() => parseLine('move chr1')).toThrow("'move' requires");
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - select
  // -----------------------------------------------------------------------
  describe('parseLine - select', () => {
    it('should parse select single contig', () => {
      const cmd = parseLine('select chr2');
      expect(cmd!.type).toBe('select');
      expect(cmd!.args.contig).toEqual({ kind: 'name', value: 'chr2' });
    });

    it('should parse select all', () => {
      const cmd = parseLine('select all');
      expect(cmd!.type).toBe('select_all');
    });

    it('should parse select all case-insensitively', () => {
      const cmd = parseLine('select ALL');
      expect(cmd!.type).toBe('select_all');
    });

    it('should parse select range with .. syntax', () => {
      const cmd = parseLine('select chr1..chr3');
      expect(cmd!.type).toBe('select_range');
      expect(cmd!.args.from).toEqual({ kind: 'name', value: 'chr1' });
      expect(cmd!.args.to).toEqual({ kind: 'name', value: 'chr3' });
    });

    it('should parse select range with spaced .. syntax', () => {
      const cmd = parseLine('select #0 .. #3');
      expect(cmd!.type).toBe('select_range');
      expect(cmd!.args.from).toEqual({ kind: 'index', value: 0 });
      expect(cmd!.args.to).toEqual({ kind: 'index', value: 3 });
    });

    it('should throw for missing argument', () => {
      expect(() => parseLine('select')).toThrow("'select' requires");
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - deselect
  // -----------------------------------------------------------------------
  describe('parseLine - deselect', () => {
    it('should parse deselect', () => {
      const cmd = parseLine('deselect');
      expect(cmd!.type).toBe('deselect');
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - scaffold
  // -----------------------------------------------------------------------
  describe('parseLine - scaffold', () => {
    it('should parse scaffold create', () => {
      const cmd = parseLine('scaffold create MyScaffold');
      expect(cmd!.type).toBe('scaffold_create');
      expect(cmd!.args.name).toBe('MyScaffold');
    });

    it('should parse scaffold create with multi-word name', () => {
      const cmd = parseLine('scaffold create My Long Name');
      expect(cmd!.args.name).toBe('My Long Name');
    });

    it('should parse scaffold paint', () => {
      const cmd = parseLine('scaffold paint chr1 MyScaffold');
      expect(cmd!.type).toBe('scaffold_paint');
      expect(cmd!.args.contig).toEqual({ kind: 'name', value: 'chr1' });
      expect(cmd!.args.scaffoldName).toBe('MyScaffold');
    });

    it('should parse scaffold unpaint', () => {
      const cmd = parseLine('scaffold unpaint chr1');
      expect(cmd!.type).toBe('scaffold_unpaint');
      expect(cmd!.args.contig).toEqual({ kind: 'name', value: 'chr1' });
    });

    it('should parse scaffold delete', () => {
      const cmd = parseLine('scaffold delete MyScaffold');
      expect(cmd!.type).toBe('scaffold_delete');
      expect(cmd!.args.name).toBe('MyScaffold');
    });

    it('should throw for unknown subcommand', () => {
      expect(() => parseLine('scaffold foobar')).toThrow('Unknown scaffold subcommand');
    });

    it('should throw for missing subcommand', () => {
      expect(() => parseLine('scaffold')).toThrow("'scaffold' requires a subcommand");
    });

    it('should throw for scaffold create without name', () => {
      expect(() => parseLine('scaffold create')).toThrow("'scaffold create' requires");
    });

    it('should throw for scaffold paint without scaffold name', () => {
      expect(() => parseLine('scaffold paint chr1')).toThrow("'scaffold paint' requires");
    });

    it('should throw for scaffold unpaint without contig', () => {
      expect(() => parseLine('scaffold unpaint')).toThrow("'scaffold unpaint' requires");
    });

    it('should throw for scaffold delete without name', () => {
      expect(() => parseLine('scaffold delete')).toThrow("'scaffold delete' requires");
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - zoom
  // -----------------------------------------------------------------------
  describe('parseLine - zoom', () => {
    it('should parse zoom to contig', () => {
      const cmd = parseLine('zoom chr2');
      expect(cmd!.type).toBe('zoom');
      expect(cmd!.args.contig).toEqual({ kind: 'name', value: 'chr2' });
    });

    it('should parse zoom reset', () => {
      const cmd = parseLine('zoom reset');
      expect(cmd!.type).toBe('zoom_reset');
    });

    it('should throw for missing argument', () => {
      expect(() => parseLine('zoom')).toThrow("'zoom' requires");
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - goto
  // -----------------------------------------------------------------------
  describe('parseLine - goto', () => {
    it('should parse goto with integer coordinates', () => {
      const cmd = parseLine('goto 100 200');
      expect(cmd!.type).toBe('goto');
      expect(cmd!.args.x).toBe(100);
      expect(cmd!.args.y).toBe(200);
    });

    it('should parse goto with float coordinates', () => {
      const cmd = parseLine('goto 0.5 0.75');
      expect(cmd!.args.x).toBeCloseTo(0.5);
      expect(cmd!.args.y).toBeCloseTo(0.75);
    });

    it('should throw for non-numeric coordinates', () => {
      expect(() => parseLine('goto abc def')).toThrow('coordinates must be numbers');
    });

    it('should throw for missing y coordinate', () => {
      expect(() => parseLine('goto 100')).toThrow("'goto' requires");
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - echo
  // -----------------------------------------------------------------------
  describe('parseLine - echo', () => {
    it('should parse echo with message', () => {
      const cmd = parseLine('echo Hello World');
      expect(cmd!.type).toBe('echo');
      expect(cmd!.args.message).toBe('Hello World');
    });

    it('should parse echo with quoted message', () => {
      const cmd = parseLine('echo "Hello World"');
      expect(cmd!.args.message).toBe('Hello World');
    });

    it('should parse echo with empty message', () => {
      const cmd = parseLine('echo');
      expect(cmd!.type).toBe('echo');
      expect(cmd!.args.message).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // parseLine - errors
  // -----------------------------------------------------------------------
  describe('parseLine - unknown commands', () => {
    it('should throw for unknown command', () => {
      expect(() => parseLine('foobar')).toThrow("Unknown command 'foobar'");
    });

    it('should include line number in error message', () => {
      expect(() => parseLine('badcmd', 42)).toThrow('Line 42');
    });
  });

  // -----------------------------------------------------------------------
  // parseScript - multi-line
  // -----------------------------------------------------------------------
  describe('parseScript', () => {
    it('should parse a multi-line script', () => {
      const script = `
# Curation script
invert chr1
cut chr2 50
join chr2_L chr2_R
echo Done
      `.trim();

      const result = parseScript(script);
      expect(result.errors).toEqual([]);
      expect(result.commands.length).toBe(4);
      expect(result.commands[0].type).toBe('invert');
      expect(result.commands[1].type).toBe('cut');
      expect(result.commands[2].type).toBe('join');
      expect(result.commands[3].type).toBe('echo');
    });

    it('should skip blank lines and comments', () => {
      const script = `
# header

invert chr1

# middle comment

echo test

      `;
      const result = parseScript(script);
      expect(result.errors).toEqual([]);
      expect(result.commands.length).toBe(2);
    });

    it('should collect parse errors without stopping', () => {
      const script = `invert chr1
badcommand
cut chr2 50
anotherbad`;

      const result = parseScript(script);
      expect(result.commands.length).toBe(2);
      expect(result.errors.length).toBe(2);
      expect(result.errors[0].line).toBe(2);
      expect(result.errors[1].line).toBe(4);
    });

    it('should report correct line numbers', () => {
      const script = `# line 1
invert chr1
# line 3
cut chr2 50`;

      const result = parseScript(script);
      expect(result.commands[0].line).toBe(2);
      expect(result.commands[1].line).toBe(4);
    });

    it('should handle empty script', () => {
      const result = parseScript('');
      expect(result.commands).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should handle script with only comments', () => {
      const result = parseScript('# just a comment\n# another');
      expect(result.commands).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });
});

// ===========================================================================
// EXECUTOR TESTS
// ===========================================================================

describe('ScriptExecutor', () => {

  // -----------------------------------------------------------------------
  // resolveContigRef
  // -----------------------------------------------------------------------
  describe('resolveContigRef', () => {
    it('should resolve name reference to order index', () => {
      const { ctx } = createMockContext();
      const ref: ContigRef = { kind: 'name', value: 'chr2' };
      expect(resolveContigRef(ref, ctx.state)).toBe(1);
    });

    it('should resolve index reference', () => {
      const { ctx } = createMockContext();
      const ref: ContigRef = { kind: 'index', value: 2 };
      expect(resolveContigRef(ref, ctx.state)).toBe(2);
    });

    it('should throw for out-of-range index', () => {
      const { ctx } = createMockContext();
      const ref: ContigRef = { kind: 'index', value: 99 };
      expect(() => resolveContigRef(ref, ctx.state)).toThrow('out of range');
    });

    it('should throw for negative index', () => {
      const { ctx } = createMockContext();
      const ref: ContigRef = { kind: 'index', value: -1 };
      expect(() => resolveContigRef(ref, ctx.state)).toThrow('out of range');
    });

    it('should throw for unknown contig name', () => {
      const { ctx } = createMockContext();
      const ref: ContigRef = { kind: 'name', value: 'chrX' };
      expect(() => resolveContigRef(ref, ctx.state)).toThrow("not found");
    });

    it('should throw when no map is loaded', () => {
      const { ctx, appState } = createMockContext();
      appState.map = null;
      const ref: ContigRef = { kind: 'name', value: 'chr1' };
      expect(() => resolveContigRef(ref, ctx.state)).toThrow('No map loaded');
    });
  });

  // -----------------------------------------------------------------------
  // executeCommand - cut
  // -----------------------------------------------------------------------
  describe('executeCommand - cut', () => {
    it('should call curation.cut with resolved index and offset', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'cut',
        args: { contig: { kind: 'name', value: 'chr2' }, pixelOffset: 30 },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.cut).toEqual([[1, 30]]);
    });

    it('should return failure for unknown contig', () => {
      const { ctx } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'cut',
        args: { contig: { kind: 'name', value: 'chrX' }, pixelOffset: 30 },
        line: 5,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(result.line).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // executeCommand - join
  // -----------------------------------------------------------------------
  describe('executeCommand - join', () => {
    it('should call curation.join for adjacent contigs', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'join',
        args: {
          contig1: { kind: 'name', value: 'chr2' },
          contig2: { kind: 'name', value: 'chr3' },
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.join).toEqual([[1]]);
    });

    it('should fail for non-adjacent contigs', () => {
      const { ctx } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'join',
        args: {
          contig1: { kind: 'name', value: 'chr1' },
          contig2: { kind: 'name', value: 'chr3' },
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(false);
      expect(result.message).toContain('not adjacent');
    });

    it('should handle reversed order of adjacent contigs', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'join',
        args: {
          contig1: { kind: 'name', value: 'chr3' },
          contig2: { kind: 'name', value: 'chr2' },
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      // Should join at the smaller index
      expect(calls.join).toEqual([[1]]);
    });
  });

  // -----------------------------------------------------------------------
  // executeCommand - invert
  // -----------------------------------------------------------------------
  describe('executeCommand - invert', () => {
    it('should call curation.invert with resolved index', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'invert',
        args: { contig: { kind: 'index', value: 2 } },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.invert).toEqual([[2]]);
    });
  });

  // -----------------------------------------------------------------------
  // executeCommand - move
  // -----------------------------------------------------------------------
  describe('executeCommand - move_to', () => {
    it('should call curation.move with from and to indices', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'move_to',
        args: { contig: { kind: 'name', value: 'chr1' }, position: 3 },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.move).toEqual([[0, 3]]);
    });
  });

  describe('executeCommand - move_before', () => {
    it('should move contig before target (target after source)', () => {
      const { ctx, calls } = createMockContext();
      // chr1 is at 0, chr3 is at 2. "move chr1 before chr3" => toIndex = 2-1 = 1
      const cmd: ScriptCommand = {
        type: 'move_before',
        args: {
          contig: { kind: 'name', value: 'chr1' },
          target: { kind: 'name', value: 'chr3' },
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.move).toEqual([[0, 1]]);
    });

    it('should move contig before target (target before source)', () => {
      const { ctx, calls } = createMockContext();
      // chr4 is at 3, chr2 is at 1. "move chr4 before chr2" => toIndex = 1
      const cmd: ScriptCommand = {
        type: 'move_before',
        args: {
          contig: { kind: 'name', value: 'chr4' },
          target: { kind: 'name', value: 'chr2' },
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.move).toEqual([[3, 1]]);
    });
  });

  describe('executeCommand - move_after', () => {
    it('should move contig after target (target before source)', () => {
      const { ctx, calls } = createMockContext();
      // chr4 is at 3, chr1 is at 0. "move chr4 after chr1" => toIndex = 0+1 = 1
      const cmd: ScriptCommand = {
        type: 'move_after',
        args: {
          contig: { kind: 'name', value: 'chr4' },
          target: { kind: 'name', value: 'chr1' },
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.move).toEqual([[3, 1]]);
    });

    it('should move contig after target (target after source)', () => {
      const { ctx, calls } = createMockContext();
      // chr1 is at 0, chr3 is at 2. "move chr1 after chr3" => toIndex = 2
      const cmd: ScriptCommand = {
        type: 'move_after',
        args: {
          contig: { kind: 'name', value: 'chr1' },
          target: { kind: 'name', value: 'chr3' },
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.move).toEqual([[0, 2]]);
    });
  });

  // -----------------------------------------------------------------------
  // executeCommand - select
  // -----------------------------------------------------------------------
  describe('executeCommand - select', () => {
    it('should call selection.selectSingle', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'select',
        args: { contig: { kind: 'name', value: 'chr3' } },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.selectSingle).toEqual([[2]]);
    });
  });

  describe('executeCommand - select_range', () => {
    it('should select a range of contigs', () => {
      const { ctx, calls, appState } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'select_range',
        args: {
          from: { kind: 'name', value: 'chr1' },
          to: { kind: 'name', value: 'chr3' },
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      // selectSingle(0) then selectRange(2)
      expect(calls.selectSingle).toEqual([[0]]);
      expect(calls.selectRange).toEqual([[2]]);
      // Should have indices 0,1,2 selected
      expect(appState.selectedContigs).toEqual(new Set([0, 1, 2]));
    });
  });

  describe('executeCommand - select_all', () => {
    it('should call selection.selectAll', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'select_all',
        args: {},
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.selectAll.length).toBe(1);
    });
  });

  describe('executeCommand - deselect', () => {
    it('should call selection.clearSelection', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'deselect',
        args: {},
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.clearSelection.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // executeCommand - scaffold
  // -----------------------------------------------------------------------
  describe('executeCommand - scaffold_create', () => {
    it('should create a scaffold', () => {
      const { ctx, calls, scaffolds } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'scaffold_create',
        args: { name: 'TestScaffold' },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(scaffolds.length).toBe(1);
      expect(scaffolds[0].name).toBe('TestScaffold');
      expect(result.message).toContain('TestScaffold');
    });
  });

  describe('executeCommand - scaffold_paint', () => {
    it('should paint a contig with a scaffold', () => {
      const { ctx, calls, scaffolds } = createMockContext();
      // First create a scaffold
      ctx.scaffold.createScaffold('MyScaf');
      calls.paintContigs.length = 0; // reset

      const cmd: ScriptCommand = {
        type: 'scaffold_paint',
        args: {
          contig: { kind: 'name', value: 'chr1' },
          scaffoldName: 'MyScaf',
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.paintContigs).toEqual([[[0], 1]]);
    });

    it('should fail if scaffold not found', () => {
      const { ctx } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'scaffold_paint',
        args: {
          contig: { kind: 'name', value: 'chr1' },
          scaffoldName: 'NonExistent',
        },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });
  });

  describe('executeCommand - scaffold_unpaint', () => {
    it('should unpaint a contig', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'scaffold_unpaint',
        args: { contig: { kind: 'name', value: 'chr2' } },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.paintContigs).toEqual([[[1], null]]);
    });
  });

  describe('executeCommand - scaffold_delete', () => {
    it('should delete a scaffold by name', () => {
      const { ctx, calls, scaffolds } = createMockContext();
      ctx.scaffold.createScaffold('ToDelete');
      expect(scaffolds.length).toBe(1);

      const cmd: ScriptCommand = {
        type: 'scaffold_delete',
        args: { name: 'ToDelete' },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(scaffolds.length).toBe(0);
    });

    it('should fail if scaffold not found', () => {
      const { ctx } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'scaffold_delete',
        args: { name: 'Ghost' },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });
  });

  // -----------------------------------------------------------------------
  // executeCommand - zoom / goto
  // -----------------------------------------------------------------------
  describe('executeCommand - zoom', () => {
    it('should update camera state for zoom to contig', () => {
      const { ctx, appState } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'zoom',
        args: { contig: { kind: 'name', value: 'chr2' } },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      // chr2 is 100 pixels, textureSize is 1024, so zoom = 1024/100 = 10.24
      expect(appState.camera.zoom).toBeCloseTo(10.24);
    });
  });

  describe('executeCommand - zoom_reset', () => {
    it('should reset camera to default', () => {
      const { ctx, appState } = createMockContext();
      appState.camera = { x: 50, y: 50, zoom: 5 };
      const cmd: ScriptCommand = {
        type: 'zoom_reset',
        args: {},
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(appState.camera).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  describe('executeCommand - goto', () => {
    it('should update camera x and y', () => {
      const { ctx, appState } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'goto',
        args: { x: 100, y: 200 },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(appState.camera.x).toBe(100);
      expect(appState.camera.y).toBe(200);
    });

    it('should preserve zoom when navigating', () => {
      const { ctx, appState } = createMockContext();
      appState.camera.zoom = 5;
      const cmd: ScriptCommand = {
        type: 'goto',
        args: { x: 10, y: 20 },
        line: 1,
      };
      executeCommand(cmd, ctx);
      expect(appState.camera.zoom).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // executeCommand - echo
  // -----------------------------------------------------------------------
  describe('executeCommand - echo', () => {
    it('should invoke onEcho callback', () => {
      const { ctx, calls } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'echo',
        args: { message: 'Hello from script' },
        line: 1,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(true);
      expect(calls.echo).toEqual([['Hello from script']]);
    });

    it('should return the message as the result message', () => {
      const { ctx } = createMockContext();
      const cmd: ScriptCommand = {
        type: 'echo',
        args: { message: 'Test message' },
        line: 3,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.message).toBe('Test message');
      expect(result.line).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // executeCommand - error handling
  // -----------------------------------------------------------------------
  describe('executeCommand - error handling', () => {
    it('should catch errors thrown by curation engine and return failure', () => {
      const { ctx } = createMockContext();
      // Override cut to throw
      ctx.curation.cut = () => { throw new Error('Engine error'); };
      const cmd: ScriptCommand = {
        type: 'cut',
        args: { contig: { kind: 'name', value: 'chr1' }, pixelOffset: 50 },
        line: 10,
      };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(false);
      expect(result.message).toBe('Engine error');
      expect(result.line).toBe(10);
    });

    it('should handle unknown command type gracefully', () => {
      const { ctx } = createMockContext();
      const cmd = { type: 'nonexistent' as any, args: {}, line: 1 };
      const result = executeCommand(cmd, ctx);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command type');
    });
  });

  // -----------------------------------------------------------------------
  // executeScript - multi-command
  // -----------------------------------------------------------------------
  describe('executeScript', () => {
    it('should execute all commands in order', () => {
      const { ctx, calls } = createMockContext();
      const commands: ScriptCommand[] = [
        { type: 'invert', args: { contig: { kind: 'name', value: 'chr1' } }, line: 1 },
        { type: 'invert', args: { contig: { kind: 'name', value: 'chr2' } }, line: 2 },
        { type: 'echo', args: { message: 'done' }, line: 3 },
      ];
      const results = executeScript(commands, ctx);
      expect(results.length).toBe(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(calls.invert).toEqual([[0], [1]]);
    });

    it('should stop at first failure by default', () => {
      const { ctx } = createMockContext();
      const commands: ScriptCommand[] = [
        { type: 'invert', args: { contig: { kind: 'name', value: 'chr1' } }, line: 1 },
        { type: 'cut', args: { contig: { kind: 'name', value: 'chrX' }, pixelOffset: 10 }, line: 2 },
        { type: 'echo', args: { message: 'should not run' }, line: 3 },
      ];
      const results = executeScript(commands, ctx);
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });

    it('should continue on error when option is set', () => {
      const { ctx } = createMockContext();
      const commands: ScriptCommand[] = [
        { type: 'invert', args: { contig: { kind: 'name', value: 'chr1' } }, line: 1 },
        { type: 'cut', args: { contig: { kind: 'name', value: 'chrX' }, pixelOffset: 10 }, line: 2 },
        { type: 'echo', args: { message: 'ran after error' }, line: 3 },
      ];
      const results = executeScript(commands, ctx, { continueOnError: true });
      expect(results.length).toBe(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });

    it('should handle empty command list', () => {
      const { ctx } = createMockContext();
      const results = executeScript([], ctx);
      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // End-to-end: parse + execute
  // -----------------------------------------------------------------------
  describe('end-to-end: parse then execute', () => {
    it('should parse and execute a complete script', () => {
      const script = `
# A simple curation script
invert chr1
select chr2
echo All done
      `.trim();

      const { commands, errors } = parseScript(script);
      expect(errors).toEqual([]);
      expect(commands.length).toBe(3);

      const { ctx, calls } = createMockContext();
      const results = executeScript(commands, ctx);
      expect(results.length).toBe(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(calls.invert).toEqual([[0]]);
      expect(calls.selectSingle).toEqual([[1]]);
      expect(calls.echo).toEqual([['All done']]);
    });

    it('should handle scaffold workflow end-to-end', () => {
      const script = `
scaffold create Chromosome1
scaffold paint chr1 Chromosome1
scaffold paint chr2 Chromosome1
      `.trim();

      const { commands, errors } = parseScript(script);
      expect(errors).toEqual([]);

      const { ctx, calls, scaffolds } = createMockContext();
      const results = executeScript(commands, ctx);
      expect(results.every(r => r.success)).toBe(true);
      expect(scaffolds.length).toBe(1);
      expect(scaffolds[0].name).toBe('Chromosome1');
      expect(calls.paintContigs.length).toBe(2);
    });
  });
});
