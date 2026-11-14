/**
 * HaplotypeOrder — what the order of painted scaffolds will mean to
 * `pretext-to-asm` when a map holds more than one haplotype.
 *
 * The Sanger tool names chromosomes by walking the painted autosomes in map
 * order and grouping them: a scaffold joins the current group until one
 * arrives whose haplotype the group already has. It therefore expects each
 * chromosome to sit next to its partner in the other haplotype. Scaffolds of
 * one haplotype that follow one another are put in one group and named as
 * parts of one chromosome (`SUPER_3A`, `SUPER_3B`), with no message. A curator
 * who paints all of haplotype 1 and then all of haplotype 2 gets every
 * chromosome named that way.
 *
 * This module repeats the tool's grouping so the export can say so first. It
 * is transcribed from `ChrNamer.build_groups` and `ScaffoldNamer` in
 * sanger-tol/agp-tpf-utils 1.4.1 (`src/tola/assembly/naming_utils.py`);
 * `bench/haplotype-order-check.ts` runs the tool itself on the same layouts.
 *
 * Pure: no DOM, no singletons.
 */

import type { MapData } from '../core/State';
import { REMOVAL_TAGS, tagKind } from '../curation/MetaTagManager';
import { buildAGPObjects, type AGPObject } from './AGPModel';

/** A painted autosome as the Sanger tool sees it. */
export interface PaintedAutosome {
  /** Name of the scaffold's first contig, to point the curator at it. */
  first: string;
  /** Its haplotype as written, or null when nothing names one. */
  haplotype: string | null;
  /** Whether it carries the `Singleton` tag. */
  singleton: boolean;
}

/** What the tool will make of the order. */
export interface HaplotypeOrderReport {
  /** Haplotypes in the order first seen. Fewer than two: nothing to check. */
  haplotypes: string[];
  /** Painted autosomes with no haplotype while others have one. The tool stops. */
  untagged: string[];
  /** Runs of one haplotype grouped as one chromosome and given lettered names. */
  lettered: Array<{ haplotype: string; scaffolds: string[] }>;
  /** Groups with no scaffold of the first haplotype. The tool stops. */
  missingFirst: string[];
}

/** The haplotype the tool reads from a sequence name when no tag gives one. */
function haplotypeFromName(name: string): string | null {
  const m = /^SUPER_[^_]+_([^_]+)/.exec(name) ?? /^([^_]+)_.+_\d+$/.exec(name);
  return m ? m[1] : null;
}

/**
 * The painted autosomes in map order, or null when the curation uses the
 * `Primary` or `Target` tags, whose effect on grouping is not modelled here.
 */
export function paintedAutosomes(
  objects: AGPObject[], map: MapData, tagsOf: (contigId: number) => string[],
): PaintedAutosome[] | null {
  const out: PaintedAutosome[] = [];
  for (const o of objects) {
    if (!o.painted) continue;
    const tags = new Set<string>();
    for (const id of o.contigIds) for (const t of tagsOf(id)) tags.add(t);
    if (tags.has('Primary') || tags.has('Target')) return null;
    // A scaffold made only of unlocalised or removed pieces is not a chromosome.
    const placed = o.contigIds.some((id) => !tagsOf(id).some((t) => t === 'Unloc' || REMOVAL_TAGS.includes(t)));
    if (!placed) continue;
    // A named chromosome (X, W, ...) is not numbered and takes no part in grouping.
    if ([...tags].some((t) => tagKind(t) === 'chromosome')) continue;
    const tag = [...tags].find((t) => tagKind(t) === 'haplotype');
    out.push({
      first: map.contigs[o.contigIds[0]].name,
      haplotype: tag ?? haplotypeFromName(o.fragments[0].component),
      singleton: tags.has('Singleton'),
    });
  }
  return out;
}

/** Group the autosomes as the tool does and report what is unusual. */
export function checkHaplotypeOrder(autosomes: PaintedAutosome[]): HaplotypeOrderReport {
  // The tool compares haplotype names without case; the first spelling is kept.
  const spelling = new Map<string, string>();
  const keyOf = (h: string | null) => (h === null ? null : h.toLowerCase());
  for (const a of autosomes) if (a.haplotype !== null && !spelling.has(a.haplotype.toLowerCase())) spelling.set(a.haplotype.toLowerCase(), a.haplotype);
  const report: HaplotypeOrderReport = { haplotypes: [...spelling.values()], untagged: [], lettered: [], missingFirst: [] };

  const seen: Array<string | null> = [];
  for (const a of autosomes) if (!seen.includes(keyOf(a.haplotype))) seen.push(keyOf(a.haplotype));
  if (seen.length < 2) return report;
  if (seen.includes(null)) {
    report.untagged = autosomes.filter((a) => a.haplotype === null).map((a) => a.first);
    return report;
  }

  const groups: Array<Map<string, string[]>> = [new Map()];
  let last: string | null = null;
  let lastSingleton = false;
  for (const a of autosomes) {
    const h = keyOf(a.haplotype)!;
    let group = groups[groups.length - 1];
    if (group.has(h) && (h !== last || lastSingleton)) {
      group = new Map();
      groups.push(group);
    }
    if (!group.has(h)) group.set(h, []);
    group.get(h)!.push(a.first);
    last = h;
    lastSingleton = a.singleton;
  }

  const firstHaplotype = seen[0]!;
  for (const group of groups) {
    if (group.size === 0) continue;
    for (const [h, scaffolds] of group) {
      if (scaffolds.length > 1) report.lettered.push({ haplotype: spelling.get(h)!, scaffolds });
    }
    if (!group.has(firstHaplotype)) report.missingFirst.push([...group.values()][0][0]);
  }
  return report;
}

function quoteList(names: string[], limit = 4): string {
  const shown = names.slice(0, limit).map((n) => `"${n}"`).join(', ');
  return names.length > limit ? `${shown} and ${names.length - limit} more` : shown;
}

/**
 * Sentences for the curator about how `pretext-to-asm` will read the order of
 * the painted scaffolds. Empty when there is one haplotype or nothing unusual.
 * These do not stop an export: the file is valid, and a map can be meant this way.
 */
export function haplotypeOrderWarnings(
  map: MapData, order: number[], tagsOf: (contigId: number) => string[],
): string[] {
  const autosomes = paintedAutosomes(buildAGPObjects(map, order), map, tagsOf);
  if (!autosomes) return [];
  const report = checkHaplotypeOrder(autosomes);
  const warnings: string[] = [];

  if (report.untagged.length > 0) {
    const n = report.untagged.length;
    warnings.push(
      `${n} painted scaffold${n === 1 ? ' has' : 's have'} no haplotype tag while others do ` +
      `(starting at ${quoteList(report.untagged)}). pretext-to-asm stops when it meets this. ` +
      `Tag each with its haplotype (${report.haplotypes.join(', ')}).`);
  }
  if (report.lettered.length > 0) {
    const n = report.lettered.length;
    const count = report.lettered.reduce((sum, run) => sum + run.scaffolds.length, 0);
    const example = report.lettered[0];
    warnings.push(
      `Haplotype order: in ${n} place${n === 1 ? '' : 's'}, scaffolds of one haplotype follow one another ` +
      `with no partner from another haplotype between them (${count} scaffolds; first ${example.haplotype}: ` +
      `${quoteList(example.scaffolds, 3)}). pretext-to-asm pairs haplotypes by position on the map, so it will ` +
      'name each such run as parts of one chromosome (SUPER_1A, SUPER_1B, ...). Move each chromosome next to ' +
      'its partner. For a chromosome with no partner, see Singleton in docs/AGP_EXPORT.md.');
  }
  if (report.missingFirst.length > 0) {
    const n = report.missingFirst.length;
    warnings.push(
      `${n} chromosome${n === 1 ? '' : 's'} (at ${quoteList(report.missingFirst)}) would have no ` +
      `${report.haplotypes[0]} scaffold. pretext-to-asm stops when it meets this.`);
  }
  return warnings;
}
