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
   * @returns The id of the newly created scaffold.
   */
  createScaffold(name?: string): number {
    const id = this.nextId++;
    const color = this.generateColor(id - 1);
    const scaffold: Scaffold = {
      id,
      name: name ?? `Scaffold ${id}`,
      color,
    };
    this.scaffolds.set(id, scaffold);
    return id;
  }

  /**
   * Delete a scaffold. Any contigs currently assigned to it are unassigned
   * (their scaffoldId is set to null).
   */
  deleteScaffold(id: number): void {
    if (!this.scaffolds.has(id)) return;
    this.scaffolds.delete(id);

    // Unassign contigs that reference this scaffold
    const s = state.get();
    if (s.map) {
      const updates: Array<{ id: number; changes: Partial<import('../core/State').ContigInfo> }> = [];
      for (let i = 0; i < s.map.contigs.length; i++) {
        if (s.map.contigs[i].scaffoldId === id) {
          updates.push({ id: i, changes: { scaffoldId: null } });
        }
      }
      if (updates.length > 0) {
        state.updateContigs(updates);
      }
    }

    // Clear active scaffold if it was the deleted one
    if (this.activeScaffoldId === id) {
      this.activeScaffoldId = null;
    }

    events.emit('render:request', {});
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
  paintContigs(contigIndices: number[], scaffoldId: number | null): void {
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
    events.emit('render:request', {});
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
