/**
 * ScaffoldOverlay - Renders scaffold color bands on the 2D overlay canvas.
 *
 * Draws semi-transparent colored bands along the top and left edges of the
 * contact map for each contig that has a scaffold assignment. Also draws
 * alternating scaffold background bands across the full diagonal region
 * to visually group contigs belonging to the same scaffold.
 *
 * Uses the same camera coordinate transforms as LabelRenderer to convert
 * normalized map coordinates (0-1) to screen pixel positions.
 */

import { type Scaffold } from '../curation/ScaffoldManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaffoldOverlayOptions {
  /** Normalized 0-1 boundary positions (cumulative end of each contig). */
  contigBoundaries: number[];
  /** Scaffold id for each contig in order (null if unassigned). */
  contigScaffoldIds: (number | null)[];
  /** Map from scaffold id to Scaffold object. */
  scaffolds: Map<number, Scaffold>;
  /** Camera state for coordinate transforms. */
  camera: { x: number; y: number; zoom: number };
  /** Canvas dimensions in CSS pixels. */
  canvasWidth: number;
  canvasHeight: number;
  /** Width of edge bands in CSS pixels. */
  bandWidth?: number;
  /** Opacity for edge bands (0-1). */
  bandOpacity?: number;
  /** Opacity for diagonal background bands (0-1). */
  backgroundOpacity?: number;
}

// ---------------------------------------------------------------------------
// ScaffoldOverlay
// ---------------------------------------------------------------------------

export class ScaffoldOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for scaffold overlay canvas');
    this.ctx = ctx;
  }

  // -----------------------------------------------------------------------
  // Coordinate transforms (same as LabelRenderer)
  // -----------------------------------------------------------------------

  /**
   * Convert a normalized map coordinate (0-1) to screen pixel X.
   */
  private mapToScreenX(
    mapX: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
  ): number {
    const aspect = w / h;
    let screenX = (mapX - cam.x) * cam.zoom;
    if (aspect > 1) {
      screenX /= aspect;
    }
    return (screenX + 0.5) * w;
  }

  /**
   * Convert a normalized map coordinate (0-1) to screen pixel Y.
   */
  private mapToScreenY(
    mapY: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
  ): number {
    const aspect = w / h;
    let screenY = (mapY - cam.y) * cam.zoom;
    if (aspect <= 1) {
      screenY *= aspect;
    }
    return (screenY + 0.5) * h;
  }

  /**
   * Parse a hex color and return an rgba string with the given alpha.
   */
  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  render(opts: ScaffoldOverlayOptions): void {
    const {
      contigBoundaries,
      contigScaffoldIds,
      scaffolds,
      camera,
      canvasWidth,
      canvasHeight,
      bandWidth = 6,
      bandOpacity = 0.75,
      backgroundOpacity = 0.08,
    } = opts;

    const ctx = this.ctx;

    // Resize canvas to match display (retina-aware)
    const dpr = window.devicePixelRatio || 1;
    const displayW = Math.floor(canvasWidth * dpr);
    const displayH = Math.floor(canvasHeight * dpr);

    if (this.canvas.width !== displayW || this.canvas.height !== displayH) {
      this.canvas.width = displayW;
      this.canvas.height = displayH;
    }

    ctx.clearRect(0, 0, displayW, displayH);
    ctx.save();
    ctx.scale(dpr, dpr);

    if (contigBoundaries.length === 0 || contigScaffoldIds.length === 0) {
      ctx.restore();
      return;
    }

    // Draw scaffold visuals for each contig
    for (let i = 0; i < contigScaffoldIds.length && i < contigBoundaries.length; i++) {
      const scaffoldId = contigScaffoldIds[i];
      if (scaffoldId === null) continue;

      const scaffold = scaffolds.get(scaffoldId);
      if (!scaffold) continue;

      const start = i === 0 ? 0 : contigBoundaries[i - 1];
      const end = contigBoundaries[i];

      // Convert to screen coordinates
      const screenStartX = this.mapToScreenX(start, camera, canvasWidth, canvasHeight);
      const screenEndX = this.mapToScreenX(end, camera, canvasWidth, canvasHeight);
      const screenStartY = this.mapToScreenY(start, camera, canvasWidth, canvasHeight);
      const screenEndY = this.mapToScreenY(end, camera, canvasWidth, canvasHeight);

      const blockW = screenEndX - screenStartX;
      const blockH = screenEndY - screenStartY;

      // Skip if off-screen
      if (screenEndX < 0 || screenStartX > canvasWidth) continue;

      // --- Top edge band ---
      ctx.fillStyle = this.hexToRgba(scaffold.color, bandOpacity);
      ctx.fillRect(screenStartX, 0, blockW, bandWidth);

      // --- Left edge band ---
      if (!(screenEndY < 0 || screenStartY > canvasHeight)) {
        ctx.fillRect(0, screenStartY, bandWidth, blockH);
      }

      // --- Diagonal background band ---
      // Draw a semi-transparent rectangle along the diagonal (intersection
      // of the contig's row and column range).
      if (!(screenEndY < 0 || screenStartY > canvasHeight)) {
        ctx.fillStyle = this.hexToRgba(scaffold.color, backgroundOpacity);
        ctx.fillRect(screenStartX, screenStartY, blockW, blockH);
      }
    }

    ctx.restore();
  }
}
