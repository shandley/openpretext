/**
 * Types and I/O for the specimen manifest.
 *
 * Records the .pretext maps discovered on GenomeArk S3 for each assembly,
 * classified by curation stage. An assembly typically exposes several stages
 * (scaffolding-era evaluation heatmaps, near-final pre-curation intermediates,
 * and the final curated map), which is what lets us build a multi-stage
 * before/after curriculum rather than a single pre/post pair.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Curation-pipeline stage, ordered earliest to latest:
 *   evaluation   - scaffolding-era heatmap (assembly_vgp_.../evaluation/pretext)
 *   intermediate - map fed to the curator (assembly_curated/intermediates/pretextmap)
 *   curated      - final manually curated map (assembly_curated/{id}.{hap}.cur.DATE.pretext)
 */
export type CurationStage = 'evaluation' | 'intermediate' | 'curated';

/** Pipeline order for sorting stages within an assembly. */
export const STAGE_ORDER: Record<CurationStage, number> = {
  evaluation: 0,
  intermediate: 1,
  curated: 2,
};

export interface StageFile {
  stage: CurationStage;
  /** Exact S3 key, as listed from the bucket (never constructed). */
  key: string;
  /** File size in bytes, from the S3 listing. */
  size: number;
  /** Haplotype/pseudo-hap: 'pri' | 'hap1' | 'hap2' | null. */
  haplotype: string | null;
  /** Processing tag parsed from the filename (multimap, mapqfilter, hires, cur, heatmap, ...). */
  tag: string | null;
  /** YYYYMMDD parsed from the filename, if present. */
  date: string | null;
  /** Local path once downloaded. */
  local?: string;
}

export interface AssemblyEntry {
  /** Species directory name, e.g. "Phascolarctos_cinereus". */
  species: string;
  /** ToLID / assembly directory, e.g. "mPhaCin1". */
  tolid: string;
  /** All discovered .pretext maps for this assembly, sorted earliest to latest. */
  stages: StageFile[];
  /** True when a curated map and at least one earlier stage both exist. */
  pairable: boolean;
}

export interface Manifest {
  updatedAt: string;
  bucket: string;
  assemblies: AssemblyEntry[];
}

const DEFAULT_MANIFEST_PATH = new URL('../data/manifest.json', import.meta.url).pathname;

export async function loadManifest(path?: string): Promise<Manifest> {
  const manifestPath = path ?? DEFAULT_MANIFEST_PATH;
  if (!existsSync(manifestPath)) {
    return { updatedAt: new Date().toISOString(), bucket: 'genomeark', assemblies: [] };
  }
  const content = await readFile(manifestPath, 'utf-8');
  return JSON.parse(content) as Manifest;
}

export async function saveManifest(manifest: Manifest, path?: string): Promise<void> {
  const manifestPath = path ?? DEFAULT_MANIFEST_PATH;
  manifest.updatedAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
