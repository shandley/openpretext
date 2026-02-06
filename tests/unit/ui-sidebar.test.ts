import { describe, it, expect } from 'vitest';
import { formatBp } from '../../src/ui/Sidebar';

// ---------------------------------------------------------------------------
// formatBp tests
// ---------------------------------------------------------------------------

describe('formatBp', () => {
  // -------------------------------------------------------------------------
  // Standard unit ranges
  // -------------------------------------------------------------------------
  describe('base pair range (< 1000)', () => {
    it('should format 500 as "500 bp"', () => {
      expect(formatBp(500)).toBe('500 bp');
    });

    it('should format 0 as "0 bp"', () => {
      expect(formatBp(0)).toBe('0 bp');
    });

    it('should format 999 as "999 bp"', () => {
      expect(formatBp(999)).toBe('999 bp');
    });

    it('should format 1 as "1 bp"', () => {
      expect(formatBp(1)).toBe('1 bp');
    });
  });

  describe('kilobase range (1000 - 999_999)', () => {
    it('should format 1500 as "1.5 kb"', () => {
      expect(formatBp(1500)).toBe('1.5 kb');
    });

    it('should format 1000 as "1.0 kb"', () => {
      expect(formatBp(1000)).toBe('1.0 kb');
    });

    it('should format 999_999 as "1000.0 kb"', () => {
      expect(formatBp(999_999)).toBe('1000.0 kb');
    });

    it('should format 50_000 as "50.0 kb"', () => {
      expect(formatBp(50_000)).toBe('50.0 kb');
    });
  });

  describe('megabase range (1_000_000 - 999_999_999)', () => {
    it('should format 2_500_000 as "2.5 Mb"', () => {
      expect(formatBp(2_500_000)).toBe('2.5 Mb');
    });

    it('should format 1_000_000 as "1.0 Mb"', () => {
      expect(formatBp(1_000_000)).toBe('1.0 Mb');
    });

    it('should format 999_999_999 as "1000.0 Mb"', () => {
      expect(formatBp(999_999_999)).toBe('1000.0 Mb');
    });

    it('should format 150_000_000 as "150.0 Mb"', () => {
      expect(formatBp(150_000_000)).toBe('150.0 Mb');
    });
  });

  describe('gigabase range (>= 1_000_000_000)', () => {
    it('should format 1_500_000_000 as "1.5 Gb"', () => {
      expect(formatBp(1_500_000_000)).toBe('1.5 Gb');
    });

    it('should format 1_000_000_000 as "1.0 Gb"', () => {
      expect(formatBp(1_000_000_000)).toBe('1.0 Gb');
    });

    it('should format 3_200_000_000 as "3.2 Gb"', () => {
      expect(formatBp(3_200_000_000)).toBe('3.2 Gb');
    });
  });
});
