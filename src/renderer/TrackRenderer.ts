/**
 * TrackRenderer — Draws 1D annotation tracks along the top and left edges
 * of the contact map using a dedicated 2D canvas overlay.
 *
 * Supports multiple track types:
 *   - 'line'    : continuous data rendered as a filled area/line plot
 *   - 'heatmap' : density data rendered as a thin colored strip
 *   - 'marker'  : discrete features rendered as small triangles
 *
 * Tracks stack outward from the map edge: the first track sits closest to
 * the contact map, subsequent tracks are pushed further out.
 *
 * The coordinate transform matches WebGLRenderer and LabelRenderer so that
 * track positions align exactly with the contact map pixels.
 */

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export type TrackType = 'line' | 'heatmap' | 'marker';

export interface TrackConfig {
  /** Unique identifier for this track. */
  name: string;
  /** How to render the data. */
  type: TrackType;
  /** Per-pixel values in [0, 1] range. Length should equal textureSize. */
  data: Float32Array;
  /** CSS color string (used for line/marker; ignored by heatmap which uses its own palette). */
  color: string;
  /** Height in CSS pixels allocated to this track. */
  height: number;
  /** Whether this track is currently drawn. */
  visible: boolean;
}

export interface TrackRenderOptions {
  camera: { x: number; y: number; zoom: number };
  canvasWidth: number;
  canvasHeight: number;
  textureSize: number;
}

// ---------------------------------------------------------------------------
// TrackRenderer class
// ---------------------------------------------------------------------------

export class TrackRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tracks: TrackConfig[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for track canvas');
    this.ctx = ctx;
  }

  // ─── Track Management ──────────────────────────────────────

  addTrack(config: TrackConfig): void {
    // Replace if a track with this name already exists
    const idx = this.tracks.findIndex(t => t.name === config.name);
    if (idx >= 0) {
      this.tracks[idx] = config;
    } else {
      this.tracks.push(config);
    }
  }

  removeTrack(name: string): boolean {
    const idx = this.tracks.findIndex(t => t.name === name);
    if (idx >= 0) {
      this.tracks.splice(idx, 1);
      return true;
    }
    return false;
  }

  setTrackVisibility(name: string, visible: boolean): void {
    const track = this.tracks.find(t => t.name === name);
    if (track) track.visible = visible;
  }

  toggleTrackVisibility(name: string): void {
    const track = this.tracks.find(t => t.name === name);
    if (track) track.visible = !track.visible;
  }

  setAllVisible(visible: boolean): void {
    for (const track of this.tracks) {
      track.visible = visible;
    }
  }

  getTracks(): ReadonlyArray<TrackConfig> {
    return this.tracks;
  }

  getTrack(name: string): TrackConfig | undefined {
    return this.tracks.find(t => t.name === name);
  }

  clearTracks(): void {
    this.tracks = [];
  }

  // ─── Coordinate Transforms ─────────────────────────────────
  // These exactly match LabelRenderer's transforms so tracks align
  // with the contact map.

  /**
   * Convert a normalized map coordinate (0-1) to screen pixel X.
   */
  mapToScreenX(
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
  mapToScreenY(
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

  // ─── Rendering ──────────────────────────────────────────────

  render(opts: TrackRenderOptions): void {
    const { camera, canvasWidth, canvasHeight, textureSize } = opts;
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

    const visibleTracks = this.tracks.filter(t => t.visible);
    if (visibleTracks.length === 0 || textureSize === 0) {
      ctx.restore();
      return;
    }

    // Compute the stacking offsets. Tracks stack outward from the map edge.
    // The first visible track is closest to the map (offset = 0 from edge).
    let topOffset = 0;
    let leftOffset = 0;

    for (const track of visibleTracks) {
      this.renderTopTrack(ctx, track, topOffset, camera, canvasWidth, canvasHeight, textureSize);
      this.renderLeftTrack(ctx, track, leftOffset, camera, canvasWidth, canvasHeight, textureSize);
      topOffset += track.height + 2; // 2px gap between tracks
      leftOffset += track.height + 2;
    }

    ctx.restore();
  }

  // ─── Per-axis track drawing ────────────────────────────────

  /**
   * Draw a track along the top edge. The track region spans
   * y = [topOffset .. topOffset + track.height] in CSS pixels.
   */
  private renderTopTrack(
    ctx: CanvasRenderingContext2D,
    track: TrackConfig,
    topOffset: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): void {
    const trackTop = topOffset;
    const trackBottom = topOffset + track.height;

    // Determine the map coordinate range visible on screen.
    // We iterate pixel-by-pixel in screen space and map back to data index.
    const screenLeft = 0;
    const screenRight = w;

    ctx.save();
    ctx.beginPath();
    ctx.rect(screenLeft, trackTop, screenRight - screenLeft, track.height);
    ctx.clip();

    // Draw a subtle dark background so the track is readable
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(screenLeft, trackTop, screenRight - screenLeft, track.height);

    switch (track.type) {
      case 'line':
        this.drawLinePlotHorizontal(ctx, track, trackTop, track.height, cam, w, h, textureSize);
        break;
      case 'heatmap':
        this.drawHeatmapHorizontal(ctx, track, trackTop, track.height, cam, w, h, textureSize);
        break;
      case 'marker':
        this.drawMarkersHorizontal(ctx, track, trackTop, track.height, cam, w, h, textureSize);
        break;
    }

    ctx.restore();
  }

  /**
   * Draw a track along the left edge (rotated). The track region spans
   * x = [leftOffset .. leftOffset + track.height] in CSS pixels.
   */
  private renderLeftTrack(
    ctx: CanvasRenderingContext2D,
    track: TrackConfig,
    leftOffset: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): void {
    const trackLeft = leftOffset;
    const trackRight = leftOffset + track.height;

    ctx.save();
    ctx.beginPath();
    ctx.rect(trackLeft, 0, track.height, h);
    ctx.clip();

    // Subtle background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(trackLeft, 0, track.height, h);

    switch (track.type) {
      case 'line':
        this.drawLinePlotVertical(ctx, track, trackLeft, track.height, cam, w, h, textureSize);
        break;
      case 'heatmap':
        this.drawHeatmapVertical(ctx, track, trackLeft, track.height, cam, w, h, textureSize);
        break;
      case 'marker':
        this.drawMarkersVertical(ctx, track, trackLeft, track.height, cam, w, h, textureSize);
        break;
    }

    ctx.restore();
  }

  // ─── Line plot ─────────────────────────────────────────────

  private drawLinePlotHorizontal(
    ctx: CanvasRenderingContext2D,
    track: TrackConfig,
    top: number,
    height: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): void {
    const data = track.data;
    const bottom = top + height;

    ctx.fillStyle = track.color.replace(')', ', 0.3)').replace('rgb(', 'rgba(');
    ctx.strokeStyle = track.color;
    ctx.lineWidth = 1.2;

    // Build the path at screen resolution — sample every screen pixel
    ctx.beginPath();
    let started = false;

    for (let sx = 0; sx < w; sx++) {
      const dataIdx = this.screenXToDataIndex(sx, cam, w, h, textureSize);
      if (dataIdx < 0 || dataIdx >= data.length) continue;

      const value = data[dataIdx];
      const y = bottom - value * height;

      if (!started) {
        ctx.moveTo(sx, y);
        started = true;
      } else {
        ctx.lineTo(sx, y);
      }
    }

    if (!started) return;

    // Stroke the line
    ctx.stroke();

    // Fill area under the line
    ctx.lineTo(w, bottom);
    ctx.lineTo(0, bottom);
    ctx.closePath();
    ctx.fill();
  }

  private drawLinePlotVertical(
    ctx: CanvasRenderingContext2D,
    track: TrackConfig,
    left: number,
    width: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): void {
    const data = track.data;
    const right = left + width;

    ctx.fillStyle = track.color.replace(')', ', 0.3)').replace('rgb(', 'rgba(');
    ctx.strokeStyle = track.color;
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    let started = false;

    for (let sy = 0; sy < h; sy++) {
      const dataIdx = this.screenYToDataIndex(sy, cam, w, h, textureSize);
      if (dataIdx < 0 || dataIdx >= data.length) continue;

      const value = data[dataIdx];
      const x = right - value * width;

      if (!started) {
        ctx.moveTo(x, sy);
        started = true;
      } else {
        ctx.lineTo(x, sy);
      }
    }

    if (!started) return;

    ctx.stroke();

    ctx.lineTo(right, h);
    ctx.lineTo(right, 0);
    ctx.closePath();
    ctx.fill();
  }

  // ─── Heatmap bar ──────────────────────────────────────────

  private drawHeatmapHorizontal(
    ctx: CanvasRenderingContext2D,
    track: TrackConfig,
    top: number,
    height: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): void {
    const data = track.data;

    for (let sx = 0; sx < w; sx++) {
      const dataIdx = this.screenXToDataIndex(sx, cam, w, h, textureSize);
      if (dataIdx < 0 || dataIdx >= data.length) continue;

      const value = data[dataIdx];
      ctx.fillStyle = this.valueToHeatmapColor(value);
      ctx.fillRect(sx, top, 1, height);
    }
  }

  private drawHeatmapVertical(
    ctx: CanvasRenderingContext2D,
    track: TrackConfig,
    left: number,
    width: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): void {
    const data = track.data;

    for (let sy = 0; sy < h; sy++) {
      const dataIdx = this.screenYToDataIndex(sy, cam, w, h, textureSize);
      if (dataIdx < 0 || dataIdx >= data.length) continue;

      const value = data[dataIdx];
      ctx.fillStyle = this.valueToHeatmapColor(value);
      ctx.fillRect(left, sy, width, 1);
    }
  }

  // ─── Marker ────────────────────────────────────────────────

  private drawMarkersHorizontal(
    ctx: CanvasRenderingContext2D,
    track: TrackConfig,
    top: number,
    height: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): void {
    const data = track.data;
    const midY = top + height / 2;
    const markerSize = Math.min(height * 0.4, 6);

    ctx.fillStyle = track.color;

    // Instead of checking every screen pixel, iterate data to find non-zero markers
    for (let di = 0; di < data.length; di++) {
      if (data[di] <= 0) continue;

      const mapCoord = di / textureSize;
      const sx = this.mapToScreenX(mapCoord, cam, w, h);

      if (sx < -markerSize || sx > w + markerSize) continue;

      // Draw a small downward-pointing triangle
      ctx.beginPath();
      ctx.moveTo(sx, midY - markerSize);
      ctx.lineTo(sx - markerSize, midY + markerSize);
      ctx.lineTo(sx + markerSize, midY + markerSize);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawMarkersVertical(
    ctx: CanvasRenderingContext2D,
    track: TrackConfig,
    left: number,
    width: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): void {
    const data = track.data;
    const midX = left + width / 2;
    const markerSize = Math.min(width * 0.4, 6);

    ctx.fillStyle = track.color;

    for (let di = 0; di < data.length; di++) {
      if (data[di] <= 0) continue;

      const mapCoord = di / textureSize;
      const sy = this.mapToScreenY(mapCoord, cam, w, h);

      if (sy < -markerSize || sy > h + markerSize) continue;

      // Draw a small rightward-pointing triangle
      ctx.beginPath();
      ctx.moveTo(midX - markerSize, sy);
      ctx.lineTo(midX + markerSize, sy - markerSize);
      ctx.lineTo(midX + markerSize, sy + markerSize);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ─── Utility ───────────────────────────────────────────────

  /**
   * Map a screen X pixel back to a data array index.
   * Returns -1 if out of range.
   */
  private screenXToDataIndex(
    sx: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): number {
    // Invert mapToScreenX:
    //   sx = ((mapX - cam.x) * zoom [/ aspect if aspect>1] + 0.5) * w
    //   (sx / w - 0.5) = (mapX - cam.x) * zoom [/ aspect]
    //   mapX = (sx / w - 0.5) * [aspect if aspect>1] / zoom + cam.x
    const aspect = w / h;
    let ndc = sx / w - 0.5;
    if (aspect > 1) {
      ndc *= aspect;
    }
    const mapX = ndc / cam.zoom + cam.x;
    const idx = Math.floor(mapX * textureSize);
    if (idx < 0 || idx >= textureSize) return -1;
    return idx;
  }

  /**
   * Map a screen Y pixel back to a data array index.
   */
  private screenYToDataIndex(
    sy: number,
    cam: { x: number; y: number; zoom: number },
    w: number,
    h: number,
    textureSize: number,
  ): number {
    const aspect = w / h;
    let ndc = sy / h - 0.5;
    if (aspect <= 1) {
      ndc /= aspect;
    }
    const mapY = ndc / cam.zoom + cam.y;
    const idx = Math.floor(mapY * textureSize);
    if (idx < 0 || idx >= textureSize) return -1;
    return idx;
  }

  /**
   * Convert a value in [0, 1] to a heatmap color string.
   * Uses a blue-yellow-red palette for visual distinction from the map itself.
   */
  private valueToHeatmapColor(value: number): string {
    const v = Math.max(0, Math.min(1, value));
    let r: number, g: number, b: number;

    if (v < 0.5) {
      // Blue to Yellow
      const t = v * 2;
      r = Math.round(t * 255);
      g = Math.round(t * 255);
      b = Math.round((1 - t) * 200);
    } else {
      // Yellow to Red
      const t = (v - 0.5) * 2;
      r = 255;
      g = Math.round((1 - t) * 255);
      b = 0;
    }

    return `rgb(${r},${g},${b})`;
  }
}
