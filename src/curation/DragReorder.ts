/**
 * DragReorder — Visual drag-and-drop contig reordering in edit mode.
 *
 * When the user starts dragging a selected contig on the map canvas,
 * this module tracks the drag, renders a drop indicator line, and
 * on release, executes a CurationEngine.move() to reorder contigs.
 */

import { state } from '../core/State';
import { events } from '../core/EventBus';
import { CurationEngine } from './CurationEngine';
import { SelectionManager } from './SelectionManager';

export interface DragState {
  active: boolean;
  sourceIndex: number;      // order index of the contig being dragged
  dropIndex: number;        // order index where it would be inserted
  startScreenX: number;
  startScreenY: number;
}

export type ContigBoundaryResolver = (mouseMapX: number) => number;

export class DragReorder {
  private dragState: DragState = {
    active: false,
    sourceIndex: -1,
    dropIndex: -1,
    startScreenX: 0,
    startScreenY: 0,
  };

  // Minimum mouse movement before starting a drag (in px)
  private dragThreshold = 8;
  private pendingDrag = false;

  // Callbacks
  private getContigAtPosition: ((mapX: number) => number) | null = null;
  private onDragUpdate: ((drag: DragState) => void) | null = null;
  private onDragEnd: ((moved: boolean) => void) | null = null;

  /**
   * Configure the drag system with callbacks.
   */
  setup(options: {
    getContigAtPosition: (mapX: number) => number;
    onDragUpdate: (drag: DragState) => void;
    onDragEnd: (moved: boolean) => void;
  }): void {
    this.getContigAtPosition = options.getContigAtPosition;
    this.onDragUpdate = options.onDragUpdate;
    this.onDragEnd = options.onDragEnd;
  }

  /**
   * Call on mousedown in edit mode. Returns true if drag handling started.
   */
  onMouseDown(screenX: number, screenY: number, contigOrderIndex: number): boolean {
    if (contigOrderIndex < 0) return false;

    const s = state.get();
    if (!s.selectedContigs.has(contigOrderIndex)) {
      SelectionManager.selectSingle(contigOrderIndex);
    }

    this.pendingDrag = true;
    this.dragState = {
      active: false,
      sourceIndex: contigOrderIndex,
      dropIndex: contigOrderIndex,
      startScreenX: screenX,
      startScreenY: screenY,
    };

    return true;
  }

  /**
   * Call on mousemove. Returns true if currently dragging.
   */
  onMouseMove(screenX: number, screenY: number, mapX: number, contigBoundaries: number[]): boolean {
    if (!this.pendingDrag && !this.dragState.active) return false;

    const dx = screenX - this.dragState.startScreenX;
    const dy = screenY - this.dragState.startScreenY;

    if (this.pendingDrag && !this.dragState.active) {
      // Check if we've moved past the drag threshold
      if (Math.abs(dx) + Math.abs(dy) < this.dragThreshold) return false;

      // Start the drag
      this.dragState.active = true;
      this.pendingDrag = false;
    }

    if (!this.dragState.active) return false;

    // Determine drop position from mouse's map X coordinate
    // Find which boundary the mouse is closest to
    const dropIndex = this.findDropIndex(mapX, contigBoundaries);
    this.dragState.dropIndex = dropIndex;

    if (this.onDragUpdate) {
      this.onDragUpdate(this.dragState);
    }

    return true;
  }

  /**
   * Call on mouseup. Executes the move if drag was active.
   */
  onMouseUp(): boolean {
    this.pendingDrag = false;

    if (!this.dragState.active) {
      return false;
    }

    const { sourceIndex, dropIndex } = this.dragState;
    this.dragState.active = false;

    // Execute the move if position changed
    let moved = false;
    if (sourceIndex !== dropIndex && sourceIndex !== dropIndex - 1) {
      const s = state.get();
      // Get all selected contigs sorted by their order index
      const selectedIndices = Array.from(s.selectedContigs).sort((a, b) => a - b);

      // Move each selected contig to the drop position
      // For simplicity, move the primary dragged contig
      const targetIndex = dropIndex > sourceIndex ? dropIndex - 1 : dropIndex;
      if (targetIndex !== sourceIndex && targetIndex >= 0 && targetIndex < s.contigOrder.length) {
        CurationEngine.move(sourceIndex, targetIndex);
        moved = true;
      }
    }

    if (this.onDragEnd) {
      this.onDragEnd(moved);
    }

    return moved;
  }

  /**
   * Cancel any in-progress drag.
   */
  cancel(): void {
    this.dragState.active = false;
    this.pendingDrag = false;
    if (this.onDragEnd) {
      this.onDragEnd(false);
    }
  }

  getDragState(): DragState {
    return { ...this.dragState };
  }

  isActive(): boolean {
    return this.dragState.active;
  }

  isPending(): boolean {
    return this.pendingDrag;
  }

  /**
   * Find the insertion index based on mouse position in map coordinates.
   */
  private findDropIndex(mapX: number, contigBoundaries: number[]): number {
    if (contigBoundaries.length === 0) return 0;

    // Find the closest boundary
    let prevBoundary = 0;
    for (let i = 0; i < contigBoundaries.length; i++) {
      const boundary = contigBoundaries[i];
      const midpoint = (prevBoundary + boundary) / 2;

      if (mapX < midpoint) {
        return i;
      }
      prevBoundary = boundary;
    }

    return contigBoundaries.length;
  }
}

/**
 * Renders the drag indicator on the label/overlay canvas.
 * Draws a bright line at the drop position.
 */
export function renderDragIndicator(
  ctx: CanvasRenderingContext2D,
  dragState: DragState,
  contigBoundaries: number[],
  camera: { x: number; y: number; zoom: number },
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!dragState.active) return;

  const dropPos = dragState.dropIndex === 0 ? 0 : contigBoundaries[dragState.dropIndex - 1] ?? 1;

  // Convert to screen coordinates (same transform as LabelRenderer)
  const aspect = canvasWidth / canvasHeight;
  let screenXNorm = (dropPos - camera.x) * camera.zoom;
  if (aspect > 1) screenXNorm /= aspect;
  const screenX = (screenXNorm + 0.5) * canvasWidth;

  let screenYNorm = (dropPos - camera.y) * camera.zoom;
  if (aspect <= 1) screenYNorm *= aspect;
  const screenY = (screenYNorm + 0.5) * canvasHeight;

  const dpr = window.devicePixelRatio || 1;

  ctx.save();
  ctx.scale(dpr, dpr);

  // Vertical drop indicator line
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);

  ctx.beginPath();
  ctx.moveTo(screenX, 0);
  ctx.lineTo(screenX, canvasHeight);
  ctx.stroke();

  // Horizontal drop indicator line
  ctx.beginPath();
  ctx.moveTo(0, screenY);
  ctx.lineTo(canvasWidth, screenY);
  ctx.stroke();

  // Draw arrow indicators at the drop position
  ctx.setLineDash([]);
  ctx.fillStyle = '#e94560';

  // Top arrow
  ctx.beginPath();
  ctx.moveTo(screenX - 6, 0);
  ctx.lineTo(screenX + 6, 0);
  ctx.lineTo(screenX, 10);
  ctx.closePath();
  ctx.fill();

  // Left arrow
  ctx.beginPath();
  ctx.moveTo(0, screenY - 6);
  ctx.lineTo(0, screenY + 6);
  ctx.lineTo(10, screenY);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
