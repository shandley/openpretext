# OpenPretext — Task Board

## How to claim a task
1. Create a file: `current_tasks/<task_name>.txt` with your agent ID
2. If git push fails (another agent claimed it), pick a different task
3. When done, remove the lock file and update PROGRESS.md

## Priority 1 — Core (must be done sequentially)

- [x] Project scaffold and build system
- [x] WebGL2 renderer with synthetic data
- [x] Camera system (pan/zoom/drag)
- [ ] .pretext file parser (header + contig metadata)
- [ ] .pretext texture block decompression (deflate + DXT1)
- [ ] Render real .pretext contact map data

## Priority 2 — Curation (can be parallelized)

- [ ] Contig grid overlay rendering
- [ ] Selection system (click to select contig)
- [ ] Cut operation (split contig at position)
- [ ] Invert operation (reverse a contig)
- [ ] Move operation (drag contig to new position)
- [ ] Join operation (merge adjacent contigs)
- [ ] Undo/redo stack
- [ ] Scaffold painting mode

## Priority 3 — I/O (can be parallelized)

- [ ] AGP export
- [ ] Curation log (JSON operation history)
- [ ] PNG screenshot export
- [ ] State save/load

## Priority 4 — Annotation Tracks (can be parallelized)

- [ ] Track renderer base system
- [ ] Coverage track
- [ ] Telomere track (3p, 5p)
- [ ] Gap track
- [ ] Repeat density track
- [ ] Extension data parser from .pretext files

## Priority 5 — UI/UX (can be parallelized)

- [ ] Command palette (Cmd+K)
- [ ] Keyboard shortcut system
- [ ] Scaffold list sidebar
- [ ] Waypoint system
- [ ] Tooltip with contig info on hover
- [ ] Color map picker UI
- [ ] Gamma adjustment control

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
- [ ] Dark/light mode
- [ ] Performance optimization for large genomes
