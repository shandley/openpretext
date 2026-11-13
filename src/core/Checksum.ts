/**
 * Checksums of a loaded file, for comparing against the one published with it.
 *
 * A .pretext file carries no checksum of its own, so the reader's checks
 * (formats/PretextParser.ts) cannot see damage that leaves every size intact.
 * The only complete test is the usual one: compute the file's MD5 or SHA-256
 * and compare it with the value from wherever the file came from.
 *
 * Pure: no DOM. Runs in the parse worker.
 */

export interface FileChecksums {
  /** Size of the file in bytes. */
  byteLength: number;
  /** MD5 of the whole file, lowercase hex. */
  md5: string;
  /** SHA-256 of the whole file, lowercase hex. Null where Web Crypto is unavailable. */
  sha256: string | null;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i]];
  return out;
}

// ---------------------------------------------------------------------------
// MD5 (RFC 1321). Web Crypto does not provide it, and it is still the checksum
// most sequencing centres and archives publish next to their files.
// ---------------------------------------------------------------------------

/** Per-round left-rotation amounts. */
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** K[i] = floor(2^32 * abs(sin(i + 1))). */
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;

/** Fold one 64-byte block at `offset` of `data` into `h`. */
function md5Block(h: Int32Array, data: Uint8Array, offset: number, m: Int32Array): void {
  for (let i = 0, p = offset; i < 16; i++, p += 4) {
    m[i] = data[p] | (data[p + 1] << 8) | (data[p + 2] << 16) | (data[p + 3] << 24);
  }
  let a = h[0];
  let b = h[1];
  let c = h[2];
  let d = h[3];
  let f: number;
  let t: number;
  let r: number;

  for (let i = 0; i < 16; i++) {
    f = (d ^ (b & (c ^ d))) + a + K[i] + m[i];
    r = S[i];
    t = d; d = c; c = b; b = (b + ((f << r) | (f >>> (32 - r)))) | 0; a = t;
  }
  for (let i = 16; i < 32; i++) {
    f = (c ^ (d & (b ^ c))) + a + K[i] + m[(5 * i + 1) & 15];
    r = S[i];
    t = d; d = c; c = b; b = (b + ((f << r) | (f >>> (32 - r)))) | 0; a = t;
  }
  for (let i = 32; i < 48; i++) {
    f = (b ^ c ^ d) + a + K[i] + m[(3 * i + 5) & 15];
    r = S[i];
    t = d; d = c; c = b; b = (b + ((f << r) | (f >>> (32 - r)))) | 0; a = t;
  }
  for (let i = 48; i < 64; i++) {
    f = (c ^ (b | ~d)) + a + K[i] + m[(7 * i) & 15];
    r = S[i];
    t = d; d = c; c = b; b = (b + ((f << r) | (f >>> (32 - r)))) | 0; a = t;
  }

  h[0] = (h[0] + a) | 0;
  h[1] = (h[1] + b) | 0;
  h[2] = (h[2] + c) | 0;
  h[3] = (h[3] + d) | 0;
}

/** MD5 of `data`, as lowercase hex. */
export function md5Hex(data: Uint8Array): string {
  const h = Int32Array.of(0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476);
  const m = new Int32Array(16);
  const whole = data.length - (data.length % 64);
  for (let off = 0; off < whole; off += 64) md5Block(h, data, off, m);

  // Final block(s): the remaining bytes, 0x80, zeros, then the length in bits
  // as a 64-bit little-endian integer.
  const rest = data.length - whole;
  const tail = new Uint8Array(rest + 9 <= 64 ? 64 : 128);
  tail.set(data.subarray(whole));
  tail[rest] = 0x80;
  const bits = BigInt(data.length) * 8n;
  const tv = new DataView(tail.buffer);
  tv.setUint32(tail.length - 8, Number(bits & 0xffffffffn), true);
  tv.setUint32(tail.length - 4, Number((bits >> 32n) & 0xffffffffn), true);
  for (let off = 0; off < tail.length; off += 64) md5Block(h, tail, off, m);

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) ov.setInt32(i * 4, h[i], true);
  return toHex(out);
}

/** SHA-256 of `data` as lowercase hex, or null where Web Crypto is unavailable. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string | null> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) return null;
  try {
    return toHex(new Uint8Array(await subtle.digest('SHA-256', data as BufferSource)));
  } catch {
    return null;
  }
}

/** Size, MD5 and SHA-256 of a whole file. */
export async function computeFileChecksums(buffer: ArrayBuffer): Promise<FileChecksums> {
  const sha = sha256Hex(buffer);            // runs off-thread in the browser
  const md5 = md5Hex(new Uint8Array(buffer));
  return { byteLength: buffer.byteLength, md5, sha256: await sha };
}

// ---------------------------------------------------------------------------
// Comparing with a checksum the user has
// ---------------------------------------------------------------------------

export type ChecksumVerdict =
  /** The pasted value equals the file's checksum of this kind. */
  | { result: 'match'; kind: 'MD5' | 'SHA-256' }
  /** The pasted value is a checksum of this kind and differs from the file's. */
  | { result: 'mismatch'; kind: 'MD5' | 'SHA-256' }
  /** The pasted value is SHA-256 but this browser could not compute one. */
  | { result: 'unavailable'; kind: 'SHA-256' }
  /** The pasted text holds no MD5 or SHA-256 value. */
  | { result: 'unrecognised' };

/**
 * Compare what the user pasted with the file's checksums. Accepts a bare
 * value or a line from `md5sum` / `sha256sum` / `shasum` output or a BSD
 * `MD5 (file) = value` line, in either letter case. The kind is taken from the
 * value's length (32 hex digits is MD5, 64 is SHA-256).
 */
export function checkAgainst(pasted: string, sums: FileChecksums): ChecksumVerdict {
  const tokens = pasted.match(/[0-9a-fA-F]+/g) ?? [];
  // A filename may contain hex-looking runs, so take the first run of exactly
  // the right length rather than the first run.
  const value = tokens.find((t) => t.length === 64) ?? tokens.find((t) => t.length === 32);
  if (!value) return { result: 'unrecognised' };
  const v = value.toLowerCase();
  if (v.length === 32) {
    return { result: v === sums.md5 ? 'match' : 'mismatch', kind: 'MD5' };
  }
  if (sums.sha256 === null) return { result: 'unavailable', kind: 'SHA-256' };
  return { result: v === sums.sha256 ? 'match' : 'mismatch', kind: 'SHA-256' };
}
