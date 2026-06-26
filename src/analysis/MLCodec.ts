/**
 * MLCodec — base64 <-> Float32Array helpers shared by ML backend clients
 * (Evo2HiC, HiCFoundation). Pure functions; no DOM or network dependencies.
 *
 * Contact maps and track values are sent to/from the companion ML servers as
 * base64-encoded Float32Array bytes.
 */

/** Encode a Float32Array to a base64 string. */
export function encodeFloat32Array(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Decode a base64 string to a Float32Array of arbitrary length. */
export function decodeFloat32Array(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** Encode a Float32Array contact map to a base64 string. */
export function encodeContactMap(map: Float32Array): string {
  return encodeFloat32Array(map);
}

/** Decode a base64 string to a Float32Array contact map, validating size·size. */
export function decodeContactMap(base64: string, size: number): Float32Array {
  const result = decodeFloat32Array(base64);
  if (result.length !== size * size) {
    throw new Error(`Expected ${size * size} floats, got ${result.length}`);
  }
  return result;
}
