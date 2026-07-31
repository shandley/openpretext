/**
 * LabelRenderer — Draws contig name labels along the top and left edges
 * of the contact map using a 2D canvas overlay.
 *
 * This sits on top of the WebGL canvas and renders text labels, tick marks,
 * and contig boundary indicators that would be impractical to do in GLSL.
 */

import { TrackRenderer } from './TrackRenderer';

export interface LabelRenderOptions {
  contigBoundaries: number[];  // normalized 0-1 positions
  contigNames: string[];
  camera: { x: number; y: number; zoom: number };
  hoveredIndex: number;        // -1 if none
  canvasWidth: number;
  canvasHeight: number;
  /** Total thickness (CSS px) of the visible track gutters, so contig labels
   *  sit just outside them rather than overlapping the tracks. Default 0. */
  trackGutterPx?: number;
  /** Width (CSS px) of the track-name block at the left of the top gutter.
   *  Contig labels keep clear of it: this canvas is layered above the track
   *  canvas, so a label drawn there sits on top of the block instead of being
   *  hidden by it. Default 0. */
  trackLabelBlockPx?: number;
}

export class LabelRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for label canvas');
    this.ctx = ctx;
  }

  /**
   * Convert a normalized map coordinate (0-1) to screen pixel X.
   */
  private mapToScreenX(mapX: number, cam: { x: number; y: number; zoom: number }, w: number, h: number): number {
    const aspect = w / h;
    let screenX = (mapX - cam.x) * cam.zoom;
    if (aspect > 1) {
      screenX /= aspect;
    }
    return (screenX + 0.5) * w; // NDC [-0.5..0.5] -> [0..w] after the *2 in shader was applied
  }

  /**
   * Convert a normalized map coordinate (0-1) to screen pixel Y.
   */
  private mapToScreenY(mapY: number, cam: { x: number; y: number; zoom: number }, w: number, h: number): number {
    const aspect = w / h;
    let screenY = (mapY - cam.y) * cam.zoom;
    if (aspect <= 1) {
      screenY *= aspect;
    }
    return (screenY + 0.5) * h;
  }

  /** Blank the label canvas (used when no assembly is loaded). */
  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  render(opts: LabelRenderOptions): void {
    const { contigBoundaries, contigNames, camera, hoveredIndex, canvasWidth, canvasHeight } = opts;
    const ctx = this.ctx;

    // Resize canvas to match display
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

    if (contigBoundaries.length === 0 || contigNames.length === 0) {
      ctx.restore();
      return;
    }

    const labelMargin = 4;
    const fontSize = Math.min(14, Math.max(11, 132 / contigBoundaries.length));

    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    // A dark halo so labels stay legible over both the white contact map and
    // the dark gutters (the top edge often sits directly on the white map).
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 3;

    // Anchor the label band just outside the track gutter, hugging the map's
    // top/left edge so labels move with pan/zoom instead of floating at the
    // fixed canvas corner. Clamp to stay on-screen when the map fills/overflows.
    const gutter = opts.trackGutterPx ?? 0;
    const mapTop = this.mapToScreenY(0, camera, canvasWidth, canvasHeight);
    const mapLeft = this.mapToScreenX(0, camera, canvasWidth, canvasHeight);
    const topLabelY = Math.min(
      canvasHeight - fontSize / 2,
      Math.max(fontSize / 2 + labelMargin, mapTop - gutter - labelMargin - fontSize / 2),
    );
    const leftLabelX = Math.min(
      canvasWidth - fontSize / 2,
      Math.max(fontSize / 2 + labelMargin, mapLeft - gutter - labelMargin - fontSize / 2),
    );

    // The track gutter's own extent, derived the same way TrackRenderer places
    // it so the two cannot drift apart. Contig labels stay outside it: this
    // canvas is layered above the track canvas, so anything drawn inside the
    // gutter lands on top of the track names rather than behind them.
    const gutterBottom = gutter > 0
      ? TrackRenderer.gutterOffset(mapTop, gutter, canvasHeight) + gutter
      : 0;
    const nameBlockRight = gutter > 0 ? (opts.trackLabelBlockPx ?? 0) : 0;

    // Draw labels for each contig along the top edge
    for (let i = 0; i < contigNames.length && i < contigBoundaries.length; i++) {
      const start = i === 0 ? 0 : contigBoundaries[i - 1];
      const end = contigBoundaries[i];
      const mid = (start + end) / 2;

      const screenX = this.mapToScreenX(mid, camera, canvasWidth, canvasHeight);
      const screenStartX = this.mapToScreenX(start, camera, canvasWidth, canvasHeight);
      const screenEndX = this.mapToScreenX(end, camera, canvasWidth, canvasHeight);

      const blockWidth = screenEndX - screenStartX;

      // Only draw label if block is wide enough
      if (blockWidth < 20) continue;

      // Skip if off-screen
      if (screenEndX < 0 || screenStartX > canvasWidth) continue;

      const isHovered = i === hoveredIndex;

      // Centre the name in whatever of the contig is clear of the track-name
      // block, not in the contig as a whole, so a contig running under the
      // block is still labelled and the label does not land on it.
      const topSpanStart = Math.max(screenStartX, nameBlockRight);
      const topSpan = screenEndX - topSpanStart;
      if (topSpan < 20) continue;
      const topLabelX = topSpanStart + topSpan / 2;

      // Top label
      ctx.save();
      ctx.translate(topLabelX, topLabelY);

      if (isHovered) {
        ctx.fillStyle = '#ffcc00';
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      }

      ctx.textAlign = 'center';

      // Truncate name if needed
      const maxWidth = topSpan - 4;
      let name = contigNames[i];
      const measured = ctx.measureText(name);
      if (measured.width > maxWidth) {
        // Truncate with ellipsis
        while (name.length > 1 && ctx.measureText(name + '…').width > maxWidth) {
          name = name.slice(0, -1);
        }
        name += '…';
      }

      ctx.fillText(name, 0, 0, maxWidth);
      ctx.restore();

      // Left label (rotated)
      const screenY = this.mapToScreenY(mid, camera, canvasWidth, canvasHeight);
      const screenStartY = this.mapToScreenY(start, camera, canvasWidth, canvasHeight);
      const screenEndY = this.mapToScreenY(end, camera, canvasWidth, canvasHeight);
      const blockHeight = screenEndY - screenStartY;

      if (blockHeight < 20) continue;
      if (screenEndY < 0 || screenStartY > canvasHeight) continue;

      // Same treatment down the left edge: the rotated name is centred in the
      // part of the contig below the top gutter, so it no longer runs up across
      // the track names. A contig sitting entirely under the gutter is skipped.
      const leftSpanStart = Math.max(screenStartY, gutterBottom);
      const leftSpan = screenEndY - leftSpanStart;
      if (leftSpan < 20) continue;
      const leftLabelY = leftSpanStart + leftSpan / 2;

      ctx.save();
      ctx.translate(leftLabelX, leftLabelY);
      ctx.rotate(-Math.PI / 2);

      if (isHovered) {
        ctx.fillStyle = '#ffcc00';
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      }

      ctx.textAlign = 'center';
      ctx.fillText(contigNames[i], 0, 0, leftSpan - 4);
      ctx.restore();
    }

    ctx.restore();
  }
}
