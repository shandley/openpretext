/**
 * Regression benchmark runner — validates algorithm metrics against baselines.
 *
 * Downloads 2 small specimens and checks that key metrics don't regress
 * below the thresholds defined in baselines.json.
 */

import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBenchmark } from './runner';

interface BaselineEntry {
  minKendallTau: number;
  minF1: number;
  minOrientationAccuracy: number;
}

type Baselines = Record<string, BaselineEntry>;

export async function runRegression(dataDir: string): Promise<boolean> {
  const resolvedDir = resolve(dataDir);
  try {
    readdirSync(resolvedDir);
  } catch {
    console.error(`Data directory not found: ${resolvedDir}`);
    return false;
  }

  const baselinesPath = resolve(join(import.meta.dirname ?? '.', 'baselines.json'));
  const baselines: Baselines = JSON.parse(await readFile(baselinesPath, 'utf-8'));

  const speciesNames = Object.keys(baselines);
  let allPassed = true;

  for (const species of speciesNames) {
    const baseline = baselines[species];

    // Find pre and post curation files in data dir
    const files = readdirSync(resolvedDir).filter(f => f.includes(species) && f.endsWith('.pretext'));
    const preFile = files.find(f => !f.includes('_post'));
    const postFile = files.find(f => f.includes('_post'));

    if (!preFile || !postFile) {
      console.error(`  Missing files for ${species} in ${dataDir}`);
      console.error(`  Found: ${files.join(', ') || '(none)'}`);
      allPassed = false;
      continue;
    }

    console.log(`\nRegression test: ${species}`);
    const prePath = join(resolvedDir, preFile);
    const postPath = join(resolvedDir, postFile);

    const result = await runBenchmark(prePath, postPath, species);

    const checks = [
      {
        name: 'Kendall tau',
        actual: result.sortMetrics.kendallTau,
        min: baseline.minKendallTau,
      },
      {
        name: 'F1',
        actual: result.breakpointMetrics.f1,
        min: baseline.minF1,
      },
      {
        name: 'Orientation accuracy',
        actual: result.sortMetrics.orientationAccuracy,
        min: baseline.minOrientationAccuracy,
      },
    ];

    for (const check of checks) {
      const passed = check.actual >= check.min;
      const icon = passed ? 'PASS' : 'FAIL';
      console.log(`  ${icon}: ${check.name} = ${check.actual.toFixed(3)} (min: ${check.min})`);
      if (!passed) allPassed = false;
    }
  }

  return allPassed;
}
