/**
 * Tests for src/ai/AIPrompts.ts
 */

import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildSystemPrompt, buildUserMessage } from '../../src/ai/AIPrompts';
import type { AnalysisContext } from '../../src/ai/AIContext';
import type { PromptStrategy } from '../../src/data/PromptStrategy';

describe('SYSTEM_PROMPT', () => {
  it('defines the expert role', () => {
    expect(SYSTEM_PROMPT).toContain('genome assembly curation expert');
  });

  it('contains all 20 DSL command types', () => {
    // All commands from ScriptParser.ts ScriptCommandType
    const commands = [
      'cut', 'join', 'invert',
      'move', 'before', 'after',
      'select', 'select all', 'deselect',
      'scaffold create', 'scaffold paint', 'scaffold unpaint', 'scaffold delete',
      'zoom', 'zoom reset', 'goto',
      'echo',
      'autocut', 'autosort',
    ];

    for (const cmd of commands) {
      expect(SYSTEM_PROMPT).toContain(cmd);
    }
  });

  it('documents the contig reference syntax', () => {
    expect(SYSTEM_PROMPT).toContain('#N');
    expect(SYSTEM_PROMPT).toContain('#0');
  });

  it('specifies the dsl code block format', () => {
    expect(SYSTEM_PROMPT).toContain('```');
    expect(SYSTEM_PROMPT).toContain('dsl');
  });

  it('includes Hi-C pattern interpretation guide', () => {
    expect(SYSTEM_PROMPT).toContain('diagonal');
    expect(SYSTEM_PROMPT).toContain('inversion');
    expect(SYSTEM_PROMPT).toContain('off-diagonal');
  });

  it('instructs conservative approach', () => {
    expect(SYSTEM_PROMPT).toContain('conservative');
  });
});

describe('buildSystemPrompt', () => {
  it('returns base prompt when no strategy provided', () => {
    const result = buildSystemPrompt();
    expect(result).toBe(SYSTEM_PROMPT);
  });

  it('returns base prompt when strategy has empty supplement', () => {
    const strategy: PromptStrategy = {
      id: 'general',
      name: 'General',
      description: 'General analysis',
      category: 'general',
      supplement: '',
      examples: [],
    };
    const result = buildSystemPrompt(strategy);
    expect(result).toBe(SYSTEM_PROMPT);
  });

  it('appends strategy supplement to base prompt', () => {
    const strategy: PromptStrategy = {
      id: 'test',
      name: 'Test Strategy',
      description: 'A test',
      category: 'pattern',
      supplement: 'Focus on inversions specifically.',
      examples: [],
    };
    const result = buildSystemPrompt(strategy);
    expect(result).toContain(SYSTEM_PROMPT);
    expect(result).toContain('## Strategy: Test Strategy');
    expect(result).toContain('Focus on inversions specifically.');
  });

  it('includes few-shot examples when provided', () => {
    const strategy: PromptStrategy = {
      id: 'test',
      name: 'With Examples',
      description: 'Has examples',
      category: 'pattern',
      supplement: 'Some guidance.',
      examples: [
        { scenario: 'Anti-diagonal in chr3', commands: 'invert chr3' },
        { scenario: 'Gap in chr5', commands: 'cut chr5 256' },
      ],
    };
    const result = buildSystemPrompt(strategy);
    expect(result).toContain('## Examples');
    expect(result).toContain('Anti-diagonal in chr3');
    expect(result).toContain('invert chr3');
    expect(result).toContain('Gap in chr5');
    expect(result).toContain('cut chr5 256');
  });

  it('does not include Examples section when no examples', () => {
    const strategy: PromptStrategy = {
      id: 'test',
      name: 'No Examples',
      description: 'No examples',
      category: 'workflow',
      supplement: 'Some workflow guidance.',
      examples: [],
    };
    const result = buildSystemPrompt(strategy);
    expect(result).not.toContain('## Examples');
  });

  it('always preserves the base DSL reference', () => {
    const strategy: PromptStrategy = {
      id: 'test',
      name: 'Test',
      description: 'Test',
      category: 'organism',
      supplement: 'Organism-specific advice.',
      examples: [],
    };
    const result = buildSystemPrompt(strategy);
    // Base prompt DSL commands are still present
    expect(result).toContain('cut <contig>');
    expect(result).toContain('invert <contig>');
    expect(result).toContain('autocut');
    expect(result).toContain('autosort');
  });
});

describe('buildUserMessage', () => {
  const context: AnalysisContext = {
    filename: 'species.pretext',
    contigCount: 5,
    contigNames: ['a', 'b', 'c', 'd', 'e'],
    contigLengths: [1000, 2000, 3000, 4000, 5000],
    scaffoldAssignments: [],
    qualityMetrics: null,
    recentOps: [],
  };

  it('returns a formatted string with context', () => {
    const msg = buildUserMessage(context);
    expect(typeof msg).toBe('string');
    expect(msg).toContain('species.pretext');
    expect(msg).toContain('Contigs: 5');
  });
});
