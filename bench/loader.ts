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

export interface LoadOptions {
  /** Mipmap level to decode. 0 = finest (full resolution), higher = coarser.
   *  Defaults to coarsest level (typically level 5 → 1024px overview). */
  mipLevel?: number;
}

/**
 * Load a .pretext file from disk and assemble the overview contact map.
 *
 * Mirrors FileLoading.ts:32-66 (tile assembly) and :86-90 (contig mapping)
 * without any DOM or GPU dependencies.
 */
export async function loadPretextFromDisk(filepath: string, opts?: LoadOptions): Promise<LoadedAssembly> {
  const buffer = await readFile(filepath);

  // Parse at the requested mipmap level
  const parseOpts = opts?.mipLevel != null
    ? { decodeLevels: [opts.mipLevel] }
    : { coarsestOnly: true };
  const parsed = await parsePretextFile(buffer.buffer as ArrayBuffer, parseOpts);
  const h = parsed.header;
  const mapSize = h.numberOfPixels1D;

  // Determine which level was decoded
  const clampedMip = opts?.mipLevel != null
    ? Math.max(0, Math.min(opts.mipLevel, h.mipMapLevels - 1))
    : h.mipMapLevels - 1;

  // Assemble contact map from the decoded mipmap level
  const N = h.numberOfTextures1D;
  const tileRes = h.textureResolution >> clampedMip;
  const overviewSize = N * tileRes;
  const contactMap = new Float32Array(overviewSize * overviewSize);

  for (let tx = 0; tx < N; tx++) {
    for (let ty = tx; ty < N; ty++) {
      const linIdx = tileLinearIndex(tx, ty, N);
      const tileData = parsed.tilesDecoded[linIdx]?.[clampedMip];
      if (!tileData) continue;

      for (let py = 0; py < tileRes; py++) {
        for (let px = 0; px < tileRes; px++) {
          const val = tileData[py * tileRes + px];
          const gx = tx * tileRes + px;
          const gy = ty * tileRes + py;
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
