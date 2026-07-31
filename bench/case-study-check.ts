/**
 * case-study-check.ts — verify a .pretext map and a published curated AGP line up.
 *
 * The quail case study scores an OpenPretext curation against the AGP that Sanger's
 * PretextView exported for the same map. That only works if the contig names inside
 * the .pretext match the component names in column 6 of the AGP. This checks that,
 * and reports what it found, before anyone spends hours curating.
 *
 * Usage:
 *   npx tsx bench/case-study-check.ts --pretext <file.pretext> --agp <file.agp>
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { loadPretextFromDisk } from './loader';

// ---------------------------------------------------------------------------
// Core (testable, no filesystem, no process)
// ---------------------------------------------------------------------------

export interface AgpComponent {
  /** Object the component was placed into (curated chromosome/scaffold). */
  object: string;
  /** Component id, AGP column 6. */
  component: string;
  orientation: string;
}

/** Parse the `W` (sequence) rows of an AGP. Gap rows and comments are skipped. */
export function parseAgpComponents(text: string): AgpComponent[] {
  const rows: AgpComponent[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 9 || f[4] !== 'W') continue;
    rows.push({ object: f[0], component: f[5], orientation: f[8] });
  }
  return rows;
}

export interface Alignment {
  mapContigs: number;
  agpRows: number;
  agpComponents: number;
  agpObjects: number;
  /** Components the map can supply. This is the number that decides relatability. */
  resolved: string[];
  /** Components with no contig of that name in the map. Any of these blocks scoring. */
  unresolved: string[];
  /** Map contigs the curator placed nowhere. Expected: unplaced scaffolds are normal. */
  unplaced: string[];
}

/**
 * Compare the map's contig names with the AGP's component names.
 *
 * The direction matters. Relatability is "can every AGP component be resolved to a
 * contig in the map", not "is every map contig in the AGP". A curator places some
 * scaffolds into chromosomes and leaves the rest unplaced, so map contigs absent from
 * the AGP are the normal result of curation rather than a mismatch. Scoring the other
 * way around reports a healthy pair as unrelatable.
 */
export function alignNames(mapNames: string[], agp: AgpComponent[]): Alignment {
  const mapSet = new Set(mapNames);
  const agpSet = new Set(agp.map((r) => r.component));
  return {
    mapContigs: mapSet.size,
    agpRows: agp.length,
    agpComponents: agpSet.size,
    agpObjects: new Set(agp.map((r) => r.object)).size,
    resolved: [...agpSet].filter((n) => mapSet.has(n)).sort(),
    unresolved: [...agpSet].filter((n) => !mapSet.has(n)).sort(),
    unplaced: [...mapSet].filter((n) => !agpSet.has(n)).sort(),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const pretext = arg('pretext');
  const agpPath = arg('agp');
  if (!pretext || !agpPath) {
    console.error('Usage: npx tsx bench/case-study-check.ts --pretext <f.pretext> --agp <f.agp>');
    process.exit(1);
  }

  const assembly = await loadPretextFromDisk(pretext);
  const agp = parseAgpComponents(await readFile(agpPath, 'utf8'));
  const mapNames = assembly.contigs.map((c) => c.name);

  console.log(`map:  ${assembly.contigs.length} contigs, texture ${assembly.textureSize}px, overview ${assembly.overviewSize}px`);
  console.log(`agp:  ${agp.length} W rows, ${new Set(agp.map((r) => r.component)).size} components, ${new Set(agp.map((r) => r.object)).size} objects`);
  console.log(`\nmap contig names (first 5): ${mapNames.slice(0, 5).join(', ')}`);
  console.log(`agp components  (first 5): ${[...new Set(agp.map((r) => r.component))].slice(0, 5).join(', ')}`);

  const a = alignNames(mapNames, agp);

  console.log(`\nAGP components resolved to a map contig: ${a.resolved.length} / ${a.agpComponents}`);
  if (a.unresolved.length) {
    console.log(`unresolved (blocks scoring): ${a.unresolved.slice(0, 8).join(', ')}${a.unresolved.length > 8 ? ' ...' : ''}`);
  }
  console.log(`map contigs the curator left unplaced:  ${a.unplaced.length} / ${a.mapContigs}`);

  const relatable = a.unresolved.length === 0;
  console.log(`\nverdict: ${relatable ? 'RELATABLE BY ID' : 'NOT RELATABLE BY ID (alignment step needed)'}`);
  if (relatable) {
    const placed = ((a.resolved.length / a.mapContigs) * 100).toFixed(1);
    console.log(`the curator placed ${placed}% of the map's contigs into ${a.agpObjects} objects and left the rest unplaced`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
