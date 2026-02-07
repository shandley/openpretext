/**
 * Tests for SpecimenCatalog types and helper functions.
 */

import { describe, it, expect } from 'vitest';
import type { SpecimenEntry, SpecimenCatalog } from '../../src/data/SpecimenCatalog';
import { getTutorialSpecimens, getSpecimensByDifficulty } from '../../src/data/SpecimenCatalog';
import catalogData from '../../data/specimen-catalog.json';

const catalog = catalogData as SpecimenCatalog;

describe('SpecimenCatalog', () => {
  describe('catalog data validation', () => {
    it('should have a version string', () => {
      expect(catalog.version).toBe('1.0.0');
    });

    it('should have 10 specimens', () => {
      expect(catalog.specimens).toHaveLength(10);
    });

    it('should have unique IDs', () => {
      const ids = catalog.specimens.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have unique species names', () => {
      const species = catalog.specimens.map(s => s.species);
      expect(new Set(species).size).toBe(species.length);
    });

    it('each specimen should have required fields', () => {
      for (const s of catalog.specimens) {
        expect(s.id).toBeTruthy();
        expect(s.species).toBeTruthy();
        expect(s.commonName).toBeTruthy();
        expect(s.taxon).toBeTruthy();
        expect(s.sizeMB).toBeGreaterThan(0);
        expect(s.contigCount).toBeGreaterThan(0);
        expect(['beginner', 'intermediate', 'advanced']).toContain(s.difficulty);
        expect(Array.isArray(s.patterns)).toBe(true);
        expect(s.patterns.length).toBeGreaterThan(0);
        expect(typeof s.teachingNotes).toBe('string');
        expect(s.releaseTag).toBeTruthy();
      }
    });

    it('tutorial specimens should have releaseAsset set', () => {
      const tutorial = catalog.specimens.filter(s => s.releaseAsset !== null);
      for (const s of tutorial) {
        expect(s.releaseAsset).toMatch(/\.pretext$/);
      }
    });

    it('benchmark-only specimens should have releaseAsset null', () => {
      const benchOnly = catalog.specimens.filter(s => s.releaseAsset === null);
      expect(benchOnly.length).toBe(5);
    });
  });

  describe('getTutorialSpecimens', () => {
    it('should return only specimens with releaseAsset', () => {
      const tutorial = getTutorialSpecimens(catalog);
      expect(tutorial).toHaveLength(5);
      for (const s of tutorial) {
        expect(s.releaseAsset).not.toBeNull();
      }
    });

    it('should include koala, wrasse, quail, finch, crocodile', () => {
      const tutorial = getTutorialSpecimens(catalog);
      const ids = tutorial.map(s => s.id);
      expect(ids).toContain('koala');
      expect(ids).toContain('wrasse');
      expect(ids).toContain('quail');
      expect(ids).toContain('finch');
      expect(ids).toContain('crocodile');
    });
  });

  describe('getSpecimensByDifficulty', () => {
    it('should filter by beginner', () => {
      const beginners = getSpecimensByDifficulty(catalog, 'beginner');
      expect(beginners.length).toBeGreaterThanOrEqual(2);
      for (const s of beginners) {
        expect(s.difficulty).toBe('beginner');
      }
    });

    it('should filter by intermediate', () => {
      const intermediate = getSpecimensByDifficulty(catalog, 'intermediate');
      expect(intermediate.length).toBeGreaterThanOrEqual(2);
      for (const s of intermediate) {
        expect(s.difficulty).toBe('intermediate');
      }
    });

    it('should filter by advanced', () => {
      const advanced = getSpecimensByDifficulty(catalog, 'advanced');
      expect(advanced.length).toBeGreaterThanOrEqual(1);
      for (const s of advanced) {
        expect(s.difficulty).toBe('advanced');
      }
    });
  });

  describe('specimen metadata consistency', () => {
    it('koala should match known values', () => {
      const koala = catalog.specimens.find(s => s.id === 'koala')!;
      expect(koala.species).toBe('Phascolarctos_cinereus');
      expect(koala.commonName).toBe('Koala');
      expect(koala.taxon).toBe('mammal');
      expect(koala.sizeMB).toBe(109);
      expect(koala.difficulty).toBe('beginner');
      expect(koala.releaseAsset).toBe('Phascolarctos_cinereus.pretext');
    });

    it('wrasse should match known values', () => {
      const wrasse = catalog.specimens.find(s => s.id === 'wrasse')!;
      expect(wrasse.contigCount).toBe(52);
      expect(wrasse.taxon).toBe('fish');
      expect(wrasse.difficulty).toBe('beginner');
    });

    it('spinyfin should be benchmark-only', () => {
      const spinyfin = catalog.specimens.find(s => s.id === 'spinyfin')!;
      expect(spinyfin.releaseAsset).toBeNull();
      expect(spinyfin.contigCount).toBe(5506);
    });
  });
});
