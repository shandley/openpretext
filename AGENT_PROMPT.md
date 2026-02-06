# OpenPretext -- Developer Reference

This document describes the architecture and conventions of OpenPretext for
contributors and AI coding agents.

## What This Project Is

OpenPretext is a browser-based Hi-C contact map viewer and genome assembly
curation tool. It reads `.pretext` files natively using WebGL2 for rendering
and pure DOM for the UI. There are no framework dependencies (no React, Vue,
or Angular).

## Architecture

```
src/
  main.ts                    Entry point; orchestrates all modules
  core/
    State.ts                 Global AppState with undo/redo stacks
    EventBus.ts              Typed event emitter for inter-module comms
  formats/
    PretextParser.ts         Binary .pretext parser (BC4 + deflate)
    SyntheticData.ts         Demo contact map generator
    SyntheticTracks.ts       Demo annotation track generator
  renderer/
    WebGLRenderer.ts         WebGL2 contact map quad with color map shader
    Camera.ts                Pan/zoom camera with mouse/touch/trackpad
    TileManager.ts           Tile-based LOD rendering with LRU cache
    ColorMaps.ts             Color ramp textures (6 maps)
    LabelRenderer.ts         Contig name labels on map edges
    Minimap.ts               Corner overview with viewport indicator
    TrackRenderer.ts         Annotation track overlay (line/heatmap/marker)
    ScaffoldOverlay.ts       Scaffold color bands
    WaypointOverlay.ts       Waypoint position markers
  curation/
    CurationEngine.ts        Cut/join/invert/move with full undo data
    SelectionManager.ts      Click/shift/ctrl contig selection
    DragReorder.ts           Visual drag-and-drop reordering
    ScaffoldManager.ts       Scaffold (chromosome) assignment CRUD
    WaypointManager.ts       Named position markers
  scripting/
    ScriptParser.ts          Tokenizer + parser for 18-command DSL
    ScriptExecutor.ts        Executes parsed AST via ScriptContext DI
    ScriptReplay.ts          Converts operation logs to DSL scripts
  export/
    AGPWriter.ts             AGP 2.1 format generation
    SnapshotExporter.ts      PNG screenshot via canvas.toBlob
    CurationLog.ts           JSON operation history export
  io/
    SessionManager.ts        Session save/load (JSON with undo stack)
tests/
  unit/                      503 unit tests (vitest)
    basic.test.ts            Synthetic data, color maps, camera
    curation.test.ts         CurationEngine operations
    scaffold.test.ts         ScaffoldManager
    waypoint.test.ts         WaypointManager
    export.test.ts           AGP writer, curation log
    session.test.ts          Session save/load round-trips
    scripting.test.ts        Script parser + executor (110 tests)
    replay.test.ts           Script replay from logs
    tiles.test.ts            TileManager, frustum culling, LRU
    tracks.test.ts           TrackRenderer
```

## Key Technical Decisions

1. **TypeScript + Vite** -- strict mode, ESNext modules, fast HMR
2. **WebGL2** -- single-channel R8 texture for the contact map, 1D color map
   lookup in the fragment shader, camera transform in vertex shader
3. **No UI framework** -- all UI is in index.html + inline styles + main.ts
   event handlers; keeps the bundle small and avoids framework churn
4. **Single runtime dependency** -- only `pako` for deflate decompression
5. **Dependency injection** -- ScriptExecutor uses a ScriptContext interface
   so tests can run without DOM or GPU

## The .pretext File Format

The format uses BC4 (RGTC1) texture compression, NOT DXT1. Each tile stores
all mipmap levels concatenated, compressed with raw deflate (libdeflate).
See [docs/PRETEXT_FORMAT.md](docs/PRETEXT_FORMAT.md) for the full binary
specification.

Key parsing flow:
1. Validate `pstm` magic bytes
2. Read compressed/uncompressed header sizes (2x u32)
3. Decompress header with `pako.inflateRaw()`
4. Parse: total genome length (u64), num contigs (u32), per-contig records
   (fractional length f32 + 64-byte name), texture params (3 bytes)
5. For each upper-triangular tile: read compressed size, decompress, decode
   BC4 blocks at requested mipmap levels
6. Scan for `psgh` extension magic and parse graph tracks

For large genomes (e.g. 32768x32768 pixels), the full map cannot fit in a
single Float32Array. The loader uses `coarsestOnly: true` to decode only the
smallest mipmap level per tile, assembling a downsampled overview texture
(typically 1024x1024) for initial display.

## State Management

`core/State.ts` holds a single `AppState` object accessed via `state.get()`
and `state.update()`. The state includes:
- Map data (contigs, contact map, extensions)
- Contig ordering array (indices into contigs)
- Undo/redo stacks of `CurationOperation` objects
- UI state (mode, camera, visibility flags, selections)

Curation operations store enough data in their `data` field to reverse
themselves. The undo stack is the source of truth for curation history.

## Coordinate System

- Map space: (0,0) top-left to (1,1) bottom-right
- Camera center defaults to (0.5, 0.5), zoom 1.0 shows the full map
- Contig boundaries are stored as normalized positions (pixelEnd / mapSize)
- The vertex shader applies camera transform with aspect ratio correction

## Conventions

- All source in `src/`, tests in `tests/unit/`
- No comments on obvious code; comments only where logic is non-obvious
- Exported functions use JSDoc for public API; internal functions do not
- Test files mirror source structure: `curation.test.ts` tests
  `CurationEngine.ts`
- Run `npm test` before committing; all 503 tests must pass
- Run `npx tsc --noEmit` to verify types

## Common Pitfalls

- The format uses BC4, not DXT1. The two have different decoding logic.
- Deflate is raw (RFC 1951), not gzip or zlib. Use `pako.inflateRaw()`.
- BC4 blocks iterate column-major (outer x, inner y) matching PretextMap.
- WebGL Y is flipped relative to screen coordinates.
- Real .pretext files can be 30-200 MB with 32768px maps. Never allocate
  `Float32Array(mapSize * mapSize)` for the full resolution.
- The uniform `u_contigBoundaries[512]` limits the shader to 512 contigs.
- Contig `originalIndex` (position in the file) differs from the display
  order stored in `contigOrder[]`.
