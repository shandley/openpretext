/**
 * MetaTagManager — Manages contig classification meta tags.
 *
 * Meta tags classify contigs as haplotigs, contaminants, unlocalised, or
 * sex chromosome contigs. Mirrors the ContigExclusion / MisassemblyFlags
 * singleton pattern.
 *
 * Indices refer to positions in the contigOrder array (order indices),
 * not to contig IDs in the map.contigs array.
 */

import { events } from '../core/EventBus';

export type MetaTagType = 'haplotig' | 'contaminant' | 'unlocalised' | 'sex_chromosome';

export interface MetaTagInfo {
  tag: MetaTagType;
  notes?: string;
}

class MetaTagManager {
  private tags: Map<number, MetaTagInfo> = new Map();

  /**
   * Set a classification tag on a contig at the given order index.
   * Replaces any existing tag on that contig.
   *
   * @param orderIndex - Index in the contigOrder array.
   * @param tag - The classification tag to apply.
   * @param notes - Optional free-text notes.
   */
  setTag(orderIndex: number, tag: MetaTagType, notes?: string): void {
    this.tags.set(orderIndex, notes !== undefined ? { tag, notes } : { tag });
    events.emit('metatag:updated', { count: this.tags.size });
  }

  /**
   * Remove the tag from a contig at the given order index.
   *
   * @param orderIndex - Index in the contigOrder array.
   */
  removeTag(orderIndex: number): void {
    this.tags.delete(orderIndex);
    events.emit('metatag:updated', { count: this.tags.size });
  }

  /**
   * Get the tag info for a contig at the given order index.
   *
   * @param orderIndex - Index in the contigOrder array.
   * @returns The tag info, or null if no tag is set.
   */
  getTag(orderIndex: number): MetaTagInfo | null {
    return this.tags.get(orderIndex) ?? null;
  }

  /**
   * Check if a contig at the given order index has a tag.
   *
   * @param orderIndex - Index in the contigOrder array.
   * @returns True if the contig has a tag.
   */
  hasTag(orderIndex: number): boolean {
    return this.tags.has(orderIndex);
  }

  /**
   * Get all order indices that have the specified tag type.
   *
   * @param tag - The tag type to filter by.
   * @returns Array of order indices with that tag.
   */
  getByTag(tag: MetaTagType): number[] {
    const result: number[] = [];
    for (const [orderIndex, info] of this.tags) {
      if (info.tag === tag) {
        result.push(orderIndex);
      }
    }
    return result;
  }

  /**
   * Get a copy of all tags.
   * Returns a new Map to prevent external mutation.
   *
   * @returns A new Map of order index to tag info.
   */
  getAllTags(): Map<number, MetaTagInfo> {
    return new Map(this.tags);
  }

  /**
   * Get the total number of tagged contigs.
   */
  getTagCount(): number {
    return this.tags.size;
  }

  /**
   * Get the count of tagged contigs per tag type.
   *
   * @returns Record mapping each tag type to its count.
   */
  getTagCounts(): Record<MetaTagType, number> {
    const counts: Record<MetaTagType, number> = {
      haplotig: 0,
      contaminant: 0,
      unlocalised: 0,
      sex_chromosome: 0,
    };
    for (const info of this.tags.values()) {
      counts[info.tag]++;
    }
    return counts;
  }

  /**
   * Clear all tags.
   */
  clearAll(): void {
    this.tags.clear();
    events.emit('metatag:updated', { count: 0 });
  }

  /**
   * Set a tag on multiple contigs at once.
   *
   * @param orderIndices - Array of contigOrder indices to tag.
   * @param tag - The classification tag to apply.
   * @param notes - Optional free-text notes applied to all.
   */
  setMany(orderIndices: number[], tag: MetaTagType, notes?: string): void {
    const info: MetaTagInfo = notes !== undefined ? { tag, notes } : { tag };
    for (const idx of orderIndices) {
      this.tags.set(idx, { ...info });
    }
    events.emit('metatag:updated', { count: this.tags.size });
  }

  /**
   * Remove tags from multiple contigs at once.
   *
   * @param orderIndices - Array of contigOrder indices to untag.
   */
  removeMany(orderIndices: number[]): void {
    for (const idx of orderIndices) {
      this.tags.delete(idx);
    }
    events.emit('metatag:updated', { count: this.tags.size });
  }
}

export const metaTags = new MetaTagManager();
