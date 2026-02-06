/**
 * Curation log for provenance tracking and reproducibility.
 *
 * Records all curation operations as a structured JSON log, enabling:
 * - Full audit trail of every operation performed
 * - Replay of a curation session against a fresh state
 * - Export/import of curation logs for collaboration
 * - Comparison between different curation approaches
 *
 * Each log entry captures a before/after snapshot of the contig order
 * and orientations so that the effect of each operation is clear.
 */

import type { AppState, ContigInfo, CurationOperation } from '../core/State';

/**
 * Minimal snapshot of the assembly state for before/after comparison.
 * Intentionally lightweight: only the data that curation operations change.
 */
export interface StateSnapshot {
  /** Ordered list of contig indices */
  contigOrder: number[];
  /** For each contig index in contigOrder: name, inverted, scaffoldId */
  contigStates: Array<{
    index: number;
    name: string;
    inverted: boolean;
    scaffoldId: number | null;
  }>;
}

/**
 * A single entry in the curation log.
 */
export interface CurationLogEntry {
  /** Sequential entry number (0-based) */
  sequence: number;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** The operation type */
  operationType: CurationOperation['type'];
  /** Human-readable description */
  description: string;
  /** Operation-specific parameters */
  parameters: Record<string, any>;
  /** State snapshot before the operation */
  before: StateSnapshot;
  /** State snapshot after the operation */
  after: StateSnapshot;
}

/**
 * The full curation log document, serialized to JSON.
 */
export interface CurationLogDocument {
  /** Format version for forward compatibility */
  version: string;
  /** Original source filename */
  sourceFile: string;
  /** When this log was created */
  createdAt: string;
  /** When this log was last modified */
  lastModifiedAt: string;
  /** Tool identifier */
  tool: string;
  /** Total number of contigs in the assembly */
  totalContigs: number;
  /** The log entries */
  entries: CurationLogEntry[];
}

/**
 * Takes a snapshot of the current assembly state relevant to curation.
 */
export function takeSnapshot(appState: AppState): StateSnapshot {
  const contigs = appState.map?.contigs ?? [];
  const contigOrder = [...appState.contigOrder];

  return {
    contigOrder,
    contigStates: contigOrder.map((idx) => {
      const contig = contigs[idx];
      return {
        index: idx,
        name: contig?.name ?? `contig_${idx}`,
        inverted: contig?.inverted ?? false,
        scaffoldId: contig?.scaffoldId ?? null,
      };
    }),
  };
}

/**
 * Manages curation operation logging for provenance and reproducibility.
 */
export class CurationLog {
  private entries: CurationLogEntry[] = [];
  private sourceFile: string = '';
  private createdAt: string;
  private totalContigs: number = 0;

  constructor() {
    this.createdAt = new Date().toISOString();
  }

  /**
   * Initialize the log with the source assembly file info.
   */
  initialize(appState: AppState): void {
    this.sourceFile = appState.map?.filename ?? 'unknown';
    this.totalContigs = appState.map?.contigs.length ?? 0;
    this.entries = [];
    this.createdAt = new Date().toISOString();
  }

  /**
   * Record a curation operation.
   *
   * @param operation - The curation operation that was performed
   * @param before    - State snapshot taken before the operation
   * @param after     - State snapshot taken after the operation
   */
  record(
    operation: CurationOperation,
    before: StateSnapshot,
    after: StateSnapshot
  ): CurationLogEntry {
    const entry: CurationLogEntry = {
      sequence: this.entries.length,
      timestamp: new Date(operation.timestamp).toISOString(),
      operationType: operation.type,
      description: operation.description,
      parameters: { ...operation.data },
      before,
      after,
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Get the number of recorded operations.
   */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Get all entries (read-only copy).
   */
  getEntries(): ReadonlyArray<CurationLogEntry> {
    return [...this.entries];
  }

  /**
   * Get a specific entry by sequence number.
   */
  getEntry(sequence: number): CurationLogEntry | undefined {
    return this.entries[sequence];
  }

  /**
   * Remove the last N entries (for undo support).
   */
  removeLast(count: number = 1): CurationLogEntry[] {
    return this.entries.splice(-count, count);
  }

  /**
   * Clear all log entries.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Export the full log as a JSON document.
   */
  exportJSON(): CurationLogDocument {
    return {
      version: '1.0.0',
      sourceFile: this.sourceFile,
      createdAt: this.createdAt,
      lastModifiedAt: new Date().toISOString(),
      tool: 'OpenPretext',
      totalContigs: this.totalContigs,
      entries: this.entries.map((e) => ({ ...e })),
    };
  }

  /**
   * Serialize the log to a JSON string.
   */
  toJSON(pretty: boolean = true): string {
    const doc = this.exportJSON();
    return pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc);
  }

  /**
   * Import a previously exported log document.
   */
  static fromJSON(json: string): CurationLog {
    const doc: CurationLogDocument = JSON.parse(json);

    if (!doc.version) {
      throw new Error('Invalid curation log: missing version field');
    }
    if (!Array.isArray(doc.entries)) {
      throw new Error('Invalid curation log: missing entries array');
    }

    const log = new CurationLog();
    log.sourceFile = doc.sourceFile;
    log.createdAt = doc.createdAt;
    log.totalContigs = doc.totalContigs;
    log.entries = doc.entries.map((e, i) => ({
      ...e,
      sequence: i,
    }));

    return log;
  }

  /**
   * Trigger a browser download of the curation log as JSON.
   */
  download(filename?: string): void {
    const content = this.toJSON();
    const defaultFilename = this.sourceFile
      ? this.sourceFile.replace(/\.pretext$/i, '_curation_log.json')
      : 'curation_log.json';

    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/**
 * Callback type for applying a curation operation during replay.
 * The callback receives the operation details and should mutate the state accordingly.
 * It returns the new AppState after the operation is applied.
 */
export type ReplayOperationHandler = (
  state: AppState,
  entry: CurationLogEntry
) => AppState;

/**
 * Replays a curation log against a fresh (or provided) AppState.
 *
 * This is critical for reproducibility: given the same initial state and
 * the same log, the replay must produce the same final state.
 *
 * @param log            - The curation log to replay
 * @param initialState   - The starting state to replay against
 * @param applyOperation - Callback that applies each operation to the state
 * @returns The final state after all operations have been replayed, plus
 *          a list of validation results for each step
 */
export function replayLog(
  log: CurationLog,
  initialState: AppState,
  applyOperation: ReplayOperationHandler
): {
  finalState: AppState;
  validationResults: Array<{
    sequence: number;
    operationType: string;
    expectedAfter: StateSnapshot;
    actualAfter: StateSnapshot;
    matches: boolean;
  }>;
} {
  let currentState = { ...initialState };
  const validationResults: Array<{
    sequence: number;
    operationType: string;
    expectedAfter: StateSnapshot;
    actualAfter: StateSnapshot;
    matches: boolean;
  }> = [];

  for (const entry of log.getEntries()) {
    // Apply the operation
    currentState = applyOperation(currentState, entry);

    // Take a snapshot of the actual result
    const actualAfter = takeSnapshot(currentState);

    // Compare with the expected result from the log
    const matches = snapshotsMatch(entry.after, actualAfter);

    validationResults.push({
      sequence: entry.sequence,
      operationType: entry.operationType,
      expectedAfter: entry.after,
      actualAfter,
      matches,
    });
  }

  return { finalState: currentState, validationResults };
}

/**
 * Compares two state snapshots for equality.
 */
export function snapshotsMatch(a: StateSnapshot, b: StateSnapshot): boolean {
  if (a.contigOrder.length !== b.contigOrder.length) {
    return false;
  }

  for (let i = 0; i < a.contigOrder.length; i++) {
    if (a.contigOrder[i] !== b.contigOrder[i]) {
      return false;
    }
  }

  if (a.contigStates.length !== b.contigStates.length) {
    return false;
  }

  for (let i = 0; i < a.contigStates.length; i++) {
    const sa = a.contigStates[i];
    const sb = b.contigStates[i];
    if (
      sa.index !== sb.index ||
      sa.name !== sb.name ||
      sa.inverted !== sb.inverted ||
      sa.scaffoldId !== sb.scaffoldId
    ) {
      return false;
    }
  }

  return true;
}
