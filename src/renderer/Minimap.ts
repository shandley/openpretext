/**
 * Minimap — Small overview map in the corner showing the full contact map
 * with a viewport indicator rectangle.
 *
 * Renders a downsampled version of the contact map using a 2D canvas,
 * then draws the current camera viewport as a bordered rectangle.
 * Supports click-to-jump and drag-to-pan.
 */

import type { CameraState } from './Camera';

export interface MinimapOptions {
  size: number;         // pixel size of the minimap (square)
  margin: number;       // margin from corner
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

const DEFAULT_OPTIONS: MinimapOptions = {
  size: 160,
  margin: 12,
  position: 'bottom-right',
};

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private options: MinimapOptions;

  // Cached thumbnail of the contact map
  private thumbnail: ImageData | null = null;
  private thumbnailCanvas: HTMLCanvasElement;
  private thumbnailCtx: CanvasRenderingContext2D;

  // Interaction state
  private isDragging = false;
  private isVisible = true;

  // Callback for when user clicks/drags the minimap
  private onNavigate: ((mapX: number, mapY: number) => void) | null = null;

  constructor(container: HTMLElement, options?: Partial<MinimapOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Create the minimap canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap-canvas';
    this.canvas.width = this.options.size;
    this.canvas.height = this.options.size;
    this.applyPositionStyles();
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for minimap');
    this.ctx = ctx;

    // Offscreen canvas for thumbnail caching
    this.thumbnailCanvas = document.createElement('canvas');
    this.thumbnailCanvas.width = this.options.size;
    this.thumbnailCanvas.height = this.options.size;
    const tCtx = this.thumbnailCanvas.getContext('2d');
    if (!tCtx) throw new Error('Failed to get 2D context for thumbnail');
    this.thumbnailCtx = tCtx;

    this.setupInteraction();
  }

  private applyPositionStyles(): void {
    const s = this.canvas.style;
    s.position = 'absolute';
    s.zIndex = '50';
    s.borderRadius = '4px';
    s.border = '1px solid rgba(255,255,255,0.2)';
    s.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
    s.cursor = 'crosshair';
    s.imageRendering = 'pixelated';

    const m = `${this.options.margin}px`;
    switch (this.options.position) {
      case 'bottom-right':
        s.bottom = m; s.right = m;
        break;
      case 'bottom-left':
        s.bottom = m; s.left = m;
        break;
      case 'top-right':
        s.top = m; s.right = m;
        break;
      case 'top-left':
        s.top = m; s.left = m;
        break;
    }
  }

  /**
   * Generate a thumbnail from contact map data.
   * Downsamples the full-resolution map to minimap size.
   */
  updateThumbnail(contactMap: Float32Array, mapSize: number, colorMap?: (value: number, gamma: number) => [number, number, number]): void {
    const size = this.options.size;
    const imageData = this.thumbnailCtx.createImageData(size, size);
    const pixels = imageData.data;
    const scale = mapSize / size;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Sample from the contact map (average a block)
        const srcX = Math.floor(x * scale);
        const srcY = Math.floor(y * scale);
        const idx = srcY * mapSize + srcX;
        const value = contactMap[idx] ?? 0;

        // Apply simple gamma and grayscale → reddish color
        const gamma = 0.35;
        const mapped = Math.pow(Math.min(1, Math.max(0, value)), gamma);

        const pi = (y * size + x) * 4;
        if (colorMap) {
          const [r, g, b] = colorMap(mapped, gamma);
          pixels[pi] = r;
          pixels[pi + 1] = g;
          pixels[pi + 2] = b;
        } else {
          // Default red-white color map
          pixels[pi] = Math.round(255);
          pixels[pi + 1] = Math.round((1 - mapped) * 255);
          pixels[pi + 2] = Math.round((1 - mapped) * 255);
        }
        pixels[pi + 3] = 255;
      }
    }

    this.thumbnail = imageData;
    this.thumbnailCtx.putImageData(imageData, 0, 0);
  }

  /**
   * Render the minimap: thumbnail + viewport rectangle.
   */
  render(camera: CameraState): void {
    if (!this.isVisible) {
      this.canvas.style.display = 'none';
      return;
    }
    this.canvas.style.display = 'block';

    const ctx = this.ctx;
    const size = this.options.size;

    // Clear
    ctx.clearRect(0, 0, size, size);

    // Draw thumbnail background
    if (this.thumbnail) {
      ctx.drawImage(this.thumbnailCanvas, 0, 0);
    } else {
      ctx.fillStyle = 'rgba(15, 15, 30, 0.9)';
      ctx.fillRect(0, 0, size, size);
    }

    // Compute viewport rectangle in minimap space
    // The camera sees a region: center ± 0.5/zoom in each axis
    const halfW = 0.5 / camera.zoom;
    const halfH = 0.5 / camera.zoom;

    const vpLeft = (camera.x - halfW) * size;
    const vpTop = (camera.y - halfH) * size;
    const vpWidth = (2 * halfW) * size;
    const vpHeight = (2 * halfH) * size;

    // Draw semi-transparent overlay outside viewport
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    // Top
    ctx.fillRect(0, 0, size, Math.max(0, vpTop));
    // Bottom
    ctx.fillRect(0, vpTop + vpHeight, size, size - (vpTop + vpHeight));
    // Left
    ctx.fillRect(0, Math.max(0, vpTop), Math.max(0, vpLeft), Math.min(vpHeight, size));
    // Right
    ctx.fillRect(vpLeft + vpWidth, Math.max(0, vpTop), size - (vpLeft + vpWidth), Math.min(vpHeight, size));

    // Draw viewport rectangle
    ctx.strokeStyle = 'rgba(233, 69, 96, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(vpLeft, vpTop, vpWidth, vpHeight);

    // Inner white border for contrast
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vpLeft + 1, vpTop + 1, vpWidth - 2, vpHeight - 2);
  }

  /**
   * Set callback for navigation events (click/drag on minimap).
   */
  setNavigateCallback(cb: (mapX: number, mapY: number) => void): void {
    this.onNavigate = cb;
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.canvas.style.display = visible ? 'block' : 'none';
  }

  toggle(): void {
    this.setVisible(!this.isVisible);
  }

  private setupInteraction(): void {
    const canvas = this.canvas;

    canvas.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.isDragging = true;
      this.handleMinimapClick(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.handleMinimapClick(e);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }

  private handleMinimapClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Clamp to 0-1
    const mapX = Math.max(0, Math.min(1, x));
    const mapY = Math.max(0, Math.min(1, y));

    if (this.onNavigate) {
      this.onNavigate(mapX, mapY);
    }
  }
}
