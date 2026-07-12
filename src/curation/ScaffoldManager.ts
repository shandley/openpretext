/**
 * ScaffoldManager - Manages scaffold assignments for genome assembly contigs.
 *
 * Scaffolds group contigs into named, colored sets for visualization and
 * export. Each scaffold has a unique ID, a name, and a color used to render
 * colored bands on the contact map overlay.
 *
 * Integrates with the CurationEngine's undo/redo system by recording
 * scaffold_paint operations on the state's undo stack.
 */

import { state, CurationOperation } from '../core/State';
import { events } from '../core/EventBus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Scaffold {
  id: number;
  name: string;
  color: string; // hex color for visualization
}

/**
 * A full snapshot of scaffold state (the scaffolds plus every contig's
 * assignment) used to make bulk operations undoable as a single unit,
 * independent of how many scaffolds they touch.
 */
export interface ScaffoldSnapshot {
  scaffolds: Scaffold[];
  assignments: Array<[number, number | null]>; // [contigId, scaffoldId]
  nextId: number;
  activeId: number | null;
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

/**
 * 18 visually distinguishable colors for scaffold assignment.
 * Based on an expanded version of D3 category10.
 */
const SCAFFOLD_COLORS = [
  '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
  '#469990', '#dcbeff', '#9A6324', '#800000', '#aaffc3',
  '#808000', '#ffd8b1', '#000075',
];

// ---------------------------------------------------------------------------
// ScaffoldManager
// ---------------------------------------------------------------------------

export class ScaffoldManager {
  private scaffolds: Map<number, Scaffold> = new Map();
  private nextId: number = 1;
  private activeScaffoldId: number | null = null;

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /**
   * Create a new scaffold with an optional name.
   * A color is auto-generated from the palette.
   *
   * By default the creation is recorded on the undo stack so it participates
   * in undo/redo (and in script/auto-assign batches). Pass `record: false` for
   * non-curation contexts such as restoring a saved session, where the create
   * should not add an undo entry.
   *
   * @returns The id of the newly created scaffold.
   */
  createScaffold(name?: string, options?: { record?: boolean }): number {
    const id = this.nextId++;
    const color = this.generateColor(id - 1);
    const scaffold: Scaffold = {
      id,
      name: name ?? `Scaffold ${id}`,
      color,
    };
    this.scaffolds.set(id, scaffold);

    if (options?.record !== false) {
      const op: CurationOperation = {
        type: 'scaffold_create',
        timestamp: Date.now(),
        description: `Created ${scaffold.name}`,
        data: { scaffold: { ...scaffold } },
      };
      state.pushOperation(op);
    }
    return id;
  }

  /**
   * Delete a scaffold. Any contigs currently assigned to it are unassigned
   * (their scaffoldId is set to null). The deletion, including which contigs
   * were unassigned, is recorded on the undo stack so it can be reversed.
   */
  deleteScaffold(id: number): void {
    const scaffold = this.scaffolds.get(id);
    if (!scaffold) return;

    // Capture the contigs assigned to this scaffold before we unassign them,
    // so undo can restore both the scaffold and its membership.
    const contigIds = this.assignedContigIds(id);

    this.scaffolds.delete(id);
    this.assignContigs(contigIds, null);

    // Clear active scaffold if it was the deleted one
    if (this.activeScaffoldId === id) {
      this.activeScaffoldId = null;
    }

    const op: CurationOperation = {
      type: 'scaffold_delete',
      timestamp: Date.now(),
      description: `Deleted ${scaffold.name}`,
      data: { scaffold: { ...scaffold }, contigIds },
    };
    state.pushOperation(op);

    events.emit('render:request', {});
    events.emit('scaffold:changed', {}); // unassigned contigs change scaffold metrics
  }

  /**
   * Rename a scaffold.
   */
  renameScaffold(id: number, name: string): void {
    const scaffold = this.scaffolds.get(id);
    if (!scaffold) return;
    scaffold.name = name;
  }

  /**
   * Get a scaffold by id.
   */
  getScaffold(id: number): Scaffold | undefined {
    return this.scaffolds.get(id);
  }

  /**
   * Get all scaffolds as an array, ordered by id.
   */
  getAllScaffolds(): Scaffold[] {
    return Array.from(this.scaffolds.values()).sort((a, b) => a.id - b.id);
  }

  // -----------------------------------------------------------------------
  // Active scaffold
  // -----------------------------------------------------------------------

  /**
   * Get the currently active scaffold id (the one being painted with).
   */
  getActiveScaffoldId(): number | null {
    return this.activeScaffoldId;
  }

  /**
   * Set the active scaffold. Pass null to deactivate.
   */
  setActiveScaffoldId(id: number | null): void {
    if (id !== null && !this.scaffolds.has(id)) return;
    this.activeScaffoldId = id;
  }

  // -----------------------------------------------------------------------
  // Painting
  // -----------------------------------------------------------------------

  /**
   * Paint (assign) contigs to a scaffold.
   *
   * @param contigIndices - Indices into the contigOrder array.
   * @param scaffoldId   - Scaffold to assign, or null to unassign.
   */
  paintContigs(contigIndices: number[], scaffoldId: number | null, options?: { record?: boolean }): void {
    const s = state.get();
    if (!s.map) return;
    if (scaffoldId !== null && !this.scaffolds.has(scaffoldId)) return;
    if (contigIndices.length === 0) return;

    // Record previous assignments for undo
    const previousAssignments: Record<number, number | null> = {};
    const updates: Array<{ id: number; changes: Partial<import('../core/State').ContigInfo> }> = [];
    for (const orderIdx of contigIndices) {
      if (orderIdx < 0 || orderIdx >= s.contigOrder.length) continue;
      const contigId = s.contigOrder[orderIdx];
      previousAssignments[contigId] = s.map.contigs[contigId].scaffoldId;
      updates.push({ id: contigId, changes: { scaffoldId } });
    }
    if (updates.length > 0) {
      state.updateContigs(updates);
    }

    if (options?.record !== false) {
      const op: CurationOperation = {
        type: 'scaffold_paint',
        timestamp: Date.now(),
        description: scaffoldId !== null
          ? `Painted ${contigIndices.length} contig(s) with scaffold ${scaffoldId}`
          : `Unpainted ${contigIndices.length} contig(s)`,
        data: {
          contigIndices,
          scaffoldId,
          previousAssignments,
        },
      };
      state.pushOperation(op);
    }
    events.emit('render:request', {});
    // A standalone paint changes contig assignments (and thus scaffold-level
    // metrics). Skip when record is false: those calls run inside a
    // bulkOperation, which emits scaffold:changed once at the end.
    if (options?.record !== false) events.emit('scaffold:changed', {});
  }

  /**
   * Get the order-indices of all contigs belonging to a scaffold.
   */
  getContigsInScaffold(scaffoldId: number): number[] {
    const s = state.get();
    if (!s.map) return [];

    const result: number[] = [];
    for (let i = 0; i < s.contigOrder.length; i++) {
      const contigId = s.contigOrder[i];
      if (s.map.contigs[contigId].scaffoldId === scaffoldId) {
        result.push(i);
      }
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Undo support
  // -----------------------------------------------------------------------

  /**
   * Undo a scaffold_paint operation by restoring previous assignments.
   */
  undoPaint(op: CurationOperation): void {
    const s = state.get();
    if (!s.map) return;

    const prev = op.data.previousAssignments as Record<number, number | null>;
    const updates: Array<{ id: number; changes: Partial<import('../core/State').ContigInfo> }> = [];
    for (const [contigIdStr, prevScaffoldId] of Object.entries(prev)) {
      const contigId = Number(contigIdStr);
      if (contigId >= 0 && contigId < s.map.contigs.length) {
        updates.push({ id: contigId, changes: { scaffoldId: prevScaffoldId } });
      }
    }
    if (updates.length > 0) {
      state.updateContigs(updates);
    }

    events.emit('render:request', {});
  }

  /**
   * Redo a scaffold_paint operation by re-applying the paint.
   */
  reapplyPaint(op: CurationOperation): void {
    const s = state.get();
    if (!s.map) return;

    const scaffoldId = op.data.scaffoldId as number | null;
    const contigIndices = op.data.contigIndices as number[];

    const updates: Array<{ id: number; changes: Partial<import('../core/State').ContigInfo> }> = [];
    for (const orderIdx of contigIndices) {
      if (orderIdx < 0 || orderIdx >= s.contigOrder.length) continue;
      const contigId = s.contigOrder[orderIdx];
      updates.push({ id: contigId, changes: { scaffoldId } });
    }
    if (updates.length > 0) {
      state.updateContigs(updates);
    }

    const newOp: CurationOperation = {
      ...op,
      timestamp: Date.now(),
    };

    state.pushOperation(newOp);
    events.emit('render:request', {});
  }

  /**
   * Undo a scaffold_create: remove the scaffold. Any contigs it held were
   * painted by later operations that undo first (the stack is LIFO), so by the
   * time we get here the scaffold is empty.
   */
  undoCreate(op: CurationOperation): void {
    const scaffold = op.data.scaffold as Scaffold;
    this.removeScaffoldRaw(scaffold.id);
    events.emit('render:request', {});
  }

  /** Redo a scaffold_create: re-add the scaffold with its original id. */
  reapplyCreate(op: CurationOperation): void {
    const scaffold = op.data.scaffold as Scaffold;
    this.restoreScaffold(scaffold);
    state.pushOperation({ ...op, timestamp: Date.now() });
    events.emit('render:request', {});
  }

  /** Undo a scaffold_delete: restore the scaffold and its contig membership. */
  undoDelete(op: CurationOperation): void {
    const scaffold = op.data.scaffold as Scaffold;
    const contigIds = op.data.contigIds as number[];
    this.restoreScaffold(scaffold);
    this.assignContigs(contigIds, scaffold.id);
    events.emit('render:request', {});
  }

  /** Redo a scaffold_delete: remove the scaffold and unassign its contigs. */
  reapplyDelete(op: CurationOperation): void {
    const scaffold = op.data.scaffold as Scaffold;
    const contigIds = op.data.contigIds as number[];
    this.scaffolds.delete(scaffold.id);
    this.assignContigs(contigIds, null);
    if (this.activeScaffoldId === scaffold.id) this.activeScaffoldId = null;
    state.pushOperation({ ...op, timestamp: Date.now() });
    events.emit('render:request', {});
  }

  // -----------------------------------------------------------------------
  // Bulk operations (single undoable unit, independent of scaffold count)
  // -----------------------------------------------------------------------

  /**
   * Run a bulk scaffold mutation (e.g. auto-assign, which replaces the whole
   * scaffold set) and record it as ONE undoable operation via a before/after
   * snapshot. This is immune to the undo-stack depth cap: no matter how many
   * scaffolds `fn` creates, undo restores the prior state exactly.
   *
   * `fn` should mutate scaffolds without recording its own operations (use
   * `resetScaffolds()`, `createScaffold(name, { record: false })`, and
   * `paintContigs(..., { record: false })`).
   */
  bulkOperation(description: string, fn: () => void): void {
    const before = this.snapshotState();
    fn();
    const after = this.snapshotState();
    const op: CurationOperation = {
      type: 'scaffold_bulk',
      timestamp: Date.now(),
      description,
      data: { before, after },
    };
    state.pushOperation(op);
    events.emit('render:request', {});
    events.emit('scaffold:changed', {});
  }

  /** Undo a scaffold_bulk: restore the entire prior scaffold state. */
  undoBulk(op: CurationOperation): void {
    this.restoreState(op.data.before as ScaffoldSnapshot);
    events.emit('render:request', {});
    events.emit('scaffold:changed', {});
  }

  /** Redo a scaffold_bulk: restore the entire post-operation scaffold state. */
  reapplyBulk(op: CurationOperation): void {
    this.restoreState(op.data.after as ScaffoldSnapshot);
    state.pushOperation({ ...op, timestamp: Date.now() });
    events.emit('render:request', {});
    events.emit('scaffold:changed', {});
  }

  /**
   * Remove all scaffolds and unassign every contig, without recording an undo
   * operation. Intended for use inside `bulkOperation`, whose snapshot captures
   * the prior state.
   */
  resetScaffolds(): void {
    this.scaffolds.clear();
    this.activeScaffoldId = null;
    const s = state.get();
    if (s.map) {
      const updates = s.map.contigs
        .map((c, i) => ({ contig: c, i }))
        .filter(({ contig }) => contig.scaffoldId !== null)
        .map(({ i }) => ({ id: i, changes: { scaffoldId: null } }));
      if (updates.length > 0) state.updateContigs(updates);
    }
  }

  /** Capture the full scaffold state (scaffolds + every contig assignment). */
  private snapshotState(): ScaffoldSnapshot {
    const s = state.get();
    const assignments: Array<[number, number | null]> = [];
    if (s.map) {
      for (let i = 0; i < s.map.contigs.length; i++) {
        assignments.push([i, s.map.contigs[i].scaffoldId]);
      }
    }
    return {
      scaffolds: this.getAllScaffolds().map((sc) => ({ ...sc })),
      assignments,
      nextId: this.nextId,
      activeId: this.activeScaffoldId,
    };
  }

  /** Restore a full scaffold state captured by snapshotState(). */
  private restoreState(snap: ScaffoldSnapshot): void {
    this.scaffolds.clear();
    for (const sc of snap.scaffolds) this.scaffolds.set(sc.id, { ...sc });
    this.nextId = snap.nextId;
    this.activeScaffoldId = snap.activeId;
    const s = state.get();
    if (s.map) {
      const updates = snap.assignments
        .filter(([id]) => id >= 0 && id < s.map!.contigs.length)
        .map(([id, scaffoldId]) => ({ id, changes: { scaffoldId } }));
      if (updates.length > 0) state.updateContigs(updates);
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers (no undo recording)
  // -----------------------------------------------------------------------

  /** Re-insert a scaffold with a specific id/name/color (undo/redo path). */
  private restoreScaffold(scaffold: Scaffold): void {
    this.scaffolds.set(scaffold.id, { ...scaffold });
    if (scaffold.id >= this.nextId) this.nextId = scaffold.id + 1;
  }

  /** Remove a scaffold entry without touching contig assignments. */
  private removeScaffoldRaw(id: number): void {
    this.scaffolds.delete(id);
    if (this.activeScaffoldId === id) this.activeScaffoldId = null;
  }

  /** Contig ids (not order indices) currently assigned to a scaffold. */
  private assignedContigIds(scaffoldId: number): number[] {
    const s = state.get();
    if (!s.map) return [];
    const ids: number[] = [];
    for (let i = 0; i < s.map.contigs.length; i++) {
      if (s.map.contigs[i].scaffoldId === scaffoldId) ids.push(i);
    }
    return ids;
  }

  /** Set the scaffoldId of the given contig ids. */
  private assignContigs(contigIds: number[], scaffoldId: number | null): void {
    const s = state.get();
    if (!s.map || contigIds.length === 0) return;
    const updates = contigIds
      .filter((id) => id >= 0 && id < s.map!.contigs.length)
      .map((id) => ({ id, changes: { scaffoldId } }));
    if (updates.length > 0) state.updateContigs(updates);
  }

  // -----------------------------------------------------------------------
  // Color generation
  // -----------------------------------------------------------------------

  /**
   * Generate a color for a scaffold index by cycling through the palette.
   */
  private generateColor(index: number): string {
    return SCAFFOLD_COLORS[index % SCAFFOLD_COLORS.length];
  }
}
