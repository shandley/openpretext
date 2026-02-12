/**
 * Tests for src/ai/AIPrompts.ts
 */

import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildUserMessage } from '../../src/ai/AIPrompts';
import type { AnalysisContext } from '../../src/ai/AIContext';

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
