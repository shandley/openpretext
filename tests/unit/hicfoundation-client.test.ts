/**
 * Tests for src/analysis/HiCFoundationClient.ts (Phase 0 backend).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HiCFoundationClient,
  HiCFoundationServerError,
  HiCFoundationConnectionError,
  getStoredServerUrl,
  setStoredServerUrl,
} from '../../src/analysis/HiCFoundationClient';
import { encodeContactMap, encodeFloat32Array } from '../../src/analysis/MLCodec';

// Mock localStorage for the Node test environment
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((k: string) => storage.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { storage.set(k, v); }),
    removeItem: vi.fn((k: string) => { storage.delete(k); }),
    clear: vi.fn(() => { storage.clear(); }),
  },
  writable: true,
});

describe('HiCFoundationClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    storage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body: any) {
    (globalThis.fetch as any).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  // --- localStorage helpers -------------------------------------------------

  it('stores and reads the server URL under its own key', () => {
    expect(getStoredServerUrl()).toBeNull();
    setStoredServerUrl('http://localhost:8001');
    expect(getStoredServerUrl()).toBe('http://localhost:8001');
    // Must not collide with the Evo2HiC key
    expect(storage.has('openpretext-hicfoundation-url')).toBe(true);
  });

  // --- checkHealth ----------------------------------------------------------

  it('normalizes trailing slashes and maps the health response', async () => {
    mockFetch(200, {
      status: 'ok',
      model_loaded: true,
      device: 'cpu',
      model_version: 'hicfoundation-mock-0.1.0',
    });
    const client = new HiCFoundationClient({ serverUrl: 'http://localhost:8001///' });
    const health = await client.checkHealth();

    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('http://localhost:8001/api/v1/health');
    expect(opts.method).toBe('GET');
    expect(health).toEqual({
      status: 'ok',
      modelLoaded: true,
      device: 'cpu',
      modelVersion: 'hicfoundation-mock-0.1.0',
    });
  });

  // --- enhance --------------------------------------------------------------

  it('enhance() round-trips the contact map and decodes the result', async () => {
    const size = 4;
    const enhancedSize = 8;
    const enhanced = new Float32Array(enhancedSize * enhancedSize).map((_, i) => i * 0.5);
    mockFetch(200, {
      enhanced_map: encodeContactMap(enhanced),
      enhanced_size: enhancedSize,
      upscale_factor: 2,
      model_version: 'hicfoundation-mock-0.1.0',
      elapsed_ms: 12.3,
    });

    const client = new HiCFoundationClient({ serverUrl: 'http://localhost:8001' });
    const input = new Float32Array(size * size).fill(1);
    const result = await client.enhance(input, size);

    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('http://localhost:8001/api/v1/enhance');
    expect(opts.method).toBe('POST');
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.map_size).toBe(size);
    expect(sentBody.contact_map).toBe(encodeContactMap(input));
    expect(sentBody.fasta_sequences).toBeUndefined(); // Hi-C-only: never sends FASTA

    expect(result.enhancedSize).toBe(enhancedSize);
    expect(result.upscaleFactor).toBe(2);
    expect(Array.from(result.enhancedMap)).toEqual(Array.from(enhanced));
  });

  // --- predictTracks --------------------------------------------------------

  it('predictTracks() decodes each track', async () => {
    const t0 = new Float32Array([0, 0.5, 1]);
    const t1 = new Float32Array([1, 0.25, 0]);
    mockFetch(200, {
      tracks: [
        { name: 'DNase', values: encodeFloat32Array(t0), color: '#1f77b4' },
        { name: 'CTCF', values: encodeFloat32Array(t1), color: '#ff7f0e' },
      ],
      model_version: 'hicfoundation-mock-epi-0.1.0',
      elapsed_ms: 5,
    });

    const client = new HiCFoundationClient({ serverUrl: 'http://localhost:8001' });
    const result = await client.predictTracks(new Float32Array(9).fill(1), 3);

    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0].name).toBe('DNase');
    expect(Array.from(result.tracks[0].values)).toEqual(Array.from(t0));
    expect(result.tracks[1].color).toBe('#ff7f0e');
  });

  // --- error handling -------------------------------------------------------

  it('throws HiCFoundationServerError on a non-OK response', async () => {
    mockFetch(500, { detail: 'boom' });
    const client = new HiCFoundationClient({ serverUrl: 'http://localhost:8001' });
    await expect(client.enhance(new Float32Array(4).fill(1), 2)).rejects.toBeInstanceOf(
      HiCFoundationServerError,
    );
  });

  it('throws HiCFoundationConnectionError when fetch fails', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('network down'));
    const client = new HiCFoundationClient({ serverUrl: 'http://localhost:8001' });
    await expect(client.checkHealth()).rejects.toBeInstanceOf(HiCFoundationConnectionError);
  });
});
