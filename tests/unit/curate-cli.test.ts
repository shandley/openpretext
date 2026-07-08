import { describe, it, expect } from 'vitest';
import type { ContigInfo, MapData } from '../../src/core/State';
import { applyCurationScript } from '../../bench/curate';

// ---------------------------------------------------------------------------
// Helpers (mirror tests/unit/curation.test.ts makeContig / makeTestMap)
// ---------------------------------------------------------------------------

function makeContig(
  name: string,
  index: number,
  pixelStart: number,
  pixelEnd: number,
  length = 1000,
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
    tileResolution: 1024,
    tilesPerDimension: 1,
    contigs,
    contactMap: null,
    rawTiles: null,
    parsedHeader: null,
    extensions: new Map(),
  };
}

function fourContigs(): ContigInfo[] {
  return [
    makeContig('chr1', 0, 0, 100, 10000),
    makeContig('chr2', 1, 100, 200, 8000),
    makeContig('chr3', 2, 200, 300, 6000),
    makeContig('chr4', 3, 300, 400, 4000),
  ];
}

/** Extract the W (contig) component lines from an AGP string, in file order. */
function wLines(agp: string): string[][] {
  return agp
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((cols) => cols[4] === 'W');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyCurationScript', () => {
  it('applies invert + move and reflects both in the exported AGP', () => {
    const map = makeTestMap(fourContigs());
    const script = 'invert chr1\nmove chr3 to 0';

    const outcome = applyCurationScript(map, [0, 1, 2, 3], script);

    // Every line parsed and executed successfully.
    expect(outcome.parseErrors).toEqual([]);
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results.every((r) => r.success)).toBe(true);
    expect(outcome.ok).toBe(true);

    // Curation preserves the four contigs (no cut/join).
    expect(outcome.afterMetrics.contigCount).toBe(4);

    const lines = wLines(outcome.agp);
    expect(lines).toHaveLength(4);

    // New display order after `move chr3 to 0`: chr3, chr1, chr2, chr4.
    const names = lines.map((cols) => cols[5]);
    expect(names).toEqual(['chr3', 'chr1', 'chr2', 'chr4']);

    // Orientation is the last (9th) column. chr1 was inverted -> '-', rest '+'.
    const orientationByName = new Map(lines.map((cols) => [cols[5], cols[8]]));
    expect(orientationByName.get('chr1')).toBe('-');
    expect(orientationByName.get('chr2')).toBe('+');
    expect(orientationByName.get('chr3')).toBe('+');
    expect(orientationByName.get('chr4')).toBe('+');
  });

  it('halts on the first failing line and reports it', () => {
    const map = makeTestMap(fourContigs());
    // Second line references a contig that does not exist -> execution halts.
    const script = 'invert chr1\ninvert nope\ninvert chr2';

    const outcome = applyCurationScript(map, [0, 1, 2, 3], script);

    expect(outcome.ok).toBe(false);
    // continueOnError=false: stops after the failing line (2 of 3 attempted).
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0].success).toBe(true);
    expect(outcome.results[1].success).toBe(false);
    expect(outcome.results[1].line).toBe(2);
  });

  it('runs assert as a self-checking protocol (passes, then halts on a failing assert)', () => {
    const map = makeTestMap(fourContigs());

    // Passing assertion lets the run continue.
    const pass = applyCurationScript(map, [0, 1, 2, 3], 'assert contigs == 4\ninvert chr1');
    expect(pass.ok).toBe(true);
    expect(pass.results).toHaveLength(2);
    expect(pass.results[0].success).toBe(true);

    // Failing assertion halts before the later command runs.
    const fail = applyCurationScript(map, [0, 1, 2, 3], 'assert contigs == 99\ninvert chr1');
    expect(fail.ok).toBe(false);
    expect(fail.results).toHaveLength(1);
    expect(fail.results[0].success).toBe(false);
    expect(fail.results[0].message).toContain('FAILED');
  });

  it('selects by predicate headlessly', () => {
    const map = makeTestMap(fourContigs()); // lengths 10000, 8000, 6000, 4000
    const outcome = applyCurationScript(map, [0, 1, 2, 3], 'select where length < 7000');
    expect(outcome.ok).toBe(true);
    expect(outcome.results[0].message).toContain('Selected 2');
  });

  it('surfaces parse errors and marks the run not ok', () => {
    const map = makeTestMap(fourContigs());
    // `bogus` is not a known command -> parse error on line 1.
    const outcome = applyCurationScript(map, [0, 1, 2, 3], 'bogus chr1');

    expect(outcome.parseErrors).toHaveLength(1);
    expect(outcome.parseErrors[0].line).toBe(1);
    expect(outcome.ok).toBe(false);
  });
});
