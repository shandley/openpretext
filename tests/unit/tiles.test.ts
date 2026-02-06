import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TileManager,
  selectMipLevel,
  getVisibleTileKeys,
  getVisibleRect,
  tileIntersectsViewport,
  tileKeyToString,
  stringToTileKey,
  type TileKey,
} from '../../src/renderer/TileManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a dummy Float32Array for a tile of the given resolution.
 * Each pixel gets a unique-ish value derived from (col, row, level).
 */
function makeTileData(resolution: number, col = 0, row = 0, level = 0): Float32Array {
  const data = new Float32Array(resolution * resolution);
  for (let i = 0; i < data.length; i++) {
    data[i] = ((col * 1000 + row * 100 + level * 10 + i) % 256) / 255;
  }
  return data;
}

// ---------------------------------------------------------------------------
// TileKey utilities
// ---------------------------------------------------------------------------

describe('TileKey utilities', () => {
  it('should serialise and deserialise a TileKey', () => {
    const key: TileKey = { level: 3, col: 7, row: 12 };
    const str = tileKeyToString(key);
    expect(str).toBe('3:7:12');
    const parsed = stringToTileKey(str);
    expect(parsed).toEqual(key);
  });

  it('should handle level 0 and zero coordinates', () => {
    const key: TileKey = { level: 0, col: 0, row: 0 };
    expect(tileKeyToString(key)).toBe('0:0:0');
    expect(stringToTileKey('0:0:0')).toEqual(key);
  });
});

// ---------------------------------------------------------------------------
// Mip Level Selection
// ---------------------------------------------------------------------------

describe('selectMipLevel', () => {
  const tilesPerDim = 32;
  const numMipMaps = 8;

  it('should return level 0 (coarsest) at zoom 1.0', () => {
    expect(selectMipLevel(1.0, tilesPerDim, numMipMaps)).toBe(0);
  });

  it('should return level 0 at zoom < 1.0', () => {
    expect(selectMipLevel(0.5, tilesPerDim, numMipMaps)).toBe(0);
    expect(selectMipLevel(0.1, tilesPerDim, numMipMaps)).toBe(0);
  });

  it('should return level 1 at zoom 2.0', () => {
    expect(selectMipLevel(2.0, tilesPerDim, numMipMaps)).toBe(1);
  });

  it('should return level 2 at zoom 4.0', () => {
    expect(selectMipLevel(4.0, tilesPerDim, numMipMaps)).toBe(2);
  });

  it('should return level 3 at zoom 8.0', () => {
    expect(selectMipLevel(8.0, tilesPerDim, numMipMaps)).toBe(3);
  });

  it('should clamp to the maximum level', () => {
    // zoom = 2^10 = 1024, but numMipMaps = 8, so max level = 7
    expect(selectMipLevel(1024, tilesPerDim, numMipMaps)).toBe(7);
    expect(selectMipLevel(512, tilesPerDim, numMipMaps)).toBe(7);
  });

  it('should never return negative', () => {
    expect(selectMipLevel(0.001, tilesPerDim, numMipMaps)).toBe(0);
  });

  it('should handle numMipMaps = 1', () => {
    expect(selectMipLevel(1.0, tilesPerDim, 1)).toBe(0);
    expect(selectMipLevel(100.0, tilesPerDim, 1)).toBe(0);
  });

  it('should handle numMipMaps = 0 gracefully', () => {
    expect(selectMipLevel(1.0, tilesPerDim, 0)).toBe(0);
  });

  it('should increase monotonically with zoom', () => {
    let prevLevel = 0;
    for (let z = 1; z <= 256; z *= 2) {
      const level = selectMipLevel(z, tilesPerDim, numMipMaps);
      expect(level).toBeGreaterThanOrEqual(prevLevel);
      prevLevel = level;
    }
  });
});

// ---------------------------------------------------------------------------
// Visible Rect / Frustum Culling
// ---------------------------------------------------------------------------

describe('getVisibleRect', () => {
  it('should show the full [0,1] range at zoom 1, center (0.5, 0.5), square canvas', () => {
    const rect = getVisibleRect({ x: 0.5, y: 0.5, zoom: 1.0 }, 800, 800);
    expect(rect.minX).toBeCloseTo(0, 5);
    expect(rect.maxX).toBeCloseTo(1, 5);
    expect(rect.minY).toBeCloseTo(0, 5);
    expect(rect.maxY).toBeCloseTo(1, 5);
  });

  it('should show half the range at zoom 2, center (0.5, 0.5), square canvas', () => {
    const rect = getVisibleRect({ x: 0.5, y: 0.5, zoom: 2.0 }, 800, 800);
    expect(rect.minX).toBeCloseTo(0.25, 5);
    expect(rect.maxX).toBeCloseTo(0.75, 5);
    expect(rect.minY).toBeCloseTo(0.25, 5);
    expect(rect.maxY).toBeCloseTo(0.75, 5);
  });

  it('should be wider than tall for a wide canvas at zoom 1', () => {
    const rect = getVisibleRect({ x: 0.5, y: 0.5, zoom: 1.0 }, 1600, 800);
    // aspect = 2, so halfW = 0.5 * 2 / 1 = 1.0, halfH = 0.5 / 1 = 0.5
    expect(rect.maxX - rect.minX).toBeCloseTo(2.0, 5);
    expect(rect.maxY - rect.minY).toBeCloseTo(1.0, 5);
  });

  it('should be taller than wide for a tall canvas at zoom 1', () => {
    const rect = getVisibleRect({ x: 0.5, y: 0.5, zoom: 1.0 }, 800, 1600);
    // aspect = 0.5, halfW = 0.5 / 1 = 0.5, halfH = 0.5 / (1 * 0.5) = 1.0
    expect(rect.maxX - rect.minX).toBeCloseTo(1.0, 5);
    expect(rect.maxY - rect.minY).toBeCloseTo(2.0, 5);
  });

  it('should shift when camera is not centered', () => {
    const rect = getVisibleRect({ x: 0.8, y: 0.2, zoom: 2.0 }, 800, 800);
    // halfW = halfH = 0.5 / 2 = 0.25
    expect(rect.minX).toBeCloseTo(0.55, 5);
    expect(rect.maxX).toBeCloseTo(1.05, 5);
    expect(rect.minY).toBeCloseTo(-0.05, 5);
    expect(rect.maxY).toBeCloseTo(0.45, 5);
  });
});

describe('tileIntersectsViewport', () => {
  const tilesPerDim = 4; // Each tile covers 0.25 of the map

  it('should include all tiles when viewing the full map', () => {
    const camera = { x: 0.5, y: 0.5, zoom: 1.0 };
    for (let r = 0; r < tilesPerDim; r++) {
      for (let c = 0; c < tilesPerDim; c++) {
        expect(tileIntersectsViewport(c, r, tilesPerDim, camera, 800, 800)).toBe(true);
      }
    }
  });

  it('should exclude tiles outside the viewport when zoomed in', () => {
    // Zoom 4x centered at (0.125, 0.125) => visible range roughly [0, 0.25] x [0, 0.25]
    // That covers only tile (0,0) in a 4x4 grid
    const camera = { x: 0.125, y: 0.125, zoom: 4.0 };
    expect(tileIntersectsViewport(0, 0, tilesPerDim, camera, 800, 800)).toBe(true);
    expect(tileIntersectsViewport(3, 3, tilesPerDim, camera, 800, 800)).toBe(false);
    expect(tileIntersectsViewport(2, 2, tilesPerDim, camera, 800, 800)).toBe(false);
  });

  it('should include tiles partially overlapping the viewport', () => {
    // Center at the boundary between tiles 0 and 1 at moderate zoom
    const camera = { x: 0.25, y: 0.25, zoom: 2.0 };
    // Visible rect on square canvas: 0.25 +/- 0.25 = [0.0, 0.5]
    // Tiles 0 and 1 should both be visible
    expect(tileIntersectsViewport(0, 0, tilesPerDim, camera, 800, 800)).toBe(true);
    expect(tileIntersectsViewport(1, 1, tilesPerDim, camera, 800, 800)).toBe(true);
    // Tile 3 is at [0.75, 1.0] which should not overlap [0.0, 0.5]
    expect(tileIntersectsViewport(3, 3, tilesPerDim, camera, 800, 800)).toBe(false);
  });

  it('should handle edge case of single tile grid', () => {
    expect(tileIntersectsViewport(0, 0, 1, { x: 0.5, y: 0.5, zoom: 1.0 }, 800, 800)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getVisibleTileKeys
// ---------------------------------------------------------------------------

describe('getVisibleTileKeys', () => {
  const tilesPerDim = 8;
  const numMipMaps = 5;

  it('should return all tiles at zoom 1.0 on a square canvas', () => {
    const keys = getVisibleTileKeys(
      { x: 0.5, y: 0.5, zoom: 1.0 },
      800,
      800,
      tilesPerDim,
      numMipMaps,
    );
    // At zoom 1, the entire map is visible. All 8x8 = 64 tiles should appear.
    expect(keys.length).toBe(tilesPerDim * tilesPerDim);
    // All at mip level 0
    for (const k of keys) {
      expect(k.level).toBe(0);
    }
  });

  it('should return fewer tiles when zoomed into a corner', () => {
    // Zoom 8x centered at top-left corner (0.0625, 0.0625)
    // Visible range = [0, 0.125] x [0, 0.125]
    // Each tile covers 1/8 = 0.125. floor(0.125 * 8) = 1, so the range
    // includes tile columns/rows [0, 1] (conservative: includes boundary tile).
    // That gives 2x2 = 4 tiles.
    const keys = getVisibleTileKeys(
      { x: 0.0625, y: 0.0625, zoom: 8.0 },
      800,
      800,
      tilesPerDim,
      numMipMaps,
    );
    expect(keys.length).toBe(4);
    // First tile should be (0,0)
    expect(keys[0].col).toBe(0);
    expect(keys[0].row).toBe(0);
    // All at mip level 3 (log2(8) = 3)
    for (const k of keys) {
      expect(k.level).toBe(3);
    }
  });

  it('should return a reasonable number of tiles at moderate zoom', () => {
    // Zoom 2x at center: visible range [0.25, 0.75] x [0.25, 0.75]
    // colMin = floor(0.25 * 8) = 2, colMax = floor(0.75 * 8) = 6
    // That's columns/rows 2,3,4,5,6 (5 tiles each axis) = 25 tiles.
    // (The boundary tile at index 6 is included conservatively.)
    const keys = getVisibleTileKeys(
      { x: 0.5, y: 0.5, zoom: 2.0 },
      800,
      800,
      tilesPerDim,
      numMipMaps,
    );
    expect(keys.length).toBe(25);
    expect(keys[0].level).toBe(1); // log2(2) = 1
  });

  it('should handle tilesPerDim = 0 gracefully', () => {
    const keys = getVisibleTileKeys(
      { x: 0.5, y: 0.5, zoom: 1.0 },
      800,
      800,
      0,
      numMipMaps,
    );
    expect(keys.length).toBe(0);
  });

  it('should clamp tile indices to valid range when camera is panned to edge', () => {
    // Camera panned past the left/top edge
    const keys = getVisibleTileKeys(
      { x: 0.0, y: 0.0, zoom: 2.0 },
      800,
      800,
      tilesPerDim,
      numMipMaps,
    );
    // All returned keys should have valid indices
    for (const k of keys) {
      expect(k.col).toBeGreaterThanOrEqual(0);
      expect(k.col).toBeLessThan(tilesPerDim);
      expect(k.row).toBeGreaterThanOrEqual(0);
      expect(k.row).toBeLessThan(tilesPerDim);
    }
  });

  it('should have no duplicates', () => {
    const keys = getVisibleTileKeys(
      { x: 0.5, y: 0.5, zoom: 1.0 },
      800,
      800,
      tilesPerDim,
      numMipMaps,
    );
    const strings = keys.map(tileKeyToString);
    const unique = new Set(strings);
    expect(unique.size).toBe(strings.length);
  });

  it('should account for aspect ratio on a wide canvas', () => {
    // Wide canvas at zoom 1: horizontal extent is doubled
    // tilesPerDim = 8, so tiles covering [0, 1] vertically and [-0.5, 1.5] horizontally
    // Clamped to [0, 7] for col and [0, 7] for row
    const keys = getVisibleTileKeys(
      { x: 0.5, y: 0.5, zoom: 1.0 },
      1600,
      800,
      tilesPerDim,
      numMipMaps,
    );
    // All tiles should be visible since the visible area includes the full map
    expect(keys.length).toBe(tilesPerDim * tilesPerDim);
  });
});

// ---------------------------------------------------------------------------
// TileManager: loading, retrieval, eviction
// ---------------------------------------------------------------------------

describe('TileManager', () => {
  let manager: TileManager;

  beforeEach(() => {
    // Create with null GL context (no GPU textures in unit tests)
    manager = new TileManager(null, { maxTiles: 8 });
  });

  describe('loadTile and getTile', () => {
    it('should store and retrieve a tile', () => {
      const key: TileKey = { level: 0, col: 1, row: 2 };
      const data = makeTileData(16, 1, 2, 0);
      manager.loadTile(key, data);

      const tile = manager.getTile(key);
      expect(tile).toBeDefined();
      expect(tile!.state).toBe('loaded');
      expect(tile!.data).toBe(data);
      expect(tile!.key).toEqual(key);
      expect(tile!.texture).toBeNull(); // no GL context
    });

    it('should return undefined for missing tiles', () => {
      expect(manager.getTile({ level: 0, col: 0, row: 0 })).toBeUndefined();
    });

    it('should track cache size', () => {
      expect(manager.size).toBe(0);
      manager.loadTile({ level: 0, col: 0, row: 0 }, makeTileData(16));
      expect(manager.size).toBe(1);
      manager.loadTile({ level: 0, col: 1, row: 0 }, makeTileData(16));
      expect(manager.size).toBe(2);
    });

    it('should update data for an already-loaded tile', () => {
      const key: TileKey = { level: 0, col: 0, row: 0 };
      const data1 = makeTileData(16, 0, 0, 0);
      const data2 = makeTileData(16, 1, 1, 1);
      manager.loadTile(key, data1);
      manager.loadTile(key, data2);

      const tile = manager.getTile(key);
      expect(tile!.data).toBe(data2);
      // Should still be only 1 tile in cache
      expect(manager.size).toBe(1);
    });
  });

  describe('hasTile and removeTile', () => {
    it('should report whether a tile exists', () => {
      const key: TileKey = { level: 0, col: 0, row: 0 };
      expect(manager.hasTile(key)).toBe(false);
      manager.loadTile(key, makeTileData(16));
      expect(manager.hasTile(key)).toBe(true);
    });

    it('should remove a tile', () => {
      const key: TileKey = { level: 0, col: 0, row: 0 };
      manager.loadTile(key, makeTileData(16));
      expect(manager.removeTile(key)).toBe(true);
      expect(manager.hasTile(key)).toBe(false);
      expect(manager.size).toBe(0);
    });

    it('should return false when removing a non-existent tile', () => {
      expect(manager.removeTile({ level: 0, col: 0, row: 0 })).toBe(false);
    });
  });

  describe('markPending and markError', () => {
    it('should mark a tile as pending', () => {
      const key: TileKey = { level: 0, col: 0, row: 0 };
      manager.markPending(key);
      expect(manager.hasTile(key)).toBe(true);
      const tile = manager.getTile(key);
      expect(tile!.state).toBe('pending');
    });

    it('should not overwrite an existing tile when marking pending', () => {
      const key: TileKey = { level: 0, col: 0, row: 0 };
      manager.loadTile(key, makeTileData(16));
      manager.markPending(key);
      const tile = manager.getTile(key);
      expect(tile!.state).toBe('loaded'); // should not be overwritten
    });

    it('should mark a tile as error', () => {
      const key: TileKey = { level: 0, col: 0, row: 0 };
      manager.markPending(key);
      manager.markError(key);
      const tile = manager.getTile(key);
      expect(tile!.state).toBe('error');
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest tile when cache is full', () => {
      // Cache capacity is 8
      // Load 8 tiles to fill the cache
      for (let i = 0; i < 8; i++) {
        manager.loadTile({ level: 0, col: i, row: 0 }, makeTileData(16, i));
      }
      expect(manager.size).toBe(8);

      // Loading a 9th tile should evict the oldest (col=0, as it was loaded first)
      manager.loadTile({ level: 0, col: 8, row: 0 }, makeTileData(16, 8));
      expect(manager.size).toBe(8);

      // The first tile should have been evicted
      expect(manager.hasTile({ level: 0, col: 0, row: 0 })).toBe(false);
      // The new tile should exist
      expect(manager.hasTile({ level: 0, col: 8, row: 0 })).toBe(true);
    });

    it('should evict least recently used, not first loaded', () => {
      // Load 8 tiles
      for (let i = 0; i < 8; i++) {
        manager.loadTile({ level: 0, col: i, row: 0 }, makeTileData(16, i));
      }

      // Access tile 0 to make it recently used
      manager.getTile({ level: 0, col: 0, row: 0 });

      // Load a new tile - should evict tile 1 (least recently used)
      manager.loadTile({ level: 0, col: 8, row: 0 }, makeTileData(16, 8));

      // Tile 0 should still be present (was recently accessed)
      expect(manager.hasTile({ level: 0, col: 0, row: 0 })).toBe(true);
      // Tile 1 should have been evicted (oldest not recently accessed)
      expect(manager.hasTile({ level: 0, col: 1, row: 0 })).toBe(false);
    });

    it('should respect maxTiles option', () => {
      const small = new TileManager(null, { maxTiles: 3 });
      for (let i = 0; i < 5; i++) {
        small.loadTile({ level: 0, col: i, row: 0 }, makeTileData(16, i));
      }
      expect(small.size).toBe(3);
      // Only the last 3 should remain
      expect(small.hasTile({ level: 0, col: 0, row: 0 })).toBe(false);
      expect(small.hasTile({ level: 0, col: 1, row: 0 })).toBe(false);
      expect(small.hasTile({ level: 0, col: 2, row: 0 })).toBe(true);
      expect(small.hasTile({ level: 0, col: 3, row: 0 })).toBe(true);
      expect(small.hasTile({ level: 0, col: 4, row: 0 })).toBe(true);
    });

    it('should default to 256 maxTiles', () => {
      const defaultManager = new TileManager(null);
      expect(defaultManager.capacity).toBe(256);
    });
  });

  describe('updateVisibleTiles', () => {
    it('should return visible tile keys and update the visibleKeys property', () => {
      const camera = { x: 0.5, y: 0.5, zoom: 1.0 };
      const keys = manager.updateVisibleTiles(camera, 800, 800, 4, 3);
      expect(keys.length).toBe(16); // 4x4 grid, all visible
      expect(manager.visibleKeys).toBe(keys);
    });

    it('should touch visible tiles to prevent eviction', () => {
      // Load some tiles
      const key: TileKey = { level: 0, col: 0, row: 0 };
      manager.loadTile(key, makeTileData(16));

      const tileBefore = manager.getTile(key)!;
      const timeBefore = tileBefore.lastUsed;

      // Small delay to ensure timestamp changes
      // (In a real scenario performance.now() would differ; here we just verify the method runs)
      manager.updateVisibleTiles({ x: 0.5, y: 0.5, zoom: 1.0 }, 800, 800, 4, 3);

      const tileAfter = manager.getTile(key)!;
      expect(tileAfter.lastUsed).toBeGreaterThanOrEqual(timeBefore);
    });
  });

  describe('dispose', () => {
    it('should clear all tiles', () => {
      manager.loadTile({ level: 0, col: 0, row: 0 }, makeTileData(16));
      manager.loadTile({ level: 0, col: 1, row: 1 }, makeTileData(16));
      expect(manager.size).toBe(2);

      manager.dispose();
      expect(manager.size).toBe(0);
      expect(manager.visibleKeys).toEqual([]);
    });

    it('should allow reuse after dispose', () => {
      manager.loadTile({ level: 0, col: 0, row: 0 }, makeTileData(16));
      manager.dispose();
      manager.loadTile({ level: 0, col: 1, row: 1 }, makeTileData(16));
      expect(manager.size).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration-like tests: typical usage patterns
// ---------------------------------------------------------------------------

describe('TileManager integration patterns', () => {
  it('should handle a full zoom-in workflow', () => {
    const manager = new TileManager(null, { maxTiles: 64 });
    const tilesPerDim = 8;
    const numMipMaps = 5;

    // Step 1: full view at zoom 1
    let keys = manager.updateVisibleTiles(
      { x: 0.5, y: 0.5, zoom: 1.0 },
      800, 800, tilesPerDim, numMipMaps,
    );
    expect(keys.length).toBe(64);
    expect(keys[0].level).toBe(0);

    // Load all visible tiles
    for (const key of keys) {
      manager.loadTile(key, makeTileData(16, key.col, key.row, key.level));
    }
    expect(manager.size).toBe(64);

    // Step 2: zoom into center
    keys = manager.updateVisibleTiles(
      { x: 0.5, y: 0.5, zoom: 4.0 },
      800, 800, tilesPerDim, numMipMaps,
    );
    // At zoom 4, visible range is [0.375, 0.625], tiles 3,4 on each axis = 4 tiles
    expect(keys.length).toBeLessThan(64);
    expect(keys[0].level).toBe(2); // log2(4) = 2

    // All visible tiles should be retrievable after loading
    for (const key of keys) {
      manager.loadTile(key, makeTileData(16, key.col, key.row, key.level));
      expect(manager.getTile(key)).toBeDefined();
      expect(manager.getTile(key)!.state).toBe('loaded');
    }
  });

  it('should handle rapid camera movement with eviction', () => {
    const manager = new TileManager(null, { maxTiles: 16 });
    const tilesPerDim = 16;
    const numMipMaps = 5;

    // Pan across the map, loading tiles at each position
    for (let step = 0; step < 10; step++) {
      const x = (step + 0.5) / 10;
      const keys = manager.updateVisibleTiles(
        { x, y: 0.5, zoom: 4.0 },
        800, 800, tilesPerDim, numMipMaps,
      );

      for (const key of keys) {
        if (!manager.hasTile(key)) {
          manager.loadTile(key, makeTileData(8, key.col, key.row, key.level));
        }
      }

      // Cache should never exceed capacity
      expect(manager.size).toBeLessThanOrEqual(16);
    }
  });
});
