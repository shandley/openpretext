import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TileDecodeWorkerClient } from '../../src/renderer/TileDecodeWorkerClient';
import type { PretextHeader } from '../../src/formats/PretextParser';
import type { TileKey } from '../../src/renderer/TileManager';

// ---------------------------------------------------------------------------
// Helpers (mirror tile-decoder.test.ts)
// ---------------------------------------------------------------------------

function makeHeader(overrides?: Partial<PretextHeader>): PretextHeader {
  const textureResolution = overrides?.textureResolution ?? 8;
  const numberOfTextures1D = overrides?.numberOfTextures1D ?? 2;
  const mipMapLevels = overrides?.mipMapLevels ?? 1;
  return {
    totalGenomeLength: BigInt(0),
    numberOfContigs: 0,
    textureRes: Math.log2(textureResolution),
    nTextRes: Math.log2(numberOfTextures1D),
    mipMapLevels,
    textureResolution,
    numberOfTextures1D,
    numberOfPixels1D: textureResolution * numberOfTextures1D,
  };
}

function makeRawTile(header: PretextHeader): Uint8Array {
  let totalBytes = 0;
  let res = header.textureResolution;
  for (let i = 0; i < header.mipMapLevels; i++) {
    totalBytes += (res * res) >> 1;
    res >>= 1;
  }
  return new Uint8Array(totalBytes);
}

function makeConstantRawTile(header: PretextHeader, byteVal: number): Uint8Array {
  const tile = makeRawTile(header);
  for (let i = 0; i < tile.length; i += 8) {
    tile[i] = byteVal;
    tile[i + 1] = byteVal;
  }
  return tile;
}

// ---------------------------------------------------------------------------
// Tests — synchronous fallback path (no Worker global in the test env)
// ---------------------------------------------------------------------------

describe('TileDecodeWorkerClient (sync fallback)', () => {
  const header = makeHeader();
  let rawTiles: Uint8Array[];
  let rafCallbacks: Array<FrameRequestCallback>;

  beforeEach(() => {
    // Force the no-worker fallback so the test is deterministic.
    delete (globalThis as any).Worker;

    rawTiles = [
      makeConstantRawTile(header, 100),
      makeConstantRawTile(header, 100),
      makeConstantRawTile(header, 100),
    ];

    rafCallbacks = [];
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
  });

  afterEach(() => {
    delete (globalThis as any).requestAnimationFrame;
  });

  function flushRAF(times = 10) {
    for (let i = 0; i < times; i++) {
      const pending = rafCallbacks.splice(0);
      if (pending.length === 0) break;
      for (const cb of pending) cb(performance.now());
    }
  }

  const keys: TileKey[] = [
    { level: 0, col: 0, row: 0 },
    { level: 0, col: 0, row: 1 },
    { level: 0, col: 1, row: 1 },
  ];

  it('constructs without throwing when Worker is unavailable', () => {
    expect(() => new TileDecodeWorkerClient()).not.toThrow();
  });

  it('decodes all requested tiles via the fallback and invokes onDecoded', () => {
    const client = new TileDecodeWorkerClient();
    const decoded: TileKey[] = [];
    client.setOnDecoded((key, data) => {
      expect(data.length).toBe(header.textureResolution * header.textureResolution);
      decoded.push(key);
    });

    client.setSource(rawTiles, header);
    client.decode(keys);
    flushRAF();

    expect(decoded.length).toBe(3);
  });

  it('treats an empty decode request as a no-op', () => {
    const client = new TileDecodeWorkerClient();
    const onDecoded = vi.fn();
    client.setOnDecoded(onDecoded);
    client.setSource(rawTiles, header);

    client.decode([]);
    flushRAF();

    expect(onDecoded).not.toHaveBeenCalled();
  });

  it('drops tiles from a superseded (cancelled) request', () => {
    const client = new TileDecodeWorkerClient();
    const onDecoded = vi.fn();
    client.setOnDecoded(onDecoded);
    client.setSource(rawTiles, header);

    // Queue a decode but cancel before the rAF callbacks run.
    client.decode(keys);
    client.cancel();
    flushRAF();

    expect(onDecoded).not.toHaveBeenCalled();
  });

  it('does nothing when decode is called before a source is set', () => {
    const client = new TileDecodeWorkerClient();
    const onDecoded = vi.fn();
    client.setOnDecoded(onDecoded);

    client.decode(keys);
    flushRAF();

    expect(onDecoded).not.toHaveBeenCalled();
  });

  it('dispose() is safe to call and prevents further decoding', () => {
    const client = new TileDecodeWorkerClient();
    const onDecoded = vi.fn();
    client.setOnDecoded(onDecoded);
    client.setSource(rawTiles, header);

    client.dispose();
    client.decode(keys);
    flushRAF();

    expect(onDecoded).not.toHaveBeenCalled();
  });
});
