/**
 * Regression benchmark runner — validates algorithm metrics against baselines.
 *
 * Uses specimen-catalog.json as the single source of truth for baseline
 * thresholds. Any specimen with a non-null benchmarkBaseline that has
 * pre/post .pretext files in the data directory gets tested automatically.
 *
 * A 5% tolerance margin is applied below baseline values to allow for
 * minor fluctuations without failing CI.
 */

import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchmark } from './runner';

interface CatalogBaseline {
  f1: number;
  kendallTau: number;
  orientationAccuracy: number;
}

interface CatalogSpecimen {
  id: string;
  species: string;
  commonName: string;
  benchmarkBaseline: CatalogBaseline | null;
}

interface SpecimenCatalog {
  version: string;
  specimens: CatalogSpecimen[];
}

/** Allow metrics to drop up to 5% below baseline before failing. */
const TOLERANCE = 0.05;

export async function runRegression(dataDir: string): Promise<boolean> {
  const resolvedDir = resolve(dataDir);
  try {
    readdirSync(resolvedDir);
  } catch {
    console.error(`Data directory not found: ${resolvedDir}`);
    return false;
  }

  // Load specimen catalog as single source of truth for baselines
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const catalogPath = resolve(join(__dirname, '..', 'data', 'specimen-catalog.json'));
  const catalog: SpecimenCatalog = JSON.parse(await readFile(catalogPath, 'utf-8'));
  const specimensWithBaselines = catalog.specimens.filter(s => s.benchmarkBaseline !== null);

  if (specimensWithBaselines.length === 0) {
    console.error('No specimens with baselines found in catalog.');
    return false;
  }

  const allFiles = readdirSync(resolvedDir).filter(f => f.endsWith('.pretext'));
  let allPassed = true;
  let tested = 0;

  for (const specimen of specimensWithBaselines) {
    const baseline = specimen.benchmarkBaseline!;
    const species = specimen.species;

    // Find pre and post curation files in data dir
    const files = allFiles.filter(f => f.includes(species));
    const preFile = files.find(f => !f.includes('_post'));
    const postFile = files.find(f => f.includes('_post'));

    if (!preFile || !postFile) {
      // Specimen files not available in data dir — skip
      continue;
    }

    tested++;
    console.log(`\nRegression test: ${specimen.commonName} (${species})`);
    const prePath = join(resolvedDir, preFile);
    const postPath = join(resolvedDir, postFile);

    const result = await runBenchmark(prePath, postPath, species);

    // Apply tolerance: threshold = baseline * (1 - TOLERANCE)
    const checks = [
      {
        name: 'Kendall tau',
        actual: result.sortMetrics.kendallTau,
        min: baseline.kendallTau * (1 - TOLERANCE),
        baseline: baseline.kendallTau,
      },
      {
        name: 'F1',
        actual: result.breakpointMetrics.f1,
        min: baseline.f1 * (1 - TOLERANCE),
        baseline: baseline.f1,
      },
      {
        name: 'Orientation accuracy',
        actual: result.sortMetrics.orientationAccuracy,
        min: baseline.orientationAccuracy * (1 - TOLERANCE),
        baseline: baseline.orientationAccuracy,
      },
    ];

    for (const check of checks) {
      const passed = check.actual >= check.min;
      const icon = passed ? 'PASS' : 'FAIL';
      console.log(`  ${icon}: ${check.name} = ${check.actual.toFixed(3)} (baseline: ${check.baseline}, min: ${check.min.toFixed(3)})`);
      if (!passed) allPassed = false;
    }
  }

  if (tested === 0) {
    console.error('No regression specimens found in data directory.');
    console.error(`  Looked for species: ${specimensWithBaselines.map(s => s.species).join(', ')}`);
    return false;
  }

  console.log(`\n${tested} specimen(s) tested.`);
  return allPassed;
}
