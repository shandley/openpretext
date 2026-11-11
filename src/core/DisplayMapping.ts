/**
 * DisplayMapping — the relationship between display coordinates (what the
 * curator sees, in curated order) and file coordinates (texels as stored in
 * the .pretext).
 *
 * Everything drawn on the map must agree on this mapping. It lives in one
 * module so the overview, the detail tiles and the analyses cannot each grow
 * their own version of it.
 */

import type { ContigInfo } from './State';

/**
 * True when the displayed order reads the file's texels left to right with
 * nothing moved or flipped, so a display coordinate equals its file
 * coordinate.
 *
 * Detail tiles are stored and drawn in file coordinates. Until they are drawn
 * through the display mapping, they are only correct while this holds.
 *
 * Zero-width contigs occupy no texels and are ignored.
 */
export function isFileOrder(contigs: ContigInfo[], contigOrder: number[]): boolean {
  let next = 0;
  for (const id of contigOrder) {
    const c = contigs[id];
    if (!c) return false;
    const width = c.pixelEnd - c.pixelStart;
    if (width === 0) continue;
    if (c.inverted || c.pixelStart !== next) return false;
    next = c.pixelEnd;
  }
  return true;
}
