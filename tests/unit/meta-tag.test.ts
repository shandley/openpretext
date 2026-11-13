/**
 * Contig tags: the PretextView vocabulary, several per contig.
 *
 * The downstream tools compare tags exactly and read an unknown word as a
 * haplotype name, so spelling, kind and written order are all pinned here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  metaTags, isValidTag, tagKind, sortTags, fromLegacyTag,
  PRETEXTVIEW_TAGS, REMOVAL_TAGS,
} from '../../src/curation/MetaTagManager';
import { events } from '../../src/core/EventBus';

describe('tag vocabulary', () => {
  it('lists PretextView\'s default tags in PretextView\'s order, without its paint tags', () => {
    expect(PRETEXTVIEW_TAGS.slice(0, 11)).toEqual([
      'Haplotig', 'Unloc', 'X', 'Y', 'Z', 'W', 'HAP1', 'HAP2', 'Target', 'Contaminant', 'Singleton',
    ]);
    expect(PRETEXTVIEW_TAGS).toContain('FalseDuplicate');
    expect(PRETEXTVIEW_TAGS).toContain('Primary');
    expect(PRETEXTVIEW_TAGS).toHaveLength(30);
    for (const paint of ['vertPaint', 'horzPaint', 'crossPaint']) expect(PRETEXTVIEW_TAGS).not.toContain(paint);
    expect(new Set(PRETEXTVIEW_TAGS).size).toBe(PRETEXTVIEW_TAGS.length);
  });

  it('classifies tags as pretext-to-asm does', () => {
    for (const t of ['Haplotig', 'Contaminant', 'FalseDuplicate']) expect(tagKind(t)).toBe('removal');
    expect([...REMOVAL_TAGS].sort()).toEqual(['Contaminant', 'FalseDuplicate', 'Haplotig']);
    expect(tagKind('Unloc')).toBe('unloc');
    for (const t of ['Target', 'Primary', 'Singleton', 'Cut']) expect(tagKind(t)).toBe('flag');
    // Its pattern: [A-Z]\d*[A-Z]? | [IVX_]+ | \d+[A-Z]+
    for (const t of ['X', 'Y', 'Z', 'W', 'U', 'V', 'X1', 'W2', 'B1', 'B3', 'I', 'II', 'IV', 'I_II', '2RL']) {
      expect(tagKind(t), t).toBe('chromosome');
    }
    for (const t of ['Hap1', 'Hap2', 'HAP1', 'HAP2', 'Hap_1', 'Hap_2', 'maternal']) {
      expect(tagKind(t), t).toBe('haplotype');
    }
  });

  it('reads a misspelled tag as a haplotype, which is why spelling is checked on entry', () => {
    for (const t of ['haplotig', 'contaminant', 'unloc', 'Unlocalised', 'sex_chromosome']) {
      expect(tagKind(t), t).toBe('haplotype');
    }
  });

  it('accepts one word of letters, digits and underscores, and never Painted', () => {
    for (const t of ['Haplotig', 'X1', 'Hap_1', 'I_II', '2RL']) expect(isValidTag(t)).toBe(true);
    for (const t of ['', 'two words', 'tab\there', 'semi;colon', 'new\nline', 'dash-ed', 'Painted', '<b>']) {
      expect(isValidTag(t), JSON.stringify(t)).toBe(false);
    }
  });

  it('writes tags in PretextView\'s order, then the rest by name', () => {
    expect(sortTags(['Hap_2', 'Z', 'Unloc'])).toEqual(['Unloc', 'Z', 'Hap_2']);
    expect(sortTags(['Hap_1', 'Contaminant', 'Haplotig', 'Hap1'])).toEqual(['Haplotig', 'Contaminant', 'Hap1', 'Hap_1']);
    expect(sortTags(['X', 'X', 'Unloc'])).toEqual(['Unloc', 'X']);
  });

  it('maps the old lower-case tags, except the one that never named its chromosome', () => {
    expect(fromLegacyTag('haplotig')).toBe('Haplotig');
    expect(fromLegacyTag('contaminant')).toBe('Contaminant');
    expect(fromLegacyTag('unlocalised')).toBe('Unloc');
    expect(fromLegacyTag('sex_chromosome')).toBeNull();
    expect(fromLegacyTag('Haplotig')).toBeNull();
  });
});

describe('MetaTagManager', () => {
  let updates: number[] = [];
  const onUpdate = (d: { count: number }) => { updates.push(d.count); };

  beforeEach(() => {
    metaTags.clearAll();
    events.off('metatag:updated', onUpdate);
    events.on('metatag:updated', onUpdate);
    updates = [];
  });

  it('holds several tags on one contig, in written order', () => {
    metaTags.addTag(7, 'Hap_2');
    metaTags.addTag(7, 'Z');
    metaTags.addTag(7, 'Unloc');
    expect(metaTags.getTags(7)).toEqual(['Unloc', 'Z', 'Hap_2']);
    expect(metaTags.hasTag(7)).toBe(true);
    expect(metaTags.hasTag(7, 'Z')).toBe(true);
    expect(metaTags.hasTag(7, 'W')).toBe(false);
    expect(metaTags.hasTag(8)).toBe(false);
    expect(metaTags.getTags(8)).toEqual([]);
    expect(metaTags.getInfo(8)).toBeNull();
    expect(metaTags.getTagCount()).toBe(1);
  });

  it('keeps one chromosome name, one haplotype and one reason for removal per contig', () => {
    metaTags.addTag(1, 'X');
    metaTags.addTag(1, 'Y');
    expect(metaTags.getTags(1)).toEqual(['Y']);

    metaTags.addTag(1, 'Hap1');
    metaTags.addTag(1, 'Hap2');
    expect(metaTags.getTags(1)).toEqual(['Y', 'Hap2']);

    metaTags.addTag(2, 'Haplotig');
    metaTags.addTag(2, 'Contaminant');
    expect(metaTags.getTags(2)).toEqual(['Contaminant']);

    // Kinds that do not exclude one another accumulate.
    metaTags.addTag(2, 'Unloc');
    metaTags.addTag(2, 'Target');
    expect(metaTags.getTags(2)).toEqual(['Unloc', 'Target', 'Contaminant']);
  });

  it('adding a tag twice changes nothing', () => {
    metaTags.addTag(3, 'Unloc');
    metaTags.addTag(3, 'Unloc');
    expect(metaTags.getTags(3)).toEqual(['Unloc']);
  });

  it('refuses a tag that could not be written to an AGP, and leaves the contig as it was', () => {
    metaTags.addTag(4, 'Unloc');
    expect(() => metaTags.addTag(4, 'not a tag')).toThrow(/one word/);
    expect(() => metaTags.addTag(4, 'Painted')).toThrow(/cannot be used as a tag/);
    expect(() => metaTags.setTags(4, ['X', 'a\tb'])).toThrow();
    expect(metaTags.getTags(4)).toEqual(['Unloc']);
  });

  it('keeps notes with the tags and drops them with the last tag', () => {
    metaTags.addTag(5, 'Contaminant', 'bacterial');
    expect(metaTags.getInfo(5)).toEqual({ tags: ['Contaminant'], notes: 'bacterial' });
    metaTags.addTag(5, 'Unloc');
    expect(metaTags.getInfo(5)).toEqual({ tags: ['Unloc', 'Contaminant'], notes: 'bacterial' });
    metaTags.removeTag(5, 'Unloc');
    expect(metaTags.getInfo(5)).toEqual({ tags: ['Contaminant'], notes: 'bacterial' });
    metaTags.removeTag(5, 'Contaminant');
    expect(metaTags.getInfo(5)).toBeNull();
    metaTags.addTag(5, 'X');
    expect(metaTags.getInfo(5)).toEqual({ tags: ['X'] });
    expect('notes' in metaTags.getInfo(5)!).toBe(false);
  });

  it('setTags replaces everything, and an empty list clears the contig', () => {
    metaTags.addTag(6, 'X');
    metaTags.setTags(6, ['Hap_1', 'Unloc'], 'n');
    expect(metaTags.getInfo(6)).toEqual({ tags: ['Unloc', 'Hap_1'], notes: 'n' });
    metaTags.setTags(6, []);
    expect(metaTags.hasTag(6)).toBe(false);
    expect(metaTags.getTagCount()).toBe(0);
  });

  it('removes one tag or all of them', () => {
    metaTags.setTags(1, ['Unloc', 'Z']);
    metaTags.removeTag(1, 'W');
    expect(metaTags.getTags(1)).toEqual(['Unloc', 'Z']);
    metaTags.removeTag(1, 'Z');
    expect(metaTags.getTags(1)).toEqual(['Unloc']);
    metaTags.setTags(1, ['Unloc', 'Z']);
    metaTags.removeTag(1);
    expect(metaTags.getTags(1)).toEqual([]);
    metaTags.removeTag(99);
    metaTags.removeTag(99, 'X');
  });

  it('tags and untags several contigs at once, with one event each', () => {
    metaTags.addTag(2, 'Z');
    updates = [];
    metaTags.addMany([1, 2, 3], 'Haplotig');
    expect(updates).toEqual([3]);
    expect(metaTags.getTags(2)).toEqual(['Haplotig', 'Z']);
    expect(metaTags.getByTag('Haplotig').sort()).toEqual([1, 2, 3]);
    expect(metaTags.getByTag('Z')).toEqual([2]);

    updates = [];
    metaTags.removeMany([1, 2, 9], 'Haplotig');
    expect(updates).toEqual([2]);
    expect(metaTags.getTags(1)).toEqual([]);
    expect(metaTags.getTags(2)).toEqual(['Z']);
    metaTags.removeMany([2, 3]);
    expect(metaTags.getTagCount()).toBe(0);
    metaTags.addMany([], 'X');
    metaTags.removeMany([]);
  });

  it('counts contigs per tag, in written order', () => {
    metaTags.setTags(1, ['Hap_1', 'Unloc']);
    metaTags.setTags(2, ['Unloc']);
    metaTags.setTags(3, ['Contaminant']);
    expect([...metaTags.getTagCounts()]).toEqual([['Unloc', 2], ['Contaminant', 1], ['Hap_1', 1]]);
    expect(metaTags.getTagCount()).toBe(3);
    metaTags.clearAll();
    expect([...metaTags.getTagCounts()]).toEqual([]);
  });

  it('hands out copies, so callers cannot change what is stored', () => {
    metaTags.setTags(1, ['Unloc', 'X'], 'n');
    metaTags.getTags(1).push('Y');
    metaTags.getInfo(1)!.tags.push('Y');
    const all = metaTags.getAllTags();
    all.get(1)!.tags.push('Y');
    all.delete(1);
    expect(metaTags.getInfo(1)).toEqual({ tags: ['Unloc', 'X'], notes: 'n' });
  });

  it('emits metatag:updated with the number of tagged contigs', () => {
    metaTags.addTag(1, 'X');
    metaTags.addTag(2, 'Y');
    metaTags.removeTag(1);
    metaTags.setTags(2, []);
    metaTags.clearAll();
    expect(updates).toEqual([1, 2, 1, 0, 0]);
  });
});
