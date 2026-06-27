/**
 * RenderLoop — main animation loop, cut indicator, camera change handler, detail tiles.
 */

import type { AppContext } from './AppContext';
import type { CameraState } from '../renderer/Camera';
import { state } from '../core/State';
import { events } from '../core/EventBus';
import { renderDragIndicator } from '../curation/DragReorder';
import { renderComparisonOverlay } from './ComparisonMode';
import type { TileKey } from '../renderer/TileManager';
import { getContigNames, getContigScaffoldIds } from '../core/DerivedState';

/**
 * Delay before kicking off detail-tile decoding once camera motion settles.
 * During an active pan/zoom only the overview is shown (cheap), which avoids
 * decode churn and keeps interaction smooth.
 */
const TILE_DECODE_DEBOUNCE_MS = 100;

/** Detail tiles only stream in once zoomed past the overview. */
const TILE_DETAIL_MIN_ZOOM = 1.5;

export function startRenderLoop(ctx: AppContext): void {
  // Wake the render loop whenever something that affects the display changes.
  // - state.update covers gamma/grid/mode/selection/colormap/curation/etc.
  // - camera changes call ctx.requestRender() via onCameraChange.
  // - document input events are a safety net for any non-state visual change
  //   (track toggles, dropdowns, sliders) so we never show a stale frame.
  state.subscribe(() => { ctx.renderDirty = true; });
  const wake = () => { ctx.renderDirty = true; };
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'click', 'input', 'change']) {
    document.addEventListener(ev, wake, { capture: true, passive: true });
  }
  window.addEventListener('resize', wake);

  // Tracks the falling edge of the flash highlight so we render one final frame
  // to clear it after it expires.
  let flashWasActive = false;

  const renderFrame = () => {
    const now = performance.now();
    const flashActive = ctx.flashHighlightUntil > now;

    // Idle skip: nothing changed and no time-based effect is running.
    if (!ctx.renderDirty && !flashActive && !flashWasActive && !ctx.dragReorder.isActive()) {
      ctx.animFrameId = requestAnimationFrame(renderFrame);
      return;
    }
    ctx.renderDirty = false;
    flashWasActive = flashActive;

    const cam = ctx.camera.getState();
    const s = state.get();

    // Highlight from hover, single selection, or curation flash
    let highlightStart: number | undefined;
    let highlightEnd: number | undefined;

    if (ctx.flashHighlightUntil > now) {
      // Active curation flash — override hover/selection highlight
      highlightStart = ctx.flashHighlightStart;
      highlightEnd = ctx.flashHighlightEnd;
    } else if (ctx.hoveredContigIndex >= 0 && ctx.hoveredContigIndex < ctx.contigBoundaries.length) {
      highlightStart = ctx.hoveredContigIndex === 0 ? 0 : ctx.contigBoundaries[ctx.hoveredContigIndex - 1];
      highlightEnd = ctx.contigBoundaries[ctx.hoveredContigIndex];
    } else if (s.selectedContigs.size === 1) {
      const selIdx = s.selectedContigs.values().next().value as number;
      if (selIdx >= 0 && selIdx < ctx.contigBoundaries.length) {
        highlightStart = selIdx === 0 ? 0 : ctx.contigBoundaries[selIdx - 1];
        highlightEnd = ctx.contigBoundaries[selIdx];
      }
    }

    ctx.renderer.render(cam, {
      gamma: s.gamma,
      floor: s.signalFloor,
      showGrid: s.showGrid,
      gridOpacity: 0.6,
      contigBoundaries: ctx.contigBoundaries,
      highlightStart,
      highlightEnd,
    });

    // Render detail tiles on top of the overview. Shared GL state (program,
    // camera/zoom/gamma uniforms, color map) is set once per frame, not per tile.
    if (ctx.tileManager && s.map?.parsedHeader && cam.zoom > 1.5) {
      const tilesPerDim = s.map.parsedHeader.numberOfTextures1D;
      let started = false;
      for (const key of ctx.tileManager.visibleKeys) {
        const tile = ctx.tileManager.getTile(key);
        if (tile && tile.state === 'loaded' && tile.texture) {
          if (!started) { ctx.renderer.beginTiles(cam, s.gamma, s.signalFloor); started = true; }
          ctx.renderer.drawTile(tile.texture, key.col, key.row, tilesPerDim);
        }
      }
      if (started) ctx.renderer.endTiles();
    }

    const mapCanvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    const w = mapCanvas.clientWidth;
    const h = mapCanvas.clientHeight;

    if (ctx.labelRenderer && s.map) {
      const contigNames = getContigNames();
      ctx.labelRenderer.render({
        contigBoundaries: ctx.contigBoundaries,
        contigNames,
        camera: cam,
        hoveredIndex: ctx.hoveredContigIndex,
        canvasWidth: w,
        canvasHeight: h,
      });

      // Draw drag indicator on the label canvas if dragging
      if (ctx.dragReorder.isActive()) {
        const labelCanvas = document.getElementById('label-canvas') as HTMLCanvasElement;
        const labelCtx = labelCanvas.getContext('2d');
        if (labelCtx) {
          renderDragIndicator(labelCtx, ctx.dragReorder.getDragState(), ctx.contigBoundaries, cam, w, h);
        }
      }

      // Draw cut indicator in edit mode
      if (ctx.currentMode === 'edit' && ctx.hoveredContigIndex >= 0 && !ctx.dragReorder.isActive()) {
        const labelCanvas = document.getElementById('label-canvas') as HTMLCanvasElement;
        const labelCtx = labelCanvas.getContext('2d');
        if (labelCtx) {
          renderCutIndicator(ctx, labelCtx, cam, w, h);
        }
      }

      // Draw comparison overlay
      if (ctx.comparisonVisible) {
        const labelCanvas = document.getElementById('label-canvas') as HTMLCanvasElement;
        const labelCtx = labelCanvas.getContext('2d');
        if (labelCtx) {
          renderComparisonOverlay(ctx, labelCtx, cam, w, h);
        }
      }
    }

    // Scaffold overlay
    if (ctx.scaffoldOverlay && s.map) {
      const contigScaffoldIds = getContigScaffoldIds();
      const scaffoldMap = new Map(
        ctx.scaffoldManager.getAllScaffolds().map(sc => [sc.id, sc])
      );
      ctx.scaffoldOverlay.render({
        contigBoundaries: ctx.contigBoundaries,
        contigScaffoldIds,
        scaffolds: scaffoldMap,
        camera: cam,
        canvasWidth: w,
        canvasHeight: h,
      });
    }

    // Track rendering
    if (ctx.trackRenderer && ctx.tracksVisible && s.map) {
      ctx.trackRenderer.render({
        camera: cam,
        canvasWidth: w,
        canvasHeight: h,
        textureSize: s.map.textureSize,
      });
    } else if (ctx.trackRenderer) {
      ctx.trackRenderer.clear();
    }

    // Waypoint overlay
    if (ctx.waypointOverlay) {
      ctx.waypointOverlay.render({
        camera: cam,
        canvasWidth: w,
        canvasHeight: h,
        waypoints: ctx.waypointManager.getAllWaypoints(),
        currentWaypointId: ctx.currentWaypointId,
      });
    }

    // Minimap
    ctx.minimap.render(cam);

    const zoomPct = `${Math.round(cam.zoom * 100)}%`;
    document.getElementById('status-zoom')!.textContent = zoomPct;
    const zoomLevel = document.getElementById('zoom-level');
    if (zoomLevel) zoomLevel.textContent = zoomPct;

    ctx.animFrameId = requestAnimationFrame(renderFrame);
  };
  renderFrame();
}

export function renderCutIndicator(ctx: AppContext, canvasCtx: CanvasRenderingContext2D, cam: CameraState, canvasWidth: number, canvasHeight: number): void {
  const mapX = ctx.mouseMapPos.x;
  // Convert map position to canvas pixel
  const canvasX = (mapX - cam.x) * cam.zoom * canvasWidth + canvasWidth / 2;

  canvasCtx.save();
  canvasCtx.setLineDash([6, 4]);
  canvasCtx.strokeStyle = 'rgba(255, 220, 50, 0.8)';
  canvasCtx.lineWidth = 1.5;

  // Vertical line
  canvasCtx.beginPath();
  canvasCtx.moveTo(canvasX, 0);
  canvasCtx.lineTo(canvasX, canvasHeight);
  canvasCtx.stroke();

  // Horizontal line
  const canvasY = (mapX - cam.y) * cam.zoom * canvasHeight + canvasHeight / 2;
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, canvasY);
  canvasCtx.lineTo(canvasWidth, canvasY);
  canvasCtx.stroke();

  canvasCtx.restore();
}

export function onCameraChange(ctx: AppContext, cam: CameraState): void {
  ctx.renderDirty = true;
  events.emit('camera:changed', cam);
  updateDetailTiles(ctx, cam);
}

export function updateDetailTiles(ctx: AppContext, cam: CameraState): void {
  const s = state.get();
  if (!s.map || !s.map.parsedHeader || !ctx.tileManager || !ctx.tileDecoder) return;

  // Cancel any scheduled/in-flight decode; we recompute below.
  if (ctx.tileDecodeDebounce !== null) {
    clearTimeout(ctx.tileDecodeDebounce);
    ctx.tileDecodeDebounce = null;
  }

  // Only stream detail tiles when zoomed in past the overview.
  if (cam.zoom <= TILE_DETAIL_MIN_ZOOM) {
    ctx.tileDecoder.cancel();
    return;
  }

  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  if (!canvas) return;

  const header = s.map.parsedHeader;

  // Recompute which tiles are visible every call (cheap) so the render loop
  // draws the right loaded tiles and visible tiles are kept warm in the LRU.
  ctx.tileManager.updateVisibleTiles(
    cam,
    canvas.clientWidth,
    canvas.clientHeight,
    header.numberOfTextures1D,
    header.mipMapLevels,
  );

  // Defer the actual (expensive) decode until camera motion settles. The
  // overview keeps the map visible in the meantime.
  ctx.tileDecodeDebounce = setTimeout(() => {
    ctx.tileDecodeDebounce = null;
    scheduleDetailDecode(ctx);
  }, TILE_DECODE_DEBOUNCE_MS);
}

/**
 * Queue decoding for every currently-visible tile that is not already loaded.
 *
 * The guard is state-based (not presence-based): a tile that was requested but
 * never finished decoding has no `loaded` entry and is re-queued, so tiles can
 * never get permanently stuck and leave blank/white blocks.
 */
function scheduleDetailDecode(ctx: AppContext): void {
  if (!ctx.tileManager || !ctx.tileDecoder) return;

  const needDecode: TileKey[] = [];
  for (const key of ctx.tileManager.visibleKeys) {
    const tile = ctx.tileManager.getTile(key);
    if (!tile || tile.state !== 'loaded') {
      needDecode.push(key);
    }
  }

  if (needDecode.length === 0) return;
  ctx.tileDecoder.decode(needDecode);
}
