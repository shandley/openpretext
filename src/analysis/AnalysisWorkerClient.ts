/**
 * AnalysisWorkerClient — Main-thread client for the analysis Web Worker.
 *
 * Provides Promise-based API for running analysis computations in the
 * background. Falls back to synchronous main-thread execution if workers
 * are unavailable (e.g. in test environments or file:// protocol).
 */

import type { InsulationParams, InsulationResult } from './InsulationScore';
import type { ContactDecayParams, ContactDecayResult } from './ContactDecay';
import type { CompartmentParams, CompartmentResult } from './CompartmentAnalysis';
import { computeInsulation } from './InsulationScore';
import { computeContactDecay } from './ContactDecay';
import { computeCompartments } from './CompartmentAnalysis';
import type { ContigRange } from '../curation/AutoSort';
import type {
  AnalysisRequest,
  AnalysisResponse,
  InsulationResponse,
  DecayResponse,
  CompartmentResponse,
} from './AnalysisWorker';

// ---------------------------------------------------------------------------
// Pending request tracking
// ---------------------------------------------------------------------------

type PendingResolve = (value: any) => void;
type PendingReject = (reason: any) => void;

interface PendingRequest {
  resolve: PendingResolve;
  reject: PendingReject;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AnalysisWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private workerFailed = false;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL('./AnalysisWorker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
        this.handleResponse(event.data);
      };
      this.worker.onerror = (err) => {
        console.warn('Analysis worker error, falling back to main thread:', err.message);
        this.workerFailed = true;
        // Reject all pending requests so they can be retried synchronously
        for (const [id, req] of this.pending) {
          req.reject(new Error('Worker failed'));
        }
        this.pending.clear();
      };
    } catch {
      // Workers not available (file:// protocol, test environment, etc.)
      this.workerFailed = true;
    }
  }

  private handleResponse(msg: AnalysisResponse): void {
    const req = this.pending.get(msg.id);
    if (!req) return;
    this.pending.delete(msg.id);

    if (msg.type === 'error') {
      req.reject(new Error(msg.message));
    } else {
      req.resolve(msg);
    }
  }

  private postRequest(request: AnalysisRequest): Promise<AnalysisResponse> {
    return new Promise((resolve, reject) => {
      if (!this.worker || this.workerFailed) {
        reject(new Error('Worker not available'));
        return;
      }
      this.pending.set(request.id, { resolve, reject });
      // Structured clone of contactMap (don't transfer — main thread needs it)
      this.worker.postMessage(request);
    });
  }

  /**
   * Compute insulation score + TAD boundaries in the worker.
   * Falls back to synchronous if worker is unavailable.
   */
  async computeInsulation(
    contactMap: Float32Array,
    size: number,
    params?: Partial<InsulationParams>,
  ): Promise<InsulationResult> {
    if (!this.workerFailed && this.worker) {
      try {
        const id = this.nextId++;
        const resp = await this.postRequest({
          type: 'insulation',
          id,
          contactMap,
          size,
          params,
        }) as InsulationResponse;
        return {
          rawScores: resp.rawScores,
          normalizedScores: resp.normalizedScores,
          boundaries: resp.boundaries,
          boundaryStrengths: resp.boundaryStrengths,
        };
      } catch {
        // Fall through to synchronous
      }
    }
    return computeInsulation(contactMap, size, params);
  }

  /**
   * Compute contact decay P(s) curve in the worker.
   * Falls back to synchronous if worker is unavailable.
   */
  async computeContactDecay(
    contactMap: Float32Array,
    size: number,
    contigRanges: ContigRange[],
    params?: Partial<ContactDecayParams>,
  ): Promise<ContactDecayResult> {
    if (!this.workerFailed && this.worker) {
      try {
        const id = this.nextId++;
        const resp = await this.postRequest({
          type: 'decay',
          id,
          contactMap,
          size,
          contigRanges,
          params,
        }) as DecayResponse;
        return {
          distances: resp.distances,
          meanContacts: resp.meanContacts,
          logDistances: resp.logDistances,
          logContacts: resp.logContacts,
          decayExponent: resp.decayExponent,
          rSquared: resp.rSquared,
          maxDistance: resp.maxDistance,
        };
      } catch {
        // Fall through to synchronous
      }
    }
    return computeContactDecay(contactMap, size, contigRanges, params);
  }

  /**
   * Compute A/B compartments in the worker.
   * Falls back to synchronous if worker is unavailable.
   */
  async computeCompartments(
    contactMap: Float32Array,
    size: number,
    params?: Partial<CompartmentParams>,
  ): Promise<CompartmentResult> {
    if (!this.workerFailed && this.worker) {
      try {
        const id = this.nextId++;
        const resp = await this.postRequest({
          type: 'compartments',
          id,
          contactMap,
          size,
          params,
        }) as CompartmentResponse;
        return {
          eigenvector: resp.eigenvector,
          normalizedEigenvector: resp.normalizedEigenvector,
          iterations: resp.iterations,
          eigenvalue: resp.eigenvalue,
        };
      } catch {
        // Fall through to synchronous
      }
    }
    return computeCompartments(contactMap, size, params);
  }

  /**
   * Terminate the worker. Call when the client is no longer needed.
   */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, req] of this.pending) {
      req.reject(new Error('Worker terminated'));
    }
    this.pending.clear();
  }
}
