/**
 * AnalysisWorker — Background Web Worker for 3D genomics computations.
 *
 * Runs insulation score, contact decay, and compartment analysis off the
 * main thread so the UI stays responsive. Communicates via postMessage.
 *
 * The pure analysis modules have no DOM dependencies, so they run
 * directly in the worker context.
 */

import { computeInsulation, type InsulationParams } from './InsulationScore';
import { computeContactDecay, type ContactDecayParams } from './ContactDecay';
import { computeCompartments, type CompartmentParams } from './CompartmentAnalysis';
import { detectInversions, detectTranslocations, type DetectedPattern } from './PatternDetector';
import type { ContigRange } from '../curation/AutoSort';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface InsulationRequest {
  type: 'insulation';
  id: number;
  contactMap: Float32Array;
  size: number;
  params?: Partial<InsulationParams>;
}

export interface DecayRequest {
  type: 'decay';
  id: number;
  contactMap: Float32Array;
  size: number;
  contigRanges: ContigRange[];
  params?: Partial<ContactDecayParams>;
}

export interface CompartmentRequest {
  type: 'compartments';
  id: number;
  contactMap: Float32Array;
  size: number;
  params?: Partial<CompartmentParams>;
}

export interface PatternRequest {
  type: 'patterns';
  id: number;
  contactMap: Float32Array;
  size: number;
  contigRanges: ContigRange[];
  inversionThreshold?: number;
  translocationThreshold?: number;
}

export type AnalysisRequest = InsulationRequest | DecayRequest | CompartmentRequest | PatternRequest;

export interface InsulationResponse {
  type: 'insulation';
  id: number;
  rawScores: Float64Array;
  normalizedScores: Float32Array;
  boundaries: number[];
  boundaryStrengths: number[];
}

export interface DecayResponse {
  type: 'decay';
  id: number;
  distances: Float64Array;
  meanContacts: Float64Array;
  logDistances: Float64Array;
  logContacts: Float64Array;
  decayExponent: number;
  rSquared: number;
  maxDistance: number;
}

export interface CompartmentResponse {
  type: 'compartments';
  id: number;
  eigenvector: Float32Array;
  normalizedEigenvector: Float32Array;
  iterations: number;
  eigenvalue: number;
}

export interface PatternResponse {
  type: 'patterns';
  id: number;
  patterns: DetectedPattern[];
}

export interface ErrorResponse {
  type: 'error';
  id: number;
  message: string;
}

export type AnalysisResponse =
  | InsulationResponse
  | DecayResponse
  | CompartmentResponse
  | PatternResponse
  | ErrorResponse;

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'insulation': {
        const result = computeInsulation(msg.contactMap, msg.size, msg.params);
        const response: InsulationResponse = {
          type: 'insulation',
          id: msg.id,
          rawScores: result.rawScores,
          normalizedScores: result.normalizedScores,
          boundaries: result.boundaries,
          boundaryStrengths: result.boundaryStrengths,
        };
        // Transfer typed arrays for zero-copy
        self.postMessage(response, [
          response.rawScores.buffer,
          response.normalizedScores.buffer,
        ] as any);
        break;
      }

      case 'decay': {
        const result = computeContactDecay(
          msg.contactMap,
          msg.size,
          msg.contigRanges,
          msg.params,
        );
        const response: DecayResponse = {
          type: 'decay',
          id: msg.id,
          distances: result.distances,
          meanContacts: result.meanContacts,
          logDistances: result.logDistances,
          logContacts: result.logContacts,
          decayExponent: result.decayExponent,
          rSquared: result.rSquared,
          maxDistance: result.maxDistance,
        };
        self.postMessage(response, [
          response.distances.buffer,
          response.meanContacts.buffer,
          response.logDistances.buffer,
          response.logContacts.buffer,
        ] as any);
        break;
      }

      case 'compartments': {
        const result = computeCompartments(msg.contactMap, msg.size, msg.params);
        const response: CompartmentResponse = {
          type: 'compartments',
          id: msg.id,
          eigenvector: result.eigenvector,
          normalizedEigenvector: result.normalizedEigenvector,
          iterations: result.iterations,
          eigenvalue: result.eigenvalue,
        };
        self.postMessage(response, [
          response.eigenvector.buffer,
          response.normalizedEigenvector.buffer,
        ] as any);
        break;
      }

      case 'patterns': {
        const inversions = detectInversions(
          msg.contactMap, msg.size, msg.contigRanges, msg.inversionThreshold,
        );
        const translocations = detectTranslocations(
          msg.contactMap, msg.size, msg.contigRanges, msg.translocationThreshold,
        );
        const response: PatternResponse = {
          type: 'patterns',
          id: msg.id,
          patterns: [...inversions, ...translocations],
        };
        self.postMessage(response);
        break;
      }
    }
  } catch (err) {
    const response: ErrorResponse = {
      type: 'error',
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
