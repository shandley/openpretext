/**
 * Tests for src/analysis/Evo2HiCClient.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Evo2HiCClient,
  Evo2HiCServerError,
  Evo2HiCConnectionError,
  getStoredServerUrl,
  setStoredServerUrl,
} from '../../src/analysis/Evo2HiCClient';
import { encodeContactMap } from '../../src/analysis/Evo2HiCEnhancement';

// Mock localStorage for Node test environment
const storage = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn((key: string) => { storage.delete(key); }),
  clear: vi.fn(() => { storage.clear(); }),
  get length() { return storage.size; },
  key: vi.fn((_index: number) => null),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('Evo2HiCClient', () => {
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

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  it('normalizes trailing slashes from URL', async () => {
    mockFetch(200, { status: 'ok', modelLoaded: true, device: 'cpu', modelVersion: '1.0' });
    const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000///' });
    await client.checkHealth();
    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('http://localhost:8000/api/v1/health');
  });

  // -----------------------------------------------------------------------
  // checkHealth
  // -----------------------------------------------------------------------

  describe('checkHealth', () => {
    it('returns HealthStatus on success', async () => {
      const body = { status: 'ok', modelLoaded: true, device: 'cuda', modelVersion: '2.0' };
      mockFetch(200, body);

      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      const result = await client.checkHealth();
      expect(result).toEqual(body);
    });

    it('sends GET to /api/v1/health', async () => {
      mockFetch(200, { status: 'ok', modelLoaded: true, device: 'cpu', modelVersion: '1.0' });
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      await client.checkHealth();

      const [url, options] = (globalThis.fetch as any).mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/v1/health');
      expect(options.method).toBe('GET');
    });

    it('throws Evo2HiCConnectionError on network failure', async () => {
      (globalThis.fetch as any).mockRejectedValue(new TypeError('Failed to fetch'));
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      await expect(client.checkHealth()).rejects.toThrow(Evo2HiCConnectionError);
      await expect(client.checkHealth()).rejects.toThrow(/Connection failed/);
    });

    it('throws Evo2HiCServerError on 500', async () => {
      mockFetch(500, { error: 'internal' });
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      await expect(client.checkHealth()).rejects.toThrow(Evo2HiCServerError);
    });

    it('includes status code in Evo2HiCServerError', async () => {
      mockFetch(503, { error: 'unavailable' });
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      try {
        await client.checkHealth();
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(Evo2HiCServerError);
        expect(err.status).toBe(503);
      }
    });
  });

  // -----------------------------------------------------------------------
  // enhance
  // -----------------------------------------------------------------------

  describe('enhance', () => {
    const smallMap = new Float32Array([1, 2, 3, 4]);
    const enhancedBase64 = encodeContactMap(new Float32Array(64)); // 8x8

    function mockEnhanceSuccess() {
      mockFetch(200, {
        enhanced_map: enhancedBase64,
        enhanced_size: 8,
        upscale_factor: 4,
        model_version: '2.1',
        elapsed_ms: 350,
      });
    }

    it('returns EnhancementResult on success', async () => {
      mockEnhanceSuccess();
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      const result = await client.enhance(smallMap, 2);

      expect(result.enhancedMap).toBeInstanceOf(Float32Array);
      expect(result.enhancedSize).toBe(8);
      expect(result.upscaleFactor).toBe(4);
      expect(result.modelVersion).toBe('2.1');
      expect(result.elapsedMs).toBe(350);
    });

    it('sends POST to /api/v1/enhance', async () => {
      mockEnhanceSuccess();
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      await client.enhance(smallMap, 2);

      const [url, options] = (globalThis.fetch as any).mock.calls[0];
      expect(url).toBe('http://localhost:8000/api/v1/enhance');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('encodes contactMap as base64 in request body', async () => {
      mockEnhanceSuccess();
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      await client.enhance(smallMap, 2);

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(body.contact_map).toBe(encodeContactMap(smallMap));
      expect(body.size).toBe(2);
      expect(body.upscale_factor).toBe(4);
    });

    it('includes fasta sequences when provided', async () => {
      mockEnhanceSuccess();
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      const fasta = new Map([['chr1', 'ATCG'], ['chr2', 'GCTA']]);
      await client.enhance(smallMap, 2, fasta, ['chr1', 'chr2']);

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(body.fasta_sequences).toEqual({ chr1: 'ATCG', chr2: 'GCTA' });
      expect(body.contig_names).toEqual(['chr1', 'chr2']);
    });

    it('omits fasta when not provided', async () => {
      mockEnhanceSuccess();
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      await client.enhance(smallMap, 2);

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(body.fasta_sequences).toBeUndefined();
      expect(body.contig_names).toBeUndefined();
    });

    it('omits fasta when empty map provided', async () => {
      mockEnhanceSuccess();
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      await client.enhance(smallMap, 2, new Map());

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(body.fasta_sequences).toBeUndefined();
    });

    it('throws Evo2HiCServerError on 500', async () => {
      mockFetch(500, { error: 'model failed' });
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      await expect(client.enhance(smallMap, 2)).rejects.toThrow(Evo2HiCServerError);
    });

    it('includes status in Evo2HiCServerError from enhance', async () => {
      mockFetch(422, { error: 'bad input' });
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      try {
        await client.enhance(smallMap, 2);
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(Evo2HiCServerError);
        expect(err.status).toBe(422);
      }
    });

    it('throws Evo2HiCConnectionError on network failure', async () => {
      (globalThis.fetch as any).mockRejectedValue(new TypeError('Network error'));
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000' });
      await expect(client.enhance(smallMap, 2)).rejects.toThrow(Evo2HiCConnectionError);
    });

    it('throws on timeout (AbortError)', async () => {
      (globalThis.fetch as any).mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000', timeout: 100 });
      await expect(client.enhance(smallMap, 2)).rejects.toThrow(Evo2HiCConnectionError);
      await expect(client.enhance(smallMap, 2)).rejects.toThrow(/timed out/);
    });

    it('uses custom upscale factor', async () => {
      mockEnhanceSuccess();
      const client = new Evo2HiCClient({ serverUrl: 'http://localhost:8000', upscaleFactor: 2 });
      await client.enhance(smallMap, 2);

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(body.upscale_factor).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // localStorage helpers
  // -----------------------------------------------------------------------

  describe('getStoredServerUrl / setStoredServerUrl', () => {
    it('returns null when no URL stored', () => {
      expect(getStoredServerUrl()).toBeNull();
    });

    it('round-trips a URL', () => {
      setStoredServerUrl('http://localhost:9000');
      expect(getStoredServerUrl()).toBe('http://localhost:9000');
    });

    it('overwrites previous URL', () => {
      setStoredServerUrl('http://a.com');
      setStoredServerUrl('http://b.com');
      expect(getStoredServerUrl()).toBe('http://b.com');
    });
  });
});
