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
    FASTAParser.ts           FASTA sequence parser
    BedGraphParser.ts        BedGraph annotation track parser
  renderer/
    WebGLRenderer.ts         WebGL2 contact map quad with color map shader
    Camera.ts                Pan/zoom camera with mouse/touch/trackpad
    TileManager.ts           Tile-based LOD rendering with LRU cache
    TileDecoder.ts           Background tile decompression worker
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
    ContigExclusion.ts       Set-based contig hide/exclude management
    MisassemblyFlags.ts      Singleton manager for flagged misassembly contigs
    BatchOperations.ts       Batch select/cut/join/invert/sort operations
    QualityMetrics.ts        N50/L50/N90/L90 assembly statistics + tracking
    OrderingMetrics.ts       Shared pure-math ordering metrics (kendallTau, ARI)
  analysis/
    InsulationScore.ts       Insulation score + TAD boundary detection
    ContactDecay.ts          P(s) contact decay curve + exponent fitting
    CompartmentAnalysis.ts   A/B compartment eigenvector (O/E + PCA)
    MisassemblyDetector.ts   TAD/compartment-based chimeric contig detection
    HealthScore.ts           Composite assembly quality score (0–100)
    ScaffoldDetection.ts     Auto-detect chromosome blocks from block-diagonal
    AnalysisWorker.ts        Background Web Worker for analysis computation
    AnalysisWorkerClient.ts  Promise-based main-thread worker client
  ai/
    AIClient.ts              Anthropic Messages API wrapper (vision)
    AIContext.ts             Assembly state context builder for AI prompts
    AIPrompts.ts             System prompt with DSL reference + Hi-C guide
    AIFeedback.ts            Per-suggestion feedback storage + aggregation
    AIStrategyIO.ts          Strategy export/import with example validation
  data/
    SpecimenCatalog.ts       Types + loader for specimen-catalog.json
    LessonSchema.ts          Types + loader for tutorial lesson JSON files
    PromptStrategy.ts        Types + loader + custom strategy CRUD (localStorage)
  scripting/
    ScriptParser.ts          Tokenizer + parser for 18-command DSL
    ScriptExecutor.ts        Executes parsed AST via ScriptContext DI
    ScriptReplay.ts          Converts operation logs to DSL scripts
  export/
    AGPWriter.ts             AGP 2.1 format generation
    BEDWriter.ts             BED6 format export (scaffold-aware)
    FASTAWriter.ts           FASTA export with reverse complement
    AnalysisExport.ts        BedGraph/TSV export for analysis tracks
    SnapshotExporter.ts      PNG screenshot via canvas.toBlob
    CurationLog.ts           JSON operation history export
  io/
    SessionManager.ts        Session save/load (JSON with undo stack + analysis)
data/
  specimen-catalog.json      Curated multi-specimen catalog (10 species)
  lessons/                   Tutorial lesson JSON files (6 lessons)
  pattern-gallery.json       Hi-C pattern reference gallery (8 patterns)
  prompt-strategies.json     AI prompt strategy library (5 strategies)
bench/
  cli.ts                     Benchmark CLI (run/sweep/report/regression)
  runner.ts                  Benchmark pipeline orchestrator
  regression.ts              Regression benchmark runner against baselines
  baselines.json             Regression thresholds for CI
  metrics/
    autosort-metrics.ts      Sort metrics (re-exports from OrderingMetrics)
    autocut-metrics.ts       Breakpoint precision/recall/F1
    chromosome-metrics.ts    Per-chromosome completeness
    summary.ts               Aggregate statistics
  acquire/                   GenomeArk specimen download tools
tests/
  unit/                      1800 unit tests (vitest)
    basic.test.ts            Synthetic data, color maps, camera
    curation.test.ts         CurationEngine operations
    scaffold.test.ts         ScaffoldManager
    waypoint.test.ts         WaypointManager
    export.test.ts           AGP writer, curation log
    session.test.ts          Session save/load round-trips
    scripting.test.ts        Script parser + executor (110 tests)
    replay.test.ts           Script replay from logs
    tiles.test.ts            TileManager, frustum culling, LRU
    tile-decoder.test.ts     Tile decoder BC4 decompression
    tile-decoder-integration.test.ts  Decoder fidelity vs parser
    tracks.test.ts           TrackRenderer
    bed-export.test.ts       BED6 export
    fasta.test.ts            FASTA parser + writer
    bedgraph.test.ts         BedGraph parser + track conversion
    quality-metrics.test.ts  N50/L50 computation + MetricsTracker
    contig-exclusion.test.ts ContigExclusion manager
    batch-operations.test.ts Batch select/cut/join/invert/sort
    feature-integration.test.ts  Cross-module integration tests
    specimen-catalog.test.ts Catalog loading, validation (15 tests)
    ordering-metrics.test.ts kendallTau, ARI, longestCorrectRun (22 tests)
    tutorial-manager.test.ts Lesson schema, step navigation (10 tests)
    ai-client.test.ts        AIClient fetch, errors (7 tests)
    ai-context.test.ts       Context building, formatting (13 tests)
    ai-prompts.test.ts       System prompt, DSL coverage (13 tests)
    ai-panel.test.ts         Response parsing, code extraction (7 tests)
    prompt-strategy.test.ts  Strategy data validation, lookup (14 tests)
    custom-strategy.test.ts  Custom strategy CRUD, merge, localStorage (19 tests)
    ai-strategy-io.test.ts   Export/import JSON, validation, conflict resolution (26 tests)
    ai-feedback.test.ts      Feedback storage, aggregation, clear (16 tests)
    insulation-score.test.ts Insulation score + TAD boundaries (32 tests)
    contact-decay.test.ts    P(s) decay curve + exponent fitting (15 tests)
    per-chromosome-decay.test.ts  Per-scaffold P(s) computation + session persistence (16 tests)
    compartment-analysis.test.ts  A/B compartment eigenvector pipeline (31 tests)
    misassembly-detector.test.ts  Misassembly detection + flag manager (24 tests)
    cut-suggestions.test.ts      Cut suggestion generation + pixel conversion (18 tests)
    health-score.test.ts         Composite health score computation (26 tests)
    analysis-recompute.test.ts   Debounced auto-recompute after curation (8 tests)
    cut-review.test.ts           Cut review panel lifecycle + queue (10 tests)
    scaffold-detection.test.ts   Chromosome block detection algorithm (15 tests)
  e2e/                       34 E2E tests (Playwright + Chromium)
    curation.spec.ts         Cut/join UI, undo/redo (7 tests)
    edit-mode-ux.spec.ts     Edit mode UX: toast, draggable, selection (4 tests)
    tile-streaming.spec.ts   Tile LOD with real .pretext file
    features-integration.spec.ts  Stats, exclusion, comparison, batch, tracks
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
6. **Singleton patterns** -- `contigExclusion`, `misassemblyFlags`, and `state`
   are singletons; batch operations read directly from state
7. **Web Worker for analysis** -- 3D genomics computations (insulation,
   compartments) run in a background worker to avoid blocking the UI;
   `AnalysisWorkerClient` provides a Promise-based API with automatic
   fallback to synchronous execution

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

## Module Integration Points

- **ContigExclusion**: `contigExclusion.getIncludedOrder(contigOrder)` filters
  the order array for export pipelines. UI shows EXC badges in sidebar.
- **BatchOperations**: All functions read from `state.get()` directly and call
  `CurationEngine` methods. They return `BatchResult` with operation counts.
  `scaffoldAwareAutoSort(scaffoldManager, params?)` sorts contigs within each
  scaffold independently using `autoSortCore()` (bypasses the 60-contig guard).
  Falls back to global `autoSortContigs()` when < 2 scaffolds exist.
- **QualityMetrics**: `MetricsTracker.snapshot()` is called in
  `refreshAfterCuration()` and on `file:loaded`. Stats panel reads `getSummary()`.
- **BedGraphParser**: `bedGraphToTrack()` converts parsed data to `TrackConfig`
  using contig pixel spans for coordinate mapping.
- **BEDWriter/FASTAWriter**: Use `AppState` directly; FASTA needs a
  `Map<string, string>` of reference sequences loaded separately.
- **SpecimenCatalog**: `data/specimen-catalog.json` is the single source of
  truth for both benchmark and education systems. `loadSpecimenCatalog()`
  fetches and caches it. `getTutorialSpecimens()` filters to app-loadable ones.
- **TutorialManager**: State machine managing lesson lifecycle. Subscribes to
  EventBus events to detect user actions and auto-advance steps.
  `AppContext.tutorialManager` is set during init in `main.ts`.
- **OrderingMetrics**: Pure-math functions (`kendallTau`, `adjustedRandIndex`,
  `longestCorrectRun`) shared between browser (self-assessment) and bench
  (regression tests). No DOM or Node dependencies.
- **AssessmentPanel**: Triggered by TutorialManager when a lesson has
  `assessment` data. Computes kendallTau and shows score card.
- **PatternGallery**: Modal showing 8 Hi-C patterns from
  `data/pattern-gallery.json`. Clicking a pattern navigates the camera.
- **Benchmark regression**: `bench/cli.ts regression` downloads 2 small
  specimens and validates metrics against `bench/baselines.json`.
- **AIAssistPanel**: Single-shot AI curation assistant. Captures contact map
  screenshot via `SnapshotExporter`, builds context from `AppState` +
  `MetricsTracker`, sends to Anthropic Messages API, renders DSL suggestions
  with executable "Run" buttons using `ScriptParser` + `ScriptExecutor`.
  Strategy dropdown selects from built-in + custom strategies. Includes
  strategy editor (create/edit/delete), export/import buttons, Browse link
  to the community strategy repository (`shandley/openpretext-strategies`),
  and per-suggestion feedback (thumbs up/down via `AIFeedbackUI`).
- **PromptStrategy**: `data/prompt-strategies.json` contains 5 built-in
  strategies. Custom strategies stored in localStorage key
  `openpretext-custom-strategies`. `mergeStrategies()` combines built-in
  and custom. `buildSystemPrompt(strategy)` appends supplement to base prompt.
- **AIStrategyIO**: JSON export/import for sharing strategies between users.
  `exportStrategyAsJSON()` triggers browser download. `parseImportedStrategies()`
  validates and imports JSON, prefixing conflicting built-in IDs.
  `filterValidExamples()` silently drops malformed example objects during import.
- **AIFeedback**: Per-suggestion feedback stored in localStorage key
  `openpretext-ai-feedback`. Tracks strategy ID, rating (up/down), and
  whether the command was executed. `getStrategyRatingSummary()` returns
  aggregate up/down/total counts shown in the strategy description.
- **3D Analysis (InsulationScore, ContactDecay, CompartmentAnalysis)**:
  Pure algorithm modules in `src/analysis/` that operate on the overview
  `contactMap` (Float32Array, row-major, symmetric). Insulation score uses
  a sliding off-diagonal window (Crane et al. 2015) and detects TAD boundaries
  as prominent local minima. Contact decay reuses `computeIntraDiagonalProfile`
  from AutoSort and fits a power-law exponent in log-log space.
  `computeDecayByScaffold()` computes per-chromosome P(s) curves by filtering
  contig ranges per scaffold. Compartment analysis computes O/E → correlation →
  first eigenvector via power iteration. All three produce `TrackConfig`
  objects registered with `TrackRenderer`.
- **AnalysisWorkerClient**: Runs analysis computations in a background Web
  Worker (`AnalysisWorker.ts`) via `postMessage`. Falls back to synchronous
  main-thread execution if workers are unavailable. Result typed arrays are
  transferred (zero-copy) from worker to main thread.
- **AnalysisPanel**: Sidebar section "3D Analysis" with compute buttons,
  insulation window size slider, and auto-computation on `file:loaded` via
  `EventWiring`. Buttons are disabled during computation and all three
  analyses run in parallel in the worker. Includes BedGraph/TSV export
  buttons, an inline P(s) decay SVG chart with comparative overlay
  (baseline vs current), a health score card, and debounced auto-recompute
  of insulation + P(s) after curation operations (1s debounce, compartments
  excluded). "Review Cuts" button opens `CutReviewPanel`.
- **CutReviewPanel**: Step-by-step guided review of misassembly-based cut
  suggestions. Floating bottom-center panel presents one suggestion at a
  time, navigates camera to the cut point, and lets the user accept (Y),
  skip (N), or go back (B). Queue rebuilds from fresh detection after each
  accepted cut. Capture-phase keyboard handler overrides global shortcuts.
- **ScaffoldDetection**: `detectChromosomeBlocks()` auto-detects chromosome
  boundaries from the block-diagonal structure of the contact map. Computes
  mean inter-contig contact for each adjacent pair, normalizes scores, and
  finds boundaries where contact drops below an adaptive threshold
  (median * 0.3). `autoAssignScaffolds()` in Sidebar.ts creates scaffolds
  via ScaffoldManager, naming them Chr1-ChrN by size (largest first).
  Buttons in both Sidebar (when no scaffolds) and AnalysisPanel (after P(s)).
- **HealthScore**: Pure `computeHealthScore()` function combining four
  equally-weighted components (contiguity, P(s) decay quality, assembly
  integrity, compartment strength) into a 0–100 composite score. Used by
  both AnalysisPanel (detailed card) and StatsPanel (summary row).
- **Analysis persistence**: Analysis results (insulation, P(s) decay,
  compartments, baseline P(s)) are serialized in session files via optional
  `SessionAnalysisData` field. `exportAnalysisState()` converts typed arrays
  to `number[]`; `restoreAnalysisState()` reconstructs them and re-registers
  tracks. Backward compatible — old sessions without analysis still load.
- **MisassemblyDetector**: Detects potential chimeric contigs by finding
  TAD boundaries and compartment eigenvector sign-changes that fall inside
  a contig (not at edges). Uses an edge margin (default 2 overview pixels)
  to avoid false positives at true assembly breaks. Merges nearby TAD +
  compartment signals within a merge radius into higher-confidence `'both'`
  flags. Produces a marker `TrackConfig` for overlay rendering.
- **MisassemblyFlags**: Singleton manager (mirrors `ContigExclusion` pattern)
  tracking flagged contig indices. `setFlags()` emits `'misassembly:updated'`
  event for reactive sidebar refresh. Sidebar shows orange "MIS" badges.
  Detection runs automatically after insulation + compartment analysis completes.
  "Suggest Cuts" button converts flags to executable cut operations
  (`buildCutSuggestions` in MisassemblyDetector). Accept/Skip per suggestion,
  or Accept All for batch execution (right-to-left for index stability).

## Companion Repository

The community strategy repository lives at `shandley/openpretext-strategies`.
It contains individual strategy JSON files that users can download and import
via the AI panel's Import button. The app links to it via the Browse button
in `.ai-io-actions` (`index.html`). The strategies repo has its own CI
(`scripts/validate.mjs`) that validates JSON format, required fields, example
structure, filename conventions, and ID uniqueness on every PR.

## Conventions

- All source in `src/`, tests in `tests/unit/`, E2E tests in `tests/e2e/`
- No comments on obvious code; comments only where logic is non-obvious
- Exported functions use JSDoc for public API; internal functions do not
- Test files mirror source structure: `curation.test.ts` tests
  `CurationEngine.ts`
- Run `npm test` before committing; all 1747 tests must pass
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
- `contigExclusion` is a singleton -- call `clearAll()` when loading new data.
- `misassemblyFlags` is a singleton -- call `clearAll()` when loading new data
  or clearing analysis tracks.
- Batch operations process indices right-to-left to maintain index stability
  during cuts and joins.
- Analysis modules operate on the overview `contactMap`, not full-resolution
  tiles. For demo data (1024x1024) this is fine; for real .pretext files the
  overview can be as small as 64x64. Use `Math.round(Math.sqrt(contactMap.length))`
  for the overview dimension.
- The analysis Web Worker uses `postMessage` structured cloning to send the
  contactMap (don't transfer it — main thread still needs it). Result arrays
  ARE transferred (zero-copy) back from the worker.
- `AnalysisWorkerClient` falls back to synchronous execution when workers
  are unavailable (test environments, file:// protocol). Tests exercise the
  pure algorithm modules directly, not through the worker.
