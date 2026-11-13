/**
 * Rebuild a map layout from a PretextView AGP alone, for fixtures that come
 * without their `.pretext` file.
 *
 * A PretextView AGP gives the resolution in its header and, for every
 * sequence that owns a texel, an end coordinate that is a texel boundary. So
 * each sequence's width is its largest end divided by the resolution, the map
 * is a power of two wide, and the genome length follows from the two. Where
 * the file accounts for fewer texels than that (rows were removed from it
 * after export), the rest of the map goes to a sequence it does not mention,
 * called FILLER.
 */

import type { ContigInfo, MapData } from '../../src/core/State';
import type { ParsedAGP } from '../../src/formats/AGPParser';

export const FILLER = 'not_in_the_file';

export function mapFromAGP(parsed: ParsedAGP, filename = 'fixture.pretext'): MapData {
  if (parsed.resolution === null) throw new Error('The AGP has no resolution header');
  const res = parsed.resolution;
  const width = new Map<string, number>();
  for (const r of parsed.rows) width.set(r.component, Math.max(width.get(r.component) ?? 0, Math.round(r.end / res)));

  let pos = 0;
  const layout: Array<[string, number, number]> = [...width].map(([name, w]) => [name, pos, (pos += w)]);
  const N = 2 ** Math.ceil(Math.log2(pos));
  if (pos < N) layout.push([FILLER, pos, N]);
  const genomeLength = Math.round(res * N);

  const contigs: ContigInfo[] = layout.map(([name, s, e], i) => ({
    name, originalIndex: i, length: Math.round(((e - s) / N) * genomeLength),
    pixelStart: s, pixelEnd: e, inverted: false, scaffoldId: null,
  }));
  return {
    filename, textureSize: N, numMipMaps: 1, tileResolution: N, tilesPerDimension: 1,
    contigs, fileContigCount: contigs.length, genomeLength,
    contactMap: null, rawTiles: null, parsedHeader: null, extensions: new Map(),
  };
}
