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
 *   scaffolding  - raw scaffolder output, pre-curation (Sanger tolqc YaHS maps)
 *   evaluation   - scaffolding-era heatmap (GenomeArk assembly_vgp_.../evaluation/pretext)
 *   intermediate - map fed to the curator (assembly_curated/intermediates/pretextmap)
 *   curated      - final manually curated map (assembly_curated/{id}.{hap}.cur.DATE.pretext)
 */
export type CurationStage = 'scaffolding' | 'evaluation' | 'intermediate' | 'curated';

/** Pipeline order for sorting stages within an assembly. */
export const STAGE_ORDER: Record<CurationStage, number> = {
  scaffolding: 0,
  evaluation: 1,
  intermediate: 2,
  curated: 3,
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
  /** Data source. GenomeArk yields before/after pairs; DToL yields single-stage. */
  source: 'genomeark' | 'dtol';
  /** DToL taxon-group folder (algae, molluscs, fungi, ...), when source is dtol. */
  taxonGroup?: string;
  /** All discovered .pretext maps for this assembly, sorted earliest to latest. */
  stages: StageFile[];
  /**
   * True when a curated map and at least one earlier stage both exist (a
   * demonstration pair). DToL single-stage exercises are never pairable.
   */
  pairable: boolean;
}

export interface Manifest {
  updatedAt: string;
  bucket: string;
  /** S3 endpoint override (Sanger tolqc); omitted for GenomeArk / default AWS. */
  endpoint?: string;
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
