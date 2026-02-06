/**
 * ComparisonMode — overlay original contig boundaries for visual comparison.
 */

import type { AppContext } from './AppContext';
import type { CameraState } from '../renderer/Camera';
import { state } from '../core/State';

export function toggleComparisonMode(ctx: AppContext): void {
  const s = state.get();
  if (!s.map) {
    ctx.showToast('No data loaded');
    return;
  }
  if (!ctx.comparisonSnapshot) {
    ctx.showToast('No comparison snapshot available');
    return;
  }
  ctx.comparisonVisible = !ctx.comparisonVisible;
  ctx.showToast(`Comparison: ${ctx.comparisonVisible ? 'ON' : 'OFF'}`);
}

export function renderComparisonOverlay(ctx: AppContext, canvasCtx: CanvasRenderingContext2D, cam: CameraState, canvasWidth: number, canvasHeight: number): void {
  if (!ctx.comparisonVisible || !ctx.comparisonSnapshot) return;
  const s = state.get();
  if (!s.map) return;

  // Build boundary arrays for original order
  const totalPixels = s.map.textureSize;
  const origBoundaries: number[] = [];
  let acc = 0;
  for (const contigId of ctx.comparisonSnapshot) {
    const contig = s.map.contigs[contigId];
    if (contig) {
      acc += (contig.pixelEnd - contig.pixelStart);
      origBoundaries.push(acc / totalPixels);
    }
  }

  // Draw original boundaries as semi-transparent blue lines
  canvasCtx.save();
  canvasCtx.setLineDash([4, 4]);
  canvasCtx.strokeStyle = 'rgba(52, 152, 219, 0.5)';
  canvasCtx.lineWidth = 1;

  for (const boundary of origBoundaries) {
    const screenX = (boundary - cam.x) * cam.zoom * canvasWidth + canvasWidth / 2;
    const screenY = (boundary - cam.y) * cam.zoom * canvasHeight + canvasHeight / 2;

    if (screenX > 0 && screenX < canvasWidth) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(screenX, 0);
      canvasCtx.lineTo(screenX, canvasHeight);
      canvasCtx.stroke();
    }
    if (screenY > 0 && screenY < canvasHeight) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, screenY);
      canvasCtx.lineTo(canvasWidth, screenY);
      canvasCtx.stroke();
    }
  }

  canvasCtx.restore();
}
