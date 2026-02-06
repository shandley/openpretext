/**
 * LabelRenderer — Draws contig name labels along the top and left edges
 * of the contact map using a 2D canvas overlay.
 *
 * This sits on top of the WebGL canvas and renders text labels, tick marks,
 * and contig boundary indicators that would be impractical to do in GLSL.
 */

export interface LabelRenderOptions {
  contigBoundaries: number[];  // normalized 0-1 positions
  contigNames: string[];
  camera: { x: number; y: number; zoom: number };
  hoveredIndex: number;        // -1 if none
  canvasWidth: number;
  canvasHeight: number;
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
    const fontSize = Math.min(12, Math.max(8, 11 / (contigBoundaries.length / 12)));

    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

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

      // Top label
      ctx.save();
      ctx.translate(screenX, labelMargin + fontSize / 2);

      if (isHovered) {
        ctx.fillStyle = '#ffcc00';
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      }

      ctx.textAlign = 'center';

      // Truncate name if needed
      const maxWidth = blockWidth - 4;
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

      ctx.save();
      ctx.translate(labelMargin + fontSize / 2, screenY);
      ctx.rotate(-Math.PI / 2);

      if (isHovered) {
        ctx.fillStyle = '#ffcc00';
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      }

      ctx.textAlign = 'center';
      ctx.fillText(contigNames[i], 0, 0, blockHeight - 4);
      ctx.restore();
    }

    ctx.restore();
  }
}
