/**
 * Evo2HiCClient — HTTP client for the Evo2HiC resolution enhancement server.
 *
 * Follows the pattern in src/ai/AIClient.ts: direct browser fetch with
 * AbortController-based timeouts.
 */

import { encodeContactMap, decodeContactMap, decodeFloat32Array } from './Evo2HiCEnhancement';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class Evo2HiCServerError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'Evo2HiCServerError';
  }
}

export class Evo2HiCConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Evo2HiCConnectionError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Evo2HiCConfig {
  serverUrl: string;
  /** Upscale factor. Default: 4. */
  upscaleFactor?: number;
  /** Request timeout in milliseconds. Default: 120000. */
  timeout?: number;
}

export interface EnhancementResult {
  enhancedMap: Float32Array;
  enhancedSize: number;
  upscaleFactor: number;
  modelVersion: string;
  elapsedMs: number;
}

export interface HealthStatus {
  status: string;
  modelLoaded: boolean;
  device: string;
  modelVersion: string;
}

export interface EpiTrackPrediction {
  name: string;
  values: Float32Array;
  color: string;
}

export interface TrackPredictionResult {
  tracks: EpiTrackPrediction[];
  modelVersion: string;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'openpretext-evo2hic-url';

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

export class Evo2HiCClient {
  private serverUrl: string;
  private upscaleFactor: number;
  private timeout: number;

  constructor(config: Evo2HiCConfig) {
    this.serverUrl = config.serverUrl.replace(/\/+$/, '');
    this.upscaleFactor = config.upscaleFactor ?? 4;
    this.timeout = config.timeout ?? 120_000;
  }

  async checkHealth(): Promise<HealthStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(`${this.serverUrl}/api/v1/health`, {
        method: 'GET',
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      throw new Evo2HiCConnectionError(
        `Connection failed: ${err.message ?? 'fetch failed'}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Evo2HiCServerError(
        `Health check failed (${response.status}): ${text}`,
        response.status,
      );
    }

    return response.json() as Promise<HealthStatus>;
  }

  async enhance(
    contactMap: Float32Array,
    size: number,
    fastaSequences?: Map<string, string>,
    contigNames?: string[],
  ): Promise<EnhancementResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const payload: Record<string, unknown> = {
      contact_map: encodeContactMap(contactMap),
      map_size: size,
      params: { upscale_factor: this.upscaleFactor },
    };

    if (fastaSequences && fastaSequences.size > 0) {
      const seqObj: Record<string, string> = {};
      fastaSequences.forEach((seq, name) => {
        seqObj[name] = seq;
      });
      payload.fasta_sequences = seqObj;
    }

    if (contigNames) {
      payload.contig_names = contigNames;
    }

    let response: Response;
    try {
      response = await fetch(`${this.serverUrl}/api/v1/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Evo2HiCConnectionError('Request timed out');
      }
      throw new Evo2HiCConnectionError(
        `Connection failed: ${err.message ?? 'fetch failed'}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Evo2HiCServerError(
        `Enhancement failed (${response.status}): ${text}`,
        response.status,
      );
    }

    const data = await response.json();
    const enhancedSize = data.enhanced_size as number;
    const enhancedMap = decodeContactMap(data.enhanced_map as string, enhancedSize);

    return {
      enhancedMap,
      enhancedSize,
      upscaleFactor: data.upscale_factor as number,
      modelVersion: data.model_version as string,
      elapsedMs: data.elapsed_ms as number,
    };
  }

  async predictTracks(
    contactMap: Float32Array,
    size: number,
    fastaSequences?: Map<string, string>,
  ): Promise<TrackPredictionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const payload: Record<string, unknown> = {
      contact_map: encodeContactMap(contactMap),
      map_size: size,
    };

    if (fastaSequences && fastaSequences.size > 0) {
      const seqObj: Record<string, string> = {};
      fastaSequences.forEach((seq, name) => {
        seqObj[name] = seq;
      });
      payload.fasta_sequences = seqObj;
    }

    let response: Response;
    try {
      response = await fetch(`${this.serverUrl}/api/v1/predict-tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Evo2HiCConnectionError('Request timed out');
      }
      throw new Evo2HiCConnectionError(
        `Connection failed: ${err.message ?? 'fetch failed'}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Evo2HiCServerError(
        `Track prediction failed (${response.status}): ${text}`,
        response.status,
      );
    }

    const data = await response.json();
    const rawTracks = data.tracks as Array<{ name: string; values: string; color: string }>;
    const tracks: EpiTrackPrediction[] = rawTracks.map(t => ({
      name: t.name,
      values: decodeFloat32Array(t.values),
      color: t.color,
    }));

    return {
      tracks,
      modelVersion: data.model_version as string,
      elapsedMs: data.elapsed_ms as number,
    };
  }
}
