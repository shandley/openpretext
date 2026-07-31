/**
 * The numbers Figure 3 prints.
 *
 * The figure asserts what a curation changed, so the functions producing those
 * counts carry a publication claim and are tested like it. The awkward one is
 * position: unplaced contigs export as objects named `unplaced_0..N` numbered by
 * order, so moving one contig renames every object after it. A positional diff
 * therefore reports a one-line change as a whole-file change, which is why the
 * figure reports orientation and grouping instead.
 */

import { describe, it, expect } from 'vitest';
import {
  mb,
  wrapCommand,
  namedScaffolds,
  reorientedCount,
  groupedCount,
} from '../../bench/figure3';

const W = (object: string, component: string, orientation: string) =>
  `${object}\t1\t100\t1\tW\t${component}\t1\t100\t${orientation}`;

describe('mb', () => {
  it('reports base counts in Mb to two places', () => {
    expect(mb(85_711_376)).toBe('85.71 Mb');
    expect(mb(0)).toBe('0.00 Mb');
  });
});

describe('wrapCommand', () => {
  it('leaves a short command alone', () => {
    expect(wrapCommand('npx tsx a.ts --out b')).toEqual(['npx tsx a.ts --out b']);
  });

  it('breaks at a flag and marks the continuation the way a shell would', () => {
    const cmd = 'npx tsx bench/curate.ts --pretext a/very/long/path/to/an/assembly.pretext --script s.dsl';
    const lines = wrapCommand(cmd, 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].endsWith(' \\')).toBe(true);
    expect(lines[1].trim().startsWith('--')).toBe(true);
  });

  it('rejoins to the original command', () => {
    const cmd = 'npx tsx bench/curate.ts --pretext some/long/path.pretext --script s.dsl --out o.agp';
    const rejoined = wrapCommand(cmd, 50)
      .map((l) => l.replace(/ \\$/, '').trim())
      .join(' ');
    expect(rejoined).toBe(cmd);
  });
});

describe('namedScaffolds', () => {
  it('counts named objects and ignores unplaced placeholders', () => {
    const agp = [W('SUPER_1', 'ctg1', '+'), W('SUPER_1', 'ctg2', '+'), W('unplaced_0', 'ctg3', '+')].join('\n');
    expect(namedScaffolds(agp)).toBe(1);
  });

  it('is zero for a wholly unplaced assembly', () => {
    const agp = [W('unplaced_0', 'ctg1', '+'), W('unplaced_1', 'ctg2', '+')].join('\n');
    expect(namedScaffolds(agp)).toBe(0);
  });

  it('skips comments and gap rows', () => {
    const agp = ['##agp-version\t2.1', '# a comment', 'SUPER_1\t1\t100\t2\tN\t200\tscaffold\tyes\tproximity_ligation'].join('\n');
    expect(namedScaffolds(agp)).toBe(0);
  });
});

describe('reorientedCount', () => {
  const before = [W('unplaced_0', 'ctg1', '+'), W('unplaced_1', 'ctg2', '+'), W('unplaced_2', 'ctg3', '-')].join('\n');

  it('counts only components whose strand flipped', () => {
    const after = [W('unplaced_0', 'ctg1', '-'), W('unplaced_1', 'ctg2', '+'), W('unplaced_2', 'ctg3', '-')].join('\n');
    expect(reorientedCount(before, after)).toBe(1);
  });

  it('is blind to reordering, which renames every unplaced object after the move', () => {
    // Same three components, same strands, different order and so different
    // object names. Nothing was reoriented.
    const reordered = [W('unplaced_0', 'ctg3', '-'), W('unplaced_1', 'ctg1', '+'), W('unplaced_2', 'ctg2', '+')].join('\n');
    expect(reorientedCount(before, reordered)).toBe(0);
  });

  it('is blind to grouping', () => {
    const grouped = [W('SUPER_1', 'ctg1', '+'), W('SUPER_1', 'ctg2', '+'), W('unplaced_0', 'ctg3', '-')].join('\n');
    expect(reorientedCount(before, grouped)).toBe(0);
  });
});

describe('groupedCount', () => {
  it('counts components placed into a named scaffold', () => {
    const agp = [W('SUPER_1', 'ctg1', '+'), W('SUPER_1', 'ctg2', '+'), W('unplaced_0', 'ctg3', '+')].join('\n');
    expect(groupedCount(agp)).toBe(2);
  });

  it('is zero when nothing was grouped', () => {
    expect(groupedCount(W('unplaced_0', 'ctg1', '+'))).toBe(0);
  });
});
