/**
 * HiCFoundationClient — HTTP client for the HiCFoundation companion server.
 *
 * Mirrors Evo2HiCClient, but HiCFoundation is a Hi-C-only foundation model, so
 * requests carry no FASTA/sequence data. Phase 0 covers the drop-in alternate
 * backend (health + resolution enhancement + epigenomic track prediction);
 * embedding/anomaly/junction endpoints come in later phases.
 */

import { encodeContactMap, decodeContactMap, decodeFloat32Array } from './MLCodec';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class HiCFoundationServerError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'HiCFoundationServerError';
  }
}

export class HiCFoundationConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HiCFoundationConnectionError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HiCFoundationConfig {
  serverUrl: string;
  /** Upscale factor. Default: 4. */
  upscaleFactor?: number;
  /** Request timeout in milliseconds. Default: 120000. */
  timeout?: number;
}

export interface HFEnhancementResult {
  enhancedMap: Float32Array;
  enhancedSize: number;
  upscaleFactor: number;
  modelVersion: string;
  elapsedMs: number;
}

export interface HFHealthStatus {
  status: string;
  modelLoaded: boolean;
  device: string;
  modelVersion: string;
}

export interface HFTrackPrediction {
  name: string;
  values: Float32Array;
  color: string;
}

export interface HFTrackPredictionResult {
  tracks: HFTrackPrediction[];
  modelVersion: string;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'openpretext-hicfoundation-url';

export function getStoredServerUrl(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredServerUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class HiCFoundationClient {
  private serverUrl: string;
  private upscaleFactor: number;
  private timeout: number;

  constructor(config: HiCFoundationConfig) {
    this.serverUrl = config.serverUrl.replace(/\/+$/, '');
    this.upscaleFactor = config.upscaleFactor ?? 4;
    this.timeout = config.timeout ?? 120_000;
  }

  async checkHealth(): Promise<HFHealthStatus> {
    const data = await this.request('/api/v1/health', undefined, 'Health check');
    return {
      status: data.status as string,
      modelLoaded: data.model_loaded as boolean,
      device: data.device as string,
      modelVersion: data.model_version as string,
    };
  }

  async enhance(contactMap: Float32Array, size: number): Promise<HFEnhancementResult> {
    const data = await this.request(
      '/api/v1/enhance',
      {
        contact_map: encodeContactMap(contactMap),
        map_size: size,
        params: { upscale_factor: this.upscaleFactor },
      },
      'Enhancement',
    );
    const enhancedSize = data.enhanced_size as number;
    return {
      enhancedMap: decodeContactMap(data.enhanced_map as string, enhancedSize),
      enhancedSize,
      upscaleFactor: data.upscale_factor as number,
      modelVersion: data.model_version as string,
      elapsedMs: data.elapsed_ms as number,
    };
  }

  async predictTracks(contactMap: Float32Array, size: number): Promise<HFTrackPredictionResult> {
    const data = await this.request(
      '/api/v1/predict-tracks',
      { contact_map: encodeContactMap(contactMap), map_size: size },
      'Track prediction',
    );
    const rawTracks = data.tracks as Array<{ name: string; values: string; color: string }>;
    return {
      tracks: rawTracks.map((t) => ({
        name: t.name,
        values: decodeFloat32Array(t.values),
        color: t.color,
      })),
      modelVersion: data.model_version as string,
      elapsedMs: data.elapsed_ms as number,
    };
  }

  /** Shared fetch with timeout + uniform error handling. GET when no body. */
  private async request(
    path: string,
    body: Record<string, unknown> | undefined,
    label: string,
  ): Promise<Record<string, any>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(`${this.serverUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new HiCFoundationConnectionError('Request timed out');
      }
      throw new HiCFoundationConnectionError(
        `Connection failed: ${err.message ?? 'fetch failed'}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new HiCFoundationServerError(
        `${label} failed (${response.status}): ${text}`,
        response.status,
      );
    }

    return response.json();
  }
}
