/**
 * AppContext — shared context object passed to all extracted UI modules.
 *
 * Replaces `this` references from the original monolithic OpenPretextApp class.
 */

import type { WebGLRenderer } from '../renderer/WebGLRenderer';
import type { Camera } from '../renderer/Camera';
import type { LabelRenderer } from '../renderer/LabelRenderer';
import type { TrackRenderer } from '../renderer/TrackRenderer';
import type { ScaffoldOverlay } from '../renderer/ScaffoldOverlay';
import type { WaypointOverlay } from '../renderer/WaypointOverlay';
import type { Minimap } from '../renderer/Minimap';
import type { DragReorder } from '../curation/DragReorder';
import type { ScaffoldManager } from '../curation/ScaffoldManager';
import type { WaypointManager } from '../curation/WaypointManager';
import type { MetricsTracker } from '../curation/QualityMetrics';
import type { TileManager } from '../renderer/TileManager';
import type { ColorMapName } from '../renderer/ColorMaps';
import type { InteractionMode } from '../core/State';

export interface AppContext {
  // Renderers
  renderer: WebGLRenderer;
  labelRenderer: LabelRenderer;
  trackRenderer: TrackRenderer;
  scaffoldOverlay: ScaffoldOverlay;
  waypointOverlay: WaypointOverlay;
  minimap: Minimap;
  camera: Camera;

  // Managers
  dragReorder: DragReorder;
  scaffoldManager: ScaffoldManager;
  waypointManager: WaypointManager;
  metricsTracker: MetricsTracker;

  // Tile streaming
  tileManager: TileManager | null;
  cancelTileDecode: (() => void) | null;

  // Mutable shared state
  contigBoundaries: number[];
  hoveredContigIndex: number;
  mouseMapPos: { x: number; y: number };
  currentMode: InteractionMode;
  currentColorMap: ColorMapName;
  tracksVisible: boolean;
  currentWaypointId: number | null;
  animFrameId: number;
  referenceSequences: Map<string, string> | null;
  comparisonSnapshot: number[] | null;
  comparisonVisible: boolean;

  // Cross-module callbacks (wired during init)
  showToast: (message: string, duration?: number) => void;
  refreshAfterCuration: () => void;
  updateSidebarContigList: () => void;
  updateSidebarScaffoldList: () => void;
  updateStatsPanel: () => void;
  updateTrackConfigPanel: () => void;
  rebuildContigBoundaries: () => void;
  setMode: (mode: InteractionMode) => void;
  formatBp: (bp: number) => string;
}
