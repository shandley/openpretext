/**
 * AGP (A Golden Path) file writer.
 *
 * Writes the curation in the form PretextView writes it, because that is what
 * the tools after the map viewer read: Sanger's `pretext-to-asm` and the VGP
 * `vgl-curation` scripts both take PretextView's AGP together with the FASTA
 * the map was built from. `docs/AGP_EXPORT.md` describes the file for people
 * who use it; `research/export-compat-2026-11/` holds the sources this follows.
 *
 * Two flavours come from one model (AGPModel.ts):
 *
 * - `pretextview`: PretextView's layout. Every row names an original sequence
 *   and an interval of it at texel resolution; the header gives the resolution;
 *   painted rows carry `Painted` in column 10 and tags follow, one per column.
 *   Excluded contigs are written, tagged with the reason, because the
 *   downstream tool removes sequence by tag and adds back anything the file
 *   does not mention.
 * - `standard`: the same rows in nine columns for validators and archives
 *   (NCBI's validator rejects a tenth column). Excluded contigs are left out.
 *
 * Coordinates in both are accurate to one map texel, as PretextView's are.
 */

import type { AppState, MapData } from '../core/State';
import { contigExclusion } from '../curation/ContigExclusion';
import { metaTags, tagKind, REMOVAL_TAGS } from '../curation/MetaTagManager';
import { APP_VERSION } from '../core/Version';
import {
  buildAGPObjects, checkTiling, formatResolution, genomeLengthOf, type AGPObject,
} from './AGPModel';

export type AGPFlavor = 'pretextview' | 'standard';

/** Configuration for AGP export. */
export interface AGPExportOptions {
  /** Which file to write. Defaults to `pretextview`. */
  flavor?: AGPFlavor;
  /** Whether to write the header lines. Defaults to true. */
  includeHeader?: boolean;
}

/** PretextView's fixed gap row fields: an unknown gap is 100 bp in AGP 2.1. */
export const GAP_LENGTH = 100;

/** One line of the file. */
export interface AGPRow {
  object: string;
  objectBeg: number;
  objectEnd: number;
  partNumber: number;
  /** `W` for a sequence row, `U` for a gap of unknown size. */
  type: 'W' | 'U';
  // Sequence rows
  component?: string;
  componentBeg?: number;
  componentEnd?: number;
  orientation?: '+' | '-';
  /** Column 10 onward: `Painted` first when painted, then the contig's tags. */
  extra?: string[];
}

/** The curation cannot be written as it stands. `problems` are sentences for the curator. */
export class AGPExportBlocked extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'AGPExportBlocked';
  }
}

interface Marks {
  tagsOf: (contigId: number) => string[];
  isExcluded: (contigId: number) => boolean;
}

const LIVE_MARKS: Marks = {
  tagsOf: (id) => metaTags.getTags(id),
  isExcluded: (id) => contigExclusion.isExcluded(id),
};

function listNames(names: string[]): string {
  const shown = names.slice(0, 8).map((n) => `"${n}"`).join(', ');
  return names.length > 8 ? `${shown} and ${names.length - 8} more` : shown;
}

/**
 * What stops this curation being written in the PretextView flavour, as
 * sentences for the curator. Empty when nothing does.
 *
 * Each of these would otherwise fail later and less clearly: `pretext-to-asm`
 * raises an error on the tag combinations, and silently puts an excluded
 * sequence back if nothing in the file says to remove it.
 */
export function agpExportProblems(map: MapData, order: number[], marks: Marks = LIVE_MARKS): string[] {
  const problems: string[] = [];
  const objects = buildAGPObjects(map, order);
  const name = (id: number) => map.contigs[id].name;

  // An excluded contig must say why it is removed.
  const unexplained: string[] = [];
  for (const o of objects) {
    for (const id of o.contigIds) {
      if (marks.isExcluded(id) && !marks.tagsOf(id).some((t) => REMOVAL_TAGS.includes(t))) unexplained.push(name(id));
    }
  }
  if (unexplained.length > 0) {
    problems.push(
      `${unexplained.length} excluded contig${unexplained.length === 1 ? ' has' : 's have'} no tag saying why ` +
      `${unexplained.length === 1 ? 'it is' : 'they are'} removed: ${listNames(unexplained)}. ` +
      'Tag each as Haplotig, Contaminant or FalseDuplicate, or include it again. ' +
      '(The tools that read this file remove sequence by tag; an untagged sequence would be put back.)');
  }

  for (const o of objects) {
    const first = name(o.contigIds[0]);
    const where = o.painted ? `the scaffold starting at "${first}"` : `"${first}"`;
    const tags = new Set<string>();
    for (const id of o.contigIds) for (const t of marks.tagsOf(id)) tags.add(t);

    if (!o.painted) {
      const unloc = o.contigIds.filter((id) => marks.tagsOf(id).includes('Unloc')).map(name);
      if (unloc.length > 0) {
        problems.push(
          `${listNames(unloc)} ${unloc.length === 1 ? 'is' : 'are'} tagged Unloc but not assigned to a scaffold. ` +
          'An unlocalised contig has to be painted into the chromosome it belongs to.');
      }
    }
    const chromosomes = [...tags].filter((t) => tagKind(t) === 'chromosome');
    if (chromosomes.length > 1) {
      problems.push(`${where} carries more than one chromosome name (${chromosomes.join(', ')}). A scaffold can have one.`);
    }
    const haplotypes = [...tags].filter((t) => tagKind(t) === 'haplotype');
    if (haplotypes.length > 1) {
      problems.push(`${where} carries more than one haplotype tag (${haplotypes.join(', ')}). A scaffold can have one.`);
    }
  }

  for (const p of checkTiling(objects)) problems.push(`Internal error, please report it: ${p}.`);
  return problems;
}

/**
 * Lay the objects out as rows.
 *
 * Painted objects come first, named `Scaffold_1..K` in map order, then the
 * rest from `K+1`, as PretextView numbers them. Within an object every pair
 * of neighbouring rows is separated by a `U 100` gap row.
 *
 * Orientation follows the map. In the standard flavour an object of a single
 * row is written `+`, which is what the specification asks of a singleton.
 *
 * The PretextView flavour keeps `-` there, because it means something to the
 * next tool: `pretext-to-asm` reverse-complements the scaffold, which is how a
 * curator turns a whole chromosome round (in three of the Sanger tool's own
 * test curations a single-scaffold chromosome is turned this way). PretextView
 * up to 1.0.7 writes `+` there unless "Format Singletons" is ticked; its next
 * release always follows the map, as this does.
 */
export function buildAGPRows(objects: AGPObject[], marks: Pick<Marks, 'tagsOf'>, flavor: AGPFlavor): AGPRow[] {
  const rows: AGPRow[] = [];
  const ordered = [...objects.filter((o) => o.painted), ...objects.filter((o) => !o.painted)];

  ordered.forEach((o, i) => {
    const object = `Scaffold_${i + 1}`;
    let at = 1;
    let part = 0;
    o.fragments.forEach((f, k) => {
      if (k > 0) {
        rows.push({ object, objectBeg: at, objectEnd: at + GAP_LENGTH - 1, partNumber: ++part, type: 'U' });
        at += GAP_LENGTH;
      }
      const size = f.end - f.beg + 1;
      const row: AGPRow = {
        object,
        objectBeg: at,
        objectEnd: at + size - 1,
        partNumber: ++part,
        type: 'W',
        component: f.component,
        componentBeg: f.beg,
        componentEnd: f.end,
        orientation: f.reversed && !(flavor === 'standard' && o.fragments.length === 1) ? '-' : '+',
      };
      if (flavor === 'pretextview') {
        row.extra = [...(o.painted ? ['Painted'] : []), ...marks.tagsOf(f.contigId)];
      }
      rows.push(row);
      at += size;
    });
  });
  return rows;
}

/** Format one row as a tab-separated line. */
export function formatAGPRow(row: AGPRow): string {
  const head = [row.object, row.objectBeg, row.objectEnd, row.partNumber, row.type];
  if (row.type === 'U') {
    return [...head, GAP_LENGTH, 'scaffold', 'yes', 'proximity_ligation'].join('\t');
  }
  return [...head, row.component, row.componentBeg, row.componentEnd, row.orientation, ...(row.extra ?? [])].join('\t');
}

/**
 * The header lines.
 *
 * `pretextview`: the version line with a tab, as PretextView writes it, a
 * description, and the resolution line. `pretext-to-asm` will not run without
 * the resolution line and reads its tolerance from it.
 *
 * `standard`: the version line with a space, as the specification writes it,
 * and the same information as plain comments.
 */
export function generateAGPHeader(map: MapData, flavor: AGPFlavor): string {
  const resolution = formatResolution(map.textureSize, genomeLengthOf(map));
  if (flavor === 'pretextview') {
    return [
      '##agp-version\t2.1',
      `# DESCRIPTION: Generated by OpenPretext Version ${APP_VERSION}`,
      `# HiC MAP RESOLUTION: ${resolution} bp/texel`,
    ].join('\n');
  }
  return [
    '##agp-version 2.1',
    `# DESCRIPTION: Generated by OpenPretext Version ${APP_VERSION}`,
    `# Coordinates are accurate to one Hi-C map texel (${resolution} bp).`,
  ].join('\n');
}

/**
 * Export the current assembly state as AGP text.
 *
 * @throws AGPExportBlocked when the PretextView flavour cannot be written as
 *   the curation stands (see agpExportProblems).
 */
export function exportAGP(appState: AppState, options: AGPExportOptions = {}): string {
  const flavor = options.flavor ?? 'pretextview';
  const includeHeader = options.includeHeader ?? true;
  const map = appState.map;

  if (!map || map.contigs.length === 0) {
    throw new Error('Cannot export AGP: no map data loaded');
  }

  let order = appState.contigOrder;
  if (flavor === 'pretextview') {
    const problems = agpExportProblems(map, order);
    if (problems.length > 0) throw new AGPExportBlocked(problems);
  } else {
    order = contigExclusion.getIncludedOrder(order);
  }
  if (order.length === 0) {
    throw new Error('Cannot export AGP: contig order is empty');
  }

  const rows = buildAGPRows(buildAGPObjects(map, order), LIVE_MARKS, flavor);
  if (rows.length === 0) {
    throw new Error('Cannot export AGP: no contig in the order owns any part of the map');
  }
  const lines = rows.map(formatAGPRow);
  if (includeHeader) lines.unshift(generateAGPHeader(map, flavor));
  return lines.join('\n') + '\n';
}

/** File name for a download: `<map>.agp`, or `<map>.standard.agp`. */
export function agpFilename(mapFilename: string | undefined, flavor: AGPFlavor): string {
  const base = mapFilename ? mapFilename.replace(/\.pretext$/i, '') : 'assembly';
  return flavor === 'standard' ? `${base}.standard.agp` : `${base}.agp`;
}

/**
 * Trigger a browser download of the AGP file.
 */
export function downloadAGP(
  appState: AppState,
  filename?: string,
  options?: AGPExportOptions
): void {
  const content = exportAGP(appState, options);
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? agpFilename(appState.map?.filename, options?.flavor ?? 'pretextview');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
