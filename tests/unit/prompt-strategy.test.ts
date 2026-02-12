/**
 * Tests for src/data/PromptStrategy.ts and data/prompt-strategies.json
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStrategyById, _resetCache, type StrategyLibrary, type PromptStrategy } from '../../src/data/PromptStrategy';
import strategyData from '../../data/prompt-strategies.json';

const library = strategyData as StrategyLibrary;

describe('PromptStrategy', () => {
  describe('strategy data validation', () => {
    it('has a version string', () => {
      expect(library.version).toBe('1.0.0');
    });

    it('has 5 strategies', () => {
      expect(library.strategies).toHaveLength(5);
    });

    it('has unique IDs', () => {
      const ids = library.strategies.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each strategy has required fields', () => {
      for (const s of library.strategies) {
        expect(s.id).toBeTruthy();
        expect(s.name).toBeTruthy();
        expect(s.description).toBeTruthy();
        expect(['general', 'pattern', 'workflow', 'organism']).toContain(s.category);
        expect(typeof s.supplement).toBe('string');
        expect(Array.isArray(s.examples)).toBe(true);
      }
    });

    it('examples have scenario and commands', () => {
      for (const s of library.strategies) {
        for (const ex of s.examples) {
          expect(ex.scenario).toBeTruthy();
          expect(ex.commands).toBeTruthy();
        }
      }
    });

    it('general strategy has empty supplement', () => {
      const general = getStrategyById(library, 'general');
      expect(general).toBeDefined();
      expect(general!.supplement).toBe('');
      expect(general!.examples).toHaveLength(0);
    });

    it('non-general strategies have supplements', () => {
      const nonGeneral = library.strategies.filter((s) => s.id !== 'general');
      for (const s of nonGeneral) {
        expect(s.supplement.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getStrategyById', () => {
    it('finds existing strategy', () => {
      const strategy = getStrategyById(library, 'inversion-focus');
      expect(strategy).toBeDefined();
      expect(strategy!.name).toBe('Inversion Detection');
    });

    it('returns undefined for unknown id', () => {
      const strategy = getStrategyById(library, 'nonexistent');
      expect(strategy).toBeUndefined();
    });

    it('finds each strategy by its id', () => {
      for (const s of library.strategies) {
        const found = getStrategyById(library, s.id);
        expect(found).toBeDefined();
        expect(found!.name).toBe(s.name);
      }
    });
  });

  describe('specific strategies', () => {
    it('inversion-focus has examples with DSL commands', () => {
      const s = getStrategyById(library, 'inversion-focus')!;
      expect(s.examples.length).toBeGreaterThan(0);
      expect(s.examples[0].commands).toContain('invert');
    });

    it('scaffolding strategy covers scaffold commands', () => {
      const s = getStrategyById(library, 'scaffolding')!;
      expect(s.supplement).toContain('scaffold');
    });

    it('fragmented-assembly mentions autosort', () => {
      const s = getStrategyById(library, 'fragmented-assembly')!;
      expect(s.supplement).toContain('autosort');
    });

    it('micro-chromosomes is organism category', () => {
      const s = getStrategyById(library, 'micro-chromosomes')!;
      expect(s.category).toBe('organism');
      expect(s.supplement).toContain('micro-chromosome');
    });
  });
});
