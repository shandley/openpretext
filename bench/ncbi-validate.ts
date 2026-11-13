/**
 * Run NCBI's own validator on the standard (nine-column) AGP export.
 *
 * `agp_validate` is NCBI's reference check of the AGP specification
 * (https://ftp.ncbi.nih.gov/toolbox/ncbi_tools/converters/by_program/agp_validate/).
 * This script writes real curations in OpenPretext's standard flavour and
 * runs the validator on each: the king quail curation in
 * test-data/case-study/quail and the 14 in agp-tpf-utils' test data. Each is
 * a PretextView AGP read into our model and written back by our writer.
 *
 * A pass is "No errors". Warnings are expected and are printed as counts:
 * a curation that cuts a sequence uses the same component on several rows,
 * which the validator notes (w36, w37, w49) because in a final submission a
 * finished component appears once. They describe the curation, not a fault in
 * the file.
 *
 * Setup (once; test-data/ is not committed):
 *   mkdir -p test-data/ncbi && cd test-data/ncbi
 *   curl -LO https://ftp.ncbi.nih.gov/toolbox/ncbi_tools/converters/by_program/agp_validate/mac.agp_validate.gz
 *   gunzip mac.agp_validate.gz && mv mac.agp_validate agp_validate && chmod +x agp_validate
 *   (linux64.agp_validate.gz on Linux)
 * Run:
 *   npx tsx bench/ncbi-validate.ts
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAGP, planAGPImport } from '../src/formats/AGPParser';
import { readPretextHeader } from '../src/formats/PretextParser';
import { buildAGPObjects } from '../src/export/AGPModel';
import { buildAGPRows, formatAGPRow, generateAGPHeader } from '../src/export/AGPWriter';
import type { MapData } from '../src/core/State';
import { mapFromAGP, FILLER } from '../tests/helpers/agpFixtureMap';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR = join(ROOT, 'test-data/ncbi/agp_validate');
const QUAIL = join(ROOT, 'test-data/case-study/quail');
const SANGER = join(ROOT, 'test-data/agp-tpf-utils/tests/data');

function standardAGP(agpText: string, map?: MapData): string {
  const parsed = parseAGP(agpText);
  const onMap = map ?? mapFromAGP(parsed);
  const plan = planAGPImport(parsed, onMap);
  const contigs = plan.contigs.map((c) => ({ ...c }));
  plan.scaffolds.forEach((sc, k) => { for (const id of sc.contigIds) contigs[id].scaffoldId = k + 1; });
  const objects = buildAGPObjects({ ...onMap, contigs }, plan.contigOrder)
    .filter((o) => o.fragments.every((f) => f.component !== FILLER));
  const rows = buildAGPRows(objects, { tagsOf: () => [] }, 'standard').map(formatAGPRow);
  return [generateAGPHeader(onMap, 'standard'), ...rows].join('\n') + '\n';
}

function quailMap(): MapData {
  const bytes = readFileSync(join(QUAIL, 'bCotChi1.combined.pretext'));
  const { header, contigs } = readPretextHeader(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return {
    filename: 'bCotChi1.combined.pretext', textureSize: header.numberOfPixels1D, numMipMaps: 1,
    tileResolution: header.textureResolution, tilesPerDimension: header.numberOfTextures1D,
    contigs: contigs.map((c, i) => ({
      name: c.name, originalIndex: i, length: c.length,
      pixelStart: c.pixelStart, pixelEnd: c.pixelEnd, inverted: false, scaffoldId: null,
    })),
    fileContigCount: contigs.length, genomeLength: Number(header.totalGenomeLength),
    contactMap: null, rawTiles: null, parsedHeader: null, extensions: new Map(),
  };
}

function main(): void {
  if (!existsSync(VALIDATOR)) {
    console.error('agp_validate is not at test-data/ncbi/agp_validate. See the setup lines at the top of this file.');
    process.exit(2);
  }
  const out = mkdtempSync(join(ROOT, 'test-data/ncbi-validate-'));

  const inputs: Array<{ name: string; text: string }> = [];
  const quailAgp = join(QUAIL, 'bCotChi1.combined.pretext.20240422.agp');
  if (existsSync(quailAgp) && existsSync(join(QUAIL, 'bCotChi1.combined.pretext'))) {
    inputs.push({ name: 'bCotChi1', text: standardAGP(readFileSync(quailAgp, 'utf8'), quailMap()) });
  }
  if (existsSync(SANGER)) {
    for (const dir of readdirSync(SANGER).sort()) {
      if (!statSync(join(SANGER, dir)).isDirectory()) continue;
      const agp = readdirSync(join(SANGER, dir)).find((f) => /-pretext(\.\d+)?\.agp$/.test(f));
      if (agp) inputs.push({ name: dir, text: standardAGP(readFileSync(join(SANGER, dir, agp), 'utf8')) });
    }
  }
  if (inputs.length === 0) {
    console.error('No curations to validate: neither the quail files nor test-data/agp-tpf-utils are present.');
    process.exit(2);
  }

  let failed = 0;
  for (const { name, text } of inputs) {
    const file = join(out, `${name}.standard.agp`);
    writeFileSync(file, text);
    const run = spawnSync(VALIDATOR, [file], { encoding: 'utf8' });
    const report = `${run.stdout}${run.stderr}`;
    const verdict = /^(No errors.*|\d+ errors?.*)$/m.exec(report)?.[1] ?? '(no summary line)';
    const codes = [...report.matchAll(/^\s+(\d+)\s+([ew]\d+)\s+(.+)$/gm)].map((m) => `${m[2]} x${m[1]}`).join(', ');
    const rows = text.split('\n').filter((l) => l && !l.startsWith('#')).length;
    const ok = run.status === 0 && /^No errors/.test(verdict);
    if (!ok) failed++;
    console.log(`${ok ? 'ok   ' : 'FAIL '} ${name.padEnd(14)} ${String(rows).padStart(5)} rows  ${verdict}${codes ? `  [${codes}]` : ''}`);
    if (!ok) console.log(report.split('\n').filter((l) => /ERROR/.test(l)).slice(0, 5).map((l) => `      ${l.trim()}`).join('\n'));
  }

  if (failed === 0) rmSync(out, { recursive: true, force: true });
  else console.log(`Output kept in ${out}`);
  console.log(failed === 0
    ? `NCBI agp_validate reports no errors in ${inputs.length} standard AGP files.`
    : `${failed} file(s) have errors.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
