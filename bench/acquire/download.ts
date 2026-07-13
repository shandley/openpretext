/**
 * Streaming download of stage-classified .pretext maps from GenomeArk S3.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { CurationStage, Manifest, StageFile } from './manifest';
import { saveManifest } from './manifest';

const execFileAsync = promisify(execFile);
const DATA_DIR = new URL('../data', import.meta.url).pathname;

/** Deterministic local path for a downloaded stage map. */
function localPathFor(species: string, tolid: string, s: StageFile): string {
  const parts = [tolid, s.stage, s.haplotype, s.tag, s.date].filter(Boolean).join('.');
  return join(DATA_DIR, 'pairs', species, `${parts}.pretext`);
}

async function fileExists(filePath: string, expectedSize?: number): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  if (expectedSize === undefined) return true;
  try {
    return (await stat(filePath)).size === expectedSize;
  } catch {
    return false;
  }
}

async function downloadFile(bucket: string, key: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  console.log(`  s3://${bucket}/${key}`);
  await execFileAsync('aws', [
    's3', 'cp', '--no-sign-request', `s3://${bucket}/${key}`, dest,
  ], { maxBuffer: 1024 * 1024, timeout: 600_000 });
  console.log(`  -> ${dest}`);
}

/**
 * Download stage maps for the manifest's assemblies.
 *
 * @param options.stage - Only download this stage (default: all stages).
 * @param options.speciesFilter - Only assemblies whose species matches this substring.
 */
export async function downloadStages(
  manifest: Manifest,
  options: { speciesFilter?: string; stage?: CurationStage; manifestPath?: string } = {},
): Promise<void> {
  const { speciesFilter, stage, manifestPath } = options;
  const assemblies = speciesFilter
    ? manifest.assemblies.filter(a => a.species.toLowerCase().includes(speciesFilter.toLowerCase()))
    : manifest.assemblies;

  for (const a of assemblies) {
    const wanted = stage ? a.stages.filter(s => s.stage === stage) : a.stages;
    if (wanted.length === 0) continue;
    console.log(`\n${a.species} / ${a.tolid}:`);
    for (const s of wanted) {
      const dest = localPathFor(a.species, a.tolid, s);
      if (await fileExists(dest, s.size)) {
        console.log(`  cached: ${s.stage}`);
      } else {
        await downloadFile(manifest.bucket, s.key, dest);
      }
      s.local = resolve(dest);
    }
  }

  await saveManifest(manifest, manifestPath);
  console.log('\nDownloads complete.');
}
