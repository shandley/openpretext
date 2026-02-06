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
- [ ] Contig drag reorder (visual drag in edit mode)
- [ ] Scaffold painting mode
- [ ] Waypoint mode

## Priority 3 — I/O

- [x] AGP 2.1 export
- [x] Curation log (JSON operation history)
- [x] PNG screenshot export
- [ ] State save/load

## Priority 4 — Annotation Tracks

- [ ] Track renderer base system
- [ ] Coverage track
- [ ] Telomere track
- [ ] Gap track
- [ ] Repeat density track
- [x] Extension data parser from .pretext files

## Priority 5 — UI/UX

- [x] Command palette (Cmd+K) with fuzzy search
- [x] Keyboard shortcut system
- [x] Sidebar contig list with selection
- [x] Toast notifications
- [x] Contig labels on map edges (LabelRenderer)
- [x] Hover highlighting
- [ ] Scaffold list sidebar (functional)
- [ ] Tooltip with detailed contig info
- [ ] Color map picker UI (dropdown, not just cycling)
- [ ] Gamma adjustment slider
- [ ] Minimap / overview

## Priority 6 — Scripting

- [ ] Curation DSL design
- [ ] Script parser
- [ ] Script console UI
- [ ] Script replay from log

## Priority 7 — Polish

- [ ] Responsive layout
- [ ] Touch/trackpad gesture support
- [ ] Loading progress indicator
- [ ] Error handling and user feedback
- [ ] Performance optimization for large genomes
