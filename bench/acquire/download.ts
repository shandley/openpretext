/**
 * Streaming download of .pretext files from GenomeArk S3 with local cache.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { SpecimenEntry, Manifest } from './manifest';
import { saveManifest } from './manifest';

const execFileAsync = promisify(execFile);
const DATA_DIR = new URL('../data', import.meta.url).pathname;

/**
 * Get the local file path for an S3 key.
 */
function localPath(s3Key: string): string {
  return join(DATA_DIR, s3Key);
}

/**
 * Check if a local file exists and matches the expected size.
 */
async function fileExistsWithSize(filePath: string, expectedSize?: number): Promise<boolean> {
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
 */
async function downloadFile(bucket: string, s3Key: string, localDest: string): Promise<void> {
  await mkdir(dirname(localDest), { recursive: true });

  console.log(`  Downloading s3://${bucket}/${s3Key}...`);
  await execFileAsync('aws', [
    's3', 'cp', '--no-sign-request',
    `s3://${bucket}/${s3Key}`,
    localDest,
  ], { maxBuffer: 1024 * 1024, timeout: 600_000 });
  console.log(`  -> ${localDest}`);
}

/**
 * Download all specimens in the manifest.
 * Skips files that already exist with matching size.
 *
 * @param manifest - The specimen manifest.
 * @param speciesFilter - Optional filter to download only specific species.
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

  console.log(`Downloading ${specimens.length} specimens...`);

  for (const specimen of specimens) {
    console.log(`\n${specimen.species}:`);

    // Download pre-curation file
    const preLocal = localPath(specimen.preCurationKey);
    const preExists = await fileExistsWithSize(preLocal, specimen.preCurationSize);
    if (!preExists) {
      await downloadFile(manifest.bucket, specimen.preCurationKey, preLocal);
    } else {
      console.log(`  Pre-curation: cached (${preLocal})`);
    }
    specimen.preCurationLocal = preLocal;

    // Download post-curation file
    const postLocal = localPath(specimen.postCurationKey);
    const postExists = await fileExistsWithSize(postLocal, specimen.postCurationSize);
    if (!postExists) {
      await downloadFile(manifest.bucket, specimen.postCurationKey, postLocal);
    } else {
      console.log(`  Post-curation: cached (${postLocal})`);
    }
    specimen.postCurationLocal = postLocal;

    specimen.downloaded = true;
  }

  await saveManifest(manifest, manifestPath);
  console.log(`\nAll downloads complete.`);
}
