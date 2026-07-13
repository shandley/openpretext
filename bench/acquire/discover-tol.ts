/**
 * DToL / Sanger tolqc discovery.
 *
 * Finds the pre-curation scaffolding .pretext maps Sanger publishes on the
 * anonymous Ceph gateway (tolqc.cog.sanger.ac.uk), organized by taxon:
 *
 *   darwin/<taxon>/<Species>/working/<ToLID.assembler.date>/scaffolding/yahs/.../out_scaffolds_final.pretext
 *
 * These are raw scaffolder output (no curated counterpart is published), so each
 * assembly is a SINGLE-STAGE curation exercise rather than a before/after pair.
 * The taxonomic reach here (plants, fungi, every invertebrate phylum) is what
 * GenomeArk's vertebrate-heavy bucket lacks.
 */

import type { AssemblyEntry, StageFile, Manifest } from './manifest';
import { STAGE_ORDER, loadManifest, saveManifest } from './manifest';
import { s3ListDirs, s3ListFiles } from './s3';

const ENDPOINT = 'https://cog.sanger.ac.uk';
const BUCKET = 'tolqc';

/** A broad default spread across the tree of life. */
export const DEFAULT_DTOL_TAXA = [
  'molluscs', 'annelids', 'echinoderms', 'nematodes', 'platyhelminths',
  'insects', 'arthropods', 'fungi', 'dicots', 'monocots', 'sponges',
];

function classifyTol(key: string, size: number): StageFile | null {
  const parts = key.split('/');
  const base = parts[parts.length - 1];
  if (!base.endsWith('.pretext')) return null;

  const wi = parts.indexOf('working');
  const workdir = wi >= 0 ? (parts[wi + 1] ?? '') : '';
  const toks = workdir.split('.');
  const date = toks.find(t => /^\d{8}$/.test(t)) ?? base.match(/(\d{8})/)?.[1] ?? null;
  const assembler = toks[1] ?? null;
  const haplotype = (base.match(/(hap[12])/) ?? workdir.match(/(hap[12])/))?.[1] ?? null;
  const variant = parts[parts.length - 2] ?? null; // e.g. out.break.yahs
  return { stage: 'scaffolding', key, size, haplotype, tag: variant ?? assembler, date };
}

function tolidOf(key: string): string {
  const parts = key.split('/');
  const wi = parts.indexOf('working');
  const workdir = wi >= 0 ? (parts[wi + 1] ?? '') : '';
  return workdir.split('.')[0] || '(unknown)';
}

/**
 * Discover single-stage scaffolding maps across DToL taxa.
 *
 * Coverage is patchy (many species are placeholder dirs), so each taxon is
 * scanned in listing order until `perTaxon` species with maps are found or
 * `maxScanPerTaxon` species have been checked.
 */
export async function discoverDtol(options: {
  taxa?: string[];
  perTaxon?: number;
  maxScanPerTaxon?: number;
  maxSizeMB?: number;
  manifestPath?: string;
} = {}): Promise<Manifest> {
  const { taxa = DEFAULT_DTOL_TAXA, perTaxon = 3, maxScanPerTaxon = 60, maxSizeMB = 500, manifestPath } = options;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const assemblies: AssemblyEntry[] = [];

  for (const taxon of taxa) {
    const species = (await s3ListDirs(BUCKET, `darwin/${taxon}/`, ENDPOINT))
      .filter(s => /^[A-Z][a-z]+_[a-z]/.test(s)); // Genus_species dirs only
    console.log(`\n${taxon}: ${species.length} species listed, scanning for maps...`);

    let found = 0;
    let scanned = 0;
    for (const sp of species) {
      if (found >= perTaxon || scanned >= maxScanPerTaxon) break;
      scanned++;
      const files = await s3ListFiles(BUCKET, `darwin/${taxon}/${sp}/working/`, ENDPOINT);
      const stages: StageFile[] = [];
      for (const f of files) {
        const st = classifyTol(f.key, f.size);
        if (!st || st.size === 0 || st.size > maxSizeBytes) continue;
        stages.push(st);
      }
      if (stages.length === 0) continue;

      stages.sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.key.localeCompare(b.key));
      const entry: AssemblyEntry = {
        species: sp, tolid: tolidOf(stages[0].key), source: 'dtol', taxonGroup: taxon,
        stages, pairable: false,
      };
      assemblies.push(entry);
      found++;
      console.log(`  ${sp} (${entry.tolid}): ${stages.length} scaffolding map(s), ${(stages[0].size / 1e6).toFixed(0)}MB`);
    }
    console.log(`  ${taxon}: ${found} with maps (scanned ${scanned}).`);
  }

  const manifest = await loadManifest(manifestPath);
  manifest.bucket = BUCKET;
  manifest.endpoint = ENDPOINT;
  manifest.assemblies = assemblies;
  await saveManifest(manifest, manifestPath);

  const taxaCovered = new Set(assemblies.map(a => a.taxonGroup)).size;
  console.log(`\nManifest: ${assemblies.length} single-stage DToL specimens across ${taxaCovered} taxa.`);
  return manifest;
}
