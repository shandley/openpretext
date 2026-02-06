import { describe, it, expect, beforeEach, vi } from 'vitest';
import { events } from '../../src/core/EventBus';
import { WaypointManager, Waypoint } from '../../src/curation/WaypointManager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Collect emitted events into an array for assertions.
 */
function collectEvents(eventName: keyof import('../../src/core/EventBus').AppEvents) {
  const collected: any[] = [];
  const unsub = events.on(eventName, (data: any) => collected.push(data));
  return { collected, unsub };
}

// ---------------------------------------------------------------------------
// WaypointManager tests
// ---------------------------------------------------------------------------

describe('WaypointManager', () => {
  let mgr: WaypointManager;

  beforeEach(() => {
    mgr = new WaypointManager();
  });

  // -----------------------------------------------------------------------
  // addWaypoint
  // -----------------------------------------------------------------------
  describe('addWaypoint', () => {
    it('should create a waypoint with the given coordinates', () => {
      const wp = mgr.addWaypoint(0.25, 0.75);

      expect(wp.mapX).toBe(0.25);
      expect(wp.mapY).toBe(0.75);
    });

    it('should auto-generate a label when none is provided', () => {
      const wp1 = mgr.addWaypoint(0.1, 0.1);
      const wp2 = mgr.addWaypoint(0.2, 0.2);

      expect(wp1.label).toBe('WP1');
      expect(wp2.label).toBe('WP2');
    });

    it('should use the provided label when given', () => {
      const wp = mgr.addWaypoint(0.5, 0.5, 'Centromere');

      expect(wp.label).toBe('Centromere');
    });

    it('should not increment auto-name counter when custom label is provided', () => {
      mgr.addWaypoint(0.1, 0.1);               // WP1
      mgr.addWaypoint(0.2, 0.2, 'Custom');      // Custom (counter stays at 2)
      const wp3 = mgr.addWaypoint(0.3, 0.3);    // WP2

      expect(wp3.label).toBe('WP2');
    });

    it('should assign unique sequential ids', () => {
      const wp1 = mgr.addWaypoint(0.1, 0.1);
      const wp2 = mgr.addWaypoint(0.2, 0.2);
      const wp3 = mgr.addWaypoint(0.3, 0.3);

      expect(wp1.id).toBe(1);
      expect(wp2.id).toBe(2);
      expect(wp3.id).toBe(3);
    });

    it('should assign a color from the palette', () => {
      const wp = mgr.addWaypoint(0.5, 0.5);

      expect(wp.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('should assign distinct colors to multiple waypoints', () => {
      const waypoints: Waypoint[] = [];
      for (let i = 0; i < 8; i++) {
        waypoints.push(mgr.addWaypoint(i * 0.1, i * 0.1));
      }
      const colors = waypoints.map(wp => wp.color);
      const unique = new Set(colors);
      expect(unique.size).toBe(8);
    });

    it('should cycle colors after exhausting the palette', () => {
      const waypoints: Waypoint[] = [];
      for (let i = 0; i < 10; i++) {
        waypoints.push(mgr.addWaypoint(i * 0.1, i * 0.1));
      }

      // 9th waypoint (index 8) should wrap to same color as 1st (index 0)
      expect(waypoints[8].color).toBe(waypoints[0].color);
    });

    it('should set a timestamp on the waypoint', () => {
      const before = Date.now();
      const wp = mgr.addWaypoint(0.5, 0.5);
      const after = Date.now();

      expect(wp.timestamp).toBeGreaterThanOrEqual(before);
      expect(wp.timestamp).toBeLessThanOrEqual(after);
    });

    it('should emit render:request event', () => {
      const { collected, unsub } = collectEvents('render:request');

      mgr.addWaypoint(0.5, 0.5);

      expect(collected.length).toBeGreaterThanOrEqual(1);
      unsub();
    });
  });

  // -----------------------------------------------------------------------
  // removeWaypoint
  // -----------------------------------------------------------------------
  describe('removeWaypoint', () => {
    it('should remove a waypoint by id', () => {
      const wp = mgr.addWaypoint(0.5, 0.5);
      mgr.removeWaypoint(wp.id);

      expect(mgr.getWaypoint(wp.id)).toBeUndefined();
      expect(mgr.getAllWaypoints().length).toBe(0);
    });

    it('should be a no-op for non-existent id', () => {
      mgr.addWaypoint(0.5, 0.5);
      mgr.removeWaypoint(999);

      expect(mgr.getAllWaypoints().length).toBe(1);
    });

    it('should only remove the targeted waypoint', () => {
      const wp1 = mgr.addWaypoint(0.1, 0.1);
      const wp2 = mgr.addWaypoint(0.2, 0.2);
      const wp3 = mgr.addWaypoint(0.3, 0.3);

      mgr.removeWaypoint(wp2.id);

      const remaining = mgr.getAllWaypoints();
      expect(remaining.length).toBe(2);
      expect(remaining.map(w => w.id)).toEqual([wp1.id, wp3.id]);
    });

    it('should emit render:request event', () => {
      const wp = mgr.addWaypoint(0.5, 0.5);
      const { collected, unsub } = collectEvents('render:request');

      mgr.removeWaypoint(wp.id);

      expect(collected.length).toBeGreaterThanOrEqual(1);
      unsub();
    });
  });

  // -----------------------------------------------------------------------
  // renameWaypoint
  // -----------------------------------------------------------------------
  describe('renameWaypoint', () => {
    it('should update the label of an existing waypoint', () => {
      const wp = mgr.addWaypoint(0.5, 0.5);
      mgr.renameWaypoint(wp.id, 'Telomere');

      expect(mgr.getWaypoint(wp.id)!.label).toBe('Telomere');
    });

    it('should be a no-op for non-existent id', () => {
      mgr.renameWaypoint(999, 'Ghost');

      expect(mgr.getWaypoint(999)).toBeUndefined();
    });

    it('should emit render:request event', () => {
      const wp = mgr.addWaypoint(0.5, 0.5);
      const { collected, unsub } = collectEvents('render:request');

      mgr.renameWaypoint(wp.id, 'NewName');

      expect(collected.length).toBeGreaterThanOrEqual(1);
      unsub();
    });
  });

  // -----------------------------------------------------------------------
  // getAllWaypoints
  // -----------------------------------------------------------------------
  describe('getAllWaypoints', () => {
    it('should return empty array when no waypoints exist', () => {
      expect(mgr.getAllWaypoints()).toEqual([]);
    });

    it('should return waypoints sorted by creation order', () => {
      const wp1 = mgr.addWaypoint(0.3, 0.3, 'Third');
      const wp2 = mgr.addWaypoint(0.1, 0.1, 'First');
      const wp3 = mgr.addWaypoint(0.2, 0.2, 'Second');

      const all = mgr.getAllWaypoints();
      expect(all.length).toBe(3);
      // Sorted by timestamp (creation order), which matches id order
      expect(all[0].id).toBe(wp1.id);
      expect(all[1].id).toBe(wp2.id);
      expect(all[2].id).toBe(wp3.id);
    });

    it('should return a new array each time (not a live reference)', () => {
      mgr.addWaypoint(0.5, 0.5);
      const arr1 = mgr.getAllWaypoints();
      const arr2 = mgr.getAllWaypoints();

      expect(arr1).not.toBe(arr2);
      expect(arr1).toEqual(arr2);
    });
  });

  // -----------------------------------------------------------------------
  // clearAll
  // -----------------------------------------------------------------------
  describe('clearAll', () => {
    it('should remove all waypoints', () => {
      mgr.addWaypoint(0.1, 0.1);
      mgr.addWaypoint(0.2, 0.2);
      mgr.addWaypoint(0.3, 0.3);

      mgr.clearAll();

      expect(mgr.getAllWaypoints()).toEqual([]);
    });

    it('should be safe to call when no waypoints exist', () => {
      mgr.clearAll();

      expect(mgr.getAllWaypoints()).toEqual([]);
    });

    it('should emit render:request event', () => {
      mgr.addWaypoint(0.5, 0.5);
      const { collected, unsub } = collectEvents('render:request');

      mgr.clearAll();

      expect(collected.length).toBeGreaterThanOrEqual(1);
      unsub();
    });
  });

  // -----------------------------------------------------------------------
  // getNextWaypoint
  // -----------------------------------------------------------------------
  describe('getNextWaypoint', () => {
    it('should return null when no waypoints exist', () => {
      expect(mgr.getNextWaypoint(0.5, 0.5)).toBeNull();
    });

    it('should find the next waypoint along the diagonal', () => {
      // Diagonal projections: (0.1+0.1)/2=0.1, (0.5+0.5)/2=0.5, (0.8+0.8)/2=0.8
      mgr.addWaypoint(0.1, 0.1, 'A');
      mgr.addWaypoint(0.5, 0.5, 'B');
      mgr.addWaypoint(0.8, 0.8, 'C');

      const next = mgr.getNextWaypoint(0.3, 0.3);
      // Current projection = 0.3, next should be 'B' at 0.5
      expect(next).not.toBeNull();
      expect(next!.label).toBe('B');
    });

    it('should wrap around to the first waypoint when at the end', () => {
      mgr.addWaypoint(0.1, 0.1, 'A');
      mgr.addWaypoint(0.5, 0.5, 'B');

      // Current at 0.9 (projection = 0.9), which is past all waypoints
      const next = mgr.getNextWaypoint(0.9, 0.9);
      expect(next).not.toBeNull();
      expect(next!.label).toBe('A');
    });

    it('should return the only waypoint when there is just one', () => {
      mgr.addWaypoint(0.5, 0.5, 'Only');

      const next = mgr.getNextWaypoint(0.1, 0.1);
      expect(next).not.toBeNull();
      expect(next!.label).toBe('Only');
    });

    it('should handle off-diagonal waypoints correctly', () => {
      // Projection: (0.2 + 0.8)/2 = 0.5
      mgr.addWaypoint(0.2, 0.8, 'OffDiag');
      // Projection: (0.9 + 0.1)/2 = 0.5
      mgr.addWaypoint(0.9, 0.1, 'AlsoOffDiag');
      // Projection: (0.7 + 0.7)/2 = 0.7
      mgr.addWaypoint(0.7, 0.7, 'Ahead');

      // Current projection = 0.55, should find 'Ahead' at 0.7
      const next = mgr.getNextWaypoint(0.55, 0.55);
      expect(next).not.toBeNull();
      expect(next!.label).toBe('Ahead');
    });

    it('should skip waypoints at the exact same diagonal projection', () => {
      // Projection: (0.3 + 0.3)/2 = 0.3
      mgr.addWaypoint(0.3, 0.3, 'Same');
      // Projection: (0.6 + 0.6)/2 = 0.6
      mgr.addWaypoint(0.6, 0.6, 'Ahead');

      // Current at exactly 0.3 projection - should get 'Ahead', not 'Same'
      const next = mgr.getNextWaypoint(0.3, 0.3);
      expect(next).not.toBeNull();
      expect(next!.label).toBe('Ahead');
    });
  });

  // -----------------------------------------------------------------------
  // getPrevWaypoint
  // -----------------------------------------------------------------------
  describe('getPrevWaypoint', () => {
    it('should return null when no waypoints exist', () => {
      expect(mgr.getPrevWaypoint(0.5, 0.5)).toBeNull();
    });

    it('should find the previous waypoint along the diagonal', () => {
      mgr.addWaypoint(0.1, 0.1, 'A');
      mgr.addWaypoint(0.5, 0.5, 'B');
      mgr.addWaypoint(0.8, 0.8, 'C');

      // Current projection = 0.7, previous should be 'B' at 0.5
      const prev = mgr.getPrevWaypoint(0.7, 0.7);
      expect(prev).not.toBeNull();
      expect(prev!.label).toBe('B');
    });

    it('should wrap around to the last waypoint when at the beginning', () => {
      mgr.addWaypoint(0.3, 0.3, 'A');
      mgr.addWaypoint(0.7, 0.7, 'B');

      // Current at 0.1 (projection = 0.1), which is before all waypoints
      const prev = mgr.getPrevWaypoint(0.1, 0.1);
      expect(prev).not.toBeNull();
      expect(prev!.label).toBe('B');
    });

    it('should return the only waypoint when there is just one (wrapping)', () => {
      mgr.addWaypoint(0.5, 0.5, 'Only');

      // Current at 0.2, which is before 'Only', so it wraps to 'Only'
      const prev = mgr.getPrevWaypoint(0.2, 0.2);
      expect(prev).not.toBeNull();
      expect(prev!.label).toBe('Only');
    });

    it('should skip waypoints at the exact same diagonal projection', () => {
      mgr.addWaypoint(0.2, 0.2, 'Behind');
      mgr.addWaypoint(0.5, 0.5, 'Same');

      // Current at exactly 0.5 projection - should get 'Behind', not 'Same'
      const prev = mgr.getPrevWaypoint(0.5, 0.5);
      expect(prev).not.toBeNull();
      expect(prev!.label).toBe('Behind');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle waypoints at map boundaries (0,0)', () => {
      const wp = mgr.addWaypoint(0, 0, 'Origin');

      expect(wp.mapX).toBe(0);
      expect(wp.mapY).toBe(0);
      expect(mgr.getWaypoint(wp.id)).toBeDefined();
    });

    it('should handle waypoints at map boundaries (1,1)', () => {
      const wp = mgr.addWaypoint(1, 1, 'Corner');

      expect(wp.mapX).toBe(1);
      expect(wp.mapY).toBe(1);
    });

    it('should not reuse ids after removal', () => {
      const wp1 = mgr.addWaypoint(0.1, 0.1);
      mgr.removeWaypoint(wp1.id);
      const wp2 = mgr.addWaypoint(0.2, 0.2);

      expect(wp2.id).toBe(2); // IDs are never reused
    });

    it('should continue auto-naming after clearAll', () => {
      mgr.addWaypoint(0.1, 0.1);   // WP1
      mgr.addWaypoint(0.2, 0.2);   // WP2
      mgr.clearAll();
      const wp = mgr.addWaypoint(0.3, 0.3);

      // Counter continues from where it left off
      expect(wp.label).toBe('WP3');
    });

    it('should handle many waypoints without error', () => {
      for (let i = 0; i < 100; i++) {
        mgr.addWaypoint(i / 100, i / 100);
      }

      expect(mgr.getAllWaypoints().length).toBe(100);
    });

    it('getNextWaypoint should wrap correctly with single waypoint behind', () => {
      mgr.addWaypoint(0.2, 0.2, 'Behind');

      // Current at 0.5, the only waypoint is behind - should wrap to it
      const next = mgr.getNextWaypoint(0.5, 0.5);
      expect(next).not.toBeNull();
      expect(next!.label).toBe('Behind');
    });

    it('getPrevWaypoint should wrap correctly with single waypoint ahead', () => {
      mgr.addWaypoint(0.8, 0.8, 'Ahead');

      // Current at 0.5, the only waypoint is ahead - should wrap to it
      const prev = mgr.getPrevWaypoint(0.5, 0.5);
      expect(prev).not.toBeNull();
      expect(prev!.label).toBe('Ahead');
    });
  });
});
