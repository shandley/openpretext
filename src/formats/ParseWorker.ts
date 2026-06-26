/**
 * ParseWorker — parses a .pretext file off the main thread.
 *
 * Parsing a 30–200 MB file (full-file inflate + BC4 overview decode) blocks the
 * UI for seconds when done on the main thread. This worker runs the heavy
 * `parseAndAssemble` and transfers the overview + raw tile buffers back
 * zero-copy, so the only thing the main thread does is upload to the GPU.
 */

import { parseAndAssemble } from './PretextParser';

interface ParseRequest {
  buffer: ArrayBuffer;
}

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { buffer } = event.data;
  const post = (self as unknown as Worker).postMessage.bind(self);
  try {
    const result = await parseAndAssemble(buffer, (message, percent) => {
      post({ type: 'progress', message, percent });
    });
    // Transfer the large buffers (overview + raw tiles) back zero-copy.
    // Dedupe in case any tiles ever share an underlying buffer.
    const buffers = new Set<ArrayBufferLike>();
    buffers.add(result.overview.buffer);
    for (const t of result.tiles) buffers.add(t.buffer);
    post({ type: 'result', result }, Array.from(buffers) as Transferable[]);
  } catch (e) {
    post({ type: 'error', message: (e as Error).message });
  }
};
