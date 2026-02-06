import { describe, it, expect } from 'vitest';
import {
  parseBedGraph,
  bedGraphToTrack,
  type BedGraphEntry,
  type BedGraphParseResult,
} from '../../src/formats/BedGraphParser';
import type { ContigInfo } from '../../src/core/State';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ContigInfo for testing. */
function makeContig(
  name: string,
  originalIndex: number,
  length: number,
  pixelStart: number,
  pixelEnd: number,
): ContigInfo {
  return {
    name,
    originalIndex,
    length,
    pixelStart,
    pixelEnd,
    inverted: false,
    scaffoldId: null,
  };
}

// ---------------------------------------------------------------------------
// parseBedGraph
// ---------------------------------------------------------------------------

describe('parseBedGraph', () => {
  it('parses basic bedGraph with 3 entries', () => {
    const text = [
      'chr1\t0\t100\t1.5',
      'chr1\t100\t200\t2.5',
      'chr2\t0\t50\t3.0',
    ].join('\n');

    const result = parseBedGraph(text);

    expect(result.entries).toHaveLength(3);

    expect(result.entries[0]).toEqual({ chrom: 'chr1', start: 0, end: 100, value: 1.5 });
    expect(result.entries[1]).toEqual({ chrom: 'chr1', start: 100, end: 200, value: 2.5 });
    expect(result.entries[2]).toEqual({ chrom: 'chr2', start: 0, end: 50, value: 3.0 });

    expect(result.chroms).toEqual(['chr1', 'chr2']);
    expect(result.trackName).toBeNull();
  });

  it('parses track header line and extracts trackName', () => {
    const text = [
      'track type=bedGraph name="GC Content" description="GC% per window"',
      'chr1\t0\t100\t0.45',
    ].join('\n');

    const result = parseBedGraph(text);

    expect(result.trackName).toBe('GC Content');
    expect(result.entries).toHaveLength(1);
  });

  it('ignores comments and browser lines', () => {
    const text = [
      '# This is a comment',
      'browser position chr1:1-1000',
      '# Another comment',
      'chr1\t0\t100\t1.0',
      'chr1\t100\t200\t2.0',
    ].join('\n');

    const result = parseBedGraph(text);

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ chrom: 'chr1', start: 0, end: 100, value: 1.0 });
    expect(result.entries[1]).toEqual({ chrom: 'chr1', start: 100, end: 200, value: 2.0 });
  });

  it('returns empty entries for empty input', () => {
    const result = parseBedGraph('');

    expect(result.entries).toHaveLength(0);
    expect(result.chroms).toHaveLength(0);
    expect(result.trackName).toBeNull();
  });

  it('handles Windows line endings (\\r\\n)', () => {
    const text = 'chr1\t0\t100\t1.0\r\nchr1\t100\t200\t2.0\r\nchr2\t0\t50\t3.0\r\n';

    const result = parseBedGraph(text);

    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toEqual({ chrom: 'chr1', start: 0, end: 100, value: 1.0 });
    expect(result.entries[1]).toEqual({ chrom: 'chr1', start: 100, end: 200, value: 2.0 });
    expect(result.entries[2]).toEqual({ chrom: 'chr2', start: 0, end: 50, value: 3.0 });
    expect(result.chroms).toEqual(['chr1', 'chr2']);
  });

  it('extracts unquoted track name', () => {
    const text = [
      'track type=bedGraph name=Coverage',
      'chr1\t0\t100\t5.0',
    ].join('\n');

    const result = parseBedGraph(text);
    expect(result.trackName).toBe('Coverage');
  });

  it('preserves chromosome encounter order', () => {
    const text = [
      'chr3\t0\t10\t1.0',
      'chr1\t0\t10\t2.0',
      'chr2\t0\t10\t3.0',
      'chr1\t10\t20\t4.0',
    ].join('\n');

    const result = parseBedGraph(text);
    expect(result.chroms).toEqual(['chr3', 'chr1', 'chr2']);
  });

  it('skips malformed data lines with fewer than 4 fields', () => {
    const text = [
      'chr1\t0\t100',
      'chr1\t0\t100\t1.0',
      'chr1\t200',
    ].join('\n');

    const result = parseBedGraph(text);
    expect(result.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// bedGraphToTrack
// ---------------------------------------------------------------------------

describe('bedGraphToTrack', () => {
  // Two contigs: chr1 occupies pixels 0-499 (500 bp), chr2 occupies pixels 500-999 (500 bp)
  const contigs: ContigInfo[] = [
    makeContig('chr1', 0, 500, 0, 500),
    makeContig('chr2', 1, 500, 500, 1000),
  ];
  const contigOrder = [0, 1];
  const textureSize = 1000;

  it('maps entries to correct pixel positions', () => {
    // chr1 is 500 bp mapped to pixels 0-499 => 1 bp per pixel
    // An entry covering bp 100-200 should fill pixels 100-199
    const result: BedGraphParseResult = {
      entries: [
        { chrom: 'chr1', start: 100, end: 200, value: 10 },
      ],
      trackName: null,
      chroms: ['chr1'],
    };

    const track = bedGraphToTrack(result, contigs, contigOrder, textureSize);

    // With only one entry, the normalised value should be 0.5 (single value, range=0)
    expect(track.data[100]).toBeCloseTo(0.5);
    expect(track.data[150]).toBeCloseTo(0.5);
    expect(track.data[199]).toBeCloseTo(0.5);

    // Pixels outside the entry should be 0
    expect(track.data[0]).toBe(0);
    expect(track.data[99]).toBe(0);
    expect(track.data[200]).toBe(0);
  });

  it('normalizes values to [0, 1] range', () => {
    const result: BedGraphParseResult = {
      entries: [
        { chrom: 'chr1', start: 0, end: 100, value: 10 },
        { chrom: 'chr1', start: 100, end: 200, value: 30 },
        { chrom: 'chr1', start: 200, end: 300, value: 20 },
      ],
      trackName: null,
      chroms: ['chr1'],
    };

    const track = bedGraphToTrack(result, contigs, contigOrder, textureSize);

    // min=10, max=30, range=20
    // value 10 => 0.0, value 20 => 0.5, value 30 => 1.0
    expect(track.data[50]).toBeCloseTo(0.0);   // in the 10-value region
    expect(track.data[150]).toBeCloseTo(1.0);   // in the 30-value region
    expect(track.data[250]).toBeCloseTo(0.5);   // in the 20-value region

    // All values should be in [0, 1]
    for (let i = 0; i < track.data.length; i++) {
      expect(track.data[i]).toBeGreaterThanOrEqual(0);
      expect(track.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('silently skips entries with unknown chromosome', () => {
    const result: BedGraphParseResult = {
      entries: [
        { chrom: 'chr1', start: 0, end: 100, value: 5 },
        { chrom: 'chrUnknown', start: 0, end: 50, value: 10 },
        { chrom: 'chr2', start: 0, end: 100, value: 15 },
      ],
      trackName: null,
      chroms: ['chr1', 'chrUnknown', 'chr2'],
    };

    // Should not throw
    const track = bedGraphToTrack(result, contigs, contigOrder, textureSize);

    // chr1 entry: value=5, normalised to (5-5)/(15-5) = 0.0
    expect(track.data[50]).toBeCloseTo(0.0);

    // chr2 entry: value=15, normalised to (15-5)/(15-5) = 1.0
    // chr2 starts at pixel 500, entry covers bp 0-100 => pixels 500-599
    expect(track.data[550]).toBeCloseTo(1.0);
  });

  it('respects custom options (name, color, height, type)', () => {
    const result: BedGraphParseResult = {
      entries: [{ chrom: 'chr1', start: 0, end: 100, value: 1 }],
      trackName: 'Default Name',
      chroms: ['chr1'],
    };

    const track = bedGraphToTrack(result, contigs, contigOrder, textureSize, {
      name: 'My Custom Track',
      type: 'heatmap',
      color: 'rgb(255, 0, 0)',
      height: 60,
    });

    expect(track.name).toBe('My Custom Track');
    expect(track.type).toBe('heatmap');
    expect(track.color).toBe('rgb(255, 0, 0)');
    expect(track.height).toBe(60);
    expect(track.visible).toBe(true);
  });

  it('returns Float32Array of exactly textureSize length', () => {
    const sizes = [100, 512, 1024, 2048];

    for (const size of sizes) {
      const smallContigs: ContigInfo[] = [
        makeContig('chr1', 0, size, 0, size),
      ];

      const result: BedGraphParseResult = {
        entries: [{ chrom: 'chr1', start: 0, end: 10, value: 1 }],
        trackName: null,
        chroms: ['chr1'],
      };

      const track = bedGraphToTrack(result, smallContigs, [0], size);

      expect(track.data).toBeInstanceOf(Float32Array);
      expect(track.data.length).toBe(size);
    }
  });

  it('uses default values when no options provided', () => {
    const result: BedGraphParseResult = {
      entries: [],
      trackName: null,
      chroms: [],
    };

    const track = bedGraphToTrack(result, contigs, contigOrder, textureSize);

    expect(track.name).toBe('BedGraph');
    expect(track.type).toBe('line');
    expect(track.color).toBe('rgb(100, 200, 255)');
    expect(track.height).toBe(40);
    expect(track.visible).toBe(true);
  });

  it('uses trackName from parse result when no name option given', () => {
    const result: BedGraphParseResult = {
      entries: [],
      trackName: 'Coverage Depth',
      chroms: [],
    };

    const track = bedGraphToTrack(result, contigs, contigOrder, textureSize);
    expect(track.name).toBe('Coverage Depth');
  });

  it('maps entries correctly for second contig', () => {
    // chr2 is 500 bp mapped to pixels 500-999 => 1 bp per pixel
    const result: BedGraphParseResult = {
      entries: [
        { chrom: 'chr2', start: 0, end: 50, value: 8 },
      ],
      trackName: null,
      chroms: ['chr2'],
    };

    const track = bedGraphToTrack(result, contigs, contigOrder, textureSize);

    // chr2 starts at pixel 500; bp 0-50 => pixels 500-549
    expect(track.data[500]).toBeCloseTo(0.5);  // single value => 0.5
    expect(track.data[525]).toBeCloseTo(0.5);
    expect(track.data[499]).toBe(0);           // before chr2
    expect(track.data[550]).toBe(0);           // after the entry
  });
});
