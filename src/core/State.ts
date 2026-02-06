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

export interface ContigInfo {
  name: string;
  originalIndex: number;
  length: number;       // in base pairs
  pixelStart: number;   // start pixel in the texture
  pixelEnd: number;     // end pixel in the texture
  inverted: boolean;
  scaffoldId: number | null;
}

export interface CurationOperation {
  type: 'cut' | 'invert' | 'move' | 'join' | 'scaffold_paint';
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
    this.state = {
      ...this.state,
      undoStack: [...this.state.undoStack, finalOp],
      redoStack: [],
    };
    this.notify();
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
