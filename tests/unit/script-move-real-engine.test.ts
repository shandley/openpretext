/**
 * Script move commands run against the real curation engine.
 *
 * The other script tests give the executor a mocked engine and assert on the
 * arguments passed to it, which cannot see whether the contig ends up where
 * the command says. These check the resulting order.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { CurationEngine } from '../../src/curation/CurationEngine';
import { parseScript } from '../../src/scripting/ScriptParser';
import { executeScript, type ScriptContext } from '../../src/scripting/ScriptExecutor';

const NAMES = ['a', 'b', 'c', 'd', 'e'];

function load(): void {
  const contigs: ContigInfo[] = NAMES.map((name, i) => ({
    name, originalIndex: i, length: 1000,
    pixelStart: i * 10, pixelEnd: (i + 1) * 10, inverted: false, scaffoldId: null,
  }));
  const map = {
    filename: 't.pretext', textureSize: 50, numMipMaps: 1, tileResolution: 50,
    tilesPerDimension: 1, contigs, contactMap: null, rawTiles: null,
    parsedHeader: null, extensions: new Map(),
  } satisfies MapData;
  state.reset();
  state.update({ map, contigOrder: [0, 1, 2, 3, 4] });
}

function run(script: string): { order: string; ok: boolean[] } {
  const { commands, errors } = parseScript(script);
  expect(errors).toEqual([]);
  const ctx = { curation: CurationEngine, state } as unknown as ScriptContext;
  const results = executeScript(commands, ctx, { continueOnError: false });
  const s = state.get();
  return {
    order: s.contigOrder.map((id) => s.map!.contigs[id].name).join(' '),
    ok: results.map((r) => r.success),
  };
}

describe('script move commands against the real engine', () => {
  beforeEach(load);

  it('move <contig> to <n> puts it at index n', () => {
    expect(run('move a to 4').order).toBe('b c d e a');
    load();
    expect(run('move a to 2').order).toBe('b c a d e');
    load();
    expect(run('move e to 0').order).toBe('e a b c d');
    load();
    expect(run('move c to 1').order).toBe('a c b d e');
  });

  it('move <contig> before <target> puts it immediately left of the target', () => {
    expect(run('move a before d').order).toBe('b c a d e');
    load();
    expect(run('move e before b').order).toBe('a e b c d');
    load();
    expect(run('move a before c').order).toBe('b a c d e');
  });

  it('move <contig> after <target> puts it immediately right of the target', () => {
    expect(run('move a after e').order).toBe('b c d e a');
    load();
    expect(run('move a after b').order).toBe('b a c d e');
    load();
    expect(run('move e after a').order).toBe('a e b c d');
  });

  it('a move that changes nothing records nothing', () => {
    expect(run('move a before b').order).toBe('a b c d e');
    expect(state.get().undoStack.length).toBe(0);
  });
});
