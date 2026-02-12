/**
 * Tests for src/ai/AIContext.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAnalysisContext, formatContextMessage, type AnalysisContext } from '../../src/ai/AIContext';
import { state } from '../../src/core/State';

// Mock the state module
vi.mock('../../src/core/State', () => {
  const mockState = {
    contigOrder: [0, 1, 2],
    map: {
      filename: 'test_assembly.pretext',
      contigs: [
        { name: 'chr1', originalIndex: 0, length: 50000, pixelStart: 0, pixelEnd: 500, inverted: false, scaffoldId: 1 },
        { name: 'chr2', originalIndex: 1, length: 30000, pixelStart: 500, pixelEnd: 800, inverted: false, scaffoldId: 1 },
        { name: 'chr3', originalIndex: 2, length: 20000, pixelStart: 800, pixelEnd: 1000, inverted: true, scaffoldId: null },
      ],
    },
    undoStack: [
      { type: 'invert', data: {} },
      { type: 'move', data: {} },
    ],
  };
  return {
    state: {
      get: vi.fn(() => mockState),
      update: vi.fn(),
    },
  };
});

describe('buildAnalysisContext', () => {
  const mockCtx = {
    scaffoldManager: {
      getAllScaffolds: () => [{ id: 1, name: 'Scaffold_1', color: '#ff0000' }],
    },
    metricsTracker: {
      getSummary: () => ({
        initial: { n50: 40000, totalLength: 100000, contigCount: 3 },
        current: { n50: 45000, totalLength: 100000, contigCount: 3 },
        contigCountDelta: 0,
      }),
    },
  } as any;

  it('builds context with correct contig info', () => {
    const ctx = buildAnalysisContext(mockCtx);

    expect(ctx.filename).toBe('test_assembly.pretext');
    expect(ctx.contigCount).toBe(3);
    expect(ctx.contigNames).toEqual(['chr1', 'chr2', 'chr3']);
    expect(ctx.contigLengths).toEqual([50000, 30000, 20000]);
  });

  it('includes scaffold assignments', () => {
    const ctx = buildAnalysisContext(mockCtx);

    expect(ctx.scaffoldAssignments).toEqual([
      { contig: 'chr1', scaffold: 'Scaffold_1' },
      { contig: 'chr2', scaffold: 'Scaffold_1' },
    ]);
  });

  it('includes quality metrics', () => {
    const ctx = buildAnalysisContext(mockCtx);

    expect(ctx.qualityMetrics).toEqual({
      n50: 45000,
      totalLength: 100000,
      contigCount: 3,
    });
  });

  it('includes recent operations', () => {
    const ctx = buildAnalysisContext(mockCtx);

    expect(ctx.recentOps).toHaveLength(2);
    expect(ctx.recentOps[0]).toContain('invert');
    expect(ctx.recentOps[1]).toContain('move');
  });

  it('handles missing metrics gracefully', () => {
    const ctxNoMetrics = {
      ...mockCtx,
      metricsTracker: {
        getSummary: () => null,
      },
    } as any;

    const ctx = buildAnalysisContext(ctxNoMetrics);
    expect(ctx.qualityMetrics).toBeNull();
  });
});

describe('formatContextMessage', () => {
  const context: AnalysisContext = {
    filename: 'test.pretext',
    contigCount: 3,
    contigNames: ['chr1', 'chr2', 'chr3'],
    contigLengths: [50000, 30000, 20000],
    scaffoldAssignments: [{ contig: 'chr1', scaffold: 'S1' }],
    qualityMetrics: { n50: 45000, totalLength: 100000, contigCount: 3 },
    recentOps: ['invert contig'],
  };

  it('includes filename', () => {
    const msg = formatContextMessage(context);
    expect(msg).toContain('test.pretext');
  });

  it('includes contig count', () => {
    const msg = formatContextMessage(context);
    expect(msg).toContain('Contigs: 3');
  });

  it('includes quality metrics', () => {
    const msg = formatContextMessage(context);
    expect(msg).toContain('N50');
    expect(msg).toContain('45,000');
  });

  it('lists contigs with lengths', () => {
    const msg = formatContextMessage(context);
    expect(msg).toContain('#0 chr1');
    expect(msg).toContain('#1 chr2');
    expect(msg).toContain('#2 chr3');
    expect(msg).toContain('50,000 bp');
  });

  it('includes scaffold assignments', () => {
    const msg = formatContextMessage(context);
    expect(msg).toContain('chr1 -> S1');
  });

  it('includes recent operations', () => {
    const msg = formatContextMessage(context);
    expect(msg).toContain('invert contig');
  });

  it('asks for analysis at the end', () => {
    const msg = formatContextMessage(context);
    expect(msg).toContain('analyze the contact map');
  });

  it('truncates large contig lists', () => {
    const bigCtx: AnalysisContext = {
      ...context,
      contigCount: 150,
      contigNames: Array.from({ length: 150 }, (_, i) => `contig_${i}`),
      contigLengths: Array.from({ length: 150 }, () => 1000),
    };
    const msg = formatContextMessage(bigCtx);
    expect(msg).toContain('and 50 more contigs');
  });
});
