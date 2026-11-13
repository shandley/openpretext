/**
 * Assembly lifecycle: what must hold when one assembly replaces another, when
 * a session is saved and restored, and when a batch is undone and redone.
 *
 * Uses the synthetic .pretext writer, so every expectation is about a file
 * whose contents are known.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { buildSyntheticPretext, patternTexel } from '../helpers/pretextWriter';
import { buildDisplayRuns } from '../../src/core/DisplayMapping';
import type { ContigInfo } from '../../src/core/State';

function makeFile(widths: number[], prefix: string): Buffer {
  return Buffer.from(buildSyntheticPretext({
    textureResLog2: 8,
    tilesLog2: 2,
    mipMapLevels: 2,
    contigs: widths.map((texels, i) => ({ name: `${prefix}${i + 1}`, texels })),
    texel: patternTexel,
  }));
}

// Two 1024-texel maps with different contig counts and names.
const FILE_A = makeFile([200, 300, 124, 250, 150], 'a');
const FILE_B = makeFile([400, 324, 300], 'b');

async function loadPretext(page: Page, bytes: Buffer, name: string, contigs: number): Promise<void> {
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.locator('#welcome')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#status-file')).toHaveText(name);
  await expect(page.locator('#status-contigs')).toHaveText(`${contigs} contigs`);
  await page.waitForTimeout(500);
}

interface Assembly {
  contigs: ContigInfo[];
  order: number[];
  undo: number;
  redo: number;
  scaffolds: Array<{ id: number; name: string; color: string }>;
}

async function assembly(page: Page): Promise<Assembly> {
  return page.evaluate(() => {
    const { ctx, state } = (window as any).__openpretext;
    const s = state.get();
    return {
      contigs: s.map.contigs,
      order: s.contigOrder,
      undo: s.undoStack.length,
      redo: s.redoStack.length,
      scaffolds: ctx.scaffoldManager.getAllScaffolds(),
    };
  });
}

/** What the curator sees: names, widths and file texels, left to right. */
function shown(a: Assembly) {
  return {
    names: a.order.map((id) => a.contigs[id].name),
    lengths: a.order.map((id) => a.contigs[id].length),
    scaffoldOf: a.order.map((id) => a.contigs[id].scaffoldId),
    runs: buildDisplayRuns(a.contigs, a.order),
    sequence: a.order.map((id) => a.contigs[id].sequenceSegments ?? null),
  };
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

test('loading a second assembly leaves nothing of the first', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await loadPretext(page, FILE_A, 'first.pretext', 5);

  // Leave every kind of per-assembly state behind.
  await page.evaluate(() => {
    const { ctx, state, CurationEngine } = (window as any).__openpretext;
    CurationEngine.cut(1, 100);
    CurationEngine.move(0, 3);
    CurationEngine.invert(2);
    const sc = ctx.scaffoldManager.createScaffold('chrA');
    ctx.scaffoldManager.paintContigs([0, 1], sc);
    CurationEngine.undo();
    state.update({ selectedContigs: new Set([1, 2]) });
    ctx.waypointManager.addWaypoint(0.3, 0.3, 'here');
    ctx.referenceSequences = new Map([['a1', 'ACGT']]);
  });
  const before = await assembly(page);
  expect(before.undo).toBeGreaterThan(0);
  expect(before.redo).toBeGreaterThan(0);

  await loadPretext(page, FILE_B, 'second.pretext', 3);

  const after = await assembly(page);
  expect(after.undo, 'undo history belongs to the first assembly').toBe(0);
  expect(after.redo).toBe(0);
  expect(after.scaffolds).toEqual([]);
  expect(after.contigs.map((c) => c.name)).toEqual(['b1', 'b2', 'b3']);
  expect(after.order).toEqual([0, 1, 2]);
  const leftovers = await page.evaluate(() => {
    const { ctx, state } = (window as any).__openpretext;
    return {
      selected: state.get().selectedContigs.size,
      waypoints: ctx.waypointManager.getAllWaypoints().length,
      hasFasta: ctx.referenceSequences !== null,
      undoDropped: state.undoDroppedCount(),
    };
  });
  expect(leftovers).toEqual({ selected: 0, waypoints: 0, hasFasta: false, undoDropped: 0 });

  // Undo and redo have nothing to act on, and must not throw.
  await page.locator('#btn-undo').click();
  await page.locator('#btn-redo').click();
  await page.waitForTimeout(200);
  expect((await assembly(page)).order).toEqual([0, 1, 2]);

  // A new scaffold starts numbering afresh.
  const firstId = await page.evaluate(() =>
    (window as any).__openpretext.ctx.scaffoldManager.createScaffold(undefined, { record: false }));
  expect(firstId).toBe(1);

  expect(errors).toEqual([]);
});

test('a session saved after cuts and joins restores the same assembly', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await loadPretext(page, FILE_A, 'first.pretext', 5);

  await page.evaluate(() => {
    const { ctx, CurationEngine } = (window as any).__openpretext;
    CurationEngine.cut(1, 120);     // a2 -> a2_L, a2_R
    CurationEngine.invert(2);       // a2_R reversed
    CurationEngine.move(4, 0);      // a4 to the front
    CurationEngine.join(0);         // a4 + a1: not neighbours in the file
    CurationEngine.cut(0, 300);     // cut through the joined contig
    const x = ctx.scaffoldManager.createScaffold('chrX');
    const y = ctx.scaffoldManager.createScaffold('chrY');
    ctx.scaffoldManager.deleteScaffold(x);  // leaves ids non-contiguous
    ctx.scaffoldManager.paintContigs([0, 2], y);
  });
  // Tag and exclude contigs by what they are, then move one of them.
  const marksSaved = await page.evaluate(() => {
    const { state, CurationEngine, metaTags, contigExclusion } = (window as any).__openpretext;
    const order = state.get().contigOrder as number[];
    metaTags.addTag(order[1], 'Haplotig');
    metaTags.addTag(order[1], 'Hap_1');
    metaTags.addTag(order[3], 'Contaminant', 'bacterial');
    contigExclusion.toggle(order[3]);
    contigExclusion.toggle(order[4]);
    CurationEngine.move(1, 4);
    const s = state.get();
    const name = (id: number) => s.map.contigs[id].name;
    return {
      tags: [...metaTags.getAllTags()].map(([id, t]: [number, any]) => [name(id), t.tags.join('+'), t.notes ?? null]).sort(),
      excluded: [...contigExclusion.getExcluded()].map(name).sort(),
    };
  });
  expect(marksSaved.tags).toHaveLength(2);
  expect(marksSaved.excluded).toHaveLength(2);
  const saved = await assembly(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => (document.getElementById('btn-save-session') as HTMLButtonElement).click()),
  ]);
  const sessionJson = readFileSync(await download.path(), 'utf8');

  // A fresh page, the same file, then the session.
  await page.goto('/');
  await loadPretext(page, FILE_A, 'first.pretext', 5);
  await page.locator('#session-file-input').setInputFiles({
    name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(sessionJson),
  });
  await expect(page.locator('#status-contigs')).toHaveText(`${saved.order.length} contigs`, { timeout: 10_000 });
  await page.waitForTimeout(500);

  const restored = await assembly(page);
  expect(shown(restored)).toEqual(shown(saved));
  expect(restored.scaffolds).toEqual(saved.scaffolds);
  expect(restored.undo, 'restored history must not point at another state').toBe(0);

  // Tags and exclusions are on the same contigs as when saved.
  const marksRestored = await page.evaluate(() => {
    const { state, metaTags, contigExclusion } = (window as any).__openpretext;
    const s = state.get();
    const name = (id: number) => s.map.contigs[id].name;
    return {
      tags: [...metaTags.getAllTags()].map(([id, t]: [number, any]) => [name(id), t.tags.join('+'), t.notes ?? null]).sort(),
      excluded: [...contigExclusion.getExcluded()].map(name).sort(),
    };
  });
  expect(marksRestored).toEqual(marksSaved);
  await page.keyboard.press('i');
  await expect(page.locator('#contig-list .contig-badge.excluded')).toHaveCount(2);
  await expect(page.locator('#contig-list .contig-badge[data-tag="Haplotig"]')).toHaveCount(1);
  await expect(page.locator('#contig-list .contig-badge[data-tag="Contaminant"]')).toHaveCount(1);

  // The restored assembly is editable and reversible.
  await page.evaluate(() => {
    const { CurationEngine } = (window as any).__openpretext;
    CurationEngine.cut(0, 50);
    CurationEngine.undo();
  });
  expect(shown(await assembly(page))).toEqual(shown(saved));

  // A session for a different assembly is refused and changes nothing.
  await page.goto('/');
  await loadPretext(page, FILE_B, 'second.pretext', 3);
  await page.locator('#session-file-input').setInputFiles({
    name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(sessionJson),
  });
  await expect(page.locator('.toast').filter({ hasText: /cannot be restored: it was saved for a different assembly/ }))
    .toBeVisible({ timeout: 5_000 });
  const other = await assembly(page);
  expect(other.contigs.map((c) => c.name)).toEqual(['b1', 'b2', 'b3']);
  expect(other.order).toEqual([0, 1, 2]);

  expect(errors).toEqual([]);
});

test('redo reapplies a whole batch, as undo removes it', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await loadPretext(page, FILE_A, 'first.pretext', 5);

  await page.evaluate(() => {
    const { state, CurationEngine } = (window as any).__openpretext;
    CurationEngine.invert(0);                 // a single edit before the batch
    state.setBatchContext('batch-1');
    CurationEngine.move(0, 4);
    CurationEngine.cut(1, 60);
    CurationEngine.invert(3);
    state.clearBatchContext();
  });
  const done = await assembly(page);
  expect(done.undo).toBe(4);

  await page.locator('#btn-undo').click();
  await page.waitForTimeout(200);
  const undone = await assembly(page);
  expect(undone.undo).toBe(1);
  expect(undone.redo).toBe(3);

  await page.locator('#btn-redo').click();
  await page.waitForTimeout(200);
  const redone = await assembly(page);
  expect(redone.undo, 'one Redo brings the whole batch back').toBe(4);
  expect(redone.redo).toBe(0);
  expect(shown(redone)).toEqual(shown(done));

  // And it is still one batch: a single Undo removes it again.
  await page.locator('#btn-undo').click();
  await page.waitForTimeout(200);
  expect((await assembly(page)).undo).toBe(1);

  expect(errors).toEqual([]);
});

test('tags and exclusions follow a contig through a cut, and a join that would change the export is refused', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await loadPretext(page, FILE_A, 'first.pretext', 5);

  // Exclude and tag a2, then cut it.
  await page.evaluate(() => {
    const { state, CurationEngine, metaTags, contigExclusion } = (window as any).__openpretext;
    const a2 = state.get().contigOrder[1];
    contigExclusion.toggle(a2);
    metaTags.addTag(a2, 'Contaminant', 'bacterial');
    CurationEngine.cut(1, 120);
  });
  await expect(page.locator('#status-contigs')).toHaveText('6 contigs');
  await page.keyboard.press('i');
  await expect(page.locator('#contig-list .contig-badge.excluded')).toHaveCount(2);
  await expect(page.locator('#contig-list .contig-badge[data-tag="Contaminant"]')).toHaveCount(2);

  // Joining an excluded piece to its included neighbour is refused in the UI.
  await page.keyboard.press('e');
  const before = await assembly(page);
  await page.evaluate(() => {
    const { state } = (window as any).__openpretext;
    state.update({ selectedContigs: new Set([2, 3]) });   // a2_R (excluded) and a3
  });
  await page.keyboard.press('j');
  await expect(page.locator('.toast').filter({ hasText: /Cannot join "a2_R" and "a3": "a2_R" is excluded from export and "a3" is not/ }))
    .toBeVisible({ timeout: 5_000 });
  const after = await assembly(page);
  expect(after.order).toEqual(before.order);
  expect(after.undo).toBe(before.undo);

  // Undo the cut: one contig again, still excluded and tagged.
  await page.locator('#btn-undo').click();
  await expect(page.locator('#status-contigs')).toHaveText('5 contigs');
  await expect(page.locator('#contig-list .contig-badge.excluded')).toHaveCount(1);
  await expect(page.locator('#contig-list .contig-badge[data-tag="Contaminant"]')).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('redoing a join says so when a tag added in between is not kept', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await loadPretext(page, FILE_A, 'first.pretext', 5);

  await page.evaluate(() => {
    const { state, CurationEngine, metaTags } = (window as any).__openpretext;
    CurationEngine.join(1);                     // a2 + a3
    CurationEngine.undo();
    metaTags.addTag(state.get().contigOrder[1], 'Haplotig');   // tag a2 while the join is undone
  });
  await page.locator('#btn-redo').click();
  await expect(page.locator('.toast').filter({
    hasText: 'Redo. Not kept on a joined contig, because its two parts differ: the Haplotig tag on "a2".',
  })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#status-contigs')).toHaveText('4 contigs');

  // Undo brings a2 back with its tag; an ordinary redo says only "Redo".
  await page.locator('#btn-undo').click();
  await page.keyboard.press('i');
  await expect(page.locator('#contig-list .contig-badge[data-tag="Haplotig"]')).toHaveCount(1);
  await page.locator('#btn-redo').click();
  await expect(page.locator('.toast').filter({ hasText: /^Redo$/ })).toBeVisible({ timeout: 5_000 });

  expect(errors).toEqual([]);
});

test('the sidebar adds, removes and checks tags in the vocabulary the downstream tools read', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await loadPretext(page, FILE_A, 'first.pretext', 5);
  await page.keyboard.press('i');
  await page.evaluate(() => {
    (window as any).__openpretext.state.update({ selectedContigs: new Set([1, 2]) });
  });
  const tagsOf = () => page.evaluate(() => {
    const { state, metaTags } = (window as any).__openpretext;
    const s = state.get();
    return s.contigOrder.map((id: number) => metaTags.getTags(id).join('+'));
  });

  // Two tags on the same contigs: a sex chromosome and a haplotype.
  await page.locator('#metatag-select').selectOption('Z');
  await page.locator('#btn-apply-metatag').click();
  await page.locator('#metatag-select').selectOption('Hap_2');
  await page.locator('#btn-apply-metatag').click();
  expect(await tagsOf()).toEqual(['', 'Z+Hap_2', 'Z+Hap_2', '', '']);
  await expect(page.locator('#contig-list .contig-badge[data-tag="Z"]')).toHaveCount(2);
  await expect(page.locator('#contig-list .contig-badge[data-tag="Hap_2"]')).toHaveCount(2);

  // A second sex chromosome replaces the first; the haplotype stays.
  await page.locator('#metatag-select').selectOption('W');
  await page.locator('#btn-apply-metatag').click();
  expect(await tagsOf()).toEqual(['', 'W+Hap_2', 'W+Hap_2', '', '']);

  // A tag the tools would misread is caught, not applied.
  await page.locator('#metatag-custom').fill('haplotig');
  await page.locator('#btn-apply-metatag').click();
  await expect(page.locator('.toast').filter({ hasText: 'Did you mean "Haplotig"?' })).toBeVisible({ timeout: 5_000 });
  await page.locator('#metatag-custom').fill('two words');
  await page.locator('#btn-apply-metatag').click();
  await expect(page.locator('.toast').filter({ hasText: 'cannot be used as a tag' })).toBeVisible({ timeout: 5_000 });
  expect(await tagsOf()).toEqual(['', 'W+Hap_2', 'W+Hap_2', '', '']);

  // A typed tag that is fine is applied; removing one tag leaves the others.
  await page.locator('#metatag-custom').fill('maternal');
  await page.locator('#btn-apply-metatag').click();
  expect(await tagsOf()).toEqual(['', 'W+maternal', 'W+maternal', '', '']);
  await page.locator('#metatag-custom').fill('W');
  await page.locator('#btn-remove-metatag').click();
  expect(await tagsOf()).toEqual(['', 'maternal', 'maternal', '', '']);
  await page.locator('#btn-clear-metatag').click();
  expect(await tagsOf()).toEqual(['', '', '', '', '']);
  await expect(page.locator('#contig-list .contig-badge.metatag')).toHaveCount(0);

  expect(errors).toEqual([]);
});
