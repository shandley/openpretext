/**
 * Application state management with undo/redo support.
 *
 * The state tracks:
 * - Loaded contact map data
 * - Current contig ordering and orientations
 * - Scaffold assignments
 * - Curation history
 * - UI state (mode, camera, visibility toggles)
 */

import type { PretextHeader } from '../formats/PretextParser';

/**
 * Soft target for the number of operations retained in the undo stack.
 *
 * The stack is trimmed from the front (oldest first) so memory does not grow
 * without bound over a long session. The dominant per-operation cost is the
 * `previousOrder` snapshot carried by cut/join/move, one number per contig:
 * measured at ~10 KB per operation on a 1245-contig assembly and ~39 KB on a
 * 5000-contig one, so this depth costs roughly 10 MB and 39 MB respectively.
 *
 * Two rules make the cap safe for the reversibility guarantee, and both mean
 * the stack can legitimately hold MORE than this many operations:
 *
 * 1. Trimming never splits a batch. A batched action (auto-sort, auto-cut, a
 *    script run) is undone as a unit by `undoBatch`, which pops while the top
 *    of the stack carries the batch's id. Dropping the front of a batch would
 *    leave the tail unrunnable in reverse and strand the assembly in a state
 *    no undo can restore. The trim point therefore retreats to a batch
 *    boundary, so the oldest retained operation is always either unbatched or
 *    the first operation of its batch. A single batch larger than this depth
 *    is retained whole, and only ages out once a further MAX_UNDO_DEPTH
 *    operations have accumulated behind it. The real bound is therefore this
 *    depth plus the largest retained batch: an auto-sort of a 5000-contig
 *    assembly can emit of order 10^4 move operations, a few hundred MB, held
 *    until that much newer work pushes it out. That is the price of the
 *    guarantee — a batch that cannot be undone in full is worse than the
 *    memory.
 * 2. Trimming is suspended while an atomic action is open
 *    (`beginAtomicAction`/`endAtomicAction`). Script runs stamp their batch id
 *    *after* execution, so their operations look unbatched while they are
 *    being pushed and rule 1 cannot protect them.
 *
 * When operations are dropped, `undoDroppedCount()` reports how many, so the
 * UI can say so rather than silently losing history.
 */
export const MAX_UNDO_DEPTH = 1000;

/**
 * A slice of a source (originally-loaded) contig's sequence, used to
 * reconstruct the nucleotide sequence of a derived contig produced by cut
 * or join operations. Segments are stored in display (5'→3') reading order;
 * each carries its own reverse-complement flag, so the list is self-contained
 * and does not depend on the owning contig's `inverted` flag.
 */
export interface SequenceSegment {
  /** Name of the source contig — a key into the reference sequences map. */
  sourceName: string;
  /** Base-pair start offset within the source sequence (inclusive). */
  start: number;
  /** Base-pair end offset within the source sequence (exclusive). */
  end: number;
  /** Whether this segment is reverse-complemented in the derived contig. */
  revComp: boolean;
}

export interface ContigInfo {
  name: string;
  originalIndex: number;
  length: number;       // in base pairs
  pixelStart: number;   // start pixel in the texture
  pixelEnd: number;     // end pixel in the texture
  inverted: boolean;
  scaffoldId: number | null;
  /**
   * Sequence provenance for contigs derived from cut/join. Absent on contigs
   * loaded directly from a .pretext file, whose sequence is looked up by name
   * and oriented by `inverted`. When present, it fully determines the exported
   * sequence (see FASTAWriter.resolveContigSequence).
   */
  sequenceSegments?: SequenceSegment[];
}

export interface CurationOperation {
  type: 'cut' | 'invert' | 'move' | 'join' | 'scaffold_paint' | 'scaffold_create' | 'scaffold_delete' | 'scaffold_bulk';
  timestamp: number;
  description: string;
  // Operation-specific data for undo
  data: Record<string, any>;
  batchId?: string;
}

export interface MapData {
  filename: string;
  /** Total pixel dimension of the full contact map (numberOfPixels1D). */
  textureSize: number;
  /** Number of mipmap levels stored in the file. */
  numMipMaps: number;
  /** Single-texture resolution (pixels per tile dimension). */
  tileResolution: number;
  /** Number of tiles per dimension. */
  tilesPerDimension: number;
  contigs: ContigInfo[];
  /**
   * Assembled full-resolution contact map as Float32Array (textureSize x textureSize).
   * This is reconstructed from the per-tile decoded data.
   */
  contactMap: Float32Array | null;
  /**
   * Original (file-order) contact map, preserved across curation operations.
   * contactMap may be reordered to match display order; this always holds
   * the original pixel layout for re-permutation after undo/redo.
   */
  originalContactMap?: Float32Array | null;
  /** Raw decompressed BC4 tile data for on-demand detail decoding. */
  rawTiles: Uint8Array[] | null;
  /** Parsed pretext header for tile decoding parameters. */
  parsedHeader: PretextHeader | null;
  // Extension track data (graph name -> Int32Array of per-pixel values)
  extensions: Map<string, Int32Array>;
}

export type InteractionMode = 'navigate' | 'edit' | 'scaffold' | 'waypoint' | 'select_sort';

export interface AppState {
  // Map data
  map: MapData | null;
  
  // Current contig order (indices into map.contigs)
  contigOrder: number[];
  
  // UI state
  mode: InteractionMode;
  showGrid: boolean;
  showTooltip: boolean;
  showIdBar: boolean;
  visibleTracks: Set<string>;
  colorMapName: string;
  gamma: number;
  /** Contrast range: contact intensity is rescaled from [signalFloor, signalCeil]
   *  to [0,1] before gamma/colormap. Values at/below the floor are hidden on both
   *  layers; values at/above the ceiling saturate. Defaults 0/1 = show everything. */
  signalFloor: number;
  signalCeil: number;
  /** Overview representation mode.
   *  'clean'   — coarsest mip overview; sparse off-diagonal contacts are
   *              suppressed consistently at every zoom (detail is gated by the
   *              overview so nothing "pops in"). The curation default.
   *  'faithful'— overview is max-pooled from a finer mip so it agrees with the
   *              detail layer; sparse inter-contig contacts are shown honestly
   *              at every zoom and in the minimap (detail gate disabled). */
  overviewMode: 'clean' | 'faithful';

  // Selection
  selectedContigs: Set<number>;
  
  // Camera
  camera: {
    x: number;
    y: number;
    zoom: number;
  };
  
  // Undo/redo
  undoStack: CurationOperation[];
  redoStack: CurationOperation[];
}

function createInitialState(): AppState {
  return {
    map: null,
    contigOrder: [],
    mode: 'navigate',
    showGrid: true,
    showTooltip: true,
    showIdBar: false,
    visibleTracks: new Set(),
    colorMapName: 'red-white',
    gamma: 0.35,
    signalFloor: 0,
    signalCeil: 1,
    overviewMode: 'clean',
    selectedContigs: new Set(),
    camera: { x: 0, y: 0, zoom: 1 },
    undoStack: [],
    redoStack: [],
  };
}

interface SelectorEntry<T = unknown> {
  selector: (state: AppState) => T;
  callback: (newVal: T, oldVal: T) => void;
  lastValue: T;
}

class StateManager {
  private state: AppState;
  private listeners: Set<(state: AppState) => void> = new Set();
  private selectors: Map<number, SelectorEntry> = new Map();
  private nextSelectorId = 0;
  private batchContext: { batchId: string; metadata?: Record<string, any> } | null = null;
  /** Operations dropped from the front of the undo stack this session. */
  private undoDropped = 0;
  /** Nesting depth of open atomic actions; trimming is suspended while > 0. */
  private atomicDepth = 0;

  constructor() {
    this.state = createInitialState();
  }

  get(): AppState {
    return this.state;
  }

  update(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  /**
   * Update a single contig's properties immutably.
   * Clones the contigs array with the specified changes applied.
   */
  updateContig(contigId: number, changes: Partial<ContigInfo>): void {
    const map = this.state.map;
    if (!map) return;
    const newContigs = [...map.contigs];
    newContigs[contigId] = { ...newContigs[contigId], ...changes };
    this.state = {
      ...this.state,
      map: { ...map, contigs: newContigs },
    };
    this.notify();
  }

  /**
   * Update multiple contigs in a single clone (for batch efficiency).
   */
  updateContigs(updates: Array<{ id: number; changes: Partial<ContigInfo> }>): void {
    const map = this.state.map;
    if (!map) return;
    const newContigs = [...map.contigs];
    for (const { id, changes } of updates) {
      newContigs[id] = { ...newContigs[id], ...changes };
    }
    this.state = {
      ...this.state,
      map: { ...map, contigs: newContigs },
    };
    this.notify();
  }

  /**
   * Append new contigs to the contigs array immutably.
   * Returns the starting index of the first new contig.
   */
  appendContigs(...newContigs: ContigInfo[]): number {
    const map = this.state.map;
    if (!map) return -1;
    const startIndex = map.contigs.length;
    const cloned = [...map.contigs, ...newContigs];
    this.state = {
      ...this.state,
      map: { ...map, contigs: cloned },
    };
    this.notify();
    return startIndex;
  }

  /**
   * Push a curation operation onto the undo stack.
   * Clears the redo stack (you can't redo after a new operation).
   * Auto-merges batch context if active.
   */
  pushOperation(op: CurationOperation): void {
    let finalOp = op;
    if (this.batchContext) {
      finalOp = {
        ...op,
        batchId: this.batchContext.batchId,
        data: { ...op.data, ...this.batchContext.metadata },
      };
    }
    const grownUndoStack = [...this.state.undoStack, finalOp];
    this.state = {
      ...this.state,
      undoStack: this.trimUndoStack(grownUndoStack),
      redoStack: [],
    };
    this.notify();
  }

  /**
   * Drop the oldest operations to keep the stack near MAX_UNDO_DEPTH, without
   * ever breaking a batch apart and without trimming while an atomic action is
   * open. Returns the stack to store (the input array when nothing is dropped).
   * See MAX_UNDO_DEPTH for why both exceptions exist.
   */
  private trimUndoStack(stack: CurationOperation[]): CurationOperation[] {
    if (this.atomicDepth > 0) return stack;

    let drop = stack.length - MAX_UNDO_DEPTH;
    if (drop <= 0) return stack;

    // Retreat to a batch boundary so the oldest retained op is never the
    // middle of a batch. Retreating only ever keeps more history.
    while (
      drop > 0 &&
      stack[drop].batchId !== undefined &&
      stack[drop - 1].batchId === stack[drop].batchId
    ) {
      drop--;
    }
    if (drop <= 0) return stack;

    this.undoDropped += drop;
    return stack.slice(drop);
  }

  /**
   * Open an atomic action: no trimming happens until the matching
   * `endAtomicAction`, so every operation pushed in between stays on the stack
   * and stack indices captured before it remain valid. Nestable. Callers must
   * pair it in a `finally` — a leaked open action disables trimming for the
   * rest of the session.
   */
  beginAtomicAction(): void {
    this.atomicDepth++;
  }

  /** Close an atomic action opened by `beginAtomicAction` and trim once. */
  endAtomicAction(): void {
    if (this.atomicDepth === 0) return;
    this.atomicDepth--;
    if (this.atomicDepth > 0) return;
    const trimmed = this.trimUndoStack(this.state.undoStack);
    if (trimmed !== this.state.undoStack) {
      this.state = { ...this.state, undoStack: trimmed };
      this.notify();
    }
  }

  /**
   * A stable mark for the current top of the undo stack, valid even if older
   * operations are trimmed afterwards. Pass it to `assignBatchId`, or convert
   * it back to a live index with `undoIndexOfMark`.
   */
  undoMark(): number {
    return this.undoDropped + this.state.undoStack.length;
  }

  /**
   * Convert a mark from `undoMark()` into an index into the current undo
   * stack. Marks older than the trimmed region clamp to 0, so a caller slicing
   * from here gets everything still available rather than the wrong window.
   */
  undoIndexOfMark(mark: number): number {
    return Math.max(0, Math.min(this.state.undoStack.length, mark - this.undoDropped));
  }

  /** How many operations have been dropped from the front this session. */
  undoDroppedCount(): number {
    return this.undoDropped;
  }

  /**
   * Set batch context so that subsequent pushOperation calls
   * auto-merge batchId and metadata into new operations.
   */
  setBatchContext(batchId: string, metadata?: Record<string, any>): void {
    this.batchContext = { batchId, metadata };
  }

  /**
   * Clear the batch context.
   */
  clearBatchContext(): void {
    this.batchContext = null;
  }

  /**
   * Stamp the trailing undo-stack operations (from mark `fromMark` to the end)
   * with a shared batchId, so a multi-op action such as a script undoes as one
   * unit. Overwrites any inner batchIds (e.g. an autosort run inside the script)
   * so `undoBatch` pops the whole contiguous range. Post-hoc stamping is used
   * instead of spanning `setBatchContext` because nested batch operations clear
   * the context partway through.
   *
   * `fromMark` is a mark from `undoMark()`, which equals the stack length while
   * nothing has been trimmed. It is resolved against the trimmed region rather
   * than used as a raw index, so trimming between the mark and the stamp can
   * never shift the range and leave part of the action unstamped.
   */
  assignBatchId(fromMark: number, batchId: string): void {
    if (fromMark < 0) return;
    const from = this.undoIndexOfMark(fromMark);
    if (from >= this.state.undoStack.length) return;
    const undoStack = this.state.undoStack.map((op, i) =>
      i >= from ? { ...op, batchId } : op
    );
    this.state = { ...this.state, undoStack };
    this.notify();
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to a derived value from state. The callback fires only
   * when the selector's return value changes (compared via Object.is).
   * Returns an unsubscribe function.
   */
  select<T>(selector: (state: AppState) => T, callback: (newVal: T, oldVal: T) => void): () => void {
    const id = this.nextSelectorId++;
    const entry: SelectorEntry<T> = {
      selector,
      callback,
      lastValue: selector(this.state),
    };
    this.selectors.set(id, entry as SelectorEntry);
    return () => { this.selectors.delete(id); };
  }

  private notify(): void {
    this.listeners.forEach(l => l(this.state));
    for (const entry of this.selectors.values()) {
      const newVal = entry.selector(this.state);
      if (!Object.is(newVal, entry.lastValue)) {
        const oldVal = entry.lastValue;
        entry.lastValue = newVal;
        entry.callback(newVal, oldVal);
      }
    }
  }

  reset(): void {
    this.state = createInitialState();
    this.batchContext = null;
    this.undoDropped = 0;
    this.atomicDepth = 0;
    this.notify();
  }
}

// Common selectors for use with state.select()
export const selectContigOrder = (s: AppState) => s.contigOrder;
export const selectGamma = (s: AppState) => s.gamma;
export const selectShowGrid = (s: AppState) => s.showGrid;
export const selectMode = (s: AppState) => s.mode;
export const selectSelectedContigs = (s: AppState) => s.selectedContigs;

export const state = new StateManager();
