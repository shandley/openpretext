/**
 * S3 listing + paired file discovery for GenomeArk .pretext files.
 *
 * Uses `aws s3 ls --no-sign-request` to enumerate available specimens
 * and find paired pre/post-curation .pretext files.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SpecimenEntry, Manifest } from './manifest';
import { loadManifest, saveManifest } from './manifest';

const execFileAsync = promisify(execFile);

/**
 * List directories under a given S3 prefix.
 */
async function s3ListDirs(bucket: string, prefix: string): Promise<string[]> {
  const { stdout } = await execFileAsync('aws', [
    's3', 'ls', '--no-sign-request',
    `s3://${bucket}/${prefix}`,
  ], { maxBuffer: 10 * 1024 * 1024 });

  return stdout
    .split('\n')
    .filter(line => line.trim().endsWith('/'))
    .map(line => {
      const parts = line.trim().split(/\s+/);
      return parts[parts.length - 1].replace(/\/$/, '');
    })
    .filter(Boolean);
}

/**
 * List files under a given S3 prefix (recursive).
 */
async function s3ListFiles(
  bucket: string,
  prefix: string,
): Promise<Array<{ key: string; size: number }>> {
  try {
    const { stdout } = await execFileAsync('aws', [
      's3', 'ls', '--no-sign-request', '--recursive',
      `s3://${bucket}/${prefix}`,
    ], { maxBuffer: 10 * 1024 * 1024 });

    return stdout
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        const match = line.match(/^\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+(\d+)\s+(.+)$/);
        if (!match) return null;
        return { key: match[2], size: parseInt(match[1], 10) };
      })
      .filter((x): x is { key: string; size: number } => x !== null);
  } catch {
    return [];
  }
}

/**
 * Discover paired pre/post-curation .pretext files on GenomeArk.
 *
 * Looks for species that have both a pre-curation (assembly) and
 * post-curation .pretext file under the standard GenomeArk paths:
 *   species/<Name>/<assembly_id>/genomic_data/arima/
 *   species/<Name>/<assembly_id>/curated/
 *
 * @param maxSpecimens - Maximum number of specimens to discover.
 * @param speciesFilter - Optional species name filter.
 */
export async function discoverSpecimens(options: {
  maxSpecimens?: number;
  speciesFilter?: string;
  maxSizeMB?: number;
  manifestPath?: string;
} = {}): Promise<Manifest> {
  const { maxSpecimens = 50, speciesFilter, maxSizeMB = 500, manifestPath } = options;
  const bucket = 'genomeark';
  const manifest = await loadManifest(manifestPath);
  const existingKeys = new Set(manifest.specimens.map(s => s.preCurationKey));

  console.log('Discovering species on GenomeArk...');
  const speciesDirs = await s3ListDirs(bucket, 'species/');

  const filteredSpecies = speciesFilter
    ? speciesDirs.filter(d => d.toLowerCase().includes(speciesFilter.toLowerCase()))
    : speciesDirs;

  console.log(`Found ${filteredSpecies.length} species directories to scan.`);
  let discovered = 0;

  for (const species of filteredSpecies) {
    if (discovered >= maxSpecimens) break;

    // List assembly directories
    const assemblies = await s3ListDirs(bucket, `species/${species}/`);

    for (const assembly of assemblies) {
      if (discovered >= maxSpecimens) break;

      // Search for .pretext files
      const files = await s3ListFiles(bucket, `species/${species}/${assembly}/`);
      const pretextFiles = files.filter(f => f.key.endsWith('.pretext'));

      if (pretextFiles.length < 2) continue;

      // Identify pre-curation and post-curation files
      const preCuration = pretextFiles.find(f =>
        f.key.includes('genomic_data') || f.key.includes('/assembly/') ||
        (!f.key.includes('curated') && !f.key.includes('curation')),
      );
      const postCuration = pretextFiles.find(f =>
        f.key.includes('curated') || f.key.includes('curation'),
      );

      if (!preCuration || !postCuration) continue;
      if (existingKeys.has(preCuration.key)) continue;

      // Size filter
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      if (preCuration.size > maxSizeBytes || postCuration.size > maxSizeBytes) continue;

      const entry: SpecimenEntry = {
        species,
        preCurationKey: preCuration.key,
        postCurationKey: postCuration.key,
        preCurationSize: preCuration.size,
        postCurationSize: postCuration.size,
      };

      manifest.specimens.push(entry);
      discovered++;
      console.log(`  Found: ${species} (${(preCuration.size / 1e6).toFixed(0)}MB + ${(postCuration.size / 1e6).toFixed(0)}MB)`);
    }
  }

  await saveManifest(manifest, manifestPath);
  console.log(`Manifest updated: ${manifest.specimens.length} total specimens.`);
  return manifest;
}
