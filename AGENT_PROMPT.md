# OpenPretext — Agent Development Prompt

## What This Project Is

OpenPretext is a modern, web-based replacement for PretextView, the Sanger Institute's Hi-C contact map viewer used for genome assembly curation. The original PretextView is a monolithic C/C++ OpenGL desktop application that requires a 3-button mouse and has a dated UI. OpenPretext brings this to the browser with WebGL, modern UX, scriptable curation, and no special hardware requirements.

## Why It Matters

PretextView is used by hundreds of genome assembly teams worldwide (Darwin Tree of Life, VGP, etc.) to manually curate chromosome-level assemblies. The tool works but is showing its age. A modern web-based replacement would serve thousands of researchers.

## Architecture Overview

```
openpretext/
├── AGENT_PROMPT.md          # You are reading this
├── PROGRESS.md              # Current status — UPDATE THIS EVERY SESSION
├── TASKS.md                 # Task list with locks — CLAIM BEFORE WORKING
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.ts              # Entry point, app initialization
│   ├── core/
│   │   ├── App.ts           # Main application orchestrator
│   │   ├── EventBus.ts      # Inter-module communication
│   │   └── State.ts         # Application state management with undo/redo
│   ├── formats/
│   │   ├── PretextParser.ts # .pretext binary format parser
│   │   ├── CoolParser.ts    # .cool/.mcool format parser (future)
│   │   └── AGPExporter.ts   # AGP format output
│   ├── renderer/
│   │   ├── WebGLRenderer.ts # Core WebGL2 rendering engine
│   │   ├── TileManager.ts   # Multi-resolution tile pyramid
│   │   ├── Shaders.ts       # GLSL shader programs
│   │   ├── ColorMaps.ts     # Hi-C color map implementations
│   │   └── Camera.ts        # Pan/zoom camera with smooth animation
│   ├── curation/
│   │   ├── CurationEngine.ts    # Cut/join/invert/reorder operations
│   │   ├── SelectionManager.ts  # Scaffold/region selection
│   │   └── UndoStack.ts        # Undo/redo with operation history
│   ├── tracks/
│   │   ├── TrackRenderer.ts     # Annotation track overlay system
│   │   ├── CoverageTrack.ts     # Coverage depth track
│   │   ├── TelomereTrack.ts     # Telomere signal track
│   │   └── GapTrack.ts          # Assembly gap track
│   ├── ui/
│   │   ├── Toolbar.ts          # Top toolbar
│   │   ├── CommandPalette.ts   # Cmd+K command palette
│   │   ├── ScaffoldList.ts     # Scaffold sidebar
│   │   ├── StatusBar.ts        # Bottom status bar
│   │   └── Modal.ts            # Dialog system
│   ├── scripting/
│   │   ├── ScriptEngine.ts     # Curation script DSL
│   │   └── ScriptConsole.ts    # Interactive script console
│   └── export/
│       ├── AGPWriter.ts        # AGP file generation
│       ├── SnapshotExporter.ts # PNG screenshot export
│       └── CurationLog.ts     # JSON curation operation log
├── tests/
│   ├── unit/                   # Unit tests (vitest)
│   ├── visual/                 # Visual regression tests (playwright)
│   └── fixtures/               # Test data files
├── scripts/
│   ├── generate-test-data.ts   # Generate synthetic .pretext-like test data
│   └── visual-regression.ts    # Compare screenshots against references
└── public/
    └── test-data/              # Small test .pretext files
```

## Key Technical Decisions

1. **TypeScript + Vite** — Fast dev server, HMR, modern tooling
2. **WebGL2** — Direct GPU rendering, no framework abstraction
3. **No React/Vue** — Pure DOM manipulation for UI, keeps it simple and fast
4. **Canvas-based rendering** — Single WebGL canvas for the contact map, HTML overlay for UI
5. **File format**: Support `.pretext` natively, plan for `.cool`/`.mcool` later

## The .pretext File Format

The .pretext format stores Hi-C contact maps as DXT1-compressed texture blocks:

- **Header**: Magic bytes, version, number of contigs, texture resolution, number of mipmap levels
- **Contig metadata**: Names, lengths, order
- **Texture data**: DXT1-compressed blocks at multiple mipmap levels, deflate-compressed
- **Extensions**: Optional bedgraph data (coverage, telomere, gap, repeat density) embedded after the main texture data

The textures represent the contact matrix where:
- The full genome is mapped onto a square texture
- Each contig occupies a proportional number of pixels
- Mipmap levels provide multi-resolution zoom
- The diagonal shows self-contacts, off-diagonal shows inter-contig contacts

### Reading .pretext files in the browser:
1. Read the file as ArrayBuffer via File API
2. Parse the header to get texture dimensions and contig info
3. Decompress texture blocks using pako (deflate)
4. Decode DXT1 blocks to RGBA pixels
5. Upload to WebGL textures at each mipmap level

## How to Work on This Project

### Starting a session:
1. `git pull` to get latest changes
2. Read `PROGRESS.md` to understand current state
3. Read `TASKS.md` to find unclaimed work
4. Claim a task by creating `current_tasks/your_task_name.txt`
5. Run `npm run dev` to start the dev server
6. Run `npm test` to verify nothing is broken

### Making changes:
1. Write code in small, testable increments
2. Run tests frequently: `npm test`
3. For visual changes, take screenshots with Puppeteer and compare
4. Update `PROGRESS.md` with what you did
5. Commit with descriptive messages
6. Push changes
7. Remove your task lock file

### Testing strategy:
- **Unit tests**: All pure logic (parser, curation operations, color maps)
- **Visual tests**: Screenshot comparison for rendering
- **Integration tests**: Full file load → render → curate → export pipeline
- **The test oracle**: Load same file in original PretextView, screenshot, compare

### Common pitfalls:
- DXT1 decoding: Make sure to handle the two interpolation modes correctly
- Deflate: The pretext format uses raw deflate, not gzip — use pako's `inflateRaw`
- Coordinate systems: WebGL Y is flipped vs screen coords
- Large files: A typical pretext file is 30-50MB — don't load everything into memory at once
- Contig ordering: The internal order may differ from display order after curation

## Design Principles

1. **Keyboard-first**: Every operation should have a keyboard shortcut
2. **No 3-button mouse**: Everything works with a trackpad
3. **Undo everything**: Every operation is reversible
4. **Scriptable**: Every UI operation has a script equivalent
5. **Progressive disclosure**: Simple by default, powerful when needed
6. **Fast**: 60fps pan/zoom on a 3-year-old laptop

## Color Maps

PretextView supports multiple color maps. We should implement at minimum:
- Red-white (default, most common for Hi-C)
- Blue-white-red (diverging)
- Viridis
- Custom user-defined

## Curation Operations

These are the core operations that genome curators perform:
1. **Cut**: Split a contig at a specified position
2. **Join**: Merge two adjacent contigs
3. **Invert**: Reverse-complement a contig/region
4. **Move**: Relocate a contig to a different position
5. **Paint scaffold**: Assign contigs to named scaffolds (chromosomes)
6. **Waypoint**: Mark positions of interest

## Current Priority Order

1. Get a synthetic contact map rendering in WebGL ✓ (if done)
2. Parse real .pretext files
3. Implement pan/zoom camera
4. Basic curation (cut, invert, move)
5. Scaffold painting
6. AGP export
7. Extension tracks (coverage, telomere, gap)
8. Command palette / scripting
9. Visual polish

## Links

- Original PretextView: https://github.com/sanger-tol/PretextView
- PretextMap (creates .pretext files): https://github.com/sanger-tol/PretextMap
- PretextGraph (embeds bedgraph data): https://github.com/sanger-tol/PretextGraph
- DXT1 format: https://en.wikipedia.org/wiki/S3_Texture_Compression#DXT1
- AGP format: https://www.ncbi.nlm.nih.gov/assembly/agp/AGP_Specification/
