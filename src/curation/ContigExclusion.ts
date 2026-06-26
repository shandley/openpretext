/**
 * ContigExclusion - Manages contig exclusion (hiding) state.
 *
 * Excluded contigs remain in the contigOrder array and in the map data,
 * but are flagged for exclusion from rendering highlights and exports.
 * This uses a separate Set-based approach so that we do not need to
 * modify the ContigInfo interface or touch other files.
 *
 * Keys stored here are contig IDs (the values in the contigOrder array, i.e.
 * indices into map.contigs), NOT positions in contigOrder. Keying by identity
 * means an exclusion follows its contig across reorders (move/sort) and is
 * naturally dropped when that contig is destroyed by a cut/join.
 */

class ContigExclusionManager {
  private excludedIndices: Set<number> = new Set();

  /**
   * Toggle exclusion for a contig at the given order index.
   * If the contig is currently excluded, it becomes included, and vice versa.
   *
   * @param orderIndex - Index in the contigOrder array.
   * @returns The new excluded state (true = now excluded, false = now included).
   */
  toggle(orderIndex: number): boolean {
    if (this.excludedIndices.has(orderIndex)) {
      this.excludedIndices.delete(orderIndex);
      return false;
    } else {
      this.excludedIndices.add(orderIndex);
      return true;
    }
  }

  /**
   * Explicitly set the exclusion state for a contig.
   *
   * @param orderIndex - Index in the contigOrder array.
   * @param excluded - Whether the contig should be excluded.
   */
  set(orderIndex: number, excluded: boolean): void {
    if (excluded) {
      this.excludedIndices.add(orderIndex);
    } else {
      this.excludedIndices.delete(orderIndex);
    }
  }

  /**
   * Exclude multiple contigs at once.
   *
   * @param orderIndices - Array of contigOrder indices to exclude.
   */
  excludeMany(orderIndices: number[]): void {
    for (const idx of orderIndices) {
      this.excludedIndices.add(idx);
    }
  }

  /**
   * Include (un-exclude) multiple contigs at once.
   *
   * @param orderIndices - Array of contigOrder indices to include.
   */
  includeMany(orderIndices: number[]): void {
    for (const idx of orderIndices) {
      this.excludedIndices.delete(idx);
    }
  }

  /**
   * Check if a contig at the given order index is excluded.
   *
   * @param orderIndex - Index in the contigOrder array.
   * @returns True if the contig is excluded.
   */
  isExcluded(orderIndex: number): boolean {
    return this.excludedIndices.has(orderIndex);
  }

  /**
   * Get the full set of excluded order indices.
   * Returns a copy to prevent external mutation.
   *
   * @returns A new Set containing all excluded order indices.
   */
  getExcluded(): Set<number> {
    return new Set(this.excludedIndices);
  }

  /**
   * Get the count of excluded contigs.
   *
   * @returns The number of excluded contigs.
   */
  getExcludedCount(): number {
    return this.excludedIndices.size;
  }

  /**
   * Clear all exclusions, making every contig included.
   */
  clearAll(): void {
    this.excludedIndices.clear();
  }

  /**
   * Get a filtered contigOrder that omits excluded contigs.
   * Returns the contig IDs (values from the contigOrder array) that are not
   * excluded, preserving their relative order.
   *
   * @param contigOrder - The full contigOrder array from state.
   * @returns A new array containing only the contig IDs that are not excluded.
   */
  getIncludedOrder(contigOrder: number[]): number[] {
    return contigOrder.filter((contigId) => !this.excludedIndices.has(contigId));
  }

  /**
   * Count how many of the given order's contigs are currently excluded.
   * Orphan-safe: ignores excluded IDs no longer present (e.g. after cut/join).
   *
   * @param contigOrder - The full contigOrder array from state.
   */
  getExcludedCountIn(contigOrder: number[]): number {
    let n = 0;
    for (const id of contigOrder) if (this.excludedIndices.has(id)) n++;
    return n;
  }
}

export const contigExclusion = new ContigExclusionManager();
