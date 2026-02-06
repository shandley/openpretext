# OpenPretext — Progress

## Session 1 — 2026-02-05

### What was done:
- Project scaffolded with Vite + TypeScript
- AGENT_PROMPT.md written with full architecture spec
- Core WebGL renderer implemented with tile-based rendering
- Synthetic Hi-C contact map data generator
- Camera system with pan/zoom (mouse wheel + drag)
- Color map system (red-white, blue-white-red, viridis)
- Basic UI shell (toolbar, status bar)
- DXT1 decoder for .pretext format
- Deflate decompression integration (pako)
- Test infrastructure set up (vitest)

### What's working:
- Synthetic data renders correctly as Hi-C heatmap
- Pan and zoom with mouse/trackpad
- Color map switching
- WebGL2 rendering at 60fps

### What's next:
- [ ] Parse real .pretext file headers and contig metadata
- [ ] Load and render real .pretext texture data
- [ ] Implement contig grid overlay
- [ ] Selection system for contigs
- [ ] Cut/invert/move operations
- [ ] Undo/redo stack
- [ ] Scaffold painting mode
- [ ] AGP export
- [ ] Extension track rendering
- [ ] Command palette

### Known issues:
- None yet (first session)

### Decisions made:
- Using Vite + TypeScript (no framework)
- WebGL2 for rendering
- Pure DOM for UI
- Will support .pretext format natively before .cool
