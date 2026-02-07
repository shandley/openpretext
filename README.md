# OpenPretext

A modern, web-based Hi-C contact map viewer and genome assembly curation tool.

**[Try it now at shandley.github.io/openpretext](https://shandley.github.io/openpretext/)** — no installation required. Click **Load Example** to explore a real koala genome assembly.

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
- Comparison mode overlay (original vs curated assembly boundaries)

**Curation**
- Cut, join, invert, and move contigs with full undo/redo
- Drag-and-drop contig reordering
- Scaffold painting mode for chromosome assignment
- Waypoint markers for positions of interest
- Selection system (click, shift-range, ctrl-toggle)
- Contig exclusion (mark contigs to exclude from export)
- Batch operations (select by pattern/size, batch cut/join/invert, sort by length)

**Automated Curation Algorithms**
- **Auto Sort (Union Find)** — Scores all contig pairs using Hi-C inter-contig
  link analysis across 4 orientations, then chains contigs into chromosome groups
  using a greedy Union Find algorithm. Automatically applies inversions and
  reordering via the command palette.
- **Auto Cut (Breakpoint Detection)** — Analyzes diagonal Hi-C signal density to
  detect misassembly breakpoints where the contact signal drops, automatically
  splitting contigs at discontinuities.

**Annotation Tracks**
- Coverage, telomere, gap, and GC content tracks
- Line, heatmap, and marker rendering modes
- Reads embedded graph extensions from `.pretext` files
- BedGraph track upload with per-track configuration (color, type, visibility)

**I/O**
- AGP 2.1 export
- BED6 export (scaffold-aware)
- FASTA export (with reverse complement for inverted contigs)
- PNG screenshot export
- Session save/load (JSON)
- Curation log with full operation history

**Assembly Quality Metrics**
- N50/L50, N90/L90, contig count, total length
- Live stats panel in the sidebar with delta tracking
- Automatic metric snapshots after each curation operation

**Scripting**
- 18-command curation DSL
- Script console with syntax highlighting
- Replay curation sessions from operation logs
- All UI operations have script equivalents

**UI/UX**
- Command palette (Cmd+K / Ctrl+K)
- Keyboard shortcuts for all operations
- Responsive layout with mobile/tablet breakpoints
- Touch and trackpad gesture support (pinch-zoom, pan)
- Sidebar with searchable contig list, scaffold assignments, stats panel, and track config
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
- Click **Load Example — Koala genome** to download and explore a real pre-curation assembly (109 MB)
- Click **Open** to load a `.pretext` file from your computer
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
| `C` | Cut contig at cursor (edit mode) |
| `J` | Join selected contigs (edit mode) / Jump to diagonal |
| `F` | Flip/invert selected (edit mode) |
| `H` | Toggle contig exclusion (edit mode) |
| `P` | Toggle comparison mode |
| `L` | Toggle contig grid |
| `I` | Toggle info sidebar |
| `X` | Toggle annotation tracks |
| `M` | Toggle minimap |
| `?` | Keyboard shortcuts reference |
| `Cmd+K` | Command palette |
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |
| `Cmd+O` | Open file |
| `Cmd+S` | Screenshot |
| `Cmd+A` | Select all contigs (edit mode) |
| `Up/Down` | Cycle color maps |
| `Left/Right` | Adjust gamma |
| `Home` | Reset view |

## Curation Workflow

### Manual Curation
1. Load a `.pretext` file
2. Press `E` to enter edit mode
3. Select contigs by clicking (shift-click for range, ctrl-click to toggle)
4. Use cut (`C`), join (`J`), invert (`F`), and drag to reorder the assembly
5. Press `H` to exclude contigs from export
6. Press `S` to enter scaffold mode and paint contigs into chromosomes
7. Export the curated assembly as AGP, BED, or FASTA via the toolbar
8. Toggle comparison mode (`P`) to see original vs curated boundaries

### Automated Curation
Open the command palette (`Cmd+K`) and run:
- **Auto cut: detect breakpoints** — Scans all contigs for misassembly
  breakpoints by analyzing the diagonal Hi-C signal. Contigs are split wherever
  the signal drops significantly. Each cut is a separate undo step.
- **Auto sort: Union Find** — Scores every contig pair across 4 orientations
  (head-head, head-tail, tail-head, tail-tail), then greedily chains contigs
  into chromosome groups. The algorithm applies inversions where needed and
  reorders the assembly. Each operation is individually undoable.

A typical automated workflow: run Auto Cut first to break misassemblies, then
Auto Sort to group and orient the fragments into chromosomes.

All operations support undo (`Cmd+Z`) and redo (`Cmd+Shift+Z`).

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
- **`.bedgraph`** -- annotation tracks loaded via the **Load Track** button
- **`.fasta`** -- reference sequences loaded via **Load FASTA** for curated export

For technical details on the binary format, see
[docs/PRETEXT_FORMAT.md](docs/PRETEXT_FORMAT.md).

## Development

```bash
npm run dev        # Start development server with hot reload
npm test           # Run the test suite (1,395 tests)
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
    FASTAParser.ts           FASTA sequence parser
    BedGraphParser.ts        BedGraph annotation track parser
  renderer/
    WebGLRenderer.ts         WebGL2 contact map renderer
    Camera.ts                Pan/zoom camera with touch gestures
    TileManager.ts           Tile-based LOD with LRU cache
    TileDecoder.ts           Background tile decompression
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
    ContigExclusion.ts       Contig hide/exclude management
    BatchOperations.ts       Batch select/cut/join/invert/sort
    QualityMetrics.ts        N50/L50/N90/L90 assembly statistics
    AutoCut.ts               Diagonal signal breakpoint detection
    AutoSort.ts              Union Find link scoring and chaining
  scripting/
    ScriptParser.ts          Curation DSL tokenizer and parser
    ScriptExecutor.ts        Script execution engine
    ScriptReplay.ts          Operation log to DSL converter
  export/
    AGPWriter.ts             AGP 2.1 format export
    BEDWriter.ts             BED6 format export
    FASTAWriter.ts           FASTA format export (with reverse complement)
    SnapshotExporter.ts      PNG screenshot export
    CurationLog.ts           JSON operation history
  io/
    SessionManager.ts        Session save/load (JSON persistence)
tests/
  unit/                      1,395 unit tests across 45 test files
  e2e/                       E2E tests (Playwright + Chromium)
```

### Technology

- **TypeScript** with strict mode
- **Vite** for development and builds
- **WebGL2** for GPU-accelerated rendering (no framework)
- **pako** for deflate decompression
- **Vitest** for unit testing
- **Playwright** for E2E testing
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
