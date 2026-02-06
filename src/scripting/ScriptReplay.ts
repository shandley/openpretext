/**
 * ScriptReplay - Converts curation operation logs into executable DSL scripts.
 *
 * Two conversion modes:
 *
 * 1. **From CurationOperation[]** (in-app undo stack): Uses the full `data`
 *    field to extract exact parameters for deterministic replay.
 *
 * 2. **From SessionOperationLogEntry[]** (imported sessions): Parses the
 *    human-readable `description` field since the raw operation data is not
 *    stored in exported sessions.
 *
 * The generated DSL can be pasted into the Script Console and re-executed
 * to reproduce a curation session from scratch.
 */

import type { CurationOperation, ContigInfo } from '../core/State';
import type { SessionOperationLogEntry } from '../io/SessionManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for script generation.
 */
export interface ReplayOptions {
  /** Include timestamps as comments above each command. Default: true. */
  includeTimestamps?: boolean;
  /** Include a header comment with session metadata. Default: true. */
  includeHeader?: boolean;
  /** Scaffold name lookup: scaffoldId → name. Needed for scaffold_paint ops. */
  scaffoldNames?: Map<number, string>;
}

// ---------------------------------------------------------------------------
// From full CurationOperation[] (in-app undo stack)
// ---------------------------------------------------------------------------

/**
 * Convert a list of CurationOperation objects (from the undo stack)
 * into a DSL script string.
 *
 * This uses the full `data` field and the contigs array for accurate
 * name resolution, producing deterministic replay scripts.
 *
 * @param operations - Array of CurationOperation from the undo stack.
 * @param contigs - The contigs array from MapData for name resolution.
 * @param options - Optional generation settings.
 * @returns A multi-line DSL script string.
 */
export function operationsToScript(
  operations: CurationOperation[],
  contigs: ContigInfo[],
  options?: ReplayOptions
): string {
  const includeTimestamps = options?.includeTimestamps ?? true;
  const includeHeader = options?.includeHeader ?? true;
  const scaffoldNames = options?.scaffoldNames ?? new Map<number, string>();

  const lines: string[] = [];

  if (includeHeader) {
    lines.push('# Curation replay script');
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push(`# Operations: ${operations.length}`);
    lines.push('');
  }

  for (const op of operations) {
    if (includeTimestamps) {
      const date = new Date(op.timestamp);
      lines.push(`# ${date.toISOString()}`);
    }

    const dsl = operationToDSL(op, contigs, scaffoldNames);
    if (dsl !== null) {
      lines.push(dsl);
    } else {
      lines.push(`# (unsupported operation: ${op.type}) ${op.description}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Convert a single CurationOperation to a DSL command string.
 *
 * @returns The DSL string, or null if the operation cannot be represented.
 */
function operationToDSL(
  op: CurationOperation,
  contigs: ContigInfo[],
  scaffoldNames: Map<number, string>
): string | null {
  switch (op.type) {
    case 'cut': {
      const contigId = op.data.originalContigId as number;
      const pixelOffset = op.data.pixelOffset as number;
      const name = contigId < contigs.length ? contigs[contigId].name : `#${op.data.contigOrderIndex}`;
      return `cut ${quoteIfNeeded(name)} ${pixelOffset}`;
    }

    case 'join': {
      const firstId = op.data.firstId as number;
      const secondId = op.data.secondId as number;
      const firstName = firstId < contigs.length ? contigs[firstId].name : `#${op.data.contigOrderIndex}`;
      const secondName = secondId < contigs.length ? contigs[secondId].name : `#${op.data.contigOrderIndex + 1}`;
      return `join ${quoteIfNeeded(firstName)} ${quoteIfNeeded(secondName)}`;
    }

    case 'invert': {
      const contigId = op.data.contigId as number;
      const name = contigId < contigs.length ? contigs[contigId].name : `#${op.data.contigOrderIndex}`;
      return `invert ${quoteIfNeeded(name)}`;
    }

    case 'move': {
      const fromIndex = op.data.fromIndex as number;
      const toIndex = op.data.toIndex as number;
      return `move #${fromIndex} to ${toIndex}`;
    }

    case 'scaffold_paint': {
      const contigIndices = op.data.contigIndices as number[];
      const scaffoldId = op.data.scaffoldId as number | null;

      if (scaffoldId === null) {
        // Unpaint
        return contigIndices.map(idx => `scaffold unpaint #${idx}`).join('\n');
      }

      const scaffoldName = scaffoldNames.get(scaffoldId) ?? `Scaffold_${scaffoldId}`;
      return contigIndices
        .map(idx => `scaffold paint #${idx} ${quoteIfNeeded(scaffoldName)}`)
        .join('\n');
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// From SessionOperationLogEntry[] (imported sessions)
// ---------------------------------------------------------------------------

/**
 * Convert a list of SessionOperationLogEntry objects (from a saved session)
 * into a DSL script string.
 *
 * Since the session log only contains type, timestamp, and description,
 * parameters are extracted by parsing the description string. This is
 * best-effort and may produce comments for unrecognizable entries.
 *
 * @param entries - Array of SessionOperationLogEntry from a session file.
 * @param options - Optional generation settings.
 * @returns A multi-line DSL script string.
 */
export function logEntriesToScript(
  entries: SessionOperationLogEntry[],
  options?: ReplayOptions
): string {
  const includeTimestamps = options?.includeTimestamps ?? true;
  const includeHeader = options?.includeHeader ?? true;

  const lines: string[] = [];

  if (includeHeader) {
    lines.push('# Curation replay script (from session log)');
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push(`# Operations: ${entries.length}`);
    lines.push('');
  }

  for (const entry of entries) {
    if (includeTimestamps) {
      const date = new Date(entry.timestamp);
      lines.push(`# ${date.toISOString()}`);
    }

    const dsl = descriptionToDSL(entry.type, entry.description);
    if (dsl !== null) {
      lines.push(dsl);
    } else {
      lines.push(`# (could not parse) ${entry.description}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Parse a CurationOperation description string into a DSL command.
 *
 * Known description formats (from CurationEngine):
 * - Cut contig "chr1" at pixel offset 50
 * - Joined contigs "chr1" and "chr2"
 * - Inverted contig "chr1" (now inverted)
 * - Moved contig from position 0 to 2
 * - Painted 2 contig(s) with scaffold 1
 *
 * @returns The DSL string, or null if the description cannot be parsed.
 */
export function descriptionToDSL(type: string, description: string): string | null {
  switch (type) {
    case 'cut': {
      // Cut contig "chr1" at pixel offset 50
      const match = description.match(/^Cut contig "(.+)" at pixel offset (\d+)$/);
      if (match) {
        return `cut ${quoteIfNeeded(match[1])} ${match[2]}`;
      }
      return null;
    }

    case 'join': {
      // Joined contigs "chr1" and "chr2"
      const match = description.match(/^Joined contigs "(.+)" and "(.+)"$/);
      if (match) {
        return `join ${quoteIfNeeded(match[1])} ${quoteIfNeeded(match[2])}`;
      }
      return null;
    }

    case 'invert': {
      // Inverted contig "chr1" (now inverted|normal)
      const match = description.match(/^Inverted contig "(.+)" \(now (?:inverted|normal)\)$/);
      if (match) {
        return `invert ${quoteIfNeeded(match[1])}`;
      }
      return null;
    }

    case 'move': {
      // Moved contig from position 0 to 2
      const match = description.match(/^Moved contig from position (\d+) to (\d+)$/);
      if (match) {
        return `move #${match[1]} to ${match[2]}`;
      }
      return null;
    }

    case 'scaffold_paint': {
      // Painted N contig(s) with scaffold ID
      // This one is harder — the description doesn't include which contigs
      // or the scaffold name, only the count and ID.
      const match = description.match(/^Painted (\d+) contig\(s\) with scaffold (\d+)$/);
      if (match) {
        return `# scaffold paint: ${match[1]} contig(s) → scaffold ${match[2]} (manual reconstruction needed)`;
      }
      return null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a contig name in double quotes if it contains spaces or special chars.
 */
function quoteIfNeeded(name: string): string {
  if (/\s/.test(name) || name.includes('"') || name.includes("'")) {
    // Escape internal double quotes
    const escaped = name.replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return name;
}
