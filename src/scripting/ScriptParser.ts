/**
 * ScriptParser - Parses a line-oriented curation DSL into an AST.
 *
 * The DSL supports contig operations (cut, join, invert, move), selection
 * commands, scaffold management, navigation, and meta commands like echo.
 *
 * Each line is parsed independently. Comments start with #, blank lines
 * are ignored, and whitespace is treated forgivingly.
 *
 * Contigs can be referenced by name (e.g. `chr1`) or by 0-based order
 * index using the `#N` syntax (e.g. `#0`, `#3`).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Discriminated union of all supported command types. */
export type ScriptCommandType =
  | 'cut'
  | 'join'
  | 'invert'
  | 'move_to'
  | 'move_before'
  | 'move_after'
  | 'select'
  | 'select_range'
  | 'select_all'
  | 'deselect'
  | 'scaffold_create'
  | 'scaffold_paint'
  | 'scaffold_unpaint'
  | 'scaffold_delete'
  | 'zoom'
  | 'zoom_reset'
  | 'goto'
  | 'echo';

/**
 * A single parsed script command.
 *
 * `type` identifies the operation; `args` carries command-specific
 * parameters; `line` records the 1-based source line number for error
 * reporting.
 */
export interface ScriptCommand {
  type: ScriptCommandType;
  args: Record<string, any>;
  line: number;
}

/**
 * A contig reference that can be resolved against the current state.
 * Either a name string or a numeric index (from `#N` syntax).
 */
export interface ContigRef {
  kind: 'name' | 'index';
  value: string | number;
}

/**
 * Returned when parsing encounters an error on a specific line.
 */
export interface ParseError {
  line: number;
  message: string;
}

/**
 * The result of parsing a full script. Contains successfully parsed
 * commands and any errors encountered.
 */
export interface ParseResult {
  commands: ScriptCommand[];
  errors: ParseError[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a contig reference token.
 *
 * Tokens starting with `#` followed by digits are treated as numeric
 * indices into the contig order. Everything else is treated as a contig
 * name.
 *
 * @param token - Raw token string from the script line.
 * @returns A ContigRef describing either a name or index reference.
 */
export function parseContigRef(token: string): ContigRef {
  if (/^#\d+$/.test(token)) {
    return { kind: 'index', value: parseInt(token.slice(1), 10) };
  }
  return { kind: 'name', value: token };
}

/**
 * Tokenize a single line, respecting quoted strings.
 *
 * Tokens are split on whitespace. Double-quoted or single-quoted strings
 * are kept as single tokens with the quotes stripped.
 *
 * @param line - A single script line (already trimmed).
 * @returns Array of tokens.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    // Skip whitespace
    if (/\s/.test(line[i])) {
      i++;
      continue;
    }
    // Quoted string
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      i++;
      let token = '';
      while (i < line.length && line[i] !== quote) {
        token += line[i];
        i++;
      }
      if (i < line.length) i++; // skip closing quote
      tokens.push(token);
      continue;
    }
    // Regular token
    let token = '';
    while (i < line.length && !/\s/.test(line[i])) {
      token += line[i];
      i++;
    }
    tokens.push(token);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Single-line parser
// ---------------------------------------------------------------------------

/**
 * Parse a single script line into a ScriptCommand.
 *
 * Returns `null` for blank lines and comments. Throws an Error with a
 * descriptive message for malformed commands.
 *
 * @param line - The raw source line.
 * @param lineNumber - 1-based line number for error reporting.
 * @returns A ScriptCommand, or null if the line is empty/comment.
 */
export function parseLine(line: string, lineNumber: number = 1): ScriptCommand | null {
  const trimmed = line.trim();

  // Skip blank lines and comments
  if (trimmed === '' || trimmed.startsWith('#')) {
    return null;
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  const keyword = tokens[0].toLowerCase();

  switch (keyword) {
    // ----- cut <contig> <pixel_offset> -----
    case 'cut': {
      if (tokens.length < 3) {
        throw new Error(`Line ${lineNumber}: 'cut' requires <contig> and <pixel_offset> arguments`);
      }
      const contig = parseContigRef(tokens[1]);
      const pixelOffset = parseInt(tokens[2], 10);
      if (isNaN(pixelOffset)) {
        throw new Error(`Line ${lineNumber}: 'cut' pixel_offset must be a number, got '${tokens[2]}'`);
      }
      return { type: 'cut', args: { contig, pixelOffset }, line: lineNumber };
    }

    // ----- join <contig1> <contig2> -----
    case 'join': {
      if (tokens.length < 3) {
        throw new Error(`Line ${lineNumber}: 'join' requires <contig1> and <contig2> arguments`);
      }
      const contig1 = parseContigRef(tokens[1]);
      const contig2 = parseContigRef(tokens[2]);
      return { type: 'join', args: { contig1, contig2 }, line: lineNumber };
    }

    // ----- invert <contig> -----
    case 'invert': {
      if (tokens.length < 2) {
        throw new Error(`Line ${lineNumber}: 'invert' requires a <contig> argument`);
      }
      const contig = parseContigRef(tokens[1]);
      return { type: 'invert', args: { contig }, line: lineNumber };
    }

    // ----- move <contig> to|before|after <target> -----
    case 'move': {
      if (tokens.length < 4) {
        throw new Error(`Line ${lineNumber}: 'move' requires <contig> to|before|after <target>`);
      }
      const contig = parseContigRef(tokens[1]);
      const direction = tokens[2].toLowerCase();
      if (direction === 'to') {
        const position = parseInt(tokens[3], 10);
        if (isNaN(position)) {
          throw new Error(`Line ${lineNumber}: 'move ... to' position must be a number, got '${tokens[3]}'`);
        }
        return { type: 'move_to', args: { contig, position }, line: lineNumber };
      }
      if (direction === 'before') {
        const target = parseContigRef(tokens[3]);
        return { type: 'move_before', args: { contig, target }, line: lineNumber };
      }
      if (direction === 'after') {
        const target = parseContigRef(tokens[3]);
        return { type: 'move_after', args: { contig, target }, line: lineNumber };
      }
      throw new Error(
        `Line ${lineNumber}: 'move' direction must be 'to', 'before', or 'after', got '${tokens[2]}'`
      );
    }

    // ----- select <contig> | <contig1>..<contig2> | all -----
    case 'select': {
      if (tokens.length < 2) {
        throw new Error(`Line ${lineNumber}: 'select' requires an argument`);
      }
      const arg = tokens[1];
      if (arg.toLowerCase() === 'all') {
        return { type: 'select_all', args: {}, line: lineNumber };
      }
      // Check for range syntax: contig1..contig2
      const rangeMatch = arg.match(/^(.+)\.\.(.+)$/);
      if (rangeMatch) {
        const from = parseContigRef(rangeMatch[1]);
        const to = parseContigRef(rangeMatch[2]);
        return { type: 'select_range', args: { from, to }, line: lineNumber };
      }
      // Also support separated by space: select <c1> .. <c2>
      if (tokens.length >= 4 && tokens[2] === '..') {
        const from = parseContigRef(tokens[1]);
        const to = parseContigRef(tokens[3]);
        return { type: 'select_range', args: { from, to }, line: lineNumber };
      }
      const contig = parseContigRef(arg);
      return { type: 'select', args: { contig }, line: lineNumber };
    }

    // ----- deselect -----
    case 'deselect': {
      return { type: 'deselect', args: {}, line: lineNumber };
    }

    // ----- scaffold <subcommand> ... -----
    case 'scaffold': {
      if (tokens.length < 2) {
        throw new Error(`Line ${lineNumber}: 'scaffold' requires a subcommand (create|paint|unpaint|delete)`);
      }
      const sub = tokens[1].toLowerCase();
      switch (sub) {
        case 'create': {
          if (tokens.length < 3) {
            throw new Error(`Line ${lineNumber}: 'scaffold create' requires a <name> argument`);
          }
          // Name is everything after "scaffold create", joined by spaces
          const name = tokens.slice(2).join(' ');
          return { type: 'scaffold_create', args: { name }, line: lineNumber };
        }
        case 'paint': {
          if (tokens.length < 4) {
            throw new Error(`Line ${lineNumber}: 'scaffold paint' requires <contig> and <scaffold_name> arguments`);
          }
          const contig = parseContigRef(tokens[2]);
          const scaffoldName = tokens.slice(3).join(' ');
          return { type: 'scaffold_paint', args: { contig, scaffoldName }, line: lineNumber };
        }
        case 'unpaint': {
          if (tokens.length < 3) {
            throw new Error(`Line ${lineNumber}: 'scaffold unpaint' requires a <contig> argument`);
          }
          const contig = parseContigRef(tokens[2]);
          return { type: 'scaffold_unpaint', args: { contig }, line: lineNumber };
        }
        case 'delete': {
          if (tokens.length < 3) {
            throw new Error(`Line ${lineNumber}: 'scaffold delete' requires a <name> argument`);
          }
          const name = tokens.slice(2).join(' ');
          return { type: 'scaffold_delete', args: { name }, line: lineNumber };
        }
        default:
          throw new Error(
            `Line ${lineNumber}: Unknown scaffold subcommand '${tokens[1]}'. Expected create, paint, unpaint, or delete`
          );
      }
    }

    // ----- zoom <contig> | reset -----
    case 'zoom': {
      if (tokens.length < 2) {
        throw new Error(`Line ${lineNumber}: 'zoom' requires an argument (contig name or 'reset')`);
      }
      if (tokens[1].toLowerCase() === 'reset') {
        return { type: 'zoom_reset', args: {}, line: lineNumber };
      }
      const contig = parseContigRef(tokens[1]);
      return { type: 'zoom', args: { contig }, line: lineNumber };
    }

    // ----- goto <x> <y> -----
    case 'goto': {
      if (tokens.length < 3) {
        throw new Error(`Line ${lineNumber}: 'goto' requires <x> and <y> arguments`);
      }
      const x = parseFloat(tokens[1]);
      const y = parseFloat(tokens[2]);
      if (isNaN(x) || isNaN(y)) {
        throw new Error(`Line ${lineNumber}: 'goto' coordinates must be numbers`);
      }
      return { type: 'goto', args: { x, y }, line: lineNumber };
    }

    // ----- echo <message> -----
    case 'echo': {
      // Everything after "echo" is the message
      const message = tokens.slice(1).join(' ');
      return { type: 'echo', args: { message }, line: lineNumber };
    }

    default:
      throw new Error(`Line ${lineNumber}: Unknown command '${tokens[0]}'`);
  }
}

// ---------------------------------------------------------------------------
// Multi-line parser
// ---------------------------------------------------------------------------

/**
 * Parse a multi-line script into commands.
 *
 * Each line is parsed independently. Comments and blank lines are
 * skipped. Parse errors are collected rather than thrown so that the
 * caller can report all errors at once.
 *
 * @param text - The full script text (may contain multiple lines).
 * @returns A ParseResult with commands and any errors.
 */
export function parseScript(text: string): ParseResult {
  const lines = text.split('\n');
  const commands: ScriptCommand[] = [];
  const errors: ParseError[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    try {
      const cmd = parseLine(lines[i], lineNumber);
      if (cmd !== null) {
        commands.push(cmd);
      }
    } catch (e: any) {
      errors.push({ line: lineNumber, message: e.message ?? String(e) });
    }
  }

  return { commands, errors };
}
