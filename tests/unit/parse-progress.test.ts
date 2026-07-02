/**
 * Progress-reporting tests for parseAndAssemble.
 *
 * Large .pretext files spend seconds in the tile inflate + BC4 decode phase.
 * These tests verify that phase reports granular, monotonic progress (it used
 * to sit at a flat 20% for the whole decode). Gated on a local specimen file
 * (gitignored), so they skip in CI where the fixture is absent — the same
 * pattern used by tile-decoder-integration.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseAndAssemble } from '../../src/formats/PretextParser';

const TEST_FILE = resolve(__dirname, '../../test-data/Anilios_waitii_post.pretext');
const FILE_EXISTS = existsSync(TEST_FILE);
const d = FILE_EXISTS ? describe : describe.skip;

function loadBuffer(): ArrayBuffer {
  const buf = readFileSync(TEST_FILE);
  // Slice out an exact, standalone ArrayBuffer (Node buffers may be pooled).
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

d('parseAndAssemble progress reporting', () => {
  it('reports granular, monotonic progress through decode and assembly', async () => {
    const events: Array<{ message: string; percent: number }> = [];
    await parseAndAssemble(loadBuffer(), (message, percent) => events.push({ message, percent }));

    // Many updates, not just a start/end pair (the flat-20% regression).
    expect(events.length).toBeGreaterThan(5);

    // Every percent is in range and the sequence never goes backwards.
    for (const e of events) {
      expect(e.percent).toBeGreaterThanOrEqual(0);
      expect(e.percent).toBeLessThanOrEqual(100);
    }
    for (let i = 1; i < events.length; i++) {
      expect(events[i].percent).toBeGreaterThanOrEqual(events[i - 1].percent);
    }

    // The slow decompression phase must actually report progress.
    expect(events.some(e => /decompress/i.test(e.message))).toBe(true);
    // And the bar climbs near the top before GPU upload takes over on the main thread.
    expect(Math.max(...events.map(e => e.percent))).toBeGreaterThanOrEqual(85);
  }, 60_000);
});
