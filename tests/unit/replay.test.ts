/**
 * Tests for ScriptReplay — converting operation logs to DSL scripts.
 */

import { describe, it, expect } from 'vitest';
import {
  operationsToScript,
  logEntriesToScript,
  descriptionToDSL,
} from '../../src/scripting/ScriptReplay';
import type { CurationOperation, ContigInfo } from '../../src/core/State';
import type { SessionOperationLogEntry } from '../../src/io/SessionManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContigs(): ContigInfo[] {
  return [
    { name: 'chr1', originalIndex: 0, length: 1000, pixelStart: 0, pixelEnd: 100, inverted: false, scaffoldId: null },
    { name: 'chr2', originalIndex: 1, length: 2000, pixelStart: 100, pixelEnd: 300, inverted: false, scaffoldId: null },
    { name: 'chr3', originalIndex: 2, length: 1500, pixelStart: 300, pixelEnd: 450, inverted: false, scaffoldId: null },
    { name: 'chr4', originalIndex: 3, length: 500, pixelStart: 450, pixelEnd: 500, inverted: false, scaffoldId: null },
  ];
}

const fixedTimestamp = 1704067200000; // 2024-01-01T00:00:00Z

// ---------------------------------------------------------------------------
// operationsToScript — full CurationOperation conversion
// ---------------------------------------------------------------------------

describe('ScriptReplay', () => {
  describe('operationsToScript', () => {
    it('should convert a cut operation', () => {
      const ops: CurationOperation[] = [
        {
          type: 'cut',
          timestamp: fixedTimestamp,
          description: 'Cut contig "chr1" at pixel offset 50',
          data: {
            contigOrderIndex: 0,
            pixelOffset: 50,
            originalContigId: 0,
            leftId: 4,
            rightId: 5,
            previousOrder: [0, 1, 2, 3],
          },
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toBe('cut chr1 50\n');
    });

    it('should convert a join operation', () => {
      const ops: CurationOperation[] = [
        {
          type: 'join',
          timestamp: fixedTimestamp,
          description: 'Joined contigs "chr1" and "chr2"',
          data: {
            contigOrderIndex: 0,
            firstId: 0,
            secondId: 1,
            mergedId: 4,
            previousOrder: [0, 1, 2, 3],
          },
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toBe('join chr1 chr2\n');
    });

    it('should convert an invert operation', () => {
      const ops: CurationOperation[] = [
        {
          type: 'invert',
          timestamp: fixedTimestamp,
          description: 'Inverted contig "chr3" (now inverted)',
          data: {
            contigOrderIndex: 2,
            contigId: 2,
            previousInverted: false,
          },
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toBe('invert chr3\n');
    });

    it('should convert a move operation', () => {
      const ops: CurationOperation[] = [
        {
          type: 'move',
          timestamp: fixedTimestamp,
          description: 'Moved contig from position 0 to 2',
          data: {
            fromIndex: 0,
            toIndex: 2,
            previousOrder: [0, 1, 2, 3],
          },
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toBe('move #0 to 2\n');
    });

    it('should convert scaffold_paint operations', () => {
      const ops: CurationOperation[] = [
        {
          type: 'scaffold_paint',
          timestamp: fixedTimestamp,
          description: 'Painted 2 contig(s) with scaffold 1',
          data: {
            contigIndices: [0, 1],
            scaffoldId: 1,
            previousAssignments: { 0: null, 1: null },
          },
        },
      ];
      const scaffoldNames = new Map<number, string>([[1, 'MyScaffold']]);
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
        scaffoldNames,
      });
      expect(script).toContain('scaffold paint #0 MyScaffold');
      expect(script).toContain('scaffold paint #1 MyScaffold');
    });

    it('should convert scaffold unpaint operations', () => {
      const ops: CurationOperation[] = [
        {
          type: 'scaffold_paint',
          timestamp: fixedTimestamp,
          description: 'Unpainted 1 contig(s)',
          data: {
            contigIndices: [2],
            scaffoldId: null,
            previousAssignments: { 2: 1 },
          },
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toBe('scaffold unpaint #2\n');
    });

    it('should handle multiple operations in sequence', () => {
      const ops: CurationOperation[] = [
        {
          type: 'invert',
          timestamp: fixedTimestamp,
          description: 'Inverted contig "chr1"',
          data: { contigOrderIndex: 0, contigId: 0, previousInverted: false },
        },
        {
          type: 'move',
          timestamp: fixedTimestamp + 1000,
          description: 'Moved contig from position 0 to 3',
          data: { fromIndex: 0, toIndex: 3, previousOrder: [0, 1, 2, 3] },
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toContain('invert chr1');
      expect(script).toContain('move #0 to 3');
    });

    it('should include header when enabled', () => {
      const script = operationsToScript([], makeContigs(), {
        includeTimestamps: false,
        includeHeader: true,
      });
      expect(script).toContain('# Curation replay script');
      expect(script).toContain('# Operations: 0');
    });

    it('should include timestamps when enabled', () => {
      const ops: CurationOperation[] = [
        {
          type: 'invert',
          timestamp: fixedTimestamp,
          description: 'Inverted contig "chr1"',
          data: { contigOrderIndex: 0, contigId: 0, previousInverted: false },
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: true,
        includeHeader: false,
      });
      expect(script).toContain('# 2024-01-01');
    });

    it('should fall back to index reference for unknown contig IDs', () => {
      const ops: CurationOperation[] = [
        {
          type: 'invert',
          timestamp: fixedTimestamp,
          description: 'Inverted contig "unknown"',
          data: { contigOrderIndex: 5, contigId: 999, previousInverted: false },
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toContain('#5');
    });

    it('should fall back to auto-generated scaffold name when not provided', () => {
      const ops: CurationOperation[] = [
        {
          type: 'scaffold_paint',
          timestamp: fixedTimestamp,
          description: 'Painted 1 contig(s) with scaffold 7',
          data: {
            contigIndices: [0],
            scaffoldId: 7,
            previousAssignments: { 0: null },
          },
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toContain('Scaffold_7');
    });

    it('should quote contig names with spaces', () => {
      const contigs = makeContigs();
      contigs[0].name = 'chr 1 long name';
      const ops: CurationOperation[] = [
        {
          type: 'invert',
          timestamp: fixedTimestamp,
          description: 'Inverted',
          data: { contigOrderIndex: 0, contigId: 0, previousInverted: false },
        },
      ];
      const script = operationsToScript(ops, contigs, {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toContain('"chr 1 long name"');
    });

    it('should handle empty operations array', () => {
      const script = operationsToScript([], makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toBe('\n');
    });

    it('should comment out unknown operation types', () => {
      const ops: CurationOperation[] = [
        {
          type: 'unknown_type' as any,
          timestamp: fixedTimestamp,
          description: 'Some unknown operation',
          data: {},
        },
      ];
      const script = operationsToScript(ops, makeContigs(), {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toContain('# (unsupported operation: unknown_type)');
    });
  });

  // ---------------------------------------------------------------------------
  // descriptionToDSL — parsing description strings
  // ---------------------------------------------------------------------------

  describe('descriptionToDSL', () => {
    it('should parse cut description', () => {
      const result = descriptionToDSL('cut', 'Cut contig "chr1" at pixel offset 50');
      expect(result).toBe('cut chr1 50');
    });

    it('should parse cut with complex contig name', () => {
      const result = descriptionToDSL('cut', 'Cut contig "chr1_L" at pixel offset 25');
      expect(result).toBe('cut chr1_L 25');
    });

    it('should parse join description', () => {
      const result = descriptionToDSL('join', 'Joined contigs "chr1" and "chr2"');
      expect(result).toBe('join chr1 chr2');
    });

    it('should parse join with complex names', () => {
      const result = descriptionToDSL('join', 'Joined contigs "chr1_L" and "chr1_R"');
      expect(result).toBe('join chr1_L chr1_R');
    });

    it('should parse invert description (now inverted)', () => {
      const result = descriptionToDSL('invert', 'Inverted contig "chr3" (now inverted)');
      expect(result).toBe('invert chr3');
    });

    it('should parse invert description (now normal)', () => {
      const result = descriptionToDSL('invert', 'Inverted contig "chr3" (now normal)');
      expect(result).toBe('invert chr3');
    });

    it('should parse move description', () => {
      const result = descriptionToDSL('move', 'Moved contig from position 0 to 2');
      expect(result).toBe('move #0 to 2');
    });

    it('should parse move with larger indices', () => {
      const result = descriptionToDSL('move', 'Moved contig from position 15 to 42');
      expect(result).toBe('move #15 to 42');
    });

    it('should handle scaffold_paint description as comment', () => {
      const result = descriptionToDSL('scaffold_paint', 'Painted 2 contig(s) with scaffold 1');
      expect(result).not.toBeNull();
      expect(result).toContain('#');
      expect(result).toContain('scaffold');
    });

    it('should return null for unrecognized cut description', () => {
      const result = descriptionToDSL('cut', 'Something unexpected');
      expect(result).toBeNull();
    });

    it('should return null for unrecognized join description', () => {
      const result = descriptionToDSL('join', 'Merged something');
      expect(result).toBeNull();
    });

    it('should return null for unrecognized invert description', () => {
      const result = descriptionToDSL('invert', 'Flipped something');
      expect(result).toBeNull();
    });

    it('should return null for unrecognized move description', () => {
      const result = descriptionToDSL('move', 'Relocated something');
      expect(result).toBeNull();
    });

    it('should return null for unknown operation type', () => {
      const result = descriptionToDSL('unknown', 'Something');
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // logEntriesToScript — full pipeline from session entries
  // ---------------------------------------------------------------------------

  describe('logEntriesToScript', () => {
    it('should convert a sequence of session log entries', () => {
      const entries: SessionOperationLogEntry[] = [
        {
          type: 'invert',
          timestamp: fixedTimestamp,
          description: 'Inverted contig "chr1" (now inverted)',
        },
        {
          type: 'cut',
          timestamp: fixedTimestamp + 1000,
          description: 'Cut contig "chr2" at pixel offset 100',
        },
        {
          type: 'move',
          timestamp: fixedTimestamp + 2000,
          description: 'Moved contig from position 1 to 3',
        },
      ];

      const script = logEntriesToScript(entries, {
        includeTimestamps: false,
        includeHeader: false,
      });

      expect(script).toContain('invert chr1');
      expect(script).toContain('cut chr2 100');
      expect(script).toContain('move #1 to 3');
    });

    it('should include header when enabled', () => {
      const script = logEntriesToScript([], {
        includeTimestamps: false,
        includeHeader: true,
      });
      expect(script).toContain('# Curation replay script (from session log)');
      expect(script).toContain('# Operations: 0');
    });

    it('should include timestamps when enabled', () => {
      const entries: SessionOperationLogEntry[] = [
        {
          type: 'invert',
          timestamp: fixedTimestamp,
          description: 'Inverted contig "chr1" (now inverted)',
        },
      ];
      const script = logEntriesToScript(entries, {
        includeTimestamps: true,
        includeHeader: false,
      });
      expect(script).toContain('# 2024-01-01');
    });

    it('should comment out unparseable entries', () => {
      const entries: SessionOperationLogEntry[] = [
        {
          type: 'unknown',
          timestamp: fixedTimestamp,
          description: 'Did something mysterious',
        },
      ];
      const script = logEntriesToScript(entries, {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toContain('# (could not parse)');
      expect(script).toContain('Did something mysterious');
    });

    it('should handle empty entries array', () => {
      const script = logEntriesToScript([], {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toBe('\n');
    });

    it('should handle mixed parseable and unparseable entries', () => {
      const entries: SessionOperationLogEntry[] = [
        {
          type: 'invert',
          timestamp: fixedTimestamp,
          description: 'Inverted contig "chr1" (now inverted)',
        },
        {
          type: 'scaffold_paint',
          timestamp: fixedTimestamp + 1000,
          description: 'Painted 3 contig(s) with scaffold 2',
        },
        {
          type: 'move',
          timestamp: fixedTimestamp + 2000,
          description: 'Moved contig from position 0 to 5',
        },
      ];
      const script = logEntriesToScript(entries, {
        includeTimestamps: false,
        includeHeader: false,
      });
      expect(script).toContain('invert chr1');
      expect(script).toContain('# scaffold paint');
      expect(script).toContain('move #0 to 5');
    });

    it('should produce a complete round-trip-capable script', () => {
      const entries: SessionOperationLogEntry[] = [
        { type: 'invert', timestamp: fixedTimestamp, description: 'Inverted contig "chr1" (now inverted)' },
        { type: 'join', timestamp: fixedTimestamp + 1000, description: 'Joined contigs "chr2" and "chr3"' },
        { type: 'cut', timestamp: fixedTimestamp + 2000, description: 'Cut contig "chr4" at pixel offset 30' },
        { type: 'move', timestamp: fixedTimestamp + 3000, description: 'Moved contig from position 2 to 0' },
      ];
      const script = logEntriesToScript(entries, {
        includeTimestamps: false,
        includeHeader: false,
      });

      // Verify each command is on its own line and is valid DSL
      const lines = script.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe('invert chr1');
      expect(lines[1]).toBe('join chr2 chr3');
      expect(lines[2]).toBe('cut chr4 30');
      expect(lines[3]).toBe('move #2 to 0');
    });
  });
});
