# OpenPretext

A modern, web-based Hi-C contact map viewer and genome assembly curation tool.

OpenPretext is designed as a browser-based alternative to
[PretextView](https://github.com/sanger-tol/PretextView), the Wellcome Sanger
Institute's desktop application used by genome assembly teams worldwide
(Darwin Tree of Life, Vertebrate Genomes Project, Earth BioGenome Project).
It reads native `.pretext` files directly in the browser with no installation
required.

## Features

**Rendering**
- WebGL2-accelerated contact map display at 60fps
- Six color maps (Red-White, Blue-White-Red, Viridis, Hot, Cool, Grayscale)
- Adjustable gamma correction
- Contig grid overlay with anti-aliased lines
- Contig labels along map edges
- Minimap overview with click-to-navigate

**Curation**
- Cut, join, invert, and move contigs with full undo/redo
- Drag-and-drop contig reordering
- Scaffold painting mode for chromosome assignment
- Waypoint markers for positions of interest
- Selection system (click, shift-range, ctrl-toggle)

**Annotation Tracks**
- Coverage, telomere, gap, and GC content tracks
- Line, heatmap, and marker rendering modes
- Reads embedded graph extensions from `.pretext` files

**I/O**
- AGP 2.1 export
- PNG screenshot export
- Session save/load (JSON)
- Curation log with full operation history

**Scripting**
- 18-command curation DSL
- Script console with syntax highlighting
- Replay curation sessions from operation logs
- All UI operations have script equivalents

**UI/UX**
- Command palette (Cmd+K / Ctrl+K)
- Keyboard shortcuts for all operations
- Responsive layout with mobile breakpoints
- Touch and trackpad gesture support (pinch-zoom, pan)
- Sidebar with searchable contig list and scaffold assignments
- Toast notifications and detailed tooltips

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later

### Install and Run

```bash
git clone https://github.com/shandley/openpretext.git
cd openpretext
npm install
npm run dev
```

Open http://localhost:5173 in a browser, then either:
- Click **Open** to load a `.pretext` file from your computer
- Click **Load Demo Data** to explore the interface with synthetic data
- Drag and drop a `.pretext` file onto the window

### Obtaining Test Data

Real `.pretext` files are available from the
[GenomeArk](https://www.genomeark.org/) public S3 bucket. For example, to
download a zebra finch contact map (~56 MB):

```bash
aws s3 cp \
  s3://genomeark/species/Taeniopygia_guttata/bTaeGut2/assembly_curated/evaluation/pretext/bTaeGut2.mat.pretext \
  . --no-sign-request
```

The `--no-sign-request` flag allows access without AWS credentials.

## Keyboard Shortcuts

Press `?` at any time to open the shortcuts reference.

| Key | Action |
|-----|--------|
| `E` | Edit mode (cut/join/invert/move) |
| `S` | Scaffold painting mode |
| `W` | Waypoint mode |
| `Esc` | Return to navigate mode |
| `L` | Toggle contig grid |
| `I` | Toggle info sidebar |
| `X` | Toggle annotation tracks |
| `M` | Toggle minimap |
| `J` | Jump to diagonal |
| `?` | Keyboard shortcuts reference |
| `Cmd+K` | Command palette |
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |
| `Cmd+O` | Open file |
| `Cmd+S` | Screenshot |
| `Up/Down` | Cycle color maps |
| `Left/Right` | Adjust gamma |
| `Home` | Reset view |
| `Delete` | Cut selected contig (edit mode) |
| `F` | Flip/invert selected (edit mode) |

## Curation Workflow

1. Load a `.pretext` file
2. Press `E` to enter edit mode
3. Select contigs by clicking (shift-click for range, ctrl-click to toggle)
4. Use cut, join, invert, and move to correct the assembly
5. Press `S` to enter scaffold mode and paint contigs into chromosomes
6. Export the curated assembly as AGP via **Export AGP**

All operations support undo (Cmd+Z) and redo (Cmd+Shift+Z).

## Scripting

Open the script console with the backtick key or the **Console** button.
Commands can be typed directly or generated from the curation log using the
**From Log** button. Run scripts with Ctrl+Enter.

Example script:

```
# Invert a misoriented contig
invert chr3

# Move a contig to a new position
move #5 to 0

# Cut a contig at a pixel offset
cut chr1 500

# Join two adjacent contigs
join chr1_L chr1_R

# Assign contigs to a scaffold
scaffold paint #0 Chromosome_1
scaffold paint #1 Chromosome_1

# Select and deselect
select chr2
deselect all
```

See the full DSL reference by typing `help` in the script console.

## File Format Support

- **`.pretext`** -- native BC4-compressed contact maps produced by
  [PretextMap](https://github.com/sanger-tol/PretextMap), including embedded
  graph extensions from
  [PretextGraph](https://github.com/sanger-tol/PretextGraph)

For technical details on the binary format, see
[docs/PRETEXT_FORMAT.md](docs/PRETEXT_FORMAT.md).

## Development

```bash
npm run dev        # Start development server with hot reload
npm test           # Run the test suite (503 tests)
npm run build      # Production build to dist/
npm run preview    # Preview the production build
```

### Project Structure

```
src/
  main.ts                    Application entry point and orchestrator
  core/
    State.ts                 Application state with undo/redo
    EventBus.ts              Inter-module event system
  formats/
    PretextParser.ts         .pretext binary format parser (BC4/deflate)
    SyntheticData.ts         Demo contact map generator
    SyntheticTracks.ts       Demo annotation track generator
  renderer/
    WebGLRenderer.ts         WebGL2 contact map renderer
    Camera.ts                Pan/zoom camera with touch gestures
    TileManager.ts           Tile-based LOD with LRU cache
    ColorMaps.ts             Color map implementations
    LabelRenderer.ts         Contig label overlay
    Minimap.ts               Overview minimap
    TrackRenderer.ts         Annotation track renderer
    ScaffoldOverlay.ts       Scaffold color overlay
    WaypointOverlay.ts       Waypoint marker overlay
  curation/
    CurationEngine.ts        Cut/join/invert/move with undo/redo
    SelectionManager.ts      Contig selection (click/shift/ctrl)
    DragReorder.ts           Visual drag reordering
    ScaffoldManager.ts       Scaffold (chromosome) assignments
    WaypointManager.ts       Waypoint markers
  scripting/
    ScriptParser.ts          Curation DSL tokenizer and parser
    ScriptExecutor.ts        Script execution engine
    ScriptReplay.ts          Operation log to DSL converter
  export/
    AGPWriter.ts             AGP 2.1 format export
    SnapshotExporter.ts      PNG screenshot export
    CurationLog.ts           JSON operation history
  io/
    SessionManager.ts        Session save/load (JSON persistence)
tests/
  unit/                      503 unit tests across 10 test files
```

### Technology

- **TypeScript** with strict mode
- **Vite** for development and builds
- **WebGL2** for GPU-accelerated rendering (no framework)
- **pako** for deflate decompression
- **Vitest** for unit testing
- Pure DOM manipulation for UI (no React/Vue/Angular)

## Background

PretextView is an essential tool in genome assembly curation, used to
visualize Hi-C contact maps and manually arrange contigs into chromosomes.
It is developed by the Wellcome Sanger Institute as part of the Pretext
suite:

- [PretextMap](https://github.com/sanger-tol/PretextMap) -- converts
  aligned Hi-C reads into `.pretext` contact maps
- [PretextView](https://github.com/sanger-tol/PretextView) -- desktop
  viewer for manual curation
- [PretextGraph](https://github.com/sanger-tol/PretextGraph) -- embeds
  bedgraph annotation tracks into `.pretext` files
- [PretextSnapshot](https://github.com/sanger-tol/PretextSnapshot) --
  command-line screenshot tool

OpenPretext aims to provide a browser-based alternative that works on any
platform, requires no installation, supports trackpad input, and offers
scriptable curation workflows.

## License

[MIT](LICENSE)

## Acknowledgments

- The [Pretext suite](https://github.com/sanger-tol) by the Wellcome Sanger
  Institute Tree of Life programme
- [GenomeArk](https://www.genomeark.org/) and the Vertebrate Genomes Project
  for public genome assembly data
- The Darwin Tree of Life, Earth BioGenome Project, and genome curation
  communities
