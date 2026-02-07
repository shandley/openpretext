/**
 * Tests for the shared OrderingMetrics module.
 */

import { describe, it, expect } from 'vitest';
import { kendallTau, adjustedRandIndex, longestCorrectRun } from '../../src/curation/OrderingMetrics';

describe('OrderingMetrics', () => {
  describe('kendallTau', () => {
    it('should return 1 for identical orderings', () => {
      expect(kendallTau([0, 1, 2, 3, 4], [0, 1, 2, 3, 4])).toBe(1);
    });

    it('should return -1 for completely reversed ordering', () => {
      expect(kendallTau([4, 3, 2, 1, 0], [0, 1, 2, 3, 4])).toBe(-1);
    });

    it('should return 1 for single element', () => {
      expect(kendallTau([0], [0])).toBe(1);
    });

    it('should return 1 for empty array', () => {
      expect(kendallTau([], [])).toBe(1);
    });

    it('should handle partial overlaps', () => {
      const tau = kendallTau([0, 2, 1, 3], [0, 1, 2, 3]);
      // One inversion (2,1): concordant=5, discordant=1, tau = 4/6 = 0.667
      expect(tau).toBeCloseTo(0.667, 2);
    });

    it('should return value in [-1, 1] for any input', () => {
      const predicted = [3, 1, 4, 0, 2];
      const groundTruth = [0, 1, 2, 3, 4];
      const tau = kendallTau(predicted, groundTruth);
      expect(tau).toBeGreaterThanOrEqual(-1);
      expect(tau).toBeLessThanOrEqual(1);
    });

    it('should handle non-overlapping elements gracefully', () => {
      const tau = kendallTau([10, 11, 12], [0, 1, 2]);
      // No overlap — should return 1 (n <= 1 after filtering)
      expect(tau).toBe(1);
    });

    it('should handle two elements', () => {
      expect(kendallTau([0, 1], [0, 1])).toBe(1);
      expect(kendallTau([1, 0], [0, 1])).toBe(-1);
    });

    it('should be symmetric in direction', () => {
      const a = [0, 2, 1, 3, 4];
      const b = [0, 1, 2, 3, 4];
      const tau1 = kendallTau(a, b);
      // Swapping should give same magnitude but could differ in sign
      const tau2 = kendallTau(b, a);
      // Actually tau is symmetric for same set
      expect(tau1).toBeCloseTo(tau2, 10);
    });
  });

  describe('adjustedRandIndex', () => {
    it('should return 1 for identical clusterings', () => {
      expect(adjustedRandIndex([0, 0, 1, 1, 2], [0, 0, 1, 1, 2])).toBe(1);
    });

    it('should return 1 for single element', () => {
      expect(adjustedRandIndex([0], [0])).toBe(1);
    });

    it('should return ~0 for random clusterings', () => {
      // Two very different clusterings of same length
      const pred = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
      const gt   = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
      const ari = adjustedRandIndex(pred, gt);
      // Should be close to 0 for unrelated clusterings
      expect(Math.abs(ari)).toBeLessThan(0.3);
    });

    it('should handle relabeled identical clusterings', () => {
      // Same partition, different labels
      const pred = [1, 1, 2, 2, 3];
      const gt   = [10, 10, 20, 20, 30];
      expect(adjustedRandIndex(pred, gt)).toBeCloseTo(1, 5);
    });

    it('should handle all-same cluster', () => {
      const pred = [0, 0, 0, 0];
      const gt   = [0, 0, 0, 0];
      expect(adjustedRandIndex(pred, gt)).toBe(1);
    });

    it('should handle different lengths by using minimum', () => {
      const pred = [0, 1, 0, 1, 0, 1];
      const gt   = [0, 1, 0];
      const ari = adjustedRandIndex(pred, gt);
      expect(ari).toBeDefined();
    });
  });

  describe('longestCorrectRun', () => {
    it('should return full length for identical orderings', () => {
      expect(longestCorrectRun([0, 1, 2, 3, 4], [0, 1, 2, 3, 4])).toBe(5);
    });

    it('should return 1 for completely reversed ordering', () => {
      expect(longestCorrectRun([4, 3, 2, 1, 0], [0, 1, 2, 3, 4])).toBe(1);
    });

    it('should return 0 for empty arrays', () => {
      expect(longestCorrectRun([], [])).toBe(0);
      expect(longestCorrectRun([0], [])).toBe(0);
      expect(longestCorrectRun([], [0])).toBe(0);
    });

    it('should find longest consecutive run', () => {
      // [0, 1, 2] is the longest correct run in gt [0,1,2,3,4]
      expect(longestCorrectRun([3, 0, 1, 2, 4], [0, 1, 2, 3, 4])).toBe(3);
    });

    it('should handle single element', () => {
      expect(longestCorrectRun([0], [0])).toBe(1);
    });

    it('should handle elements not in ground truth', () => {
      expect(longestCorrectRun([0, 10, 1, 2], [0, 1, 2, 3])).toBe(2);
    });

    it('should find the maximum run, not the first', () => {
      // [2,3,4] is length 3, [0,1] is length 2
      expect(longestCorrectRun([0, 1, 5, 2, 3, 4], [0, 1, 2, 3, 4])).toBe(3);
    });
  });
});
