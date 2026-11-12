/**
 * Names and labels that come from files are text, never markup.
 *
 * Contig names come from the .pretext file, track names from BedGraph files,
 * scaffold names and colours from session and AGP files. All of them reach
 * panels that are built as HTML strings. A file from someone else must not be
 * able to run script in the curator's page (where an AI API key may be
 * stored), so every one of them has to be escaped.
 */

import { test, expect, type Page } from '@playwright/test';
import { buildSyntheticPretext, patternTexel } from '../helpers/pretextWriter';

const PAYLOAD = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const ATTR_PAYLOAD = '" onmouseover="window.__xss=1" x="';

const WIDTHS = [200, 300, 124, 250, 150];
const FILE = Buffer.from(buildSyntheticPretext({
  textureResLog2: 8,
  tilesLog2: 2,
  mipMapLevels: 2,
  contigs: WIDTHS.map((texels, i) => ({ name: i === 1 ? `c${PAYLOAD}` : `ctg${i + 1}`, texels })),
  texel: patternTexel,
}));

/** No element or attribute from a payload exists anywhere in the page. */
async function expectNoInjection(page: Page, where: string): Promise<void> {
  const found = await page.evaluate(() => ({
    fired: (window as any).__xss ?? 0,
    imgs: document.querySelectorAll('img[src="x"]').length,
    handlers: document.querySelectorAll('[onmouseover*="__xss"],[onerror*="__xss"]').length,
  }));
  expect(found, where).toEqual({ fired: 0, imgs: 0, handlers: 0 });
}

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

test('hostile names from files are shown as text and never become markup', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({
    name: 'hostile.pretext', mimeType: 'application/octet-stream', buffer: FILE,
  });
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#status-contigs')).toHaveText('5 contigs');
  await page.waitForTimeout(800);

  // Sidebar contig list.
  await page.keyboard.press('i');
  await expect(page.locator('#sidebar')).toHaveClass(/visible/);
  await expect(page.locator('#contig-list .contig-name').nth(1)).toHaveText(`c${PAYLOAD}`);
  await expectNoInjection(page, 'contig list');

  // Scaffolds with a hostile name and colour, as a session or AGP could supply.
  await page.evaluate(([payload, attr]) => {
    const { ctx } = (window as any).__openpretext;
    ctx.scaffoldManager.restoreScaffolds([{ id: 1, name: `chr${payload}`, color: `red${attr}` }]);
    ctx.scaffoldManager.paintContigs([0, 1], 1);
    ctx.updateSidebarScaffoldList();
    ctx.updateSidebarContigList();
  }, [PAYLOAD, ATTR_PAYLOAD]);
  await expect(page.locator('#scaffold-list .contig-name').first()).toHaveText(`chr${PAYLOAD}`);
  await expectNoInjection(page, 'scaffold list');

  // Undo history: operation descriptions carry contig names.
  await page.evaluate(() => {
    const { ctx, CurationEngine } = (window as any).__openpretext;
    CurationEngine.cut(1, 100);
    CurationEngine.invert(1);
    CurationEngine.move(1, 3);
    CurationEngine.join(0);
    CurationEngine.undo();
    ctx.updateUndoHistoryPanel();
  });
  await page.waitForTimeout(300);
  await expectNoInjection(page, 'undo history');

  // A track whose name and colour come from a file.
  await page.evaluate(([payload, attr]) => {
    const { ctx } = (window as any).__openpretext;
    ctx.trackRenderer.addTrack({
      name: `cov${payload}${attr}`, type: 'line', data: new Float32Array(1024),
      color: `#fff${attr}`, height: 20, visible: true,
    });
    ctx.updateTrackConfigPanel();
  }, [PAYLOAD, ATTR_PAYLOAD]);
  await page.waitForTimeout(200);
  await expectNoInjection(page, 'track list');
  // The track can still be found by its name, so its controls keep working.
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.track-vis-checkbox')).map((el) => (el as HTMLElement).dataset.trackName));
  expect(names).toContain(`cov${PAYLOAD}${ATTR_PAYLOAD}`);

  // Tooltip over the hostile contig (which now sits in a hostile scaffold).
  // With the default camera the map is a centred square, so a contig's own
  // block is on the diagonal at its display fraction.
  const frac = await page.evaluate(() => {
    const { ctx, state } = (window as any).__openpretext;
    const s = state.get();
    const i = (s.contigOrder as number[]).findIndex((id) => s.map.contigs[id].name.includes('<img')
      && s.map.contigs[id].scaffoldId !== null);
    const b = ctx.contigBoundaries as number[];
    return ((i === 0 ? 0 : b[i - 1]) + b[i]) / 2;
  });
  const box = (await page.locator('#map-canvas').boundingBox())!;
  const side = Math.min(box.width, box.height);
  const px = box.x + box.width / 2 + (frac - 0.5) * side;
  const py = box.y + box.height / 2 + (frac - 0.5) * side;
  await page.mouse.move(px - 2, py - 2);
  await page.mouse.move(px, py);
  await expect(page.locator('#tooltip .tooltip-name')).toContainText('<img src=x', { timeout: 5_000 });
  await expect(page.locator('#tooltip .tooltip-badge')).toContainText('<img src=x');
  await expectNoInjection(page, 'tooltip');

  // Command palette lists commands, some built from data.
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(200);
  await expectNoInjection(page, 'command palette');
  await page.keyboard.press('Escape');

  // Give any injected image time to fail and fire.
  await page.waitForTimeout(500);
  await expectNoInjection(page, 'after settling');
});

test('the page refuses inline script even if markup is injected', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#welcome')).toBeVisible();
  // Put live markup into the page directly, as a missed escape would.
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.innerHTML = '<img src="x-missing" onerror="window.__csp = 1">'
      + '<a id="probe" href="#" onclick="window.__csp = 2">x</a>';
    document.body.appendChild(div);
    const s = document.createElement('script');
    s.textContent = 'window.__csp = 3';
    document.body.appendChild(s);
    (document.getElementById('probe') as HTMLElement).click();
  });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).__csp)).toBeUndefined();
});
