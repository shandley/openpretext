/**
 * MisassemblyFlags — Manages misassembly flag state for contigs.
 *
 * Flagged contigs are those where internal TAD boundaries or compartment
 * sign-changes suggest a chimeric misassembly. Mirrors the ContigExclusion
 * singleton pattern.
 *
 * Indices refer to positions in the contigOrder array (order indices),
 * not to contig IDs in the map.contigs array.
 */

import type { MisassemblyFlag } from '../analysis/MisassemblyDetector';
import { events } from '../core/EventBus';

class MisassemblyFlagManager {
  private flaggedIndices: Set<number> = new Set();
  private flagData: Map<number, MisassemblyFlag[]> = new Map();

  /**
   * Bulk-set flags from detection results.
   * Clears previous state and replaces with new flags.
   */
  setFlags(flags: MisassemblyFlag[]): void {
    this.flaggedIndices.clear();
    this.flagData.clear();

    for (const flag of flags) {
      this.flaggedIndices.add(flag.orderIndex);
      if (!this.flagData.has(flag.orderIndex)) {
        this.flagData.set(flag.orderIndex, []);
      }
      this.flagData.get(flag.orderIndex)!.push(flag);
    }

    events.emit('misassembly:updated', { count: this.flaggedIndices.size });
  }

  /**
   * Check if a contig at the given order index is flagged.
   */
  isFlagged(orderIndex: number): boolean {
    return this.flaggedIndices.has(orderIndex);
  }

  /**
   * Get the full set of flagged order indices.
   * Returns a copy to prevent external mutation.
   */
  getFlagged(): Set<number> {
    return new Set(this.flaggedIndices);
  }

  /**
   * Get the count of flagged contigs.
   */
  getFlaggedCount(): number {
    return this.flaggedIndices.size;
  }

  /**
   * Get all flags across all contigs.
   */
  getAllFlags(): MisassemblyFlag[] {
    const all: MisassemblyFlag[] = [];
    for (const flags of this.flagData.values()) {
      all.push(...flags);
    }
    return all;
  }

  /**
   * Get the detailed flags for a specific contig.
   * Returns an empty array if the contig is not flagged.
   */
  getFlagDetails(orderIndex: number): MisassemblyFlag[] {
    return this.flagData.get(orderIndex) ?? [];
  }

  /**
   * Clear all flags.
   */
  clearAll(): void {
    this.flaggedIndices.clear();
    this.flagData.clear();
  }
}

export const misassemblyFlags = new MisassemblyFlagManager();
