/**
 * Structured JSON output for benchmark results.
 */

import { writeFile } from 'node:fs/promises';
import type { SpecimenResult, AggregateStats } from '../metrics/summary';
import { computeAggregateStats } from '../metrics/summary';

export interface BenchmarkOutput {
  /** Timestamp of the benchmark run. */
  timestamp: string;
  /** Parameters used. */
  params: Record<string, unknown>;
  /** Per-specimen results. */
  results: SerializableResult[];
  /** Aggregate statistics. */
  aggregate: AggregateStats;
}

/** SpecimenResult with Map fields serialized for JSON. */
interface SerializableResult {
  species: string;
  numContigs: number;
  breakpointMetrics: SpecimenResult['breakpointMetrics'];
  sortMetrics: SpecimenResult['sortMetrics'];
  chromosomeCompleteness: {
    perChromosome: Record<string, number>;
    macroAverage: number;
    microAverage: number;
    highCompleteness: number;
    totalChromosomes: number;
  };
  timingMs: SpecimenResult['timingMs'];
}

function serializeResult(result: SpecimenResult): SerializableResult {
  const perChrom: Record<string, number> = {};
  for (const [k, v] of result.chromosomeCompleteness.perChromosome) {
    perChrom[String(k)] = v;
  }

  return {
    ...result,
    chromosomeCompleteness: {
      ...result.chromosomeCompleteness,
      perChromosome: perChrom,
    },
  };
}

/**
 * Write benchmark results to a JSON file.
 */
export async function writeResults(
  results: SpecimenResult[],
  outputPath: string,
  params: Record<string, unknown> = {},
): Promise<void> {
  const output: BenchmarkOutput = {
    timestamp: new Date().toISOString(),
    params,
    results: results.map(serializeResult),
    aggregate: computeAggregateStats(results),
  };

  await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`Results written to ${outputPath}`);
}

/**
 * Read benchmark results from a JSON file.
 */
export async function readResults(inputPath: string): Promise<BenchmarkOutput> {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(inputPath, 'utf-8');
  return JSON.parse(content) as BenchmarkOutput;
}
