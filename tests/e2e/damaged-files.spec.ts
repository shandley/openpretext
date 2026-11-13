/**
 * What the app does when it is handed a .pretext file that is cut short or
 * damaged: it says so, and it never shows part of a map as if it were whole.
 */

import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { buildSyntheticPretext, patternTexel } from '../helpers/pretextWriter';

function makeFile(widths: number[], prefix: string, withTrack = false): Buffer {
  return Buffer.from(buildSyntheticPretext({
    textureResLog2: 8,
    tilesLog2: 2,
    mipMapLevels: 2,
    contigs: widths.map((texels, i) => ({ name: `${prefix}${i + 1}`, texels })),
    texel: patternTexel,
    extensions: withTrack
      ? [{ name: 'coverage', values: Int32Array.from({ length: 1024 }, (_, i) => i) }]
      : [],
  }));
}

const GOOD = makeFile([200, 300, 124, 250, 150], 'a');
const OTHER = makeFile([400, 324, 300], 'b');
// Two thirds of a file: the header is whole, the map is not.
const TRUNCATED = OTHER.subarray(0, Math.floor(OTHER.length * 2 / 3));
// A whole map whose track is cut off one byte early.
const WITH_TRACK = makeFile([400, 324, 300], 'c', true);
const TRACK_CUT = WITH_TRACK.subarray(0, WITH_TRACK.length - 1);

async function choose(page: Page, bytes: Buffer, name: string): Promise<void> {
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

test('a truncated file is refused on the landing screen, which stays up', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/');
  await choose(page, TRUNCATED, 'half.pretext');

  const toast = page.locator('.toast').filter({ hasText: /Could not load half\.pretext/ });
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(toast).toContainText(/incomplete: it ends (inside|before) map tile \d+ of 10/);
  await expect(page.locator('#loading-overlay')).toBeHidden();
  await expect(page.locator('#welcome')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__openpretext.state.get().map)).toBeNull();

  // The app is still usable: a good file loads afterwards.
  await choose(page, GOOD, 'good.pretext');
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#status-contigs')).toHaveText('5 contigs');
  expect(errors).toEqual([]);
});

test('a refused file leaves the loaded assembly and its edits untouched', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/');
  await choose(page, GOOD, 'good.pretext');
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#status-file')).toHaveText('good.pretext');

  await page.evaluate(() => {
    const { CurationEngine } = (window as any).__openpretext;
    CurationEngine.move(0, 3);
    CurationEngine.invert(1);
  });
  const snapshot = () => page.evaluate(() => {
    const s = (window as any).__openpretext.state.get();
    return {
      file: s.map.filename,
      names: s.contigOrder.map((id: number) => s.map.contigs[id].name),
      inverted: s.contigOrder.map((id: number) => s.map.contigs[id].inverted),
      undo: s.undoStack.length,
    };
  });
  const before = await snapshot();
  expect(before.undo).toBe(2);

  for (const [bytes, name] of [
    [TRUNCATED, 'half.pretext'],
    [Buffer.from('>chr1\nACGTACGT\n'), 'not-a-map.pretext'],
    [OTHER.subarray(0, 9), 'stub.pretext'],
  ] as const) {
    await choose(page, bytes, name);
    await expect(page.locator('.toast').filter({ hasText: `Could not load ${name}` })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#loading-overlay')).toBeHidden();
    await expect(page.locator('#status-file')).toHaveText('good.pretext');
    expect(await snapshot()).toEqual(before);
  }
  expect(errors).toEqual([]);
});

test('a file whose track is cut short loads the map and says the track is missing', async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto('/');
  await choose(page, TRACK_CUT, 'track-cut.pretext');
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#status-contigs')).toHaveText('3 contigs');
  await expect(page.locator('.toast').filter({ hasText: /loaded with a problem: Track 1 is incomplete/ }))
    .toBeVisible({ timeout: 10_000 });
  const tracks = await page.evaluate(() => (window as any).__openpretext.state.get().map.extensions.size);
  expect(tracks).toBe(0);
  expect(errors).toEqual([]);
});

test('the loaded file can be checked against a published checksum', async ({ page }) => {
  const errors = watchPageErrors(page);
  const md5 = createHash('md5').update(GOOD).digest('hex');
  const sha256 = createHash('sha256').update(GOOD).digest('hex');
  const otherMd5 = createHash('md5').update(OTHER).digest('hex');

  await page.goto('/');
  await choose(page, GOOD, 'good.pretext');
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });

  // The file name in the status bar opens the dialog.
  await page.locator('#status-file').click();
  const dialog = page.locator('#checksums-modal');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#checksums-file')).toHaveText('good.pretext');
  await expect(page.locator('#checksums-size')).toHaveText(`${GOOD.length.toLocaleString('en-US')} bytes`);
  await expect(page.locator('#checksums-md5')).toHaveText(md5);
  await expect(page.locator('#checksums-sha256')).toHaveText(sha256);

  const expected = page.locator('#checksums-expected');
  const verdict = page.locator('#checksums-verdict');
  await expected.fill(`${md5.toUpperCase()}  good.pretext`);
  await expect(verdict).toHaveText("Match. The file's MD5 equals the value you pasted.");
  await expected.fill(sha256);
  await expect(verdict).toHaveText("Match. The file's SHA-256 equals the value you pasted.");
  await expected.fill(otherMd5);
  await expect(verdict).toContainText("No match. The file's MD5 differs");
  await expected.fill('c'); // a letter that is also an Edit-mode shortcut
  await expect(verdict).toContainText('not an MD5');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // A second file replaces the values; the paste box starts empty again.
  await choose(page, OTHER, 'other.pretext');
  await expect(page.locator('#status-file')).toHaveText('other.pretext');
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('#command-input').fill('checksum');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#checksums-md5')).toHaveText(otherMd5);
  await expect(expected).toHaveValue('');
  await expect(verdict).toHaveText('');
  await page.locator('#checksums-close').click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
