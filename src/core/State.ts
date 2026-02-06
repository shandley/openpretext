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

class StateManager {
  private state: AppState;
  private listeners: Set<(state: AppState) => void> = new Set();

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
   * Push a curation operation onto the undo stack.
   * Clears the redo stack (you can't redo after a new operation).
   */
  pushOperation(op: CurationOperation): void {
    this.state.undoStack.push(op);
    this.state.redoStack = [];
    this.notify();
  }

  subscribe(listener: (state: AppState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(l => l(this.state));
  }

  reset(): void {
    this.state = createInitialState();
    this.notify();
  }
}

export const state = new StateManager();
