import { describe, it, expect, beforeEach } from 'vitest';
import { contigExclusion } from '../../src/curation/ContigExclusion';

// ---------------------------------------------------------------------------
// ContigExclusionManager tests
// ---------------------------------------------------------------------------

describe('ContigExclusionManager', () => {
  beforeEach(() => {
    contigExclusion.clearAll();
  });

  // -----------------------------------------------------------------------
  // toggle
  // -----------------------------------------------------------------------
  describe('toggle', () => {
    it('should exclude a contig that is currently included', () => {
      const result = contigExclusion.toggle(0);
      expect(result).toBe(true);
      expect(contigExclusion.isExcluded(0)).toBe(true);
    });

    it('should include a contig that is currently excluded', () => {
      contigExclusion.set(0, true);
      const result = contigExclusion.toggle(0);
      expect(result).toBe(false);
      expect(contigExclusion.isExcluded(0)).toBe(false);
    });

    it('should return the new excluded state', () => {
      expect(contigExclusion.toggle(5)).toBe(true);  // was included -> now excluded
      expect(contigExclusion.toggle(5)).toBe(false);  // was excluded -> now included
      expect(contigExclusion.toggle(5)).toBe(true);  // was included -> now excluded again
    });

    it('should only affect the toggled index', () => {
      contigExclusion.toggle(1);
      contigExclusion.toggle(3);

      expect(contigExclusion.isExcluded(0)).toBe(false);
      expect(contigExclusion.isExcluded(1)).toBe(true);
      expect(contigExclusion.isExcluded(2)).toBe(false);
      expect(contigExclusion.isExcluded(3)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // set
  // -----------------------------------------------------------------------
  describe('set', () => {
    it('should explicitly set a contig as excluded', () => {
      contigExclusion.set(2, true);
      expect(contigExclusion.isExcluded(2)).toBe(true);
    });

    it('should explicitly set a contig as included', () => {
      contigExclusion.set(2, true);
      contigExclusion.set(2, false);
      expect(contigExclusion.isExcluded(2)).toBe(false);
    });

    it('should be idempotent when setting excluded to true twice', () => {
      contigExclusion.set(1, true);
      contigExclusion.set(1, true);
      expect(contigExclusion.isExcluded(1)).toBe(true);
      expect(contigExclusion.getExcludedCount()).toBe(1);
    });

    it('should be idempotent when setting excluded to false for already included', () => {
      contigExclusion.set(1, false);
      expect(contigExclusion.isExcluded(1)).toBe(false);
      expect(contigExclusion.getExcludedCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // excludeMany / includeMany
  // -----------------------------------------------------------------------
  describe('excludeMany', () => {
    it('should exclude multiple contigs at once', () => {
      contigExclusion.excludeMany([0, 2, 4]);

      expect(contigExclusion.isExcluded(0)).toBe(true);
      expect(contigExclusion.isExcluded(1)).toBe(false);
      expect(contigExclusion.isExcluded(2)).toBe(true);
      expect(contigExclusion.isExcluded(3)).toBe(false);
      expect(contigExclusion.isExcluded(4)).toBe(true);
    });

    it('should handle empty array', () => {
      contigExclusion.excludeMany([]);
      expect(contigExclusion.getExcludedCount()).toBe(0);
    });

    it('should not duplicate already-excluded indices', () => {
      contigExclusion.set(1, true);
      contigExclusion.excludeMany([1, 2, 3]);
      expect(contigExclusion.getExcludedCount()).toBe(3);
    });
  });

  describe('includeMany', () => {
    it('should include multiple contigs at once', () => {
      contigExclusion.excludeMany([0, 1, 2, 3]);
      contigExclusion.includeMany([1, 3]);

      expect(contigExclusion.isExcluded(0)).toBe(true);
      expect(contigExclusion.isExcluded(1)).toBe(false);
      expect(contigExclusion.isExcluded(2)).toBe(true);
      expect(contigExclusion.isExcluded(3)).toBe(false);
    });

    it('should handle empty array', () => {
      contigExclusion.excludeMany([0, 1]);
      contigExclusion.includeMany([]);
      expect(contigExclusion.getExcludedCount()).toBe(2);
    });

    it('should be safe to include already-included indices', () => {
      contigExclusion.includeMany([0, 1, 2]);
      expect(contigExclusion.getExcludedCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // isExcluded
  // -----------------------------------------------------------------------
  describe('isExcluded', () => {
    it('should return false for indices that were never excluded', () => {
      expect(contigExclusion.isExcluded(0)).toBe(false);
      expect(contigExclusion.isExcluded(99)).toBe(false);
    });

    it('should return true for excluded indices', () => {
      contigExclusion.set(5, true);
      expect(contigExclusion.isExcluded(5)).toBe(true);
    });

    it('should return false after an index is re-included', () => {
      contigExclusion.set(5, true);
      contigExclusion.set(5, false);
      expect(contigExclusion.isExcluded(5)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getExcluded
  // -----------------------------------------------------------------------
  describe('getExcluded', () => {
    it('should return an empty set when nothing is excluded', () => {
      const excluded = contigExclusion.getExcluded();
      expect(excluded.size).toBe(0);
    });

    it('should return all excluded indices', () => {
      contigExclusion.excludeMany([1, 3, 5]);
      const excluded = contigExclusion.getExcluded();
      expect(excluded).toEqual(new Set([1, 3, 5]));
    });

    it('should return a copy that does not affect internal state', () => {
      contigExclusion.excludeMany([1, 2]);
      const excluded = contigExclusion.getExcluded();
      excluded.add(99);
      // Internal state should not be affected
      expect(contigExclusion.isExcluded(99)).toBe(false);
      expect(contigExclusion.getExcludedCount()).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // getExcludedCount
  // -----------------------------------------------------------------------
  describe('getExcludedCount', () => {
    it('should return 0 when nothing is excluded', () => {
      expect(contigExclusion.getExcludedCount()).toBe(0);
    });

    it('should return the correct count after exclusions', () => {
      contigExclusion.excludeMany([0, 1, 2]);
      expect(contigExclusion.getExcludedCount()).toBe(3);
    });

    it('should decrease when contigs are included', () => {
      contigExclusion.excludeMany([0, 1, 2]);
      contigExclusion.includeMany([1]);
      expect(contigExclusion.getExcludedCount()).toBe(2);
    });

    it('should reflect toggle operations', () => {
      contigExclusion.toggle(0);
      expect(contigExclusion.getExcludedCount()).toBe(1);
      contigExclusion.toggle(0);
      expect(contigExclusion.getExcludedCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // clearAll
  // -----------------------------------------------------------------------
  describe('clearAll', () => {
    it('should remove all exclusions', () => {
      contigExclusion.excludeMany([0, 1, 2, 3, 4]);
      expect(contigExclusion.getExcludedCount()).toBe(5);

      contigExclusion.clearAll();
      expect(contigExclusion.getExcludedCount()).toBe(0);
      expect(contigExclusion.isExcluded(0)).toBe(false);
      expect(contigExclusion.isExcluded(4)).toBe(false);
    });

    it('should be safe to call when nothing is excluded', () => {
      contigExclusion.clearAll();
      expect(contigExclusion.getExcludedCount()).toBe(0);
    });

    it('should allow new exclusions after clearing', () => {
      contigExclusion.excludeMany([0, 1]);
      contigExclusion.clearAll();
      contigExclusion.set(3, true);
      expect(contigExclusion.getExcludedCount()).toBe(1);
      expect(contigExclusion.isExcluded(3)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // getIncludedOrder
  // -----------------------------------------------------------------------
  describe('getIncludedOrder', () => {
    it('should return all contigs when nothing is excluded', () => {
      const order = [0, 1, 2, 3];
      const included = contigExclusion.getIncludedOrder(order);
      expect(included).toEqual([0, 1, 2, 3]);
    });

    it('should filter out excluded contigs', () => {
      contigExclusion.excludeMany([1, 3]);
      const order = [0, 1, 2, 3];
      const included = contigExclusion.getIncludedOrder(order);
      expect(included).toEqual([0, 2]);
    });

    it('should preserve order of non-excluded contigs', () => {
      contigExclusion.set(0, true);
      const order = [5, 3, 1, 4, 2];
      // Excluding index 0 means we exclude the contig at position 0 (which is contig ID 5)
      const included = contigExclusion.getIncludedOrder(order);
      expect(included).toEqual([3, 1, 4, 2]);
    });

    it('should return empty array when all contigs are excluded', () => {
      contigExclusion.excludeMany([0, 1, 2]);
      const order = [10, 20, 30];
      const included = contigExclusion.getIncludedOrder(order);
      expect(included).toEqual([]);
    });

    it('should handle reordered contig order correctly', () => {
      // Exclude indices 1 and 4
      contigExclusion.excludeMany([1, 4]);
      const order = [7, 3, 9, 1, 5];
      // index 0: contig 7 (included)
      // index 1: contig 3 (excluded)
      // index 2: contig 9 (included)
      // index 3: contig 1 (included)
      // index 4: contig 5 (excluded)
      const included = contigExclusion.getIncludedOrder(order);
      expect(included).toEqual([7, 9, 1]);
    });

    it('should not modify the original order array', () => {
      contigExclusion.set(1, true);
      const order = [0, 1, 2];
      const orderCopy = [...order];
      contigExclusion.getIncludedOrder(order);
      expect(order).toEqual(orderCopy);
    });
  });
});
