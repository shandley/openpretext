/**
 * Tags and exclusions when a contig is cut or joined.
 *
 * Both are keyed by contig id, and a cut or join replaces the contigs it acts
 * on with new ones. Without care the new contigs start with no marks: an
 * excluded contaminant that is cut would have both pieces written to the
 * exported FASTA and AGP. The rules:
 *   - both pieces of a cut take the marks of the contig that was cut;
 *   - an excluded contig cannot be joined to one that is not excluded, since
 *     either result would silently change what is exported;
 *   - a joined contig keeps a tag only if both parts carry the same one, and
 *     the join reports a tag it did not keep;
 *   - undo brings back the earlier contigs with the marks they had.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { state, type ContigInfo, type MapData } from '../../src/core/State';
import { events } from '../../src/core/EventBus';
import { CurationEngine, type DroppedMark } from '../../src/curation/CurationEngine';
import { metaTags } from '../../src/curation/MetaTagManager';
import { contigExclusion } from '../../src/curation/ContigExclusion';
import { exportAGP } from '../../src/export/AGPWriter';
import { batchJoinSelected } from '../../src/curation/BatchOperations';
import { describeDroppedTags } from '../../src/ui/CurationActions';

function contig(name: string, i: number): ContigInfo {
  return {
    name, originalIndex: i, length: 10_000,
    pixelStart: i * 100, pixelEnd: (i + 1) * 100, inverted: false, scaffoldId: null,
  };
}

/** What the curator sees, left to right: name, tag, notes, excluded. */
function shown(): Array<[string, string | null, string | null, boolean]> {
  const s = state.get();
  return s.contigOrder.map((id) => {
    const t = metaTags.getTag(id);
    return [s.map!.contigs[id].name, t?.tag ?? null, t?.notes ?? null, contigExclusion.isExcluded(id)];
  });
}

const id = (orderIndex: number) => state.get().contigOrder[orderIndex];

let dropped: DroppedMark[][] = [];
const onJoin = (d: { dropped?: DroppedMark[] }) => { dropped.push(d.dropped ?? []); };

beforeEach(() => {
  state.reset();
  metaTags.clearAll();
  contigExclusion.clearAll();
  const map = {
    filename: 't.pretext', textureSize: 400, numMipMaps: 1, tileResolution: 400, tilesPerDimension: 1,
    contigs: ['a', 'b', 'c', 'd'].map(contig), contactMap: null, rawTiles: null, parsedHeader: null,
    extensions: new Map(),
  } as unknown as MapData;
  state.update({ map, contigOrder: [0, 1, 2, 3] });
  dropped = [];
  events.off('curation:join', onJoin);
  events.on('curation:join', onJoin);
});

describe('cut', () => {
  it('gives both pieces the tag, notes and exclusion of the contig that was cut', () => {
    metaTags.setTag(id(1), 'contaminant', 'bacterial');
    contigExclusion.set(id(1), true);
    CurationEngine.cut(1, 40);
    expect(shown()).toEqual([
      ['a', null, null, false],
      ['b_L', 'contaminant', 'bacterial', true],
      ['b_R', 'contaminant', 'bacterial', true],
      ['c', null, null, false],
      ['d', null, null, false],
    ]);
  });

  it('carries a tag without an exclusion, and an exclusion without a tag', () => {
    metaTags.setTag(id(0), 'haplotig');
    contigExclusion.set(id(2), true);
    CurationEngine.cut(2, 10);
    CurationEngine.cut(0, 10);
    expect(shown()).toEqual([
      ['a_L', 'haplotig', null, false],
      ['a_R', 'haplotig', null, false],
      ['b', null, null, false],
      ['c_L', null, null, true],
      ['c_R', null, null, true],
      ['d', null, null, false],
    ]);
  });

  it('leaves unmarked pieces unmarked', () => {
    CurationEngine.cut(1, 40);
    expect(metaTags.getTagCount()).toBe(0);
    expect(contigExclusion.getExcludedCount()).toBe(0);
  });

  it('keeps an excluded contig out of the export after it is cut', () => {
    contigExclusion.set(id(1), true);
    // Sequence rows (component type W) and the bases they cover.
    const exported = () => {
      const rows = exportAGP(state.get()).split('\n')
        .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')).filter((c) => c[4] === 'W');
      return { rows: rows.length, bases: rows.reduce((n, c) => n + Number(c[7]) - Number(c[6]) + 1, 0) };
    };
    expect(exported()).toEqual({ rows: 3, bases: 30_000 });
    CurationEngine.cut(1, 40);
    expect(exported()).toEqual({ rows: 3, bases: 30_000 });
    // A piece the curator includes again is exported; the other still is not.
    contigExclusion.set(id(1), false);
    expect(exported()).toEqual({ rows: 4, bases: 34_000 });
  });

  it('undo restores the contig with its marks; redo restores the pieces with theirs', () => {
    metaTags.setTag(id(1), 'haplotig', 'dup of a');
    contigExclusion.set(id(1), true);
    const before = shown();
    CurationEngine.cut(1, 40);
    // The curator changes one piece.
    metaTags.setTag(id(2), 'unlocalised');
    contigExclusion.set(id(2), false);
    const afterCut = shown();

    CurationEngine.undo();
    expect(shown()).toEqual(before);
    CurationEngine.redo();
    expect(shown()).toEqual(afterCut);
    CurationEngine.undo();
    expect(shown()).toEqual(before);
  });

  it('redo gives the pieces a mark set on the contig after the cut was undone', () => {
    CurationEngine.cut(1, 40);
    CurationEngine.undo();
    contigExclusion.set(id(1), true);
    metaTags.setTag(id(1), 'contaminant');
    CurationEngine.redo();
    expect(shown().slice(1, 3)).toEqual([
      ['b_L', 'contaminant', null, true],
      ['b_R', 'contaminant', null, true],
    ]);
  });

  it('redo drops a mark removed from the contig after the cut was undone', () => {
    contigExclusion.set(id(1), true);
    CurationEngine.cut(1, 40);
    CurationEngine.undo();
    contigExclusion.set(id(1), false);
    CurationEngine.redo();
    expect(shown().slice(1, 3)).toEqual([['b_L', null, null, false], ['b_R', null, null, false]]);
  });

  it('carries marks through a chain of cuts', () => {
    contigExclusion.set(id(3), true);
    CurationEngine.cut(3, 50);
    CurationEngine.cut(4, 20);
    CurationEngine.cut(3, 10);
    expect(shown().slice(3).every(([, , , excluded]) => excluded)).toBe(true);
    expect(shown()).toHaveLength(7);
  });
});

describe('join', () => {
  it('keeps a tag and an exclusion that both parts carry', () => {
    for (const i of [1, 2]) {
      metaTags.setTag(id(i), 'contaminant', 'bacterial');
      contigExclusion.set(id(i), true);
    }
    CurationEngine.join(1);
    expect(shown()[1]).toEqual(['b+c', 'contaminant', 'bacterial', true]);
    expect(dropped).toEqual([[]]);
  });

  it('keeps both notes when the parts have the same tag with different notes', () => {
    metaTags.setTag(id(0), 'haplotig', 'dup of d');
    metaTags.setTag(id(1), 'haplotig', 'low coverage');
    CurationEngine.join(0);
    expect(shown()[0]).toEqual(['a+b', 'haplotig', 'dup of d; low coverage', false]);
    metaTags.setTag(id(1), 'sex_chromosome');
    metaTags.setTag(id(2), 'sex_chromosome', 'W');
    CurationEngine.join(1);
    expect(shown()[1]).toEqual(['c+d', 'sex_chromosome', 'W', false]);
  });

  it('refuses to join an excluded contig to one that is not, either way round, and changes nothing', () => {
    contigExclusion.set(id(1), true);
    metaTags.setTag(id(1), 'contaminant');
    const before = { shown: shown(), contigs: state.get().map!.contigs.length };
    expect(() => CurationEngine.join(1)).toThrow(
      'Cannot join "b" and "c": "b" is excluded from export and "c" is not. Exclude both or include both first.');
    expect(() => CurationEngine.join(0)).toThrow(
      'Cannot join "a" and "b": "b" is excluded from export and "a" is not.');
    expect(CurationEngine.joinBlockedReason(1)).toMatch(/^Cannot join "b" and "c"/);
    expect(CurationEngine.joinBlockedReason(2)).toBeNull();
    expect(shown()).toEqual(before.shown);
    expect(state.get().map!.contigs.length).toBe(before.contigs);
    expect(state.get().undoStack).toHaveLength(0);
    expect(dropped).toEqual([]);

    // Once the curator has said which, the join goes ahead.
    contigExclusion.set(id(2), true);
    expect(CurationEngine.join(1)).toEqual([{ kind: 'tag', contig: 'b', tag: 'contaminant' }]);
    expect(shown()[1]).toEqual(['b+c', null, null, true]);
  });

  it('drops a tag only one part carries, and tags of different kinds, and says so', () => {
    metaTags.setTag(id(0), 'haplotig');
    CurationEngine.join(0);
    expect(shown()[0]).toEqual(['a+b', null, null, false]);
    expect(dropped[0]).toEqual([{ kind: 'tag', contig: 'a', tag: 'haplotig' }]);
    expect(describeDroppedTags(dropped[0] as DroppedMark[])).toBe('the haplotig tag on "a"');

    metaTags.setTag(id(1), 'contaminant');
    metaTags.setTag(id(2), 'unlocalised');
    CurationEngine.join(1);
    expect(shown()[1]).toEqual(['c+d', null, null, false]);
    expect(dropped[1]).toEqual([
      { kind: 'tag', contig: 'c', tag: 'contaminant' },
      { kind: 'tag', contig: 'd', tag: 'unlocalised' },
    ]);
  });

  it('reports nothing when neither part is marked', () => {
    CurationEngine.join(0);
    expect(dropped).toEqual([[]]);
    expect(metaTags.getTagCount()).toBe(0);
  });

  it('undo restores both parts with their own marks; redo restores the joined contig', () => {
    metaTags.setTag(id(1), 'haplotig');
    contigExclusion.set(id(1), true);
    contigExclusion.set(id(2), true);
    const before = shown();
    CurationEngine.join(1);
    const after = shown();
    expect(after[1]).toEqual(['b+c', null, null, true]);
    CurationEngine.undo();
    expect(shown()).toEqual(before);
    CurationEngine.redo();
    expect(shown()).toEqual(after);
  });

  it('redo follows marks changed on both parts after the join was undone', () => {
    CurationEngine.join(1);
    expect(shown()[1]).toEqual(['b+c', null, null, false]);
    CurationEngine.undo();
    contigExclusion.set(id(1), true);
    contigExclusion.set(id(2), true);
    metaTags.setTag(id(1), 'haplotig');
    expect(CurationEngine.redo()).toBe(true);
    expect(shown()[1]).toEqual(['b+c', null, null, true]);
    expect(dropped[dropped.length - 1]).toEqual([{ kind: 'tag', contig: 'b', tag: 'haplotig' }]);
  });

  it('redo of a join is held back while its parts differ in exclusion', () => {
    CurationEngine.join(1);
    CurationEngine.undo();
    contigExclusion.set(id(1), true);
    const before = shown();

    expect(CurationEngine.redoBlockedReason()).toMatch(/^Cannot join "b" and "c": "b" is excluded/);
    expect(CurationEngine.redo()).toBe(false);
    expect(shown()).toEqual(before);
    expect(state.get().redoStack).toHaveLength(1);
    expect(state.get().undoStack).toHaveLength(0);

    contigExclusion.set(id(1), false);
    expect(CurationEngine.redoBlockedReason()).toBeNull();
    expect(CurationEngine.redo()).toBe(true);
    expect(shown()[1]).toEqual(['b+c', null, null, false]);
  });

  it('redoing a batch stops at a join that is held back, and resumes once it is not', () => {
    state.setBatchContext('b1');
    CurationEngine.move(3, 0);     // d a b c
    CurationEngine.join(2);        // d a b+c
    CurationEngine.invert(0);
    state.clearBatchContext();
    CurationEngine.undoBatch('b1');
    contigExclusion.set(2, true);  // exclude c

    expect(CurationEngine.redoBatch('b1')).toBe(1);
    expect(shown().map(([n]) => n)).toEqual(['d', 'a', 'b', 'c']);
    expect(state.get().redoStack).toHaveLength(2);

    contigExclusion.set(1, true);  // and b
    expect(CurationEngine.redoBatch('b1')).toBe(2);
    expect(shown().map(([n, , , x]) => [n, x])).toEqual([['d', false], ['a', false], ['b+c', true]]);
  });
});

describe('cut then join', () => {
  it('a marked contig that is cut and rejoined ends with the marks it started with', () => {
    metaTags.setTag(id(2), 'contaminant', 'phiX');
    contigExclusion.set(id(2), true);
    CurationEngine.cut(2, 30);
    CurationEngine.join(2);
    expect(shown()[2]).toEqual(['c_L+c_R', 'contaminant', 'phiX', true]);
    CurationEngine.undo();
    CurationEngine.undo();
    expect(shown()[2]).toEqual(['c', 'contaminant', 'phiX', true]);
  });

  it('undoing and redoing a batch keeps marks where they were', () => {
    contigExclusion.set(id(0), true);
    metaTags.setTag(id(3), 'haplotig');
    state.setBatchContext('b1');
    CurationEngine.cut(0, 50);
    CurationEngine.cut(4, 50);
    CurationEngine.move(0, 2);
    state.clearBatchContext();
    const after = shown();
    CurationEngine.undoBatch('b1');
    expect(shown()).toEqual([['a', null, null, true], ['b', null, null, false], ['c', null, null, false], ['d', 'haplotig', null, false]]);
    CurationEngine.redoBatch('b1');
    expect(shown()).toEqual(after);
  });
});

describe('batch join', () => {
  it('joins nothing if any pair in the selection mixes excluded and included', () => {
    contigExclusion.set(id(2), true);
    state.update({ selectedContigs: new Set([0, 1, 2, 3]) });
    const result = batchJoinSelected();
    expect(result.operationsPerformed).toBe(0);
    expect(result.description).toMatch(/^Nothing was joined\. Cannot join "b" and "c": "c" is excluded/);
    expect(shown().map(([n]) => n)).toEqual(['a', 'b', 'c', 'd']);
    expect(state.get().undoStack).toHaveLength(0);
  });

  it('joins a run that is excluded throughout, keeps it excluded, and counts tags it did not keep', () => {
    for (const i of [1, 2, 3]) contigExclusion.set(id(i), true);
    metaTags.setTag(id(3), 'contaminant');
    state.update({ selectedContigs: new Set([1, 2, 3]) });
    const result = batchJoinSelected();
    expect(result.operationsPerformed).toBe(2);
    expect(result.description).toMatch(/1 tag was not kept/);
    expect(shown()).toEqual([['a', null, null, false], ['b+c+d', null, null, true]]);
  });
});
