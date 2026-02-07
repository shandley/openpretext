/**
 * Main CLI entry point for the benchmark harness.
 *
 * Usage:
 *   npx tsx bench/cli.ts run [--species X] [--output results.json]
 *   npx tsx bench/cli.ts sweep [--sweep-config sweep.json]
 *   npx tsx bench/cli.ts report [--input results.json] [--format md|csv|latex|tsv]
 */

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { runBenchmark } from './runner';
import { runSweep, printSweepResults, DEFAULT_SWEEP_CONFIG, type SweepConfig } from './sweep';
import { writeResults, readResults } from './output/json-writer';
import { formatTable, type TableFormat } from './output/table-formatter';
import { loadManifest } from './acquire/manifest';
import { computeAggregateStats } from './metrics/summary';
import type { SpecimenResult } from './metrics/summary';

async function runCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      species: { type: 'string' },
      output: { type: 'string', default: 'bench/data/results.json' },
      'pre-curation': { type: 'string' },
      'post-curation': { type: 'string' },
      'manifest-path': { type: 'string' },
    },
  });

  const results: SpecimenResult[] = [];
  const outputPath = values.output ?? 'bench/data/results.json';

  // Direct file paths mode
  if (values['pre-curation'] && values['post-curation']) {
    const result = await runBenchmark(
      values['pre-curation'],
      values['post-curation'],
      values.species ?? 'unknown',
    );
    results.push(result);
  } else {
    // Use manifest mode
    const manifest = await loadManifest(values['manifest-path']);
    const species = values.species;
    const specimens = species
      ? manifest.specimens.filter(s => s.species.toLowerCase().includes(species.toLowerCase()))
      : manifest.specimens.filter(s => s.downloaded);

    if (specimens.length === 0) {
      console.error('No specimens found. Use --pre-curation/--post-curation or run acquire first.');
      process.exit(1);
    }

    for (const specimen of specimens) {
      if (!specimen.preCurationLocal || !specimen.postCurationLocal) {
        console.warn(`Skipping ${specimen.species}: not downloaded.`);
        continue;
      }

      console.log(`\nBenchmarking ${specimen.species}...`);
      const result = await runBenchmark(
        specimen.preCurationLocal,
        specimen.postCurationLocal,
        specimen.species,
      );
      results.push(result);

      console.log(`  F1: ${result.breakpointMetrics.f1.toFixed(3)}, Tau: ${result.sortMetrics.kendallTau.toFixed(3)}, Time: ${result.timingMs.total.toFixed(0)}ms`);
    }
  }

  if (results.length > 0) {
    await writeResults(results, outputPath);
    const agg = computeAggregateStats(results);
    console.log('\n' + formatTable(results, agg, 'markdown'));
  }
}

async function sweepCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      'sweep-config': { type: 'string' },
      'pre-curation': { type: 'string' },
      'post-curation': { type: 'string' },
      output: { type: 'string', default: 'bench/data/sweep-results.json' },
    },
  });

  if (!values['pre-curation'] || !values['post-curation']) {
    console.error('Sweep requires --pre-curation and --post-curation paths.');
    process.exit(1);
  }

  let config = DEFAULT_SWEEP_CONFIG;
  if (values['sweep-config']) {
    const content = await readFile(values['sweep-config'], 'utf-8');
    config = JSON.parse(content) as SweepConfig;
  }

  const results = await runSweep(
    values['pre-curation'],
    values['post-curation'],
    config,
  );

  printSweepResults(results);

  const outputPath = values.output ?? 'bench/data/sweep-results.json';
  const { writeFile: writeFileAsync } = await import('node:fs/promises');
  await writeFileAsync(outputPath, JSON.stringify(results.slice(0, 100), null, 2) + '\n');
  console.log(`\nTop 100 sweep results written to ${outputPath}`);
}

async function reportCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      input: { type: 'string', default: 'bench/data/results.json' },
      format: { type: 'string', default: 'markdown' },
    },
  });

  const inputPath = values.input ?? 'bench/data/results.json';

  if (!existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const data = await readResults(inputPath);
  const format = (values.format ?? 'markdown') as TableFormat;

  // Reconstruct SpecimenResult objects with Map fields
  const results: SpecimenResult[] = data.results.map(r => ({
    ...r,
    chromosomeCompleteness: {
      ...r.chromosomeCompleteness,
      perChromosome: new Map(Object.entries(r.chromosomeCompleteness.perChromosome).map(
        ([k, v]) => [Number(k), v as number],
      )),
    },
  }));

  const agg = computeAggregateStats(results);
  console.log(formatTable(results, agg, format));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case 'run':
      await runCommand(commandArgs);
      break;
    case 'sweep':
      await sweepCommand(commandArgs);
      break;
    case 'report':
      await reportCommand(commandArgs);
      break;
    default:
      console.log('OpenPretext Benchmark Harness');
      console.log('');
      console.log('Commands:');
      console.log('  run    [--species X] [--output results.json]    Run benchmarks');
      console.log('  sweep  [--sweep-config sweep.json]              Parameter sweep');
      console.log('  report [--input results.json] [--format md]     Generate report');
      console.log('');
      console.log('Data acquisition:');
      console.log('  npx tsx bench/acquire/cli.ts --discover         Discover specimens');
      console.log('  npx tsx bench/acquire/cli.ts --download          Download specimens');
      break;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
