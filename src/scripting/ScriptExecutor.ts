/**
 * ScriptExecutor - Executes parsed DSL commands against the application state.
 *
 * Commands are resolved and validated against a ScriptContext that provides
 * access to the CurationEngine, SelectionManager, ScaffoldManager, and
 * application state. Each command produces a ScriptResult indicating success
 * or failure with a descriptive message.
 *
 * The executor is decoupled from DOM APIs and can run in tests or headless
 * environments.
 */

import type { ScriptCommand, ContigRef } from './ScriptParser';
import type { ContigInfo, AppState, MapData } from '../core/State';
import type { ScaffoldManager, Scaffold } from '../curation/ScaffoldManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The result of executing a single script command.
 */
export interface ScriptResult {
  /** Whether the command executed successfully. */
  success: boolean;
  /** Human-readable description of the outcome. */
  message: string;
  /** The 1-based source line number of the command. */
  line: number;
}

/**
 * Abstraction over the CurationEngine operations so the executor
 * does not import the singleton directly. This makes testing easy.
 */
export interface CurationEngineAPI {
  cut(contigOrderIndex: number, pixelOffset: number): void;
  join(contigOrderIndex: number): void;
  invert(contigOrderIndex: number): void;
  move(fromIndex: number, toIndex: number): void;
}

/**
 * Abstraction over the SelectionManager operations.
 */
export interface SelectionAPI {
  selectSingle(orderIndex: number): void;
  selectRange(orderIndex: number): void;
  selectAll(): void;
  clearSelection(): void;
}

/**
 * Abstraction over the ScaffoldManager operations.
 */
export interface ScaffoldAPI {
  createScaffold(name?: string): number;
  deleteScaffold(id: number): void;
  paintContigs(contigIndices: number[], scaffoldId: number | null): void;
  getAllScaffolds(): Scaffold[];
}

/**
 * Abstraction over state access so the executor does not import the
 * singleton directly.
 */
export interface StateAPI {
  get(): AppState;
  update(partial: Partial<AppState>): void;
}

/**
 * The execution context provides all the dependencies a command needs.
 */
export interface ScriptContext {
  curation: CurationEngineAPI;
  selection: SelectionAPI;
  scaffold: ScaffoldAPI;
  state: StateAPI;
  /** Optional callback for echo messages. Defaults to console.log. */
  onEcho?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Contig reference resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a ContigRef to a 0-based order index.
 *
 * For index references (`#N`), the value is used directly after bounds
 * checking. For name references, the contig order is searched for a
 * contig whose name matches (case-sensitive).
 *
 * @param ref - The contig reference to resolve.
 * @param stateApi - State accessor.
 * @returns The 0-based order index.
 * @throws Error if the reference cannot be resolved.
 */
export function resolveContigRef(ref: ContigRef, stateApi: StateAPI): number {
  const s = stateApi.get();
  if (!s.map) {
    throw new Error('No map loaded');
  }

  if (ref.kind === 'index') {
    const idx = ref.value as number;
    if (idx < 0 || idx >= s.contigOrder.length) {
      throw new Error(
        `Contig index #${idx} is out of range. Valid range: 0..${s.contigOrder.length - 1}`
      );
    }
    return idx;
  }

  // Name lookup
  const name = ref.value as string;
  for (let i = 0; i < s.contigOrder.length; i++) {
    const contigId = s.contigOrder[i];
    if (s.map.contigs[contigId].name === name) {
      return i;
    }
  }

  throw new Error(`Contig '${name}' not found`);
}

/**
 * Find a scaffold by name (case-insensitive).
 *
 * @param name - Scaffold name to search for.
 * @param scaffoldApi - Scaffold accessor.
 * @returns The matching Scaffold.
 * @throws Error if not found.
 */
function findScaffoldByName(name: string, scaffoldApi: ScaffoldAPI): Scaffold {
  const all = scaffoldApi.getAllScaffolds();
  const lowerName = name.toLowerCase();
  const match = all.find(s => s.name.toLowerCase() === lowerName);
  if (!match) {
    throw new Error(`Scaffold '${name}' not found`);
  }
  return match;
}

// ---------------------------------------------------------------------------
// Single-command executor
// ---------------------------------------------------------------------------

/**
 * Execute a single parsed ScriptCommand within the given context.
 *
 * @param cmd - The parsed command to execute.
 * @param ctx - The execution context with all required dependencies.
 * @returns A ScriptResult describing the outcome.
 */
export function executeCommand(cmd: ScriptCommand, ctx: ScriptContext): ScriptResult {
  try {
    switch (cmd.type) {

      // ----- cut <contig> <pixel_offset> -----
      case 'cut': {
        const orderIndex = resolveContigRef(cmd.args.contig, ctx.state);
        const pixelOffset = cmd.args.pixelOffset as number;
        ctx.curation.cut(orderIndex, pixelOffset);
        const s = ctx.state.get();
        const contigName = s.map!.contigs[s.contigOrder[orderIndex]]?.name ?? `#${orderIndex}`;
        return {
          success: true,
          message: `Cut contig '${contigName}' at pixel offset ${pixelOffset}`,
          line: cmd.line,
        };
      }

      // ----- join <contig1> <contig2> -----
      case 'join': {
        const idx1 = resolveContigRef(cmd.args.contig1, ctx.state);
        const idx2 = resolveContigRef(cmd.args.contig2, ctx.state);
        // Validate that the two contigs are adjacent
        if (Math.abs(idx1 - idx2) !== 1) {
          return {
            success: false,
            message: `Cannot join: contigs are not adjacent (positions ${idx1} and ${idx2})`,
            line: cmd.line,
          };
        }
        const joinAt = Math.min(idx1, idx2);
        ctx.curation.join(joinAt);
        return {
          success: true,
          message: `Joined contigs at positions ${idx1} and ${idx2}`,
          line: cmd.line,
        };
      }

      // ----- invert <contig> -----
      case 'invert': {
        const orderIndex = resolveContigRef(cmd.args.contig, ctx.state);
        const s = ctx.state.get();
        const contigId = s.contigOrder[orderIndex];
        const contigName = s.map!.contigs[contigId].name;
        ctx.curation.invert(orderIndex);
        return {
          success: true,
          message: `Inverted contig '${contigName}'`,
          line: cmd.line,
        };
      }

      // ----- move <contig> to <position> -----
      case 'move_to': {
        const fromIndex = resolveContigRef(cmd.args.contig, ctx.state);
        const toIndex = cmd.args.position as number;
        ctx.curation.move(fromIndex, toIndex);
        return {
          success: true,
          message: `Moved contig from position ${fromIndex} to ${toIndex}`,
          line: cmd.line,
        };
      }

      // ----- move <contig> before <target> -----
      case 'move_before': {
        const fromIndex = resolveContigRef(cmd.args.contig, ctx.state);
        const targetIndex = resolveContigRef(cmd.args.target, ctx.state);
        // "before target" means: the contig should end up at targetIndex's
        // current position (pushing target rightward). We need to compute
        // the toIndex that move() expects.
        const toIndex = targetIndex > fromIndex ? targetIndex - 1 : targetIndex;
        ctx.curation.move(fromIndex, toIndex);
        return {
          success: true,
          message: `Moved contig to before position ${targetIndex}`,
          line: cmd.line,
        };
      }

      // ----- move <contig> after <target> -----
      case 'move_after': {
        const fromIndex = resolveContigRef(cmd.args.contig, ctx.state);
        const targetIndex = resolveContigRef(cmd.args.target, ctx.state);
        // "after target" means: the contig should end up right after target.
        const toIndex = targetIndex >= fromIndex ? targetIndex : targetIndex + 1;
        ctx.curation.move(fromIndex, toIndex);
        return {
          success: true,
          message: `Moved contig to after position ${targetIndex}`,
          line: cmd.line,
        };
      }

      // ----- select <contig> -----
      case 'select': {
        const orderIndex = resolveContigRef(cmd.args.contig, ctx.state);
        ctx.selection.selectSingle(orderIndex);
        return {
          success: true,
          message: `Selected contig at position ${orderIndex}`,
          line: cmd.line,
        };
      }

      // ----- select <contig1>..<contig2> -----
      case 'select_range': {
        const fromIndex = resolveContigRef(cmd.args.from, ctx.state);
        const toIndex = resolveContigRef(cmd.args.to, ctx.state);
        // Select the first, then extend to the second
        ctx.selection.selectSingle(fromIndex);
        ctx.selection.selectRange(toIndex);
        return {
          success: true,
          message: `Selected contigs from position ${fromIndex} to ${toIndex}`,
          line: cmd.line,
        };
      }

      // ----- select all -----
      case 'select_all': {
        ctx.selection.selectAll();
        return {
          success: true,
          message: 'Selected all contigs',
          line: cmd.line,
        };
      }

      // ----- deselect -----
      case 'deselect': {
        ctx.selection.clearSelection();
        return {
          success: true,
          message: 'Cleared selection',
          line: cmd.line,
        };
      }

      // ----- scaffold create <name> -----
      case 'scaffold_create': {
        const name = cmd.args.name as string;
        const id = ctx.scaffold.createScaffold(name);
        return {
          success: true,
          message: `Created scaffold '${name}' (id=${id})`,
          line: cmd.line,
        };
      }

      // ----- scaffold paint <contig> <scaffold_name> -----
      case 'scaffold_paint': {
        const orderIndex = resolveContigRef(cmd.args.contig, ctx.state);
        const scaffoldName = cmd.args.scaffoldName as string;
        const scaffold = findScaffoldByName(scaffoldName, ctx.scaffold);
        ctx.scaffold.paintContigs([orderIndex], scaffold.id);
        return {
          success: true,
          message: `Painted contig at position ${orderIndex} with scaffold '${scaffoldName}'`,
          line: cmd.line,
        };
      }

      // ----- scaffold unpaint <contig> -----
      case 'scaffold_unpaint': {
        const orderIndex = resolveContigRef(cmd.args.contig, ctx.state);
        ctx.scaffold.paintContigs([orderIndex], null);
        return {
          success: true,
          message: `Unpainted contig at position ${orderIndex}`,
          line: cmd.line,
        };
      }

      // ----- scaffold delete <name> -----
      case 'scaffold_delete': {
        const name = cmd.args.name as string;
        const scaffold = findScaffoldByName(name, ctx.scaffold);
        ctx.scaffold.deleteScaffold(scaffold.id);
        return {
          success: true,
          message: `Deleted scaffold '${name}'`,
          line: cmd.line,
        };
      }

      // ----- zoom <contig> -----
      case 'zoom': {
        const orderIndex = resolveContigRef(cmd.args.contig, ctx.state);
        const s = ctx.state.get();
        const contigId = s.contigOrder[orderIndex];
        const contig = s.map!.contigs[contigId];

        // Calculate cumulative pixel start for this contig in current order
        let cumulativePixels = 0;
        for (let i = 0; i < orderIndex; i++) {
          const cId = s.contigOrder[i];
          const c = s.map!.contigs[cId];
          cumulativePixels += c.pixelEnd - c.pixelStart;
        }
        const contigPixelLength = contig.pixelEnd - contig.pixelStart;
        const textureSize = s.map!.textureSize;

        // Center on the contig and zoom to fit
        const centerPixel = cumulativePixels + contigPixelLength / 2;
        const normalizedCenter = centerPixel / textureSize;
        const zoom = textureSize / contigPixelLength;

        ctx.state.update({
          camera: {
            x: 0,
            y: 0,
            zoom: Math.min(zoom, 100), // cap zoom to avoid extreme values
          },
        });
        return {
          success: true,
          message: `Zoomed to contig '${contig.name}'`,
          line: cmd.line,
        };
      }

      // ----- zoom reset -----
      case 'zoom_reset': {
        ctx.state.update({
          camera: { x: 0, y: 0, zoom: 1 },
        });
        return {
          success: true,
          message: 'Reset zoom to full view',
          line: cmd.line,
        };
      }

      // ----- goto <x> <y> -----
      case 'goto': {
        const x = cmd.args.x as number;
        const y = cmd.args.y as number;
        const s = ctx.state.get();
        ctx.state.update({
          camera: { ...s.camera, x, y },
        });
        return {
          success: true,
          message: `Navigated to (${x}, ${y})`,
          line: cmd.line,
        };
      }

      // ----- echo <message> -----
      case 'echo': {
        const message = cmd.args.message as string;
        if (ctx.onEcho) {
          ctx.onEcho(message);
        }
        return {
          success: true,
          message: message,
          line: cmd.line,
        };
      }

      default: {
        return {
          success: false,
          message: `Unknown command type '${(cmd as any).type}'`,
          line: cmd.line,
        };
      }
    }
  } catch (e: any) {
    return {
      success: false,
      message: e.message ?? String(e),
      line: cmd.line,
    };
  }
}

// ---------------------------------------------------------------------------
// Multi-command executor
// ---------------------------------------------------------------------------

/**
 * Execute a sequence of parsed commands.
 *
 * Commands are executed in order. Execution stops at the first failure
 * unless `continueOnError` is true.
 *
 * @param commands - Array of parsed ScriptCommands.
 * @param ctx - The execution context.
 * @param options - Optional execution options.
 * @returns Array of ScriptResults, one per executed command.
 */
export function executeScript(
  commands: ScriptCommand[],
  ctx: ScriptContext,
  options?: { continueOnError?: boolean }
): ScriptResult[] {
  const results: ScriptResult[] = [];
  const continueOnError = options?.continueOnError ?? false;

  for (const cmd of commands) {
    const result = executeCommand(cmd, ctx);
    results.push(result);

    if (!result.success && !continueOnError) {
      break;
    }
  }

  return results;
}
