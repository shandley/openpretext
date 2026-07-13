/**
 * S3 listing + stage-classified .pretext discovery for GenomeArk.
 *
 * Uses `aws s3 ls --no-sign-request` to enumerate assemblies and classify every
 * .pretext map by curation stage under the CURRENT GenomeArk layout:
 *
 *   curated (final):
 *     species/<Sp>/<ToLID>/assembly_curated/<ToLID>.<pri|hap1|hap2>.cur.<DATE>.pretext
 *   intermediate (fed to the curator):
 *     species/<Sp>/<ToLID>/assembly_curated/intermediates/pretextmap/*.pretext
 *   evaluation (scaffolding era):
 *     species/<Sp>/<ToLID>/assembly_vgp_.../evaluation/.../pretext/...heatmap.pretext
 *
 * Keys and sizes come straight from the live bucket listing; nothing is
 * constructed or guessed.
 */

import type { AssemblyEntry, StageFile, Manifest } from './manifest';
import { STAGE_ORDER, loadManifest, saveManifest } from './manifest';
import { s3ListDirs, s3ListFiles } from './s3';

const HAPLOTYPE_RE = /(?:^|[._])(pri|hap1|hap2)(?:[._]|$)/;
const DATE_RE = /(?:^|[._])(\d{8})(?:[._]|$)/;
const INTERMEDIATE_TAGS = ['hires', 'mapqfilter', 'multimap', 'combined', 'decontam'];

function baseName(key: string): string {
  return key.split('/').pop() ?? key;
}

/** Classify a single .pretext S3 key into a stage, or null if not a map we want. */
function classify(key: string): StageFile | null {
  const base = baseName(key);
  if (!base.endsWith('.pretext')) return null; // excludes .savestate / .agp siblings

  const haplotype = base.match(HAPLOTYPE_RE)?.[1] ?? null;
  const date = base.match(DATE_RE)?.[1] ?? null;

  // curated: top level of assembly_curated (not the intermediates subtree), *.cur.DATE.pretext
  if (key.includes('/assembly_curated/')
      && !key.includes('/intermediates/')
      && /\.cur\.\d{8}\.pretext$/.test(base)) {
    return { stage: 'curated', key, size: 0, haplotype, tag: 'cur', date };
  }

  // intermediate: the pretextmap folder fed to the curator
  if (key.includes('/assembly_curated/intermediates/pretextmap/')) {
    const tag = INTERMEDIATE_TAGS.find(t => base.toLowerCase().includes(t)) ?? 'other';
    return { stage: 'intermediate', key, size: 0, haplotype, tag, date };
  }

  // evaluation: scaffolding-era heatmaps
  if (key.includes('/evaluation/') && key.includes('/pretext/')) {
    const s = base.match(/__s(\d)/)?.[1];
    const hap = base.match(/_(hap[12])_/)?.[1] ?? haplotype;
    return { stage: 'evaluation', key, size: 0, haplotype: hap, tag: s ? `heatmap_s${s}` : 'heatmap', date };
  }

  return null;
}

/**
 * Discover stage-classified .pretext maps for a set of assemblies.
 *
 * @param options.speciesList - Explicit species directory names to scan
 *   (recommended: avoids enumerating the whole bucket). If omitted, the bucket's
 *   species/ listing is enumerated and filtered by speciesFilter.
 */
export async function discoverSpecimens(options: {
  speciesList?: string[];
  speciesFilter?: string;
  maxSpecimens?: number;
  maxSizeMB?: number;
  manifestPath?: string;
} = {}): Promise<Manifest> {
  const { speciesList, speciesFilter, maxSpecimens = 50, maxSizeMB = 500, manifestPath } = options;
  const bucket = 'genomeark';
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  let species: string[];
  if (speciesList && speciesList.length > 0) {
    species = speciesList;
  } else {
    console.log('Enumerating species on GenomeArk...');
    const all = await s3ListDirs(bucket, 'species/');
    species = speciesFilter
      ? all.filter(d => d.toLowerCase().includes(speciesFilter.toLowerCase()))
      : all.slice(0, maxSpecimens);
  }
  console.log(`Scanning ${species.length} species.`);

  const assemblies: AssemblyEntry[] = [];

  for (const sp of species) {
    const tolids = await s3ListDirs(bucket, `species/${sp}/`);
    for (const tolid of tolids) {
      // Only recurse into assembly_* subtrees; skip the large raw-data folders
      // (genomic_data/, transcriptomic_data/, ...) that hold no .pretext maps.
      const subdirs = await s3ListDirs(bucket, `species/${sp}/${tolid}/`);
      const assemblyDirs = subdirs.filter(d => d.startsWith('assembly_'));
      const files: Array<{ key: string; size: number }> = [];
      for (const ad of assemblyDirs) {
        files.push(...await s3ListFiles(bucket, `species/${sp}/${tolid}/${ad}/`));
      }
      const bySize = new Map(files.map(f => [f.key, f.size]));

      const stages: StageFile[] = [];
      for (const f of files) {
        const classified = classify(f.key);
        if (!classified) continue;
        classified.size = bySize.get(f.key) ?? 0;
        if (classified.size === 0) continue;             // skip empty placeholder objects
        if (classified.size > maxSizeBytes) continue;    // size cap
        stages.push(classified);
      }
      if (stages.length === 0) continue;

      stages.sort((a, b) =>
        STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]
        || (a.date ?? '').localeCompare(b.date ?? '')
        || a.key.localeCompare(b.key));

      const hasCurated = stages.some(s => s.stage === 'curated');
      const hasEarlier = stages.some(s => s.stage !== 'curated');
      const entry: AssemblyEntry = { species: sp, tolid, source: 'genomeark', stages, pairable: hasCurated && hasEarlier };
      assemblies.push(entry);

      const tags = stages.map(s => `${s.stage}${s.haplotype ? `/${s.haplotype}` : ''}`).join(', ');
      console.log(`  ${sp}/${tolid}: ${stages.length} map(s) [${tags}]${entry.pairable ? ' PAIRABLE' : ''}`);
    }
  }

  const manifest = await loadManifest(manifestPath);
  manifest.bucket = bucket;
  manifest.assemblies = assemblies;
  await saveManifest(manifest, manifestPath);

  const pairable = assemblies.filter(a => a.pairable).length;
  console.log(`\nManifest: ${assemblies.length} assemblies, ${pairable} pairable.`);
  return manifest;
}
