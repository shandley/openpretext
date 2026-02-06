/**
 * Canvas snapshot exporter.
 *
 * Captures the current WebGL canvas as a PNG image and either triggers
 * a browser download or returns the image as a data URL for programmatic use.
 *
 * Important WebGL note: the canvas must have `preserveDrawingBuffer: true`
 * set in the WebGL context options for toDataURL/toBlob to work, OR the
 * snapshot must be taken synchronously within the same frame as the render.
 */

export interface SnapshotOptions {
  /** Image format. Defaults to 'image/png'. */
  mimeType?: 'image/png' | 'image/jpeg';
  /** Quality for JPEG (0-1). Ignored for PNG. Defaults to 0.92. */
  quality?: number;
  /** Optional filename for download. Defaults to 'openpretext_snapshot_{timestamp}.png'. */
  filename?: string;
  /** Whether to include UI overlays. If true, composites the overlay canvas. Defaults to false. */
  includeOverlays?: boolean;
}

const DEFAULT_OPTIONS: Required<SnapshotOptions> = {
  mimeType: 'image/png',
  quality: 0.92,
  filename: '',
  includeOverlays: false,
};

/**
 * Generate a default filename based on the current timestamp.
 */
function generateFilename(mimeType: string): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  return `openpretext_snapshot_${timestamp}.${extension}`;
}

/**
 * Captures the WebGL canvas content as a data URL string.
 *
 * If the canvas was created without `preserveDrawingBuffer: true`, you need
 * to call this within the same requestAnimationFrame callback as the render,
 * or re-render before calling this function.
 *
 * @param canvas  - The WebGL canvas element
 * @param options - Snapshot configuration
 * @returns A data URL string (e.g., "data:image/png;base64,...")
 */
export function captureDataURL(
  canvas: HTMLCanvasElement,
  options: SnapshotOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (opts.includeOverlays) {
    return captureWithOverlays(canvas, opts);
  }

  return canvas.toDataURL(opts.mimeType, opts.quality);
}

/**
 * Captures the canvas and composites any overlay elements on top.
 * This creates an offscreen canvas, draws the WebGL canvas, then
 * draws any sibling overlay canvases on top.
 */
function captureWithOverlays(
  canvas: HTMLCanvasElement,
  opts: Required<SnapshotOptions>
): string {
  const offscreen = document.createElement('canvas');
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;

  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create 2D context for snapshot compositing');
  }

  // Draw the main WebGL canvas
  ctx.drawImage(canvas, 0, 0);

  // Look for overlay canvases that are siblings or children of the same parent
  const parent = canvas.parentElement;
  if (parent) {
    const overlays = parent.querySelectorAll('canvas');
    for (const overlay of overlays) {
      if (overlay !== canvas && overlay !== offscreen) {
        ctx.drawImage(overlay, 0, 0);
      }
    }
  }

  return offscreen.toDataURL(opts.mimeType, opts.quality);
}

/**
 * Captures the canvas as a Blob, useful for more efficient handling
 * of large images or for sending to APIs.
 *
 * @param canvas  - The WebGL canvas element
 * @param options - Snapshot configuration
 * @returns A Promise that resolves to a Blob
 */
export function captureBlob(
  canvas: HTMLCanvasElement,
  options: SnapshotOptions = {}
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let sourceCanvas: HTMLCanvasElement = canvas;

  if (opts.includeOverlays) {
    // Create a composited canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;

    const ctx = offscreen.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to create 2D context for snapshot compositing');
    }

    ctx.drawImage(canvas, 0, 0);

    const parent = canvas.parentElement;
    if (parent) {
      const overlays = parent.querySelectorAll('canvas');
      for (const overlay of overlays) {
        if (overlay !== canvas && overlay !== offscreen) {
          ctx.drawImage(overlay, 0, 0);
        }
      }
    }

    sourceCanvas = offscreen;
  }

  return new Promise<Blob>((resolve, reject) => {
    sourceCanvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob returned null'));
        }
      },
      opts.mimeType,
      opts.quality
    );
  });
}

/**
 * Captures the canvas as a PNG and triggers a browser download.
 *
 * @param canvas  - The WebGL canvas element
 * @param options - Snapshot configuration
 */
export function downloadSnapshot(
  canvas: HTMLCanvasElement,
  options: SnapshotOptions = {}
): void {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dataURL = captureDataURL(canvas, opts);
  const filename = opts.filename || generateFilename(opts.mimeType);

  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Captures the canvas as a Blob and triggers a browser download.
 * More memory-efficient than downloadSnapshot for large canvases since
 * it avoids the base64 encoding overhead of data URLs.
 *
 * @param canvas  - The WebGL canvas element
 * @param options - Snapshot configuration
 */
export async function downloadSnapshotBlob(
  canvas: HTMLCanvasElement,
  options: SnapshotOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const blob = await captureBlob(canvas, opts);
  const filename = opts.filename || generateFilename(opts.mimeType);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
