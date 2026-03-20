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
    DerivedState.ts          Computed state selectors
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
    ContactMapReorder.ts     Contact map pixel reordering for curation updates
  curation/
    CurationEngine.ts        Cut/join/invert/move with full undo data
    SelectionManager.ts      Click/shift/ctrl contig selection
    DragReorder.ts           Visual drag-and-drop reordering
    ScaffoldManager.ts       Scaffold (chromosome) assignment CRUD
    WaypointManager.ts       Named position markers
    ContigExclusion.ts       Set-based contig hide/exclude management
    MisassemblyFlags.ts      Singleton manager for flagged misassembly contigs
    MetaTagManager.ts        Contig classification meta tags (singleton)
    AutoCut.ts               Diagonal signal breakpoint detection
    AutoSort.ts              Union Find link scoring and chaining
    BatchOperations.ts       Batch select/cut/join/invert/sort operations
    QualityMetrics.ts        N50/L50/N90/L90 assembly statistics + tracking
    OrderingMetrics.ts       Shared pure-math ordering metrics (kendallTau, ARI)
  analysis/
    InsulationScore.ts       Insulation score + TAD boundary detection
    ContactDecay.ts          P(s) contact decay curve + exponent fitting
    CompartmentAnalysis.ts   A/B compartment eigenvector (O/E + PCA)
    ICENormalization.ts      ICE (Sinkhorn-Knopp) matrix balancing
    DirectionalityIndex.ts   Directionality index + TAD boundary detection
    HiCQualityMetrics.ts     Library quality (cis/trans, short/long, density)
    SaddlePlot.ts            Saddle plot (compartment strength visualization)
    Virtual4C.ts             Virtual 4C locus contact profiling
    TelomereDetector.ts      Telomere repeat detection from FASTA sequences
    KRNormalization.ts       Knight-Ruiz (KR) matrix balancing
    MisassemblyDetector.ts   TAD/compartment-based chimeric contig detection
    HealthScore.ts           Composite assembly quality score (0–100)
    ScaffoldDetection.ts     Auto-detect chromosome blocks from block-diagonal
    PatternDetector.ts       Inversion + translocation detection algorithms
    CurationProgress.ts      Real-time ordering progress scoring + trends
    AnalysisWorker.ts        Background Web Worker for analysis computation
    AnalysisWorkerClient.ts  Promise-based main-thread worker client
    Evo2HiCClient.ts          HTTP client for Evo2HiC enhancement server
    Evo2HiCEnhancement.ts     Contact map encode/decode/downscale utilities
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
    AnalysisExport.ts        BedGraph/TSV export for all analysis tracks
    SnapshotExporter.ts      PNG screenshot via canvas.toBlob
    CurationLog.ts           JSON operation history export
  io/
    SessionManager.ts        Session save/load (JSON with undo stack + analysis)
  ui/                        38 UI modules (pure DOM, no framework)
    AppContext.ts             Shared context object passed between UI modules
    EventWiring.ts           Event subscriptions + refresh-after-curation logic
    AnalysisPanel.ts         3D analysis sidebar (compute, export, health, patterns)
    Sidebar.ts               Contig list, scaffold panel, sidebar sections
    StatsPanel.ts            Assembly metrics display
    CutReviewPanel.ts        Step-by-step guided cut review
    UndoHistoryPanel.ts      Undo history list with expandable entries
    CommandPalette.ts        Cmd+K fuzzy search command palette
    KeyboardShortcuts.ts     Global keyboard shortcut handler
    ModeManager.ts           Navigate/Edit/Scaffold/Waypoint mode switching
    BatchActions.ts          Batch operation UI (select by pattern/size)
    FileLoading.ts           File open, drag-drop, FASTA/BedGraph loading
    AIAssistPanel.ts         AI curation assistant panel
    AIFeedbackUI.ts          Per-suggestion thumbs up/down UI
    ComparisonMode.ts        Original vs curated boundary overlay
    LessonBrowser.ts         Tutorial lesson browser modal
    WorkflowGuide.ts         7-step recommended workflow modal
    ZoomControls.ts          Zoom +/- buttons and level indicator
    index.ts                 Barrel exports for UI modules
public/data/
  specimen-catalog.json      Curated multi-specimen catalog (10 species)
  lessons/                   Tutorial lesson JSON files (9 lessons)
  pattern-gallery.json       Hi-C pattern reference gallery (11 patterns)
  prompt-strategies.json     AI prompt strategy library (8 strategies)
server/                        Evo2HiC enhancement server (Python/FastAPI, optional)
  evo2hic_server/
    main.py                    FastAPI app (/api/v1/health, /api/v1/enhance)
    inference.py               Model loading (mock or real Evo2HiC weights)
    schemas.py                 Pydantic request/response models
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
  unit/                      2221 unit tests across 82 files (vitest)
    basic.test.ts            Synthetic data, color maps, camera
    curation.test.ts         CurationEngine operations
    scaffold.test.ts         ScaffoldManager
    waypoint.test.ts         WaypointManager
    export.test.ts           AGP writer, curation log
    session.test.ts          Session save/load round-trips (106 tests)
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
    auto-cut.test.ts         AutoCut breakpoint detection
    auto-sort.test.ts        AutoSort Union Find chaining
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
    ice-normalization.test.ts     ICE normalization (32 tests)
    directionality-index.test.ts  Directionality index (26 tests)
    hic-quality-metrics.test.ts   Hi-C quality metrics + health score (18 tests)
    saddle-plot.test.ts           Saddle plot (20 tests)
    virtual-4c.test.ts            Virtual 4C (22 tests)
    meta-tag.test.ts              MetaTagManager CRUD + events (61 tests)
    telomere-detector.test.ts     Telomere repeat detection + track (40 tests)
    kr-normalization.test.ts      KR matrix balancing + track (39 tests)
    misassembly-detector.test.ts  Misassembly detection + confidence scoring (31 tests)
    cut-suggestions.test.ts      Cut suggestion generation + pixel conversion (18 tests)
    health-score.test.ts         Composite health score computation (28 tests)
    analysis-recompute.test.ts   Debounced auto-recompute after curation (8 tests)
    analysis-export.test.ts      BedGraph/TSV analysis data export
    cut-review.test.ts           Cut review panel lifecycle + queue (10 tests)
    scaffold-detection.test.ts   Chromosome block detection algorithm (15 tests)
    curation-progress.test.ts    Progress scoring + trend tracking (11 tests)
    pattern-detector.test.ts     Inversion + translocation detection (14 tests)
    state-select.test.ts         State selectors + derived state
    derived-state.test.ts        Computed state properties
    benchmark-metrics.test.ts    Benchmark metric computations
    benchmark-loader.test.ts     Benchmark data loading
    ui-sidebar.test.ts           Sidebar contig list + sections
    ui-undo-history.test.ts      Undo history panel
    ui-event-wiring.test.ts      Event subscription + refresh logic
    ui-batch-actions.test.ts     Batch operation UI
    ui-click-interactions.test.ts  Click handler routing
    ui-toolbar.test.ts           Toolbar button state
    ui-command-palette.test.ts   Command palette fuzzy search
    ui-export-session.test.ts    Export + session UI
    ui-mouse-tracking.test.ts    Mouse position tracking
    ui-mode-manager.test.ts      Mode switching logic
    ui-script-console.test.ts    Script console UI
    ui-track-config.test.ts      Track configuration UI
    ui-stats-panel.test.ts       Stats panel rendering
    ui-tooltip.test.ts           Tooltip display logic
    ui-curation-actions.test.ts  Curation action handlers
    ui-keyboard-shortcuts.test.ts  Keyboard shortcut bindings
    ui-file-drop.test.ts         File drop zone handling
    ui-comparison-mode.test.ts   Comparison mode overlay
    ui-toast.test.ts             Toast notification system
    ui-loading.test.ts           Loading overlay
    ui-color-map.test.ts         Color map controls
    ui-shortcuts-modal.test.ts   Shortcuts reference modal
    contact-map-reorder.test.ts  Contact map reorder permutation (12 tests)
    evo2hic-client.test.ts       Evo2HiC HTTP client (20 tests)
    evo2hic-enhancement.test.ts  Encode/decode/downscale utilities (30 tests)
  e2e/                       35 E2E tests (Playwright + Chromium)
    curation.spec.ts         Cut/join UI, undo/redo (7 tests)
    edit-mode-ux.spec.ts     Edit mode UX: toast, draggable, selection (4 tests)
    auto-curation.spec.ts    AutoCut + AutoSort E2E
    tile-streaming.spec.ts   Tile LOD with real .pretext file
    features-integration.spec.ts  Stats, exclusion, comparison, batch, tracks
    session-persistence.spec.ts   Analysis save/load round-trip (1 test)
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
6. **Singleton patterns** -- `contigExclusion`, `misassemblyFlags`, `metaTags`,
   and `state` are singletons; batch operations read directly from state
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
- **SpecimenCatalog**: `public/data/specimen-catalog.json` is the single source of
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
- **PatternGallery**: Modal showing 11 Hi-C patterns from
  `public/data/pattern-gallery.json`. Clicking a pattern navigates the camera.
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
- **PromptStrategy**: `public/data/prompt-strategies.json` contains 8 built-in
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
- **ICENormalization**: Sinkhorn-Knopp iterative matrix balancing (Imakaev
  et al. 2012). Computes bias vector and normalized matrix. Input is sanitized
  (NaN/Infinity → 0) before processing. Low-coverage bins masked by quantile
  filtering. Optimized to 2 O(n²) passes per iteration (fused correction +
  row-sum recomputation). Worker-integrated via
  `AnalysisWorkerClient.normalizeICE()`. When ICE completes, compartment
  analysis and P(s) decay are re-run on the normalized matrix. Produces
  "ICE Bias" line track.
- **DirectionalityIndex**: Dixon et al. 2012 signed chi-square statistic.
  Computes per-bin directionality scores with configurable window size.
  Boundary detection at negative-to-positive zero crossings. Worker-integrated
  via `AnalysisWorkerClient.computeDirectionality()`. Produces "Directionality
  Index" (line) and "DI Boundaries" (marker) tracks.
- **HiCQualityMetrics**: Library-level quality assessment. Computes cis/trans
  ratio, short/long range ratio, contact density, and per-contig cis ratios.
  Requires scaffold assignments. Feeds `cisTransRatio` into HealthScore for the
  5th component (libraryQuality). Produces "Per-Contig Cis Ratio" line track.
- **SaddlePlot**: Compartment strength visualization. Digitizes bins by
  eigenvector quantile, computes mean O/E per quantile pair to build saddle
  matrix. Reuses `computeExpectedContacts` and `computeOEMatrix` from
  CompartmentAnalysis. Renders inline SVG heatmap with blue-white-red scale.
  Runs synchronously (no worker needed). Requires compartments to be computed
  first.
- **Virtual4C**: Interactive locus contact profiling. Extracts contact row at a
  viewpoint bin, normalizes by distance-expected, scales to [0,1]. Triggered by
  Alt+click on the contact map via `ClickInteractions.ts`. Produces "Virtual 4C
  (bin X)" line track. Cleared on curation operations or via Clear V4C button.
  Runs synchronously (no worker needed).
- **AnalysisWorkerClient**: Runs analysis computations in a background Web
  Worker (`AnalysisWorker.ts`) via `postMessage`. Falls back to synchronous
  main-thread execution if workers are unavailable. Also handles ICE
  normalization, KR normalization, and directionality index requests.
  Result typed arrays are transferred (zero-copy) from worker to main thread.
- **AnalysisPanel**: Sidebar section "3D Analysis" with compute buttons,
  insulation window size slider, and auto-computation on `file:loaded` via
  `EventWiring`. Buttons are disabled during computation and all three
  core analyses run in parallel in the worker. Also includes 6 additional
  buttons (Directionality, Library Quality, Normalize ICE, Normalize KR,
  Compute Saddle Plot, Clear V4C) with 6 additional result caches
  (including KR and telomere). Includes 8 export buttons (Insulation
  BedGraph, P(s) TSV, Compartments BedGraph, Directionality BedGraph,
  ICE Bias BedGraph, KR Bias BedGraph, Quality TSV, Saddle TSV),
  an inline P(s) decay SVG chart with comparative overlay (baseline vs
  current), a health score card, and debounced auto-recompute of insulation
  + P(s) after curation operations (1s debounce, compartments excluded).
  P(s) decay uses ICE-normalized map when available (`cachedNormalizedMap`)
  and auto-recomputes after ICE normalization completes.
  "Review Cuts" button opens `CutReviewPanel`.
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
- **HealthScore**: Pure `computeHealthScore()` function combining five
  weighted components (contiguity 20%, P(s) decay quality 25%, assembly
  integrity 20%, compartment strength 15%, library quality 20%) into a
  0–100 composite score. Contiguity uses log-scaled N50/totalLength
  (score = (1 + log10(ratio)) * 100, where ratio < 0.1 scores 0).
  Used by both AnalysisPanel (detailed card) and StatsPanel (summary row).
- **Analysis persistence**: Analysis results (insulation, P(s) decay,
  compartments, baseline P(s), ICE, KR, directionality, quality, saddle) are
  serialized in session files via optional `SessionAnalysisData` field.
  `exportAnalysisState()` converts typed arrays to `number[]`;
  `restoreAnalysisState()` reconstructs them and re-registers tracks.
  ICE `normalizedMatrix` is re-derived from bias vector + raw contactMap
  on restore (not persisted). V4C is excluded (viewpoint invalidated by
  reordering). Backward compatible — old sessions without analysis still
  load.
- **MisassemblyDetector**: Detects potential chimeric contigs by finding
  TAD boundaries and compartment eigenvector sign-changes that fall inside
  a contig (not at edges). Uses an edge margin (default 2 overview pixels)
  to avoid false positives at true assembly breaks. Merges nearby TAD +
  compartment signals within a merge radius into higher-confidence `'both'`
  flags. Produces a marker `TrackConfig` for overlay rendering.
- **MetaTagManager**: Singleton manager (mirrors `ContigExclusion` pattern)
  for classifying contigs with meta tags. Types: `haplotig`, `contaminant`,
  `unlocalised`, `sex_chromosome`. Emits `'metatag:updated'` event with
  `{ count }` payload. Sidebar shows colored badges (HAP/CON/UNL/SEX)
  and supports "Color: Meta Tag" metric. Cleared on `file:loaded` via
  EventWiring. `setMany()`/`removeMany()` emit only once for batch ops.
- **TelomereDetector**: Pure algorithm scanning loaded FASTA sequences for
  telomere repeat motifs (TTAGGG/CCCTAA) at contig ends. Computes genome-wide
  density profile and identifies telomere-positive ends exceeding a minimum
  density threshold. Requires `referenceSequences` map from FASTA loading.
  Runs synchronously. Produces "Telomere Repeats" marker track (green,
  `#00e676`). Emits `'telomere:detected'` event.
- **KRNormalization**: Knight-Ruiz iterative matrix balancing (Knight & Ruiz
  2013). Accumulates scaling vector via `x_new = x * sqrt(rowSum)`. Reuses
  `computeRowSums` and `filterLowCoverageBins` from ICENormalization. Tighter
  convergence (epsilon 1e-6, max 200 iterations) than ICE. Worker-integrated
  via `AnalysisWorkerClient.normalizeKR()`. When KR completes, compartments
  and P(s) are re-run on the normalized matrix. Produces "KR Bias" line
  track (coral, `#ff7675`). Session-persisted as `SessionICE` type (bias
  vector only; matrix re-derived on restore).
- **MisassemblyFlags**: Singleton manager (mirrors `ContigExclusion` pattern)
  tracking flagged contig indices. `setFlags()` emits `'misassembly:updated'`
  event for reactive sidebar refresh. Sidebar shows orange "MIS" badges.
  Detection runs automatically after insulation + compartment analysis completes.
  "Suggest Cuts" button converts flags to executable cut operations
  (`buildCutSuggestions` in MisassemblyDetector). Accept/Skip per suggestion,
  or Accept All for batch execution (right-to-left for index stability).
  `scoreCutConfidence()` computes composite confidence (0.5 * TAD + 0.3 *
  compartment + 0.2 * decay) for each suggestion; UI shows colored badges
  (green/yellow/red) sorted by confidence descending.
- **PatternDetector**: `detectInversions()` compares anti-diagonal to diagonal
  signal ratio at large genomic distances within each contig block; threshold
  defaults to 2.0. `detectTranslocations()` computes observed/expected contact
  ratio for non-adjacent contig pairs (skips adjacent). Both run in the
  analysis Web Worker via `AnalysisWorkerClient.detectPatterns()`. Results
  shown as clickable cards in AnalysisPanel with "Go" buttons for camera
  navigation.
- **CurationProgress**: `computeProgress()` calculates Kendall tau and longest
  correct run comparing current contig order to a reference order (captured on
  file load). `computeTrend()` compares current vs previous score. Sidebar
  section shows ordering percentage bar, longest run count, trend arrow
  (green up / red down / grey neutral), and "Set Reference" button.
  Updated after every curation operation via `refreshAfterCuration()`.
- **Evo2HiC Enhancement**: Optional ML-powered contact map resolution
  enhancement via companion FastAPI server. `Evo2HiCClient` sends
  base64-encoded overview contactMap to server, receives enhanced map.
  `downscaleMap()` reduces enhanced output to overview dimensions for
  display. `cachedEnhancedOverview` in AnalysisPanel follows the same
  pattern as `cachedNormalizedMap` — downstream analyses use the enhanced
  map when toggle is active. Cleared on curation operations via
  `clearEnhancedMap()` in EventWiring. Session-persisted as base64
  in `SessionEnhancement`. Server supports real Evo2HiC model weights
  (via EVO2HIC_REPO_PATH + EVO2HIC_CHECKPOINT env vars) or mock
  inference (Gaussian denoise + bicubic upscale) for testing.

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
- Run `npm test` before committing; all 2221 tests must pass
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
- `metaTags` is a singleton -- call `clearAll()` when loading new data.
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
- Track `color` values must use `#hex` format (e.g. `'#ff5050'`), not
  `rgb()`. The color is set on `<input type="color">` elements which only
  accept hex. Using `rgb()` causes console warnings.
