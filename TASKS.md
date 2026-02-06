# OpenPretext — Task Board

## Priority 1 — Core

- [x] Project scaffold and build system
- [x] WebGL2 renderer with synthetic data
- [x] Camera system (pan/zoom/drag)
- [x] .pretext file parser (header + contig metadata)
- [x] .pretext texture block decompression (deflate + BC4/RGTC1)
- [x] Color maps (red-white, blue-white-red, viridis, magma, plasma)
- [ ] Render real .pretext contact map data (parser done, needs e2e test with real file)

## Priority 2 — Curation

- [x] Contig grid overlay rendering (anti-aliased smoothstep)
- [x] Selection system (click to select, shift-range, ctrl-toggle)
- [x] Cut operation with undo/redo
- [x] Invert operation with undo/redo
- [x] Move operation with undo/redo
- [x] Join operation with undo/redo
- [x] Undo/redo stack (CurationEngine)
- [x] Contig drag reorder (visual drag in edit mode)
- [x] Scaffold painting mode
- [x] Waypoint mode

## Priority 3 — I/O

- [x] AGP 2.1 export
- [x] Curation log (JSON operation history)
- [x] PNG screenshot export
- [x] State save/load (session persistence as JSON)

## Priority 4 — Annotation Tracks

- [x] Track renderer base system (line, heatmap, marker types)
- [x] Coverage track (synthetic)
- [x] Telomere track (synthetic)
- [x] Gap track (synthetic)
- [x] GC content track (synthetic)
- [x] Extension data parser from .pretext files

## Priority 5 — UI/UX

- [x] Command palette (Cmd+K) with fuzzy search
- [x] Keyboard shortcut system
- [x] Sidebar contig list with selection
- [x] Toast notifications
- [x] Contig labels on map edges (LabelRenderer)
- [x] Hover highlighting
- [x] Scaffold list sidebar (functional)
- [x] Color map picker UI (dropdown)
- [x] Gamma adjustment slider
- [x] Minimap / overview
- [x] Tooltip with detailed contig info
- [x] Loading progress indicator

## Priority 6 — Scripting

- [x] Curation DSL design
- [x] Script parser (18 command types, quoted strings, contig refs)
- [x] Script executor (dependency-injected, testable)
- [x] Script console UI (split input/output, Ctrl+Enter run)
- [x] Script replay from log (operation-to-DSL converter, "From Log" button)

## Priority 7 — Polish

- [x] Responsive layout (900px/600px breakpoints)
- [x] Touch/trackpad gesture support (pinch-zoom, single-finger pan)
- [x] Error handling and user feedback (global handlers, toast UI)
- [x] Performance: tile-based LOD rendering system (TileManager with LRU cache)
- [x] Keyboard shortcuts help modal (? key)
- [x] Contig search/filter in sidebar
