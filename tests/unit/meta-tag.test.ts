import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/core/EventBus', () => ({
  events: {
    on: vi.fn(),
    emit: vi.fn(),
    off: vi.fn(),
  },
}));

import { metaTags } from '../../src/curation/MetaTagManager';
import { events } from '../../src/core/EventBus';

// ---------------------------------------------------------------------------
// MetaTagManager tests
// ---------------------------------------------------------------------------

describe('MetaTagManager', () => {
  beforeEach(() => {
    metaTags.clearAll();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // setTag
  // -----------------------------------------------------------------------
  describe('setTag', () => {
    it('should set a tag on a contig', () => {
      metaTags.setTag(0, 'haplotig');
      expect(metaTags.getTag(0)).toEqual({ tag: 'haplotig' });
    });

    it('should set a tag with notes', () => {
      metaTags.setTag(1, 'contaminant', 'bacterial contamination');
      expect(metaTags.getTag(1)).toEqual({
        tag: 'contaminant',
        notes: 'bacterial contamination',
      });
    });

    it('should not include notes key when notes is undefined', () => {
      metaTags.setTag(0, 'haplotig');
      const info = metaTags.getTag(0);
      expect(info).toEqual({ tag: 'haplotig' });
      expect(info).not.toHaveProperty('notes');
    });

    it('should replace an existing tag on the same contig', () => {
      metaTags.setTag(0, 'haplotig', 'first');
      metaTags.setTag(0, 'contaminant', 'replaced');
      expect(metaTags.getTag(0)).toEqual({ tag: 'contaminant', notes: 'replaced' });
      expect(metaTags.getTagCount()).toBe(1);
    });

    it('should replace an existing tag and remove notes when none given', () => {
      metaTags.setTag(0, 'haplotig', 'has notes');
      metaTags.setTag(0, 'unlocalised');
      const info = metaTags.getTag(0);
      expect(info).toEqual({ tag: 'unlocalised' });
      expect(info).not.toHaveProperty('notes');
    });

    it('should emit metatag:updated with correct count', () => {
      metaTags.setTag(0, 'haplotig');
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 1 });
    });

    it('should emit metatag:updated with correct count for multiple tags', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'contaminant');
      expect(events.emit).toHaveBeenLastCalledWith('metatag:updated', { count: 2 });
    });

    it('should support all four tag types', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'contaminant');
      metaTags.setTag(2, 'unlocalised');
      metaTags.setTag(3, 'sex_chromosome');
      expect(metaTags.getTag(0)!.tag).toBe('haplotig');
      expect(metaTags.getTag(1)!.tag).toBe('contaminant');
      expect(metaTags.getTag(2)!.tag).toBe('unlocalised');
      expect(metaTags.getTag(3)!.tag).toBe('sex_chromosome');
    });
  });

  // -----------------------------------------------------------------------
  // removeTag
  // -----------------------------------------------------------------------
  describe('removeTag', () => {
    it('should remove an existing tag', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.removeTag(0);
      expect(metaTags.getTag(0)).toBeNull();
      expect(metaTags.getTagCount()).toBe(0);
    });

    it('should be safe to remove a non-existent tag', () => {
      metaTags.removeTag(99);
      expect(metaTags.getTagCount()).toBe(0);
    });

    it('should only remove the specified contig', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'contaminant');
      metaTags.removeTag(0);
      expect(metaTags.hasTag(0)).toBe(false);
      expect(metaTags.hasTag(1)).toBe(true);
    });

    it('should emit metatag:updated with correct count', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'contaminant');
      vi.clearAllMocks();
      metaTags.removeTag(0);
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 1 });
    });

    it('should emit metatag:updated even when removing non-existent tag', () => {
      metaTags.removeTag(99);
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 0 });
    });
  });

  // -----------------------------------------------------------------------
  // getTag
  // -----------------------------------------------------------------------
  describe('getTag', () => {
    it('should return tag info for a tagged contig', () => {
      metaTags.setTag(5, 'sex_chromosome', 'X chromosome');
      expect(metaTags.getTag(5)).toEqual({ tag: 'sex_chromosome', notes: 'X chromosome' });
    });

    it('should return null for an untagged contig', () => {
      expect(metaTags.getTag(0)).toBeNull();
    });

    it('should return null after a tag is removed', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.removeTag(0);
      expect(metaTags.getTag(0)).toBeNull();
    });

    it('should return null for an index that never existed', () => {
      expect(metaTags.getTag(999)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // hasTag
  // -----------------------------------------------------------------------
  describe('hasTag', () => {
    it('should return true for a tagged contig', () => {
      metaTags.setTag(0, 'haplotig');
      expect(metaTags.hasTag(0)).toBe(true);
    });

    it('should return false for an untagged contig', () => {
      expect(metaTags.hasTag(0)).toBe(false);
    });

    it('should return false after removal', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.removeTag(0);
      expect(metaTags.hasTag(0)).toBe(false);
    });

    it('should return false for an index that never existed', () => {
      expect(metaTags.hasTag(999)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getByTag
  // -----------------------------------------------------------------------
  describe('getByTag', () => {
    it('should return indices with the specified tag type', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(2, 'haplotig');
      metaTags.setTag(5, 'haplotig');
      metaTags.setTag(1, 'contaminant');
      const haplotigs = metaTags.getByTag('haplotig');
      expect(haplotigs).toEqual(expect.arrayContaining([0, 2, 5]));
      expect(haplotigs).toHaveLength(3);
    });

    it('should return empty array when no contigs have the tag', () => {
      metaTags.setTag(0, 'haplotig');
      expect(metaTags.getByTag('contaminant')).toEqual([]);
    });

    it('should return empty array when no tags exist', () => {
      expect(metaTags.getByTag('haplotig')).toEqual([]);
    });

    it('should not include contigs with a different tag type', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'contaminant');
      metaTags.setTag(2, 'unlocalised');
      metaTags.setTag(3, 'sex_chromosome');
      expect(metaTags.getByTag('contaminant')).toEqual([1]);
    });

    it('should reflect updates after tag changes', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'haplotig');
      metaTags.setTag(0, 'contaminant'); // change tag type
      expect(metaTags.getByTag('haplotig')).toEqual([1]);
      expect(metaTags.getByTag('contaminant')).toEqual([0]);
    });
  });

  // -----------------------------------------------------------------------
  // getAllTags
  // -----------------------------------------------------------------------
  describe('getAllTags', () => {
    it('should return an empty map when no tags exist', () => {
      const all = metaTags.getAllTags();
      expect(all.size).toBe(0);
    });

    it('should return all tags', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'contaminant', 'notes');
      const all = metaTags.getAllTags();
      expect(all.size).toBe(2);
      expect(all.get(0)).toEqual({ tag: 'haplotig' });
      expect(all.get(1)).toEqual({ tag: 'contaminant', notes: 'notes' });
    });

    it('should return a copy that does not affect internal state', () => {
      metaTags.setTag(0, 'haplotig');
      const all = metaTags.getAllTags();
      all.set(99, { tag: 'contaminant' });
      all.delete(0);
      // Internal state should not be affected
      expect(metaTags.hasTag(0)).toBe(true);
      expect(metaTags.hasTag(99)).toBe(false);
      expect(metaTags.getTagCount()).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // getTagCount
  // -----------------------------------------------------------------------
  describe('getTagCount', () => {
    it('should return 0 when no tags exist', () => {
      expect(metaTags.getTagCount()).toBe(0);
    });

    it('should return the correct count', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'contaminant');
      metaTags.setTag(2, 'unlocalised');
      expect(metaTags.getTagCount()).toBe(3);
    });

    it('should decrease when tags are removed', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'contaminant');
      metaTags.removeTag(0);
      expect(metaTags.getTagCount()).toBe(1);
    });

    it('should not double-count when replacing a tag', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(0, 'contaminant');
      expect(metaTags.getTagCount()).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // getTagCounts
  // -----------------------------------------------------------------------
  describe('getTagCounts', () => {
    it('should return all zeros when no tags exist', () => {
      expect(metaTags.getTagCounts()).toEqual({
        haplotig: 0,
        contaminant: 0,
        unlocalised: 0,
        sex_chromosome: 0,
      });
    });

    it('should count each tag type correctly', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'haplotig');
      metaTags.setTag(2, 'contaminant');
      metaTags.setTag(3, 'sex_chromosome');
      metaTags.setTag(4, 'sex_chromosome');
      metaTags.setTag(5, 'sex_chromosome');
      expect(metaTags.getTagCounts()).toEqual({
        haplotig: 2,
        contaminant: 1,
        unlocalised: 0,
        sex_chromosome: 3,
      });
    });

    it('should update after removals', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'haplotig');
      metaTags.removeTag(0);
      expect(metaTags.getTagCounts()).toEqual({
        haplotig: 1,
        contaminant: 0,
        unlocalised: 0,
        sex_chromosome: 0,
      });
    });

    it('should reflect tag type changes', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(0, 'contaminant');
      expect(metaTags.getTagCounts()).toEqual({
        haplotig: 0,
        contaminant: 1,
        unlocalised: 0,
        sex_chromosome: 0,
      });
    });
  });

  // -----------------------------------------------------------------------
  // clearAll
  // -----------------------------------------------------------------------
  describe('clearAll', () => {
    it('should remove all tags', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.setTag(1, 'contaminant');
      metaTags.setTag(2, 'unlocalised');
      metaTags.clearAll();
      expect(metaTags.getTagCount()).toBe(0);
      expect(metaTags.hasTag(0)).toBe(false);
      expect(metaTags.hasTag(1)).toBe(false);
      expect(metaTags.hasTag(2)).toBe(false);
    });

    it('should be safe to call when no tags exist', () => {
      metaTags.clearAll();
      expect(metaTags.getTagCount()).toBe(0);
    });

    it('should allow new tags after clearing', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.clearAll();
      metaTags.setTag(5, 'contaminant');
      expect(metaTags.getTagCount()).toBe(1);
      expect(metaTags.hasTag(5)).toBe(true);
    });

    it('should emit metatag:updated with count 0', () => {
      metaTags.setTag(0, 'haplotig');
      vi.clearAllMocks();
      metaTags.clearAll();
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 0 });
    });
  });

  // -----------------------------------------------------------------------
  // setMany
  // -----------------------------------------------------------------------
  describe('setMany', () => {
    it('should tag multiple contigs at once', () => {
      metaTags.setMany([0, 1, 2], 'haplotig');
      expect(metaTags.hasTag(0)).toBe(true);
      expect(metaTags.hasTag(1)).toBe(true);
      expect(metaTags.hasTag(2)).toBe(true);
      expect(metaTags.getTagCount()).toBe(3);
    });

    it('should tag multiple contigs with notes', () => {
      metaTags.setMany([0, 1], 'contaminant', 'E. coli');
      expect(metaTags.getTag(0)).toEqual({ tag: 'contaminant', notes: 'E. coli' });
      expect(metaTags.getTag(1)).toEqual({ tag: 'contaminant', notes: 'E. coli' });
    });

    it('should not include notes key when notes is undefined', () => {
      metaTags.setMany([0, 1], 'haplotig');
      expect(metaTags.getTag(0)).not.toHaveProperty('notes');
      expect(metaTags.getTag(1)).not.toHaveProperty('notes');
    });

    it('should handle empty array', () => {
      metaTags.setMany([], 'haplotig');
      expect(metaTags.getTagCount()).toBe(0);
    });

    it('should replace existing tags', () => {
      metaTags.setTag(0, 'haplotig', 'old');
      metaTags.setMany([0, 1], 'contaminant', 'new');
      expect(metaTags.getTag(0)).toEqual({ tag: 'contaminant', notes: 'new' });
      expect(metaTags.getTagCount()).toBe(2);
    });

    it('should not share object references between entries', () => {
      metaTags.setMany([0, 1], 'haplotig', 'shared?');
      const tag0 = metaTags.getTag(0)!;
      const tag1 = metaTags.getTag(1)!;
      expect(tag0).toEqual(tag1);
      expect(tag0).not.toBe(tag1); // different object instances
    });

    it('should emit metatag:updated once with correct count', () => {
      metaTags.setMany([0, 1, 2], 'haplotig');
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 3 });
    });

    it('should emit metatag:updated only once for the batch', () => {
      metaTags.setMany([0, 1, 2], 'haplotig');
      // Only the final emit from setMany, not per-item
      expect(events.emit).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // removeMany
  // -----------------------------------------------------------------------
  describe('removeMany', () => {
    it('should remove tags from multiple contigs', () => {
      metaTags.setMany([0, 1, 2, 3], 'haplotig');
      vi.clearAllMocks();
      metaTags.removeMany([1, 3]);
      expect(metaTags.hasTag(0)).toBe(true);
      expect(metaTags.hasTag(1)).toBe(false);
      expect(metaTags.hasTag(2)).toBe(true);
      expect(metaTags.hasTag(3)).toBe(false);
      expect(metaTags.getTagCount()).toBe(2);
    });

    it('should handle empty array', () => {
      metaTags.setMany([0, 1], 'haplotig');
      vi.clearAllMocks();
      metaTags.removeMany([]);
      expect(metaTags.getTagCount()).toBe(2);
    });

    it('should be safe to remove non-existent indices', () => {
      metaTags.setTag(0, 'haplotig');
      vi.clearAllMocks();
      metaTags.removeMany([5, 10, 99]);
      expect(metaTags.getTagCount()).toBe(1);
    });

    it('should emit metatag:updated with correct count', () => {
      metaTags.setMany([0, 1, 2], 'haplotig');
      vi.clearAllMocks();
      metaTags.removeMany([0, 2]);
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 1 });
    });

    it('should emit metatag:updated only once for the batch', () => {
      metaTags.setMany([0, 1, 2], 'haplotig');
      vi.clearAllMocks();
      metaTags.removeMany([0, 1, 2]);
      expect(events.emit).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Event emission
  // -----------------------------------------------------------------------
  describe('event emission', () => {
    it('should emit on setTag', () => {
      metaTags.setTag(0, 'haplotig');
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 1 });
    });

    it('should emit on removeTag', () => {
      metaTags.setTag(0, 'haplotig');
      vi.clearAllMocks();
      metaTags.removeTag(0);
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 0 });
    });

    it('should emit on clearAll', () => {
      metaTags.setTag(0, 'haplotig');
      vi.clearAllMocks();
      metaTags.clearAll();
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 0 });
    });

    it('should emit on setMany', () => {
      metaTags.setMany([0, 1], 'haplotig');
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 2 });
    });

    it('should emit on removeMany', () => {
      metaTags.setMany([0, 1, 2], 'haplotig');
      vi.clearAllMocks();
      metaTags.removeMany([0, 1]);
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 1 });
    });

    it('should emit correct count when replacing a tag via setTag', () => {
      metaTags.setTag(0, 'haplotig');
      vi.clearAllMocks();
      metaTags.setTag(0, 'contaminant');
      expect(events.emit).toHaveBeenCalledWith('metatag:updated', { count: 1 });
    });

    it('should always emit the event name metatag:updated', () => {
      metaTags.setTag(0, 'haplotig');
      metaTags.removeTag(0);
      metaTags.setMany([1, 2], 'contaminant');
      metaTags.removeMany([1]);
      metaTags.clearAll();
      const emitCalls = (events.emit as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of emitCalls) {
        expect(call[0]).toBe('metatag:updated');
      }
    });
  });
});
