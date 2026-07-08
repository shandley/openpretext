/**
 * DSLReference - Authoritative, machine-usable reference for the curation DSL.
 *
 * Each entry documents one distinct command form accepted by the parser in
 * `ScriptParser.ts` (`parseLine`). The script console renders an in-panel
 * help/cheat-sheet from this data, and it can later feed the AI assist prompt.
 *
 * INVARIANT: this reference must stay in sync with what `parseLine` actually
 * accepts. `tests/unit/dsl-reference.test.ts` enforces that by parsing every
 * `example` and by checking that every parser keyword is documented. If you
 * add or change a command in `ScriptParser.ts`, update this file too.
 *
 * Contig references accept a name (e.g. `chr1`) or a 0-based order index using
 * the `#N` syntax (e.g. `#0`). Names containing spaces can be quoted (e.g.
 * `"super scaffold 1"`).
 */

/** A single documented command form. */
export interface DSLCommandDoc {
  /** Category for grouping in the help panel. */
  category: 'Curation' | 'Selection' | 'Scaffold' | 'Navigation' | 'Meta';
  /** Canonical command form, e.g. 'move <contig> before <target>'. */
  syntax: string;
  /** One-line description of what it does. */
  summary: string;
  /** A concrete, runnable example, e.g. 'move chr3 before chr1'. */
  example: string;
}

/**
 * The full DSL reference, ordered by category then logically within a
 * category. One entry per distinct command form.
 */
export const DSL_REFERENCE: DSLCommandDoc[] = [
  // --------------------------------------------------------------------- //
  // Curation
  // --------------------------------------------------------------------- //
  {
    category: 'Curation',
    syntax: 'cut <contig> <pixel_offset>',
    summary: 'Split a contig into two at the given pixel offset from its start.',
    example: 'cut chr1 512',
  },
  {
    category: 'Curation',
    syntax: 'join <contig1> <contig2>',
    summary: 'Join two adjacent contigs into one; they must be neighbours in the current order.',
    example: 'join chr1 chr2',
  },
  {
    category: 'Curation',
    syntax: 'invert <contig>',
    summary: 'Reverse-complement a contig, flipping its orientation in place.',
    example: 'invert chr3',
  },
  {
    category: 'Curation',
    syntax: 'move <contig> to <position>',
    summary: 'Move a contig to an absolute 0-based order position.',
    example: 'move chr5 to 0',
  },
  {
    category: 'Curation',
    syntax: 'move <contig> before <target>',
    summary: 'Move a contig so it sits immediately before the target contig.',
    example: 'move chr3 before chr1',
  },
  {
    category: 'Curation',
    syntax: 'move <contig> after <target>',
    summary: 'Move a contig so it sits immediately after the target contig.',
    example: 'move chr3 after chr7',
  },
  {
    category: 'Curation',
    syntax: 'autocut [threshold=<n>] [minsize=<n>] [window=<n>]',
    summary: 'Automatically cut contigs at detected misassemblies; all params optional and numeric.',
    example: 'autocut threshold=0.5 minsize=100 window=8',
  },
  {
    category: 'Curation',
    syntax: 'autosort [threshold=<n>] [maxdist=<n>]',
    summary: 'Automatically reorder contigs by contact signal; all params optional and numeric.',
    example: 'autosort threshold=0.6 maxdist=50',
  },

  // --------------------------------------------------------------------- //
  // Selection
  // --------------------------------------------------------------------- //
  {
    category: 'Selection',
    syntax: 'select <contig>',
    summary: 'Select a single contig, replacing any current selection.',
    example: 'select chr4',
  },
  {
    category: 'Selection',
    syntax: 'select <contig1>..<contig2>',
    summary: 'Select an inclusive range of contigs between two endpoints.',
    example: 'select chr1..chr5',
  },
  {
    category: 'Selection',
    syntax: 'select all',
    summary: 'Select every contig in the assembly.',
    example: 'select all',
  },
  {
    category: 'Selection',
    syntax: 'deselect',
    summary: 'Clear the current selection.',
    example: 'deselect',
  },

  // --------------------------------------------------------------------- //
  // Scaffold
  // --------------------------------------------------------------------- //
  {
    category: 'Scaffold',
    syntax: 'scaffold create <name>',
    summary: 'Create a new named scaffold; the name may contain spaces.',
    example: 'scaffold create chromosome_1',
  },
  {
    category: 'Scaffold',
    syntax: 'scaffold paint <contig> <scaffold_name>',
    summary: 'Assign a contig to an existing scaffold.',
    example: 'scaffold paint chr2 chromosome_1',
  },
  {
    category: 'Scaffold',
    syntax: 'scaffold unpaint <contig>',
    summary: 'Remove a contig from whatever scaffold it belongs to.',
    example: 'scaffold unpaint chr2',
  },
  {
    category: 'Scaffold',
    syntax: 'scaffold delete <name>',
    summary: 'Delete a scaffold by name.',
    example: 'scaffold delete chromosome_1',
  },

  // --------------------------------------------------------------------- //
  // Navigation
  // --------------------------------------------------------------------- //
  {
    category: 'Navigation',
    syntax: 'zoom <contig>',
    summary: 'Frame the view on a single contig.',
    example: 'zoom chr1',
  },
  {
    category: 'Navigation',
    syntax: 'zoom reset',
    summary: 'Reset the view to the full contact map.',
    example: 'zoom reset',
  },
  {
    category: 'Navigation',
    syntax: 'goto <x> <y>',
    summary: 'Center the view on normalized map coordinates (0..1 on each axis).',
    example: 'goto 0.5 0.5',
  },

  // --------------------------------------------------------------------- //
  // Meta
  // --------------------------------------------------------------------- //
  {
    category: 'Meta',
    syntax: 'echo <message>',
    summary: 'Print a message to the script output; useful for annotating scripts.',
    example: 'echo starting curation',
  },
];
