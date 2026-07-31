/**
 * figures.ts — capture publication figures from the real app, reproducibly.
 *
 * Screenshots taken by hand drift: different window sizes, different zoom, a
 * tooltip left open, panels captured on different days at different contrast.
 * Figure 4 of the paper puts three states of the same assembly side by side, so
 * they have to be captured under identical settings or the comparison is not one.
 *
 * This drives the deployed UI in headless Chromium at a fixed viewport and device
 * scale, applies an optional curation (a DSL script, or a published AGP), waits
 * for the render to actually stop changing, and writes a PNG.
 *
 * The wait matters. Detail tiles stream in asynchronously, so a screenshot taken
 * on a timer catches a half-resolved map. This polls a fingerprint of the canvas
 * until it stops moving.
 *
 * Usage:
 *   npx tsx bench/figures.ts --pretext <f.pretext> --out fig.png
 *                            [--script <f.dsl>] [--agp <f.agp>]
 *                            [--width 1600] [--height 1200] [--scale 2]
 *                            [--element <css>] [--no-tracks] [--no-grid]
 *                            [--url <url>]
 *
 * Figure 4, three panels from one map:
 *   npx tsx bench/figures.ts --pretext m.pretext --out fig4a-before.png
 *   npx tsx bench/figures.ts --pretext m.pretext --script ours.dsl --out fig4b-ours.png
 *   npx tsx bench/figures.ts --pretext m.pretext --agp published.agp --out fig4c-published.png
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { chromium, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Args (pure, testable)
// ---------------------------------------------------------------------------

export interface FigureArgs {
  pretext?: string;
  out?: string;
  script?: string;
  agp?: string;
  width: number;
  height: number;
  scale: number;
  element: string;
  tracks: boolean;
  grid: boolean;
  url: string;
  /** Also hide the zoom control and the minimap. */
  bare: boolean;
  /** Extra selectors to hide, repeatable. */
  hide: string[];
}

/**
 * Always hidden. Toasts are transient status ("63 potential misassemblies
 * detected", the scroll/drag hint) that happen to be on screen when the capture
 * fires, so they land in a figure at random depending on timing.
 */
export const ALWAYS_HIDDEN = '#toast-container';

/** Hidden with --bare: real UI, but chrome rather than data. */
export const CHROME_SELECTORS = '#zoom-controls, #minimap-canvas';

export const FIGURE_DEFAULTS: FigureArgs = {
  width: 1600,
  height: 1200,
  // 2 gives a 3200px-wide capture, enough for a 183mm full-width figure at 300 dpi.
  scale: 2,
  element: '#canvas-container',
  tracks: true,
  grid: true,
  url: 'http://localhost:3000',
  bare: false,
  hide: [],
};

export function parseFigureArgs(argv: string[]): FigureArgs {
  const args: FigureArgs = { ...FIGURE_DEFAULTS, hide: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pretext') args.pretext = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--script') args.script = argv[++i];
    else if (a === '--agp') args.agp = argv[++i];
    else if (a === '--width') args.width = Number(argv[++i]);
    else if (a === '--height') args.height = Number(argv[++i]);
    else if (a === '--scale') args.scale = Number(argv[++i]);
    else if (a === '--element') args.element = argv[++i]!;
    else if (a === '--no-tracks') args.tracks = false;
    else if (a === '--no-grid') args.grid = false;
    else if (a === '--url') args.url = argv[++i]!;
    else if (a === '--bare') args.bare = true;
    else if (a === '--hide') args.hide.push(argv[++i]!);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isFinite(args.width) || args.width <= 0) throw new Error('--width must be a positive number');
  if (!Number.isFinite(args.height) || args.height <= 0) throw new Error('--height must be a positive number');
  if (!Number.isFinite(args.scale) || args.scale <= 0) throw new Error('--scale must be a positive number');
  return args;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

/**
 * A cheap summary of what the map canvas currently shows.
 *
 * The full canvas is drawn down to 64x64 and summed, so the number changes while
 * tiles are still arriving and stops changing once they are not.
 */
async function canvasFingerprint(page: Page): Promise<number> {
  return page.evaluate(() => {
    const src = document.getElementById('map-canvas') as HTMLCanvasElement | null;
    if (!src) return -1;
    const off = document.createElement('canvas');
    off.width = 64;
    off.height = 64;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(src, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum = (sum + d[i] * (i % 7 + 1)) % 2147483647;
    return sum;
  });
}

/** Wait until the canvas stops changing, or give up and say so. */
async function settle(page: Page, stableReads = 3, pollMs = 400, maxPolls = 75): Promise<boolean> {
  let last = await canvasFingerprint(page);
  let stable = 0;
  for (let i = 0; i < maxPolls; i++) {
    await page.waitForTimeout(pollMs);
    const now = await canvasFingerprint(page);
    stable = now === last ? stable + 1 : 0;
    last = now;
    if (stable >= stableReads) return true;
  }
  return false;
}

/** Start a dev server if nothing is answering, and return how to stop it. */
async function ensureServer(url: string): Promise<ChildProcess | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) return null;
  } catch {
    // not running
  }
  const port = new URL(url).port || '3000';
  process.stderr.write(`No server at ${url}, starting vite on ${port}\n`);
  const proc = spawn('npx', ['vite', '--port', port], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return proc;
    } catch {
      // still starting
    }
  }
  proc.kill();
  throw new Error(`vite did not come up on ${url}`);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function capture(args: FigureArgs): Promise<void> {
  const server = await ensureServer(args.url);
  const browser = await chromium.launch({
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: args.width, height: args.height },
      deviceScaleFactor: args.scale,
    });
    const page = await context.newPage();
    await page.goto(args.url);
    await page.waitForSelector('#welcome', { state: 'visible' });

    // Suppress transient and chrome UI before anything can render into the shot.
    const hidden = [ALWAYS_HIDDEN, ...(args.bare ? [CHROME_SELECTORS] : []), ...args.hide];
    await page.addStyleTag({ content: `${hidden.join(', ')} { display: none !important; }` });

    await page.locator('#file-input').setInputFiles(args.pretext!);
    await page.waitForSelector('#welcome', { state: 'hidden', timeout: 120_000 });
    await page.waitForFunction(
      () => (document.getElementById('status-contigs')?.textContent ?? '').includes('contig'),
      undefined,
      { timeout: 120_000 },
    );

    // A published or prior curation, applied to the same map so the panels are
    // the same pixels under different arrangements.
    if (args.agp) {
      await page.locator('#agp-file-input').setInputFiles(args.agp);
      await page.waitForTimeout(2000);
    }

    // Our own curation, through the same DSL the paper reports.
    if (args.script) {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile(args.script, 'utf8');
      const consoleEl = page.locator('#script-console');
      if (!(await consoleEl.evaluate((el) => el.classList.contains('visible')))) {
        await page.evaluate(() => document.getElementById('btn-console')?.click());
      }
      await page.locator('#script-input').fill(text);
      await page.evaluate(() => document.getElementById('btn-run-script')?.click());
      await page.waitForTimeout(2000);
      // Close it again so it is not in the shot.
      await page.evaluate(() => document.getElementById('btn-console')?.click());
    }

    if (!args.tracks) await page.keyboard.press('x');
    if (!args.grid) await page.keyboard.press('l');

    // Fit the whole map, then park the pointer so no tooltip or hover highlight
    // lands in the figure.
    await page.keyboard.press('0');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(600);

    const settled = await settle(page);
    if (!settled) {
      process.stderr.write('WARNING: canvas never stopped changing; tiles may be incomplete\n');
    }

    await page.locator(args.element).screenshot({ path: args.out! });
    process.stderr.write(`Wrote ${args.out} at ${args.width}x${args.height} scale ${args.scale}\n`);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

const USAGE = `figures — capture publication figures from the running app

Usage:
  npx tsx bench/figures.ts --pretext <f.pretext> --out <f.png>
                           [--script <f.dsl>] [--agp <f.agp>]
                           [--width ${FIGURE_DEFAULTS.width}] [--height ${FIGURE_DEFAULTS.height}] [--scale ${FIGURE_DEFAULTS.scale}]
                           [--element ${FIGURE_DEFAULTS.element}] [--no-tracks] [--no-grid]
                           [--bare] [--hide <css>] [--url ${FIGURE_DEFAULTS.url}]

Starts a dev server if one is not already answering. Waits for the canvas to
stop changing before capturing, so streaming detail tiles are not caught
half-resolved. --scale 2 at the default size gives a 3200px-wide capture,
enough for a 183mm full-width figure at 300 dpi.

Toasts are always hidden: they are transient status that lands in the shot
depending on timing. --bare also hides the zoom control and the minimap.`;

async function main(): Promise<number> {
  let args: FigureArgs;
  try {
    args = parseFigureArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${USAGE}\n`);
    return 2;
  }
  if (!args.pretext || !args.out) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  await capture(args);
  return 0;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
