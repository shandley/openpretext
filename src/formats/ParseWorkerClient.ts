/**
 * ParseWorkerClient — main-thread client for the .pretext parse worker.
 *
 * Runs `parseAndAssemble` in a worker (transferring the input buffer in and the
 * overview + raw tiles back), with a synchronous fallback for environments
 * without Web Workers (tests, file:// protocol).
 */

import { parseAndAssemble, type AssembledPretext } from './PretextParser';

type ProgressCb = (message: string, percent: number) => void;

export class ParseWorkerClient {
  private worker: Worker | null = null;

  constructor() {
    try {
      this.worker = new Worker(
        new URL('./ParseWorker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch {
      this.worker = null;
    }
  }

  /**
   * Parse a .pretext buffer. When a worker is available the buffer is
   * transferred to it (the main thread no longer needs the raw bytes); otherwise
   * parsing runs synchronously on the main thread.
   */
  parse(buffer: ArrayBuffer, onProgress?: ProgressCb): Promise<AssembledPretext> {
    const worker = this.worker;
    if (!worker) {
      return parseAndAssemble(buffer, onProgress);
    }

    return new Promise<AssembledPretext>((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const onMessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          onProgress?.(msg.message, msg.percent);
          return;
        }
        cleanup();
        if (msg.type === 'result') resolve(msg.result as AssembledPretext);
        else reject(new Error(msg.message ?? 'Parse failed'));
      };
      const onError = (err: ErrorEvent) => {
        cleanup();
        reject(err.error ?? new Error('Parse worker error'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ buffer }, [buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
