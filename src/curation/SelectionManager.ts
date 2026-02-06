/**
 * SelectionManager - Manages contig selection state.
 *
 * Supports single selection (click), range selection (shift+click), and
 * toggle selection (ctrl/cmd+click). Converts screen coordinates to contig
 * indices and emits selection events through the EventBus.
 */

import { state, ContigInfo } from '../core/State';
import { events } from '../core/EventBus';

/**
 * Result of a screen-coordinate to contig lookup.
 */
export interface ContigHitResult {
  /** Index in the contigOrder array */
  orderIndex: number;
  /** Index in the map.contigs array */
  contigId: number;
  /** The ContigInfo object */
  contig: ContigInfo;
  /** Pixel offset within the contig (from its pixelStart) */
  pixelOffset: number;
}

/**
 * Given a pixel position along the diagonal (in texture space), find
 * which contig it falls within, according to the current contig ordering.
 *
 * The contigs are laid out sequentially in the order given by
 * state.contigOrder. Each contig occupies (pixelEnd - pixelStart) pixels.
 *
 * @param pixelPosition - Position in pixels along the diagonal axis
 *   (0-based, in the full texture coordinate space).
 * @returns The contig hit result, or null if the position is out of range.
 */
export function hitTestContig(pixelPosition: number): ContigHitResult | null {
  const s = state.get();
  if (!s.map) return null;

  let cumulativePixels = 0;

  for (let i = 0; i < s.contigOrder.length; i++) {
    const contigId = s.contigOrder[i];
    const contig = s.map.contigs[contigId];
    const contigPixelLength = contig.pixelEnd - contig.pixelStart;

    if (pixelPosition >= cumulativePixels && pixelPosition < cumulativePixels + contigPixelLength) {
      return {
        orderIndex: i,
        contigId,
        contig,
        pixelOffset: pixelPosition - cumulativePixels,
      };
    }

    cumulativePixels += contigPixelLength;
  }

  return null;
}

/**
 * Convert screen (canvas) coordinates to a pixel position along the
 * diagonal of the contact map.
 *
 * The contact map is rendered as a square. The diagonal runs from
 * top-left to bottom-right. A click at screen position (sx, sy) on
 * the canvas maps to a position along the diagonal based on the
 * camera transform.
 *
 * @param screenX - X coordinate on the canvas (pixels).
 * @param screenY - Y coordinate on the canvas (pixels).
 * @param canvasWidth - Width of the canvas in pixels.
 * @param canvasHeight - Height of the canvas in pixels.
 * @returns Pixel position along the diagonal in texture space, or null
 *   if the map is not loaded.
 */
export function screenToDiagonalPixel(
  screenX: number,
  screenY: number,
  canvasWidth: number,
  canvasHeight: number
): number | null {
  const s = state.get();
  if (!s.map) return null;

  const { x: camX, y: camY, zoom } = s.camera;
  const textureSize = s.map.textureSize;

  // Convert screen coords to texture coords via camera transform.
  // The camera defines a view where (camX, camY) is the center of the
  // viewport and zoom is the scale factor.
  //
  // textureX = (screenX / canvasWidth - 0.5) / zoom + camX
  // For the diagonal, we use the X axis (or equivalently Y, since
  // the contact map is symmetric about the diagonal).
  const textureX = ((screenX / canvasWidth - 0.5) / zoom + 0.5) * textureSize + camX;
  const textureY = ((screenY / canvasHeight - 0.5) / zoom + 0.5) * textureSize + camY;

  // The diagonal pixel position: for a symmetric map, the diagonal
  // corresponds to x == y. We project onto the diagonal by averaging.
  const diagPixel = (textureX + textureY) / 2;

  if (diagPixel < 0 || diagPixel >= textureSize) {
    return null;
  }

  return diagPixel;
}

/**
 * Get the total pixel span of all contigs in the current order.
 */
export function getTotalPixelSpan(): number {
  const s = state.get();
  if (!s.map) return 0;

  let total = 0;
  for (const contigId of s.contigOrder) {
    const contig = s.map.contigs[contigId];
    total += contig.pixelEnd - contig.pixelStart;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Selection operations
// ---------------------------------------------------------------------------

/**
 * Select a single contig, clearing any previous selection.
 *
 * @param orderIndex - Index in contigOrder to select.
 */
export function selectSingle(orderIndex: number): void {
  const s = state.get();
  if (!s.map) return;
  if (orderIndex < 0 || orderIndex >= s.contigOrder.length) return;

  const contigId = s.contigOrder[orderIndex];
  const contig = s.map.contigs[contigId];

  const newSelection = new Set<number>([orderIndex]);
  state.update({ selectedContigs: newSelection });

  events.emit('contig:selected', { index: orderIndex, name: contig.name });
  events.emit('render:request', {});
}

/**
 * Toggle selection of a single contig (ctrl/cmd+click behavior).
 * If already selected, deselect it; otherwise add to selection.
 *
 * @param orderIndex - Index in contigOrder to toggle.
 */
export function selectToggle(orderIndex: number): void {
  const s = state.get();
  if (!s.map) return;
  if (orderIndex < 0 || orderIndex >= s.contigOrder.length) return;

  const contigId = s.contigOrder[orderIndex];
  const contig = s.map.contigs[contigId];
  const newSelection = new Set(s.selectedContigs);

  if (newSelection.has(orderIndex)) {
    newSelection.delete(orderIndex);
    events.emit('contig:deselected', {});
  } else {
    newSelection.add(orderIndex);
    events.emit('contig:selected', { index: orderIndex, name: contig.name });
  }

  state.update({ selectedContigs: newSelection });
  events.emit('render:request', {});
}

/**
 * Extend the selection to form a contiguous range from the anchor to
 * the given index (shift+click behavior).
 *
 * The anchor is the minimum currently-selected index. If nothing is
 * selected, this behaves like selectSingle.
 *
 * @param orderIndex - Index in contigOrder to extend selection to.
 */
export function selectRange(orderIndex: number): void {
  const s = state.get();
  if (!s.map) return;
  if (orderIndex < 0 || orderIndex >= s.contigOrder.length) return;

  if (s.selectedContigs.size === 0) {
    selectSingle(orderIndex);
    return;
  }

  // Find the anchor (the smallest currently selected index)
  const currentSelection = Array.from(s.selectedContigs).sort((a, b) => a - b);
  const anchor = currentSelection[0];

  const start = Math.min(anchor, orderIndex);
  const end = Math.max(anchor, orderIndex);

  const newSelection = new Set<number>();
  for (let i = start; i <= end; i++) {
    newSelection.add(i);
  }

  state.update({ selectedContigs: newSelection });

  const contigId = s.contigOrder[orderIndex];
  const contig = s.map.contigs[contigId];
  events.emit('contig:selected', { index: orderIndex, name: contig.name });
  events.emit('render:request', {});
}

/**
 * Clear all contig selection.
 */
export function clearSelection(): void {
  state.update({ selectedContigs: new Set() });
  events.emit('contig:deselected', {});
  events.emit('render:request', {});
}

/**
 * Select all contigs.
 */
export function selectAll(): void {
  const s = state.get();
  if (!s.map) return;

  const newSelection = new Set<number>();
  for (let i = 0; i < s.contigOrder.length; i++) {
    newSelection.add(i);
  }

  state.update({ selectedContigs: newSelection });
  events.emit('render:request', {});
}

/**
 * Get the currently selected contig indices (in contigOrder).
 */
export function getSelectedIndices(): number[] {
  return Array.from(state.get().selectedContigs).sort((a, b) => a - b);
}

/**
 * Get the ContigInfo objects for all selected contigs.
 */
export function getSelectedContigs(): ContigInfo[] {
  const s = state.get();
  if (!s.map) return [];

  return getSelectedIndices().map(i => {
    const contigId = s.contigOrder[i];
    return s.map!.contigs[contigId];
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const SelectionManager = {
  hitTestContig,
  screenToDiagonalPixel,
  getTotalPixelSpan,
  selectSingle,
  selectToggle,
  selectRange,
  clearSelection,
  selectAll,
  getSelectedIndices,
  getSelectedContigs,
};
