/**
 * Types and I/O for the specimen manifest — tracks paired
 * pre/post-curation .pretext files discovered on GenomeArk S3.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface SpecimenEntry {
  /** Species name (e.g., "Taeniopygia_guttata"). */
  species: string;
  /** Common name if known. */
  commonName?: string;
  /** S3 key for the pre-curation .pretext file. */
  preCurationKey: string;
  /** S3 key for the post-curation .pretext file. */
  postCurationKey: string;
  /** File size of pre-curation file in bytes. */
  preCurationSize?: number;
  /** File size of post-curation file in bytes. */
  postCurationSize?: number;
  /** Local path to downloaded pre-curation file (if downloaded). */
  preCurationLocal?: string;
  /** Local path to downloaded post-curation file (if downloaded). */
  postCurationLocal?: string;
  /** Whether both files have been downloaded. */
  downloaded?: boolean;
}

export interface Manifest {
  /** When the manifest was last updated. */
  updatedAt: string;
  /** GenomeArk S3 bucket. */
  bucket: string;
  /** Discovered specimens. */
  specimens: SpecimenEntry[];
}

const DEFAULT_MANIFEST_PATH = new URL('../data/manifest.json', import.meta.url).pathname;

/**
 * Load manifest from disk. Returns empty manifest if file doesn't exist.
 */
export async function loadManifest(path?: string): Promise<Manifest> {
  const manifestPath = path ?? DEFAULT_MANIFEST_PATH;

  if (!existsSync(manifestPath)) {
    return {
      updatedAt: new Date().toISOString(),
      bucket: 'genomeark',
      specimens: [],
    };
  }

  const content = await readFile(manifestPath, 'utf-8');
  return JSON.parse(content) as Manifest;
}

/**
 * Save manifest to disk.
 */
export async function saveManifest(manifest: Manifest, path?: string): Promise<void> {
  const manifestPath = path ?? DEFAULT_MANIFEST_PATH;
  manifest.updatedAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
