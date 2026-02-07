/**
 * Streaming download of .pretext files from GenomeArk S3 with local cache.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { SpecimenEntry, Manifest } from './manifest';
import { saveManifest } from './manifest';

const execFileAsync = promisify(execFile);
const DATA_DIR = new URL('../data', import.meta.url).pathname;

/**
 * Get the local file path for a specimen file.
 * Uses the manifest's declared local path if available (e.g., bench/data/Species/pre.pretext),
 * otherwise falls back to S3-key-based path.
 */
function resolveLocalPath(declaredPath: string | undefined, s3Key: string): string {
  if (declaredPath) {
    // Resolve relative paths against the project root (3 levels up from bench/acquire/)
    if (!declaredPath.startsWith('/')) {
      const projectRoot = resolve(DATA_DIR, '..', '..');
      return resolve(projectRoot, declaredPath);
    }
    return declaredPath;
  }
  return join(DATA_DIR, s3Key);
}

/**
 * Check if a local file exists (and optionally matches expected size).
 */
async function fileExists(filePath: string, expectedSize?: number): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  if (expectedSize === undefined) return true;

  try {
    const stats = await stat(filePath);
    return stats.size === expectedSize;
  } catch {
    return false;
  }
}

/**
 * Download a single file from S3.
 * If the S3 key ends with `.gz`, the file is downloaded to a temporary `.gz`
 * path and then decompressed with `gunzip`, producing the final `.pretext` file.
 */
async function downloadFile(bucket: string, s3Key: string, localDest: string): Promise<void> {
  await mkdir(dirname(localDest), { recursive: true });

  const isGzipped = s3Key.endsWith('.gz');
  const downloadDest = isGzipped ? localDest + '.gz' : localDest;

  console.log(`  Downloading s3://${bucket}/${s3Key}...`);
  await execFileAsync('aws', [
    's3', 'cp', '--no-sign-request',
    `s3://${bucket}/${s3Key}`,
    downloadDest,
  ], { maxBuffer: 1024 * 1024, timeout: 600_000 });

  if (isGzipped) {
    console.log(`  Decompressing ${downloadDest}...`);
    await execFileAsync('gunzip', ['-f', downloadDest], { timeout: 600_000 });
  }

  console.log(`  -> ${localDest}`);
}

/**
 * Download all specimens in the manifest.
 * Skips specimens that are already downloaded and have valid local files.
 *
 * @param manifest - The specimen manifest.
 * @param options - Filter and path options.
 */
export async function downloadSpecimens(
  manifest: Manifest,
  options: {
    speciesFilter?: string;
    manifestPath?: string;
  } = {},
): Promise<void> {
  const { speciesFilter, manifestPath } = options;
  const specimens = speciesFilter
    ? manifest.specimens.filter(s => s.species.toLowerCase().includes(speciesFilter.toLowerCase()))
    : manifest.specimens;

  // Count how many need downloading
  let toDownload = 0;
  for (const s of specimens) {
    if (!s.downloaded) toDownload++;
  }
  console.log(`${specimens.length} specimens total, ${toDownload} need downloading.`);

  for (const specimen of specimens) {
    const preLocal = resolveLocalPath(specimen.preCurationLocal, specimen.preCurationKey);
    const postLocal = resolveLocalPath(specimen.postCurationLocal, specimen.postCurationKey);

    // Skip if already downloaded and files exist
    if (specimen.downloaded) {
      const preOk = await fileExists(preLocal);
      const postOk = await fileExists(postLocal);
      if (preOk && postOk) {
        console.log(`\n${specimen.species}: cached`);
        continue;
      }
      // Files missing despite downloaded flag — re-download
      console.log(`\n${specimen.species}: files missing, re-downloading...`);
    } else {
      console.log(`\n${specimen.species}:`);
    }

    // Download pre-curation file
    const preExists = await fileExists(preLocal, specimen.preCurationSize);
    if (!preExists) {
      await downloadFile(manifest.bucket, specimen.preCurationKey, preLocal);
    } else {
      console.log(`  Pre-curation: cached`);
    }
    specimen.preCurationLocal = preLocal;

    // Download post-curation file
    const postExists = await fileExists(postLocal, specimen.postCurationSize);
    if (!postExists) {
      await downloadFile(manifest.bucket, specimen.postCurationKey, postLocal);
    } else {
      console.log(`  Post-curation: cached`);
    }
    specimen.postCurationLocal = postLocal;

    specimen.downloaded = true;
  }

  await saveManifest(manifest, manifestPath);
  console.log(`\nAll downloads complete.`);
}
