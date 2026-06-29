/**
 * TileDecodeWorker — background BC4 tile decoder.
 *
 * Decoding fine-detail tiles on the main thread blocks the frame and makes
 * pan/zoom jittery. This worker owns the raw BC4 tile bytes (transferred from
 * the main thread on load) and decodes requested tiles off the main thread,
 * transferring the decoded Float32Array back zero-copy.
 *
 * Cancellation uses a monotonically increasing `generation` counter. A decode
 * task yields between small chunks (via setTimeout) so a newer request can
 * supersede it: the task stops as soon as its generation is no longer current.
 */

import { decodeTile } from './TileDecoder';
import { assembleOverview, type OverviewMode } from '../formats/PretextParser';
import type { TileKey } from './TileManager';
import type { PretextHeader } from '../formats/PretextParser';

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

/** main → worker: hand over raw tile bytes for a freshly loaded map. */
export interface TileInitMessage {
  type: 'init';
  rawTiles: Uint8Array[];
  header: PretextHeader;
}

/** main → worker: decode these tiles at the given generation. */
export interface TileDecodeMessage {
  type: 'decode';
  keys: TileKey[];
  generation: number;
}

/** main → worker: abandon any in-flight decode up to this generation. */
export interface TileCancelMessage {
  type: 'cancel';
  generation: number;
}

/**
 * main → worker: assemble an overview from the worker-owned tiles. The worker
 * holds the only live copy of the raw tile bytes (they were transferred here on
 * init), so overview re-assembly for 'faithful' mode must happen here.
 */
export interface TileAssembleOverviewMessage {
  type: 'assembleOverview';
  mode: OverviewMode;
  requestId: number;
}

export type TileWorkerRequest =
  | TileInitMessage
  | TileDecodeMessage
  | TileCancelMessage
  | TileAssembleOverviewMessage;

/** worker → main: a single tile finished decoding. `data.buffer` is transferred. */
export interface TileDecodedMessage {
  type: 'decoded';
  key: TileKey;
  data: Float32Array;
  generation: number;
}

/** worker → main: all tiles for a generation finished (or were superseded). */
export interface TileBatchCompleteMessage {
  type: 'batchComplete';
  generation: number;
}

/** worker → main: a requested overview finished assembling. `overview.buffer` is transferred. */
export interface TileOverviewAssembledMessage {
  type: 'overviewAssembled';
  requestId: number;
  overview: Float32Array;
  overviewSize: number;
}

export type TileWorkerResponse =
  | TileDecodedMessage
  | TileBatchCompleteMessage
  | TileOverviewAssembledMessage;

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

/** Tiles to decode per chunk before yielding to check for newer requests. */
const CHUNK_SIZE = 2;

let rawTiles: Uint8Array[] | null = null;
let header: PretextHeader | null = null;
/** The highest generation seen; a task is stale once its gen is below this. */
let currentGeneration = 0;

function runDecode(keys: TileKey[], generation: number): void {
  if (!rawTiles || !header) {
    postBatchComplete(generation);
    return;
  }

  let index = 0;

  const step = (): void => {
    // Superseded by a newer decode/cancel request — abandon quietly.
    if (generation !== currentGeneration) {
      postBatchComplete(generation);
      return;
    }

    const end = Math.min(index + CHUNK_SIZE, keys.length);
    for (; index < end; index++) {
      const key = keys[index];
      const data = decodeTile(key, rawTiles!, header!);
      const msg: TileDecodedMessage = { type: 'decoded', key, data, generation };
      // Transfer the decoded buffer to the main thread (zero-copy).
      (self as unknown as Worker).postMessage(msg, [data.buffer]);
    }

    if (index < keys.length) {
      setTimeout(step, 0);
    } else {
      postBatchComplete(generation);
    }
  };

  step();
}

function postBatchComplete(generation: number): void {
  const msg: TileBatchCompleteMessage = { type: 'batchComplete', generation };
  (self as unknown as Worker).postMessage(msg);
}

self.onmessage = (event: MessageEvent<TileWorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      rawTiles = msg.rawTiles;
      header = msg.header;
      currentGeneration = 0;
      break;
    case 'cancel':
      // Bump the generation so any in-flight task sees itself as stale.
      if (msg.generation > currentGeneration) currentGeneration = msg.generation;
      break;
    case 'decode':
      currentGeneration = msg.generation;
      runDecode(msg.keys, msg.generation);
      break;
    case 'assembleOverview': {
      const w = self as unknown as Worker;
      if (!rawTiles || !header) {
        w.postMessage({ type: 'overviewAssembled', requestId: msg.requestId, overview: new Float32Array(0), overviewSize: 0 } as TileOverviewAssembledMessage);
        break;
      }
      const { overview, overviewSize } = assembleOverview(rawTiles, header, msg.mode);
      const resp: TileOverviewAssembledMessage = { type: 'overviewAssembled', requestId: msg.requestId, overview, overviewSize };
      w.postMessage(resp, [overview.buffer]);
      break;
    }
  }
};
