/**
 * Node.js .pretext file loader — replicates the contact map assembly
 * from src/ui/FileLoading.ts without any DOM dependencies.
 */

import { readFile } from 'node:fs/promises';
import { parsePretextFile, tileLinearIndex } from '../src/formats/PretextParser';
import type { PretextFile } from '../src/formats/PretextParser';
import type { ContigInfo } from '../src/core/State';

export interface LoadedAssembly {
  contactMap: Float32Array;
  overviewSize: number;
  textureSize: number;
  contigs: ContigInfo[];
  contigOrder: number[];
  parsed: PretextFile;
}

/**
 * Load a .pretext file from disk and assemble the overview contact map.
 *
 * Mirrors FileLoading.ts:32-66 (tile assembly) and :86-90 (contig mapping)
 * without any DOM or GPU dependencies.
 */
export async function loadPretextFromDisk(filepath: string): Promise<LoadedAssembly> {
  const buffer = await readFile(filepath);
  const parsed = await parsePretextFile(buffer.buffer as ArrayBuffer, { coarsestOnly: true });
  const h = parsed.header;
  const mapSize = h.numberOfPixels1D;

  // Assemble overview contact map from coarsest mipmap tiles
  const N = h.numberOfTextures1D;
  const coarsestMip = h.mipMapLevels - 1;
  const coarsestRes = h.textureResolution >> coarsestMip;
  const overviewSize = N * coarsestRes;
  const contactMap = new Float32Array(overviewSize * overviewSize);

  for (let tx = 0; tx < N; tx++) {
    for (let ty = tx; ty < N; ty++) {
      const linIdx = tileLinearIndex(tx, ty, N);
      const tileData = parsed.tilesDecoded[linIdx]?.[coarsestMip];
      if (!tileData) continue;

      for (let py = 0; py < coarsestRes; py++) {
        for (let px = 0; px < coarsestRes; px++) {
          const val = tileData[py * coarsestRes + px];
          const gx = tx * coarsestRes + px;
          const gy = ty * coarsestRes + py;
          if (gx < overviewSize && gy < overviewSize) {
            contactMap[gy * overviewSize + gx] = val;
            contactMap[gx * overviewSize + gy] = val;
          }
        }
      }
    }
  }

  // Map PretextContig[] to ContigInfo[] (mirrors FileLoading.ts:86-90)
  const contigs: ContigInfo[] = parsed.contigs.map((c, i) => ({
    name: c.name,
    originalIndex: i,
    length: c.length,
    pixelStart: c.pixelStart,
    pixelEnd: c.pixelEnd,
    inverted: false,
    scaffoldId: null,
  }));

  const contigOrder = parsed.contigs.map((_, i) => i);

  return {
    contactMap,
    overviewSize,
    textureSize: mapSize,
    contigs,
    contigOrder,
    parsed,
  };
}
