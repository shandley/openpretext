/**
 * Session save/load system for OpenPretext.
 *
 * Allows users to save their curation progress (contig ordering, inversions,
 * scaffold assignments, waypoints, camera position, settings) to a JSON file
 * and reload it later. The session file captures a complete snapshot of the
 * working state without including the raw contact map data itself.
 *
 * Design principles:
 * - The session manager never modifies application state directly; it returns
 *   typed data that the caller (e.g. main.ts) applies.
 * - All imported data is validated defensively — loaded JSON is never trusted.
 * - No external dependencies.
 */

import type { AppState, ContigInfo, CurationOperation } from '../core/State';
import type { ScaffoldManager, Scaffold } from '../curation/ScaffoldManager';

// ---------------------------------------------------------------------------
// Session data types
// ---------------------------------------------------------------------------

/** Current session format version. Increment on breaking changes. */
export const SESSION_VERSION = 1;

/**
 * A waypoint bookmark in the contact map.
 */
export interface SessionWaypoint {
  id: number;
  mapX: number;
  mapY: number;
  label: string;
  color: string;
}

/**
 * Per-contig state overrides stored in the session.
 */
export interface ContigStateOverride {
  inverted: boolean;
  scaffoldId: number | null;
}

/**
 * Camera position snapshot.
 */
export interface SessionCamera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * User-configurable settings snapshot.
 */
export interface SessionSettings {
  colorMapName: string;
  gamma: number;
  showGrid: boolean;
}

/**
 * A recorded curation operation for the operation log.
 */
export interface SessionOperationLogEntry {
  type: string;
  timestamp: number;
  description: string;
}

/**
 * Scaffold definition as stored in the session file.
 */
export interface SessionScaffold {
  id: number;
  name: string;
  color: string;
}

/**
 * Serialized insulation score result (typed arrays → number[]).
 */
export interface SessionInsulation {
  rawScores: number[];
  normalizedScores: number[];
  boundaries: number[];
  boundaryStrengths: number[];
}

/**
 * Serialized P(s) contact decay result.
 */
export interface SessionDecay {
  distances: number[];
  meanContacts: number[];
  logDistances: number[];
  logContacts: number[];
  decayExponent: number;
  rSquared: number;
  maxDistance: number;
}

/**
 * Serialized compartment analysis result.
 */
export interface SessionCompartments {
  eigenvector: number[];
  normalizedEigenvector: number[];
  iterations: number;
  eigenvalue: number;
}

/**
 * Serialized per-scaffold decay result.
 */
export interface SessionScaffoldDecay {
  scaffoldId: number;
  scaffoldName: string;
  color: string;
  decay: SessionDecay;
  contigCount: number;
}

/**
 * Serialized ICE normalization result (bias only — matrix re-derived on restore).
 */
export interface SessionICE {
  biasVector: number[];
  maskedBins: number[];
  iterations: number;
  maxDeviation: number;
}

/**
 * Serialized directionality index result.
 */
export interface SessionDirectionality {
  diScores: number[];
  normalizedScores: number[];
  boundaries: number[];
  strengths: number[];
}

/**
 * Serialized Hi-C quality metrics result.
 */
export interface SessionQuality {
  cisTransRatio: number;
  cisPercentage: number;
  longShortRatio: number;
  contactDensity: number;
  perContigCisRatio: number[];
  perScaffoldCis: Array<{
    scaffoldId: number;
    name: string;
    cisRatio: number;
    contactCount: number;
  }>;
  flaggedContigs: number[];
}

/**
 * Serialized saddle plot result.
 */
export interface SessionSaddle {
  saddleMatrix: number[];
  nBins: number;
  strength: number;
  strengthProfile: number[];
  binEdges: number[];
}

/**
 * Persisted analysis state for session save/restore.
 */
export interface SessionAnalysisData {
  insulationWindowSize: number;
  insulation?: SessionInsulation;
  decay?: SessionDecay;
  baselineDecay?: SessionDecay;
  compartments?: SessionCompartments;
  scaffoldDecay?: SessionScaffoldDecay[];
  ice?: SessionICE;
  kr?: SessionICE;
  directionality?: SessionDirectionality;
  quality?: SessionQuality;
  saddle?: SessionSaddle;
}

/**
 * Complete session data structure.
 *
 * This is the top-level object serialized to/from JSON.
 */
export interface SessionData {
  version: number;
  filename: string;
  timestamp: number;
  contigOrder: number[];
  contigStates: { [contigId: number]: ContigStateOverride };
  scaffolds: SessionScaffold[];
  waypoints: SessionWaypoint[];
  camera: SessionCamera;
  settings: SessionSettings;
  operationLog: SessionOperationLogEntry[];
  /** Optional persisted analysis results (added post-v1, backward compatible). */
  analysis?: SessionAnalysisData;
}

/**
 * Optional waypoint manager interface.
 * Decoupled so the session system does not depend on a concrete implementation.
 */
export interface WaypointManagerLike {
  getAllWaypoints(): SessionWaypoint[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Type guard: returns true if the value is a plain object (not null, not array).
 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Type guard: returns true if the value is a finite number.
 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Type guard: returns true if the value is a non-empty string.
 */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Type guard: returns true if the value is an array of finite numbers.
 */
function isFiniteNumberArray(v: unknown): v is number[] {
  if (!Array.isArray(v)) return false;
  for (const item of v) {
    if (!isFiniteNumber(item)) return false;
  }
  return true;
}

/**
 * Validate a SessionDecay sub-object.
 */
function validateSessionDecay(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (!isFiniteNumberArray(v.distances)) return false;
  if (!isFiniteNumberArray(v.meanContacts)) return false;
  if (!isFiniteNumberArray(v.logDistances)) return false;
  if (!isFiniteNumberArray(v.logContacts)) return false;
  if (!isFiniteNumber(v.decayExponent)) return false;
  if (!isFiniteNumber(v.rSquared)) return false;
  if (!isFiniteNumber(v.maxDistance)) return false;
  return true;
}

/**
 * Validate the optional analysis field on SessionData.
 */
function validateSessionAnalysis(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (!isFiniteNumber(v.insulationWindowSize)) return false;

  // Optional insulation
  if (v.insulation !== undefined) {
    if (!isObject(v.insulation)) return false;
    if (!isFiniteNumberArray(v.insulation.rawScores)) return false;
    if (!isFiniteNumberArray(v.insulation.normalizedScores)) return false;
    if (!isFiniteNumberArray(v.insulation.boundaries)) return false;
    if (!isFiniteNumberArray(v.insulation.boundaryStrengths)) return false;
  }

  // Optional decay
  if (v.decay !== undefined && !validateSessionDecay(v.decay)) return false;

  // Optional baseline decay
  if (v.baselineDecay !== undefined && !validateSessionDecay(v.baselineDecay)) return false;

  // Optional compartments
  if (v.compartments !== undefined) {
    if (!isObject(v.compartments)) return false;
    if (!isFiniteNumberArray(v.compartments.eigenvector)) return false;
    if (!isFiniteNumberArray(v.compartments.normalizedEigenvector)) return false;
    if (!isFiniteNumber(v.compartments.iterations)) return false;
    if (!isFiniteNumber(v.compartments.eigenvalue)) return false;
  }

  // Optional per-scaffold decay
  if (v.scaffoldDecay !== undefined) {
    if (!Array.isArray(v.scaffoldDecay)) return false;
    for (const sd of v.scaffoldDecay) {
      if (!isObject(sd)) return false;
      if (!Number.isInteger(sd.scaffoldId)) return false;
      if (!isNonEmptyString(sd.scaffoldName)) return false;
      if (!isNonEmptyString(sd.color)) return false;
      if (!validateSessionDecay(sd.decay)) return false;
      if (!Number.isInteger(sd.contigCount) || (sd.contigCount as number) < 0) return false;
    }
  }

  // Optional ICE normalization
  if (v.ice !== undefined) {
    if (!isObject(v.ice)) return false;
    if (!isFiniteNumberArray(v.ice.biasVector)) return false;
    if (!Array.isArray(v.ice.maskedBins)) return false;
    for (const b of v.ice.maskedBins as unknown[]) {
      if (!Number.isInteger(b) || (b as number) < 0) return false;
    }
    if (!isFiniteNumber(v.ice.iterations)) return false;
    if (!isFiniteNumber(v.ice.maxDeviation)) return false;
  }

  // Optional KR normalization (same shape as ICE)
  if (v.kr !== undefined) {
    if (!isObject(v.kr)) return false;
    if (!isFiniteNumberArray(v.kr.biasVector)) return false;
    if (!Array.isArray(v.kr.maskedBins)) return false;
    for (const b of v.kr.maskedBins as unknown[]) {
      if (!Number.isInteger(b) || (b as number) < 0) return false;
    }
    if (!isFiniteNumber(v.kr.iterations)) return false;
    if (!isFiniteNumber(v.kr.maxDeviation)) return false;
  }

  // Optional directionality index
  if (v.directionality !== undefined) {
    if (!isObject(v.directionality)) return false;
    if (!isFiniteNumberArray(v.directionality.diScores)) return false;
    if (!isFiniteNumberArray(v.directionality.normalizedScores)) return false;
    if (!isFiniteNumberArray(v.directionality.boundaries)) return false;
    if (!isFiniteNumberArray(v.directionality.strengths)) return false;
  }

  // Optional quality metrics
  if (v.quality !== undefined) {
    if (!isObject(v.quality)) return false;
    if (!isFiniteNumber(v.quality.cisTransRatio)) return false;
    if (!isFiniteNumber(v.quality.cisPercentage)) return false;
    if (!isFiniteNumber(v.quality.longShortRatio)) return false;
    if (!isFiniteNumber(v.quality.contactDensity)) return false;
    if (!isFiniteNumberArray(v.quality.perContigCisRatio)) return false;
    if (!Array.isArray(v.quality.perScaffoldCis)) return false;
    for (const psc of v.quality.perScaffoldCis as unknown[]) {
      if (!isObject(psc)) return false;
      if (!Number.isInteger((psc as Record<string, unknown>).scaffoldId)) return false;
      if (typeof (psc as Record<string, unknown>).name !== 'string') return false;
      if (!isFiniteNumber((psc as Record<string, unknown>).cisRatio)) return false;
      if (!isFiniteNumber((psc as Record<string, unknown>).contactCount)) return false;
    }
    if (!isFiniteNumberArray(v.quality.flaggedContigs)) return false;
  }

  // Optional saddle plot
  if (v.saddle !== undefined) {
    if (!isObject(v.saddle)) return false;
    if (!isFiniteNumberArray(v.saddle.saddleMatrix)) return false;
    if (!Number.isInteger(v.saddle.nBins) || (v.saddle.nBins as number) < 0) return false;
    if (!isFiniteNumber(v.saddle.strength)) return false;
    if (!isFiniteNumberArray(v.saddle.strengthProfile)) return false;
    if (!isFiniteNumberArray(v.saddle.binEdges)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Build a SessionData object from the current application state.
 *
 * @param appState         - The current application state
 * @param scaffoldManager  - The scaffold manager instance
 * @param waypointManager  - Optional waypoint manager
 * @returns A fully populated SessionData object ready for serialization
 */
export function exportSession(
  appState: AppState,
  scaffoldManager: ScaffoldManager,
  waypointManager?: WaypointManagerLike
): SessionData {
  const filename = appState.map?.filename ?? 'unknown.pretext';

  // Build per-contig state overrides
  const contigStates: { [contigId: number]: ContigStateOverride } = {};
  const contigs: ContigInfo[] = appState.map?.contigs ?? [];
  for (let i = 0; i < contigs.length; i++) {
    contigStates[i] = {
      inverted: contigs[i].inverted,
      scaffoldId: contigs[i].scaffoldId,
    };
  }

  // Scaffold definitions
  const scaffolds: SessionScaffold[] = scaffoldManager.getAllScaffolds().map(
    (s: Scaffold) => ({
      id: s.id,
      name: s.name,
      color: s.color,
    })
  );

  // Waypoints
  const waypoints: SessionWaypoint[] = waypointManager
    ? waypointManager.getAllWaypoints()
    : [];

  // Operation log (lightweight summary — no undo data)
  const operationLog: SessionOperationLogEntry[] = appState.undoStack.map(
    (op: CurationOperation) => ({
      type: op.type,
      timestamp: op.timestamp,
      description: op.description,
    })
  );

  return {
    version: SESSION_VERSION,
    filename,
    timestamp: Date.now(),
    contigOrder: [...appState.contigOrder],
    contigStates,
    scaffolds,
    waypoints,
    camera: { ...appState.camera },
    settings: {
      colorMapName: appState.colorMapName,
      gamma: appState.gamma,
      showGrid: appState.showGrid,
    },
    operationLog,
  };
}

/**
 * Parse a JSON string into a validated SessionData object.
 *
 * @param json - The raw JSON string to parse
 * @returns A validated SessionData object
 * @throws Error if the JSON is invalid or the data fails validation
 */
export function importSession(json: string): SessionData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Session import failed: invalid JSON');
  }

  if (!validateSession(parsed)) {
    throw new Error('Session import failed: data did not pass validation');
  }

  return parsed;
}

/**
 * Trigger a browser download of the session data as a JSON file.
 *
 * The filename follows the pattern: `{original_filename}_session_{date}.json`
 *
 * @param sessionData - The session data to download
 */
export function downloadSession(sessionData: SessionData): void {
  const content = JSON.stringify(sessionData, null, 2);
  const dateStr = formatDateForFilename(new Date(sessionData.timestamp));
  const baseName = sessionData.filename.replace(/\.pretext$/i, '');
  const downloadFilename = `${baseName}_session_${dateStr}.json`;

  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Validate that an unknown value conforms to the SessionData structure.
 *
 * Performs thorough structural and type checking without trusting any input.
 *
 * @param data - The unknown value to validate
 * @returns True if the data is a valid SessionData object
 */
export function validateSession(data: unknown): data is SessionData {
  if (!isObject(data)) return false;

  // -- version --
  if (data.version !== SESSION_VERSION) return false;

  // -- filename --
  if (typeof data.filename !== 'string') return false;

  // -- timestamp --
  if (!isFiniteNumber(data.timestamp) || data.timestamp < 0) return false;

  // -- contigOrder --
  if (!Array.isArray(data.contigOrder)) return false;
  for (const v of data.contigOrder) {
    if (!Number.isInteger(v) || v < 0) return false;
  }

  // -- contigStates --
  if (!isObject(data.contigStates)) return false;
  for (const [key, value] of Object.entries(data.contigStates)) {
    // Keys must be non-negative integer strings
    const numKey = Number(key);
    if (!Number.isInteger(numKey) || numKey < 0) return false;
    if (!isObject(value)) return false;
    if (typeof value.inverted !== 'boolean') return false;
    if (value.scaffoldId !== null && !Number.isInteger(value.scaffoldId)) {
      return false;
    }
  }

  // -- scaffolds --
  if (!Array.isArray(data.scaffolds)) return false;
  for (const s of data.scaffolds) {
    if (!isObject(s)) return false;
    if (!Number.isInteger(s.id) || (s.id as number) < 0) return false;
    if (typeof s.name !== 'string') return false;
    if (typeof s.color !== 'string') return false;
  }

  // -- waypoints --
  if (!Array.isArray(data.waypoints)) return false;
  for (const w of data.waypoints) {
    if (!isObject(w)) return false;
    if (!Number.isInteger(w.id)) return false;
    if (!isFiniteNumber(w.mapX)) return false;
    if (!isFiniteNumber(w.mapY)) return false;
    if (typeof w.label !== 'string') return false;
    if (typeof w.color !== 'string') return false;
  }

  // -- camera --
  if (!isObject(data.camera)) return false;
  if (!isFiniteNumber(data.camera.x)) return false;
  if (!isFiniteNumber(data.camera.y)) return false;
  if (!isFiniteNumber(data.camera.zoom)) return false;

  // -- settings --
  if (!isObject(data.settings)) return false;
  if (typeof data.settings.colorMapName !== 'string') return false;
  if (!isFiniteNumber(data.settings.gamma)) return false;
  if (typeof data.settings.showGrid !== 'boolean') return false;

  // -- operationLog --
  if (!Array.isArray(data.operationLog)) return false;
  for (const entry of data.operationLog) {
    if (!isObject(entry)) return false;
    if (typeof entry.type !== 'string') return false;
    if (!isFiniteNumber(entry.timestamp) || (entry.timestamp as number) < 0) {
      return false;
    }
    if (typeof entry.description !== 'string') return false;
  }

  // -- analysis (optional, backward compatible) --
  if (data.analysis !== undefined) {
    if (!validateSessionAnalysis(data.analysis)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as a compact string suitable for filenames: YYYYMMDD_HHmmss.
 */
export function formatDateForFilename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${h}${min}${s}`;
}

/**
 * Build the default download filename for a session.
 *
 * @param originalFilename - The original .pretext filename
 * @param timestamp        - The session timestamp (epoch ms)
 * @returns A filename string
 */
export function buildSessionFilename(
  originalFilename: string,
  timestamp: number
): string {
  const dateStr = formatDateForFilename(new Date(timestamp));
  const baseName = originalFilename.replace(/\.pretext$/i, '');
  return `${baseName}_session_${dateStr}.json`;
}
