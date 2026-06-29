/**
 * TileDecodeWorkerClient — main-thread client for the tile decode worker.
 *
 * Owns the lifecycle of a TileDecodeWorker and routes decoded tiles back to a
 * callback (typically TileManager.loadTile). Falls back to synchronous,
 * main-thread decoding when Web Workers are unavailable (test environments,
 * file:// protocol).
 *
 * Cancellation/staleness is tracked with a `generation` counter shared with the
 * worker: every new source or decode request bumps the generation, and decoded
 * tiles tagged with an older generation are dropped.
 */

import { decodeTileBatch } from './TileDecoder';
import { assembleOverview as assembleOverviewSync, type OverviewMode } from '../formats/PretextParser';
import type { TileKey } from './TileManager';
import type { PretextHeader } from '../formats/PretextParser';
import type { TileWorkerResponse } from './TileDecodeWorker';

export interface AssembledOverview { overview: Float32Array; overviewSize: number }

export type TileDecodedCallback = (key: TileKey, data: Float32Array) => void;

export class TileDecodeWorkerClient {
  private worker: Worker | null = null;
  private usingWorker = false;
  /** Set if the worker created successfully but later errored at runtime. */
  private workerDead = false;

  /** Retained ONLY for the synchronous fallback (no worker available). */
  private rawTiles: Uint8Array[] | null = null;
  private header: PretextHeader | null = null;

  private generation = 0;
  private onDecoded: TileDecodedCallback | null = null;
  private cancelSync: (() => void) | null = null;

  /** Pending assembleOverview() requests, keyed by request id. */
  private overviewReqId = 0;
  private pendingOverview = new Map<number, (r: AssembledOverview) => void>();

  constructor() {
    this.tryInitWorker();
  }

  private tryInitWorker(): void {
    try {
      this.worker = new Worker(
        new URL('./TileDecodeWorker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (event: MessageEvent<TileWorkerResponse>) => {
        this.handleResponse(event.data);
      };
      this.worker.onerror = (err) => {
        console.warn('Tile decode worker error; detail tiles disabled:', err.message);
        this.workerDead = true;
      };
      this.usingWorker = true;
    } catch {
      // Workers unavailable — use the synchronous fallback path.
      this.usingWorker = false;
    }
  }

  /** Register the callback invoked for each decoded tile. */
  setOnDecoded(cb: TileDecodedCallback): void {
    this.onDecoded = cb;
  }

  /**
   * Provide the raw tile bytes for a newly loaded map.
   *
   * When a worker is available the buffers are transferred to it (the main
   * thread no longer needs them); otherwise they are retained for synchronous
   * decoding.
   */
  setSource(rawTiles: Uint8Array[], header: PretextHeader): void {
    this.cancel();
    this.header = header;

    if (this.usingWorker && this.worker && !this.workerDead) {
      // Dedupe underlying buffers in case multiple tiles share one (transfer
      // lists reject duplicate buffers).
      const buffers = Array.from(new Set(rawTiles.map((t) => t.buffer)));
      this.worker.postMessage({ type: 'init', rawTiles, header }, buffers);
      this.rawTiles = null; // bytes now owned by the worker
    } else {
      this.rawTiles = rawTiles;
    }
  }

  /**
   * Request decoding of the given tiles. Any previously in-flight request is
   * superseded.
   */
  decode(keys: TileKey[]): void {
    if (keys.length === 0) return;
    this.generation++;
    const gen = this.generation;

    if (this.usingWorker && this.worker && !this.workerDead) {
      this.worker.postMessage({ type: 'decode', keys, generation: gen });
      return;
    }

    // Synchronous fallback (no worker). Chunked across frames to limit jank.
    if (!this.rawTiles || !this.header) return;
    if (this.cancelSync) this.cancelSync();
    this.cancelSync = decodeTileBatch(
      keys,
      this.rawTiles,
      this.header,
      (key, data) => {
        if (gen === this.generation) this.onDecoded?.(key, data);
      },
      () => {
        this.cancelSync = null;
      },
    );
  }

  /**
   * Assemble an overview from the worker-owned tiles (used for 'faithful' mode,
   * which max-pools a finer mip than the load-time clean overview). The worker
   * holds the only live copy of the raw bytes (transferred on setSource), so the
   * compute must happen there; resolves with the overview in original order.
   * Resolves with an empty overview if no tiles are available.
   */
  assembleOverview(mode: OverviewMode): Promise<AssembledOverview> {
    if (this.usingWorker && this.worker && !this.workerDead) {
      return new Promise((resolve) => {
        const requestId = ++this.overviewReqId;
        this.pendingOverview.set(requestId, resolve);
        this.worker!.postMessage({ type: 'assembleOverview', mode, requestId });
      });
    }
    // Synchronous fallback (no worker) — tiles are retained on the main thread.
    if (this.rawTiles && this.header) {
      return Promise.resolve(assembleOverviewSync(this.rawTiles, this.header, mode));
    }
    return Promise.resolve({ overview: new Float32Array(0), overviewSize: 0 });
  }

  /** Abandon any in-flight decode. */
  cancel(): void {
    this.generation++;
    if (this.usingWorker && this.worker && !this.workerDead) {
      this.worker.postMessage({ type: 'cancel', generation: this.generation });
    }
    if (this.cancelSync) {
      this.cancelSync();
      this.cancelSync = null;
    }
  }

  /** Terminate the worker and release references. */
  dispose(): void {
    this.cancel();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.usingWorker = false;
    this.rawTiles = null;
    this.header = null;
    this.onDecoded = null;
    this.pendingOverview.clear();
  }

  private handleResponse(msg: TileWorkerResponse): void {
    if (msg.type === 'overviewAssembled') {
      const resolve = this.pendingOverview.get(msg.requestId);
      if (resolve) {
        this.pendingOverview.delete(msg.requestId);
        resolve({ overview: msg.overview, overviewSize: msg.overviewSize });
      }
      return;
    }
    if (msg.type !== 'decoded') return;
    // Drop tiles from a superseded request.
    if (msg.generation !== this.generation) return;
    this.onDecoded?.(msg.key, msg.data);
  }
}
