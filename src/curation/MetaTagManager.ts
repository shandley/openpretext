/**
 * MetaTagManager — the tags a curator puts on contigs.
 *
 * The tags are the ones PretextView writes into its AGP and the downstream
 * tools read back: Sanger's `pretext-to-asm` (sanger-tol/agp-tpf-utils) and
 * the VGP `vgl-curation` scripts. They are single words, compared exactly and
 * with case, and a contig can carry several (`Unloc` and `Hap1`, say). What
 * each one does downstream, and the sources for it, are in
 * `research/export-compat-2026-11/downstream-tooling.md`.
 *
 * The spelling matters more than it looks: `pretext-to-asm` treats any word it
 * does not know as the name of a haplotype and splits its output accordingly,
 * without a warning. So tags are checked here, on the way in.
 *
 * Keys are contig ids (indices into `map.contigs`, the values of
 * `contigOrder`), not positions in the order, so a tag follows its contig
 * when it moves. CurationEngine carries tags across cut and join.
 */

import { events } from '../core/EventBus';

/** What a tag means to the tools that read the AGP. */
export type TagKind =
  /** The sequence is taken out of the assembly: Haplotig, Contaminant, FalseDuplicate. */
  | 'removal'
  /** Belongs to its chromosome but has no place in it: Unloc. */
  | 'unloc'
  /** Names the chromosome: X, Y, Z, W, X1, B1, I, II, ... */
  | 'chromosome'
  /** Target, Primary, Singleton, Cut: switches read by pretext-to-asm. */
  | 'flag'
  /** Anything else is read as a haplotype name: Hap1, HAP2, Hap_1, ... */
  | 'haplotype';

/** Tags that take sequence out of the curated assembly. */
export const REMOVAL_TAGS: readonly string[] = ['Haplotig', 'Contaminant', 'FalseDuplicate'];

const FLAG_TAGS: readonly string[] = ['Target', 'Primary', 'Singleton', 'Cut'];

/**
 * PretextView's default tags, in the order it stores them, which is the order
 * it writes them across the columns of an AGP row (PretextView.cpp,
 * `Default_Tags`, release 1.0.7; its three paint-only tags are left out).
 */
export const PRETEXTVIEW_TAGS: readonly string[] = [
  'Haplotig', 'Unloc', 'X', 'Y', 'Z', 'W', 'HAP1', 'HAP2', 'Target', 'Contaminant', 'Singleton',
  'X1', 'X2', 'Y1', 'Y2', 'Z1', 'Z2', 'W1', 'W2', 'I', 'II', 'III', 'IV', 'V', 'U',
  'B1', 'B2', 'B3', 'FalseDuplicate', 'Primary',
];

/**
 * Haplotype tags in use that are not PretextView defaults. `Hap1`/`Hap2` are
 * in the Sanger documentation; the VGP scripts require `Hap_1`/`Hap_2`.
 */
export const HAPLOTYPE_TAGS: readonly string[] = ['Hap1', 'Hap2', 'HAP1', 'HAP2', 'Hap_1', 'Hap_2'];

/** `pretext-to-asm`'s test for "this tag looks like a chromosome name" (naming_utils.py). */
const CHROMOSOME_NAME = /^([A-Z]\d*[A-Z]?|[IVX_]+|\d+[A-Z]+)$/;

/**
 * Whether `tag` can be written to an AGP as a tag. A tag is one word of
 * letters, digits and underscores. `Painted` is not a tag: PretextView writes
 * it from the scaffold painting, and so do we.
 */
export function isValidTag(tag: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(tag) && tag !== 'Painted';
}

/** How the downstream tools will read `tag`. */
export function tagKind(tag: string): TagKind {
  if (REMOVAL_TAGS.includes(tag)) return 'removal';
  if (tag === 'Unloc') return 'unloc';
  if (FLAG_TAGS.includes(tag)) return 'flag';
  if (CHROMOSOME_NAME.test(tag)) return 'chromosome';
  return 'haplotype';
}

/** Position of a tag across an AGP row: PretextView's order, then the rest by name. */
function tagRank(tag: string): number {
  const i = PRETEXTVIEW_TAGS.indexOf(tag);
  return i === -1 ? PRETEXTVIEW_TAGS.length : i;
}

/** Sort tags into the order they are written in. */
export function sortTags(tags: Iterable<string>): string[] {
  return [...new Set(tags)].sort((a, b) => tagRank(a) - tagRank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The tags used before the PretextView vocabulary was adopted, as saved in
 * version 2 sessions. `sex_chromosome` did not record which chromosome, so it
 * has no equivalent.
 */
export function fromLegacyTag(tag: string): string | null {
  switch (tag) {
    case 'haplotig': return 'Haplotig';
    case 'contaminant': return 'Contaminant';
    case 'unlocalised': return 'Unloc';
    default: return null;
  }
}

export interface MetaTagInfo {
  /** In written order (see sortTags). Never empty. */
  tags: string[];
  notes?: string;
}

class MetaTagManager {
  private byContig: Map<number, MetaTagInfo> = new Map();

  private changed(): void {
    events.emit('metatag:updated', { count: this.byContig.size });
  }

  private put(contigId: number, tags: string[], notes: string | undefined): void {
    for (const t of tags) {
      if (!isValidTag(t)) throw new Error(`"${t}" cannot be used as a tag: a tag is one word of letters, digits and underscores`);
    }
    const sorted = sortTags(tags);
    if (sorted.length === 0) {
      this.byContig.delete(contigId);
      return;
    }
    this.byContig.set(contigId, notes !== undefined && notes !== '' ? { tags: sorted, notes } : { tags: sorted });
  }

  /**
   * Add a tag to a contig. A contig holds at most one tag of each of the
   * kinds that exclude one another: one chromosome name, one haplotype, one
   * reason for removal. Adding a second replaces the first.
   */
  addTag(contigId: number, tag: string, notes?: string): void {
    this.addQuietly(contigId, tag, notes);
    this.changed();
  }

  private addQuietly(contigId: number, tag: string, notes?: string): void {
    const current = this.byContig.get(contigId);
    const kind = tagKind(tag);
    const exclusive = kind === 'chromosome' || kind === 'haplotype' || kind === 'removal';
    const kept = (current?.tags ?? []).filter((t) => !(exclusive && tagKind(t) === kind));
    this.put(contigId, [...kept, tag], notes ?? current?.notes);
  }

  /** Replace everything on a contig. An empty list removes its entry. */
  setTags(contigId: number, tags: string[], notes?: string): void {
    this.put(contigId, tags, notes);
    this.changed();
  }

  /** Remove one tag from a contig, or all of them when `tag` is omitted. */
  removeTag(contigId: number, tag?: string): void {
    this.removeQuietly(contigId, tag);
    this.changed();
  }

  private removeQuietly(contigId: number, tag?: string): void {
    const current = this.byContig.get(contigId);
    if (!current) return;
    if (tag === undefined) this.byContig.delete(contigId);
    else this.put(contigId, current.tags.filter((t) => t !== tag), current.notes);
  }

  /** The contig's tags in written order; empty when it has none. */
  getTags(contigId: number): string[] {
    return [...(this.byContig.get(contigId)?.tags ?? [])];
  }

  getInfo(contigId: number): MetaTagInfo | null {
    const info = this.byContig.get(contigId);
    return info ? { ...info, tags: [...info.tags] } : null;
  }

  /** Whether the contig carries `tag`, or any tag when `tag` is omitted. */
  hasTag(contigId: number, tag?: string): boolean {
    const info = this.byContig.get(contigId);
    if (!info) return false;
    return tag === undefined || info.tags.includes(tag);
  }

  /** Ids of the contigs carrying `tag`. */
  getByTag(tag: string): number[] {
    const out: number[] = [];
    for (const [id, info] of this.byContig) if (info.tags.includes(tag)) out.push(id);
    return out;
  }

  /** A copy of everything, by contig id. */
  getAllTags(): Map<number, MetaTagInfo> {
    const out = new Map<number, MetaTagInfo>();
    for (const [id, info] of this.byContig) out.set(id, { ...info, tags: [...info.tags] });
    return out;
  }

  /** Number of contigs that carry at least one tag. */
  getTagCount(): number {
    return this.byContig.size;
  }

  /** How many contigs carry each tag, in written order. */
  getTagCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const info of this.byContig.values()) {
      for (const t of info.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return new Map(sortTags(counts.keys()).map((t) => [t, counts.get(t)!]));
  }

  clearAll(): void {
    this.byContig.clear();
    events.emit('metatag:updated', { count: 0 });
  }

  /** Add one tag to several contigs. */
  addMany(contigIds: number[], tag: string): void {
    for (const id of contigIds) this.addQuietly(id, tag);
    this.changed();
  }

  /** Remove one tag, or all tags, from several contigs. */
  removeMany(contigIds: number[], tag?: string): void {
    for (const id of contigIds) this.removeQuietly(id, tag);
    this.changed();
  }
}

export const metaTags = new MetaTagManager();
