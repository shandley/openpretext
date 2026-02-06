/**
 * WaypointOverlay - Renders waypoint markers on the 2D overlay canvas.
 *
 * Draws diamond-shaped marker icons at each waypoint's map position with
 * a label next to it. The "current" waypoint is highlighted with a larger
 * marker and a glow effect.
 *
 * Uses the same camera coordinate transforms as ScaffoldOverlay to convert
 * normalized map coordinates (0-1) to screen pixel positions.
 */

import { type Waypoint } from '../curation/WaypointManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WaypointOverlayOptions {
  /** Camera state for coordinate transforms. */
  camera: { x: number; y: number; zoom: number };
  /** Canvas dimensions in CSS pixels. */
  canvasWidth: number;
  canvasHeight: number;
  /** Array of waypoints to render. */
  waypoints: Waypoint[];
  /** Id of the currently active/highlighted waypoint, or null. */
  currentWaypointId: number | null;
  /** Size of the diamond marker in CSS pixels. Default: 8. */
  markerSize?: number;
  /** Font size for labels in CSS pixels. Default: 11. */
  fontSize?: number;
}

// ---------------------------------------------------------------------------
// WaypointOverlay
// ---------------------------------------------------------------------------

export class WaypointOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for waypoint overlay canvas');
    this.ctx = ctx;
  }

  // -----------------------------------------------------------------------
  // Coordinate transforms (same as ScaffoldOverlay / LabelRenderer)
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

  // -----------------------------------------------------------------------
  // Drawing helpers
  // -----------------------------------------------------------------------

  /**
   * Draw a diamond shape centered at (cx, cy) with the given half-size.
   */
  private drawDiamond(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);      // top
    ctx.lineTo(cx + size, cy);      // right
    ctx.lineTo(cx, cy + size);      // bottom
    ctx.lineTo(cx - size, cy);      // left
    ctx.closePath();
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  /**
   * Render all waypoint markers and labels onto the overlay canvas.
   */
  render(opts: WaypointOverlayOptions): void {
    const {
      camera,
      canvasWidth,
      canvasHeight,
      waypoints,
      currentWaypointId,
      markerSize = 8,
      fontSize = 11,
    } = opts;

    const ctx = this.ctx;

    // Resize canvas to match display (retina-aware)
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
    const displayW = Math.floor(canvasWidth * dpr);
    const displayH = Math.floor(canvasHeight * dpr);

    if (this.canvas.width !== displayW || this.canvas.height !== displayH) {
      this.canvas.width = displayW;
      this.canvas.height = displayH;
    }

    ctx.clearRect(0, 0, displayW, displayH);
    ctx.save();
    ctx.scale(dpr, dpr);

    if (waypoints.length === 0) {
      ctx.restore();
      return;
    }

    // Configure text rendering
    ctx.textBaseline = 'middle';
    ctx.font = `${fontSize}px sans-serif`;

    for (const wp of waypoints) {
      const sx = this.mapToScreenX(wp.mapX, camera, canvasWidth, canvasHeight);
      const sy = this.mapToScreenY(wp.mapY, camera, canvasWidth, canvasHeight);

      // Skip if off-screen (with generous margin for labels)
      const margin = markerSize + 150;
      if (sx < -margin || sx > canvasWidth + margin) continue;
      if (sy < -margin || sy > canvasHeight + margin) continue;

      const isCurrent = wp.id === currentWaypointId;
      const size = isCurrent ? markerSize * 1.5 : markerSize;

      // --- Glow effect for current waypoint ---
      if (isCurrent) {
        ctx.save();
        ctx.shadowColor = wp.color;
        ctx.shadowBlur = 12;
        this.drawDiamond(ctx, sx, sy, size + 2);
        ctx.fillStyle = wp.color;
        ctx.fill();
        ctx.restore();
      }

      // --- Diamond marker ---
      this.drawDiamond(ctx, sx, sy, size);
      ctx.fillStyle = wp.color;
      ctx.fill();

      // --- White outline for contrast ---
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isCurrent ? 2 : 1.5;
      this.drawDiamond(ctx, sx, sy, size);
      ctx.stroke();

      // --- Label ---
      const labelX = sx + size + 5;
      const labelY = sy;

      // Text shadow for readability
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillText(wp.label, labelX + 1, labelY + 1);
      ctx.fillStyle = '#ffffff';
      if (isCurrent) {
        ctx.font = `bold ${fontSize}px sans-serif`;
      }
      ctx.fillText(wp.label, labelX, labelY);
      ctx.restore();

      // Reset font after potential bold
      ctx.font = `${fontSize}px sans-serif`;
    }

    ctx.restore();
  }
}
