/**
 * Blind-curation helper: load a map in the built site, run the edits made so
 * far through the script console, take screenshots, optionally export.
 *
 *   npx tsx test-data/blind/view.ts <map> <outdir> [--script f] [--zoom "a,b,c"] [--tags f] [--export f] [--light]
 *
 * --zoom takes contig references the console's `zoom` understands (#index or name).
 * --tags is a file of lines "<tag> <#index> <#index> ..." applied through the sidebar.
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [map, outdir] = process.argv.slice(2);
const opt = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };

async function run(page: Page, lines: string[]): Promise<void> {
  await page.locator('#script-input').fill(lines.join('\n'));
  await page.evaluate(() => { document.getElementById('script-output')!.textContent = ''; });
  await page.locator('#btn-run-script').click();
  const summary = page.locator('#script-output .script-output-info').filter({ hasText: /succeeded/ }).last();
  await summary.waitFor({ timeout: 120_000 });
  const text = (await summary.textContent()) ?? '';
  if (!/ 0 failed/.test(text)) {
    const errors = await page.locator('#script-output .script-output-error').allTextContents();
    throw new Error(`console: ${text} ${errors.slice(0, 5).join(' | ')}`);
  }
}

async function settle(page: Page): Promise<void> { await page.waitForTimeout(2500); }

(async () => {
  mkdirSync(outdir, { recursive: true });
  const browser = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: Number(opt('--size') ?? 1500), height: Number(opt('--size') ?? 1500) }, acceptDownloads: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(opt('--url') ?? 'http://localhost:4173');
  await page.locator('#file-input').setInputFiles(map);
  await page.locator('#welcome').waitFor({ state: 'hidden', timeout: 120_000 });
  await page.evaluate(() => document.getElementById('btn-console')?.click());
  await page.locator('#script-console.visible').waitFor();

  const script = opt('--script');
  if (script) {
    const lines = readFileSync(script, 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    if (lines.length) await run(page, lines);
    console.log(`ran ${lines.length} commands`);
  }

  // The contig list after the edits: position, name, length, badges.
  await page.locator('#btn-sidebar').click();
  const items = await page.locator('#contig-list .contig-item').evaluateAll((els) => els.map((e) =>
    `${(e as HTMLElement).dataset.orderIndex}\t${e.querySelector('.contig-name')!.textContent}\t${e.querySelector('.contig-meta')!.textContent!.trim().replace(/\s+/g, ' ')}`));
  writeFileSync(join(outdir, 'contigs.tsv'), items.join('\n') + '\n');

  const tags = opt('--tags');
  if (tags) {
    for (const line of readFileSync(tags, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))) {
      const [tag, ...refs] = line.trim().split(/\s+/);
      for (const [n, r] of refs.entries()) {
        await page.locator(`#contig-list .contig-item[data-order-index="${r.replace('#', '')}"]`).click(n === 0 ? {} : { modifiers: ['ControlOrMeta'] });
      }
      await page.locator('#metatag-custom').fill('');
      await page.locator('#metatag-select').selectOption(tag);
      await page.locator('#btn-apply-metatag').click();
      console.log(`tagged ${refs.length} as ${tag}`);
    }
  }

  const exportTo = opt('--export');
  if (exportTo) {
    const [d] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.evaluate(() => (document.getElementById('btn-save-agp') as HTMLButtonElement).click()),
    ]);
    writeFileSync(exportTo, readFileSync(await d.path(), 'utf8'));
    console.log(`exported ${exportTo}`);
  }

  await page.locator('#btn-sidebar').click();
  const canvas = page.locator('#canvas-container');
  const shot = async (name: string) => { await settle(page); await canvas.screenshot({ path: join(outdir, `${name}.png`) }); console.log(`shot ${name}`); };
  await page.locator('#btn-close-console').click();
  await page.keyboard.press('x');
  await page.addStyleTag({ content: '.toast, #toast-container, #minimap-canvas, #minimap, #zoom-controls, #tooltip, .tooltip { display: none !important; }' });
  if (!process.argv.includes('--noshots')) await shot('full');
  for (const z of (opt('--zoom') ?? '').split(',').filter(Boolean)) {
    await page.evaluate(() => document.getElementById('btn-console')?.click());
    await page.locator('#script-console.visible').waitFor();
    await run(page, [`zoom ${z}`]);
    await page.locator('#btn-close-console').click();
    await shot(`zoom-${z.replace(/[^A-Za-z0-9_.]/g, '')}`);
  }
  // --views "name@x,y,steps;...": reset, then wheel-zoom at container point (x,y) by `steps` notches.
  const box = (await canvas.boundingBox())!;
  for (const v of (opt('--views') ?? '').split(';').filter(Boolean)) {
    const [name, rest] = v.split('@');
    const [x, y, steps] = rest.split(',').map(Number);
    await page.keyboard.press('0');
    await page.waitForTimeout(600);
    await page.mouse.move(box.x + x, box.y + y);
    for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
    await page.mouse.move(box.x + 5, box.y + box.height - 5);
    await shot(`view-${name}`);
  }
  // --actions "zoom:#0;wheel:x,y,n;key:e;move:x,y;click:x,y;shot:name;list:name;export:file;run:cmd text"
  const consoleRun = async (lines: string[]) => {
    await page.evaluate(() => document.getElementById('btn-console')?.click());
    await page.locator('#script-console.visible').waitFor();
    await run(page, lines);
    await page.locator('#btn-close-console').click();
  };
  for (const a of (opt('--actions') ?? '').split(';').filter(Boolean)) {
    const i = a.indexOf(':'); const kind = a.slice(0, i); const v = a.slice(i + 1);
    const nums = v.split(',').map(Number);
    if (kind === 'zoom') await consoleRun([`zoom ${v}`]);
    else if (kind === 'run') await consoleRun([v]);
    else if (kind === 'script') await consoleRun(readFileSync(v, 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#')));
    else if (kind === 'tag') {
      // tag:<Tag>=<name>,<name>,... through the sidebar list and tag controls
      const [tag, names] = v.split('=');
      await page.locator('#btn-sidebar').click();
      for (const [n, name] of names.split(',').entries()) {
        await page.locator('#contig-list .contig-item').filter({ has: page.locator('.contig-name', { hasText: new RegExp(`^${name.replace(/[.]/g, '\\.')}$`) }) })
          .click(n === 0 ? {} : { modifiers: ['ControlOrMeta'] });
      }
      await page.locator('#metatag-custom').fill('');
      await page.locator('#metatag-select').selectOption(tag);
      await page.locator('#btn-apply-metatag').click();
      console.log(`tagged ${names.split(',').length} as ${tag}`);
      await page.locator('#btn-sidebar').click();
    }
    else if (kind === 'wheel') { await page.mouse.move(box.x + nums[0], box.y + nums[1]); for (let k = 0; k < Math.abs(nums[2]); k++) { await page.mouse.wheel(0, nums[2] > 0 ? -120 : 120); await page.waitForTimeout(60); } }
    else if (kind === 'key') await page.keyboard.press(v);
    else if (kind === 'move') await page.mouse.move(box.x + nums[0], box.y + nums[1], { steps: 3 });
    else if (kind === 'click') await page.mouse.click(box.x + nums[0], box.y + nums[1]);
    else if (kind === 'shot') await shot(v);
    else if (kind === 'wait') await page.waitForTimeout(nums[0]);
    else if (kind === 'list') {
      await page.locator('#btn-sidebar').click();
      const rows = await page.locator('#contig-list .contig-item').evaluateAll((els) => els.map((e) =>
        `${(e as HTMLElement).dataset.orderIndex}\t${e.querySelector('.contig-name')!.textContent}\t${e.querySelector('.contig-meta')!.textContent!.trim().replace(/\s+/g, ' ')}`));
      writeFileSync(join(outdir, `${v}.tsv`), rows.join('\n') + '\n');
      await page.locator('#btn-sidebar').click();
    } else if (kind === 'export') {
      const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }),
        page.evaluate(() => (document.getElementById('btn-save-agp') as HTMLButtonElement).click())]);
      writeFileSync(v, readFileSync(await d.path(), 'utf8')); console.log(`exported ${v}`);
    } else throw new Error(`unknown action ${kind}`);
  }
  if (errors.length) console.log('PAGE ERRORS', errors.slice(0, 5));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
