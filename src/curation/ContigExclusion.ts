/**
 * ContigExclusion - Manages contig exclusion (hiding) state.
 *
 * Excluded contigs remain in the contigOrder array and in the map data,
 * but are flagged for exclusion from rendering highlights and exports.
 * This uses a separate Set-based approach so that we do not need to
 * modify the ContigInfo interface or touch other files.
 *
 * Indices stored here refer to positions in the contigOrder array
 * (order indices), not to contig IDs in the map.contigs array.
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
   * Returns the contig IDs (values from the contigOrder array) for
   * non-excluded positions, preserving their relative order.
   *
   * @param contigOrder - The full contigOrder array from state.
   * @returns A new array containing only the contig IDs at non-excluded positions.
   */
  getIncludedOrder(contigOrder: number[]): number[] {
    return contigOrder.filter((_, index) => !this.excludedIndices.has(index));
  }
}

export const contigExclusion = new ContigExclusionManager();
