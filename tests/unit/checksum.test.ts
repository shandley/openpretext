import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { verdictText } from '../../src/ui/FileChecksums';
import { md5Hex, sha256Hex, computeFileChecksums, checkAgainst, type FileChecksums } from '../../src/core/Checksum';

/** Deterministic bytes, so a failure can be reproduced. */
function bytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

const nodeMd5 = (b: Uint8Array) => createHash('md5').update(b).digest('hex');
const nodeSha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

afterEach(() => { vi.unstubAllGlobals(); });

describe('md5Hex', () => {
  it('agrees with Node for every length around the block and padding boundaries', () => {
    // 55/56 is where the padding spills into a second block; 64 is a block.
    for (const n of [0, 1, 2, 3, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1000, 4096, 65537]) {
      const b = bytes(n, n + 7);
      expect(md5Hex(b), `length ${n}`).toBe(nodeMd5(b));
    }
  });

  it('agrees with Node on text and on all-zero and all-one bytes', () => {
    const enc = new TextEncoder();
    for (const b of [
      enc.encode('abc'),
      enc.encode('The quick brown fox jumps over the lazy dog'),
      new Uint8Array(1 << 16),
      new Uint8Array(300).fill(0xff),
    ]) {
      expect(md5Hex(b)).toBe(nodeMd5(b));
    }
  });

  it('hashes a view into a larger buffer, not the buffer', () => {
    const big = bytes(500);
    const view = big.subarray(100, 371);
    expect(md5Hex(view)).toBe(nodeMd5(view));
  });

  it('agrees with Node on a few megabytes', () => {
    const b = bytes(3 * 1024 * 1024 + 11, 99);
    expect(md5Hex(b)).toBe(nodeMd5(b));
  });
});

describe('sha256Hex and computeFileChecksums', () => {
  it('agree with Node', async () => {
    const b = bytes(100_003, 5);
    const ab = b.buffer.slice(0) as ArrayBuffer;
    expect(await sha256Hex(ab)).toBe(nodeSha(b));
    expect(await computeFileChecksums(ab)).toEqual({ byteLength: 100_003, md5: nodeMd5(b), sha256: nodeSha(b) });
  });

  it('report no SHA-256, but still an MD5, where Web Crypto is missing', async () => {
    vi.stubGlobal('crypto', {});
    const b = bytes(1000);
    const sums = await computeFileChecksums(b.buffer.slice(0) as ArrayBuffer);
    expect(sums.sha256).toBeNull();
    expect(sums.md5).toBe(nodeMd5(b));
  });
});

describe('checkAgainst', () => {
  const b = bytes(2000, 3);
  const sums: FileChecksums = { byteLength: 2000, md5: nodeMd5(b), sha256: nodeSha(b) };
  const other = bytes(2000, 4);

  it('matches a bare value in either case, with surrounding space', () => {
    expect(checkAgainst(sums.md5, sums)).toEqual({ result: 'match', kind: 'MD5' });
    expect(checkAgainst(`  ${sums.md5.toUpperCase()}\n`, sums)).toEqual({ result: 'match', kind: 'MD5' });
    expect(checkAgainst(sums.sha256!, sums)).toEqual({ result: 'match', kind: 'SHA-256' });
  });

  it('reads lines as the checksum tools print them', () => {
    expect(checkAgainst(`${sums.md5}  bTaeGut1.pretext`, sums)).toEqual({ result: 'match', kind: 'MD5' });
    expect(checkAgainst(`${sums.sha256} *map.pretext`, sums)).toEqual({ result: 'match', kind: 'SHA-256' });
    expect(checkAgainst(`MD5 (map.pretext) = ${sums.md5}`, sums)).toEqual({ result: 'match', kind: 'MD5' });
    // A filename that itself looks like hex must not be taken for the value.
    expect(checkAgainst(`${sums.md5}  deadbeef.cafe`, sums)).toEqual({ result: 'match', kind: 'MD5' });
    expect(checkAgainst(`MD5 (abcdef01.pretext) = ${sums.md5}`, sums)).toEqual({ result: 'match', kind: 'MD5' });
  });

  it('reports a different file as a mismatch of the right kind', () => {
    expect(checkAgainst(nodeMd5(other), sums)).toEqual({ result: 'mismatch', kind: 'MD5' });
    expect(checkAgainst(nodeSha(other), sums)).toEqual({ result: 'mismatch', kind: 'SHA-256' });
    // One digit off.
    const off = (sums.md5[0] === '0' ? '1' : '0') + sums.md5.slice(1);
    expect(checkAgainst(off, sums)).toEqual({ result: 'mismatch', kind: 'MD5' });
  });

  it('does not call a value of the wrong length a mismatch', () => {
    expect(checkAgainst('', sums)).toEqual({ result: 'unrecognised' });
    expect(checkAgainst('not a checksum', sums)).toEqual({ result: 'unrecognised' });
    expect(checkAgainst(sums.md5.slice(0, 31), sums)).toEqual({ result: 'unrecognised' });
    expect(checkAgainst(sums.md5 + 'a', sums)).toEqual({ result: 'unrecognised' });
  });

  it('words the verdict for the dialog', () => {
    expect(verdictText('   ', sums)).toEqual({ text: '', tone: 'neutral' });
    expect(verdictText(sums.md5, sums)).toEqual({ text: "Match. The file's MD5 equals the value you pasted.", tone: 'ok' });
    expect(verdictText(nodeSha(other), sums).tone).toBe('bad');
    expect(verdictText(nodeSha(other), sums).text).toMatch(/^No match\. The file's SHA-256 differs/);
    expect(verdictText('abc', sums).tone).toBe('neutral');
  });

  it('says so when a SHA-256 is pasted but none could be computed', () => {
    expect(checkAgainst(sums.sha256!, { ...sums, sha256: null })).toEqual({ result: 'unavailable', kind: 'SHA-256' });
  });
});
