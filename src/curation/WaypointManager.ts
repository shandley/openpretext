/**
 * WaypointManager - Manages bookmark markers on the contact map.
 *
 * Waypoints are user-placed markers at specific map coordinates that can be
 * navigated between (previous/next). Each waypoint has a unique ID, a label,
 * a color, and the map coordinates where it was placed.
 *
 * Waypoints are ordered by creation time. Navigation moves along the diagonal
 * direction (bottom-right is "forward", top-left is "backward") based on the
 * projection of position onto the diagonal axis.
 */

import { events } from '../core/EventBus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Waypoint {
  id: number;
  /** Normalized map X coordinate (0-1 range). */
  mapX: number;
  /** Normalized map Y coordinate (0-1 range). */
  mapY: number;
  /** Display label for the waypoint. */
  label: string;
  /** Hex color for visualization. */
  color: string;
  /** Unix timestamp when the waypoint was created. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

/**
 * 8 visually distinct colors for waypoint markers.
 * Chosen for readability on both light and dark map regions.
 */
const WAYPOINT_COLORS = [
  '#ff4081', // pink
  '#536dfe', // indigo
  '#00e676', // green
  '#ffab00', // amber
  '#e040fb', // purple
  '#00bcd4', // cyan
  '#ff6e40', // deep orange
  '#76ff03', // light green
];

// ---------------------------------------------------------------------------
// WaypointManager
// ---------------------------------------------------------------------------

export class WaypointManager {
  private waypoints: Map<number, Waypoint> = new Map();
  private nextId: number = 1;
  private autoNameCounter: number = 1;

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /**
   * Add a waypoint at the given map coordinates.
   *
   * @param mapX - Normalized X position (0-1 range).
   * @param mapY - Normalized Y position (0-1 range).
   * @param label - Optional display label. Defaults to "WP1", "WP2", etc.
   * @returns The newly created Waypoint.
   */
  addWaypoint(mapX: number, mapY: number, label?: string): Waypoint {
    const id = this.nextId++;
    const color = this.generateColor(id - 1);
    const resolvedLabel = label ?? `WP${this.autoNameCounter++}`;

    const waypoint: Waypoint = {
      id,
      mapX,
      mapY,
      label: resolvedLabel,
      color,
      timestamp: Date.now(),
    };

    this.waypoints.set(id, waypoint);
    events.emit('render:request', {});
    return waypoint;
  }

  /**
   * Remove a waypoint by its id.
   */
  removeWaypoint(id: number): void {
    if (!this.waypoints.has(id)) return;
    this.waypoints.delete(id);
    events.emit('render:request', {});
  }

  /**
   * Update the label of an existing waypoint.
   */
  renameWaypoint(id: number, label: string): void {
    const wp = this.waypoints.get(id);
    if (!wp) return;
    wp.label = label;
    events.emit('render:request', {});
  }

  /**
   * Get a single waypoint by id.
   */
  getWaypoint(id: number): Waypoint | undefined {
    return this.waypoints.get(id);
  }

  /**
   * Get all waypoints sorted by creation order (timestamp ascending, then id).
   */
  getAllWaypoints(): Waypoint[] {
    return Array.from(this.waypoints.values()).sort(
      (a, b) => a.timestamp - b.timestamp || a.id - b.id,
    );
  }

  /**
   * Remove all waypoints.
   */
  clearAll(): void {
    this.waypoints.clear();
    events.emit('render:request', {});
  }

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  /**
   * Compute the diagonal projection of a map position.
   *
   * The diagonal runs from (0,0) to (1,1). We project the point onto
   * this axis by computing (x + y) / 2, which gives a scalar value
   * representing how far "along the diagonal" the point is.
   */
  private diagonalProjection(mapX: number, mapY: number): number {
    return (mapX + mapY) / 2;
  }

  /**
   * Find the nearest waypoint in the "forward" direction (toward bottom-right
   * on the diagonal) from the given position.
   *
   * If no waypoint is strictly forward, wraps around to the first waypoint
   * along the diagonal.
   *
   * @returns The next waypoint, or null if no waypoints exist.
   */
  getNextWaypoint(currentMapX: number, currentMapY: number): Waypoint | null {
    const all = this.getAllWaypoints();
    if (all.length === 0) return null;

    const currentProj = this.diagonalProjection(currentMapX, currentMapY);

    // Sort waypoints by diagonal projection
    const sorted = [...all].sort(
      (a, b) =>
        this.diagonalProjection(a.mapX, a.mapY) -
        this.diagonalProjection(b.mapX, b.mapY),
    );

    // Find the first waypoint strictly ahead on the diagonal
    for (const wp of sorted) {
      const wpProj = this.diagonalProjection(wp.mapX, wp.mapY);
      if (wpProj > currentProj) {
        return wp;
      }
    }

    // Wrap around to the first waypoint
    return sorted[0];
  }

  /**
   * Find the nearest waypoint in the "backward" direction (toward top-left
   * on the diagonal) from the given position.
   *
   * If no waypoint is strictly backward, wraps around to the last waypoint
   * along the diagonal.
   *
   * @returns The previous waypoint, or null if no waypoints exist.
   */
  getPrevWaypoint(currentMapX: number, currentMapY: number): Waypoint | null {
    const all = this.getAllWaypoints();
    if (all.length === 0) return null;

    const currentProj = this.diagonalProjection(currentMapX, currentMapY);

    // Sort waypoints by diagonal projection descending
    const sorted = [...all].sort(
      (a, b) =>
        this.diagonalProjection(b.mapX, b.mapY) -
        this.diagonalProjection(a.mapX, a.mapY),
    );

    // Find the first waypoint strictly behind on the diagonal
    for (const wp of sorted) {
      const wpProj = this.diagonalProjection(wp.mapX, wp.mapY);
      if (wpProj < currentProj) {
        return wp;
      }
    }

    // Wrap around to the last waypoint (first in descending order)
    return sorted[0];
  }

  // -----------------------------------------------------------------------
  // Color generation
  // -----------------------------------------------------------------------

  /**
   * Generate a color for a waypoint by cycling through the palette.
   */
  private generateColor(index: number): string {
    return WAYPOINT_COLORS[index % WAYPOINT_COLORS.length];
  }
}
