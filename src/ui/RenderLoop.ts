/**
 * RenderLoop — main animation loop, cut indicator, camera change handler, detail tiles.
 */

import type { AppContext } from './AppContext';
import type { CameraState } from '../renderer/Camera';
import { state } from '../core/State';
import { events } from '../core/EventBus';
import { renderDragIndicator } from '../curation/DragReorder';
import { decodeTileBatch } from '../renderer/TileDecoder';
import { renderComparisonOverlay } from './ComparisonMode';
import type { TileKey } from '../renderer/TileManager';

export function startRenderLoop(ctx: AppContext): void {
  const renderFrame = () => {
    const cam = ctx.camera.getState();
    const s = state.get();

    // Highlight from hover or single selection
    let highlightStart: number | undefined;
    let highlightEnd: number | undefined;
    if (ctx.hoveredContigIndex >= 0 && ctx.hoveredContigIndex < ctx.contigBoundaries.length) {
      highlightStart = ctx.hoveredContigIndex === 0 ? 0 : ctx.contigBoundaries[ctx.hoveredContigIndex - 1];
      highlightEnd = ctx.contigBoundaries[ctx.hoveredContigIndex];
    } else if (s.selectedContigs.size === 1) {
      const selIdx = Array.from(s.selectedContigs)[0];
      if (selIdx >= 0 && selIdx < ctx.contigBoundaries.length) {
        highlightStart = selIdx === 0 ? 0 : ctx.contigBoundaries[selIdx - 1];
        highlightEnd = ctx.contigBoundaries[selIdx];
      }
    }

    ctx.renderer.render(cam, {
      gamma: s.gamma,
      showGrid: s.showGrid,
      gridOpacity: 0.6,
      contigBoundaries: ctx.contigBoundaries,
      highlightStart,
      highlightEnd,
    });

    // Render detail tiles on top of the overview
    if (ctx.tileManager && s.map?.parsedHeader && cam.zoom > 1.5) {
      const tilesPerDim = s.map.parsedHeader.numberOfTextures1D;
      for (const key of ctx.tileManager.visibleKeys) {
        const tile = ctx.tileManager.getTile(key);
        if (tile && tile.state === 'loaded' && tile.texture) {
          ctx.renderer.renderTile(tile.texture, key.col, key.row, tilesPerDim, cam, s.gamma);
        }
      }
    }

    const mapCanvas = document.getElementById('map-canvas') as HTMLCanvasElement;
    const w = mapCanvas.clientWidth;
    const h = mapCanvas.clientHeight;

    if (ctx.labelRenderer && s.map) {
      const contigNames = s.contigOrder.map(id => s.map!.contigs[id]?.name ?? '');
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
      const contigScaffoldIds = s.contigOrder.map(id => s.map!.contigs[id]?.scaffoldId ?? null);
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

    document.getElementById('status-zoom')!.textContent = `${Math.round(cam.zoom * 100)}%`;

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
  events.emit('camera:changed', cam);
  updateDetailTiles(ctx, cam);
}

export function updateDetailTiles(ctx: AppContext, cam: CameraState): void {
  const s = state.get();
  if (!s.map || !s.map.rawTiles || !s.map.parsedHeader || !ctx.tileManager) return;

  // Only load detail tiles when zoomed in past the overview
  if (cam.zoom <= 1.5) return;

  const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  if (!canvas) return;

  const header = s.map.parsedHeader;
  const rawTiles = s.map.rawTiles;

  const visibleKeys = ctx.tileManager.updateVisibleTiles(
    cam,
    canvas.clientWidth,
    canvas.clientHeight,
    header.numberOfTextures1D,
    header.mipMapLevels,
  );

  // Find keys that need decoding
  const needDecode: TileKey[] = [];
  for (const key of visibleKeys) {
    if (!ctx.tileManager.hasTile(key)) {
      ctx.tileManager.markPending(key);
      needDecode.push(key);
    }
  }

  if (needDecode.length === 0) return;

  // Cancel any in-flight batch decode
  if (ctx.cancelTileDecode) {
    ctx.cancelTileDecode();
  }

  ctx.cancelTileDecode = decodeTileBatch(
    needDecode,
    rawTiles,
    header,
    (key, data) => {
      if (ctx.tileManager) {
        ctx.tileManager.loadTile(key, data);
      }
    },
    () => {
      ctx.cancelTileDecode = null;
    },
  );
}
