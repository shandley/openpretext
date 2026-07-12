# Changelog

All notable changes to OpenPretext are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Curator overlay tracks from the `.pretext` file.** Coverage, gaps, telomeres,
  and repeat-density tracks embedded as graph extensions are now surfaced as map
  overlays, with fallbacks that compute gaps and telomeres from a loaded FASTA.
- **Join support.** Every contig junction is scored by whether Hi-C contact
  carries across the boundary; unsupported junctions are flagged as weak joins
  with a marker and Next/Previous navigation. The check is scaffold-aware, so an
  intended chromosome boundary between two assigned scaffolds is left alone.
- **Haplotig detector.** Retained haplotigs are flagged from the bright duplicate
  block they leave against their homologous primary. A candidate is reported as a
  confirmed haplotig only when read coverage near half the assembly median agrees;
  without a coverage track it stays an unconfirmed candidate. Confirmed candidates
  can be tagged in one step.
- **Before/after map.** A side-by-side view of the overview as loaded next to the
  same overview reordered by the current curation, both drawn from the one
  underlying matrix so it shows how the edits rearranged the diagonal.
- **Observed/expected (O/E) view toggle.** Divides each overview cell by the
  genome-wide mean contact at its separation, flattening the distance-decay so
  long-range structure stands out. The transform applies to the coarse overview
  only; detail tiles carry no genome-wide expectation and stay raw at high zoom.
- **auN and scaffold-level contiguity stats.** The stats panel adds contig auN,
  scaffold N50 and auN, largest scaffold, and the fraction assigned to scaffolds,
  shown against the EBP `6.C.Q40` reference thresholds for contiguity and
  chromosome assignment. Base accuracy (QV) is reported as not assessed, since a
  Hi-C map carries no read-level data. Scaffold-level metrics refresh live as
  contigs are grouped into chromosomes.
- **AGP import.** Reads a prior curation and applies its contig order, orientation,
  and scaffold grouping onto the loaded assembly, matching contigs by name and
  leaving any not named in the file at the tail.

### Changed
- **A/B compartments are oriented by GC content.** The eigenvector sign is
  arbitrary, so when a reference FASTA is loaded the gene-rich, GC-rich side is
  labeled A. Without a FASTA the split is still computed but the labels are
  reported as unoriented rather than guessed.
- **The P(s) decay chart shows the curve, reference slopes, and a local-slope
  panel.** The chart now draws the P(s) curve as a connected line (genome-wide and
  per scaffold), decade gridlines, reference-slope guides at -1.0 and -1.5, and a
  companion panel plotting the windowed log-derivative of the curve against
  distance, which exposes a short-range plateau or long-range roll-off that the
  single global exponent hides.
- **Field guide.** Added a "Reading the analysis" page with readout explainers and
  interactive demos, and cards for the curator tracks, join support, and the
  haplotig detector.

### Fixed
- **Insulation and Directionality Index are now contig-aware.** Both slid their
  windows without knowing contig boundaries, so at every contig junction the
  window averaged across into the neighboring contig and manufactured a false
  TAD/DI boundary — noise that scaled with assembly fragmentation. Given contig
  ranges (now passed from the analysis panel through the worker), a position must
  have a full window within its own contig; near-edge positions have no valid
  measurement and are marked NaN, excluded from normalization and boundary
  detection, and rendered neutral in the tracks. Contigs shorter than twice the
  window are entirely not-measurable, which is correct. This changes the
  insulation/DI/TAD outputs near junctions (the insulation BedGraph and TAD BED
  exports will differ and should be regenerated).
- **Medium-severity analysis-audit findings.** Follow-up to the four high-severity
  fixes (see `docs/analysis-audit-2026-07-06.md`):
  - CheckerboardScore: corrected the inverted docstring to match the
    implementation (higher entropy -> higher score, no inversion) and flagged the
    score-direction question for review; standardized the Che et al. 2025
    citation; an all-zero row now yields a skippable NaN rather than a fixed 1.0
    "no data" distance that biased the entropy; the per-chromosome sample floor
    is now the parameter `minSamplesPerChromosome` (default 10, unchanged) and the
    `minSamples` doc clarified to govern the whole-genome fallback.
  - HealthScore: integrity scores a neutral 50 when misassembly detection has not
    run (was a perfect 100), and all component scorers guard with
    `Number.isFinite` so a NaN input can't poison the overall score.
  - SaddlePlot: reports `underpopulated` when a corner has too few populated cells
    (e.g. a bimodal eigenvector), so strength reads as indeterminate instead of a
    silent 0.
  - Virtual4C: under log transform, empty bins are floored to the smallest
    positive log so a no-contact bin no longer ranks above a genuinely depleted one.
  - MisassemblyDetector: cut-confidence now scores each suggestion at its own
    overview pixel (was the shared contig midpoint); removed the dead
    `insulationScores` parameter and the fake `decayProfile` proxy (the caller had
    passed the insulation profile as a stand-in for P(s) decay), reweighting to the
    two real components (TAD 0.6, compartment 0.4).
  - HiCQualityMetrics: `contactDensity` is mean-over-occupied-pixels, not a fill
    density; corrected the docs and the user-facing label (numeric value unchanged).
- **Analysis modules no longer emit confident results on degenerate input.** An
  audit of `src/analysis/` (see `docs/analysis-audit-2026-07-06.md`) found four
  modules that returned real-looking values on input that could not support them,
  the same class as the P(s) R² bug. All four now detect the degenerate case and
  are covered by regression tests:
  - **InsulationScore**: position 0 (and any all-zero window) took
    `log2(0 + 1e-10) ≈ -33`, an outlier that dominated min-max normalization and
    compressed all real variation near 1.0, hiding true TAD boundaries. It now
    floors the log at the smallest positive raw score. The `boundaryProminence`
    default is corrected to the documented 0.1 to match the restored range.
  - **ScaffoldDetection**: the `median × 0.3` boundary threshold collapsed to 0
    when half or more inter-contig scores were 0 (fragmented assemblies),
    reporting one chromosome for the whole genome. The threshold now uses the
    median of the non-zero scores, and every adjacency is a boundary when no pair
    has contact.
  - **CompartmentAnalysis**: a no-compartment genome yields a constant O/E and an
    identity correlation matrix, of which the alternating power-iteration seed is
    a fixed point, so a spurious hard A/B checkerboard was returned. It now
    detects the absence of off-diagonal structure and returns a flat result.
  - **CentromereDetector**: prominence measured on a z-normalized (scale-free)
    signal called confident centromeres on small, noisy microchromosomes (8/8 on
    a noise map). The minimum contig span is raised to 16 and a contig is skipped
    unless its inter-contig contact is non-negligible relative to the map scale.
- **P(s) decay R² no longer reports spurious perfect fits.** A curve with too
  few supporting distances (e.g. a small scaffold with 2 non-zero distances) fit
  2 points and returned R²=1.0 by construction. It is now reported as not-fitted
  (NaN, shown as "—") when fewer than 5 well-supported distances back it, and
  the previously dead `minCountForFit` now filters low-support distances from the
  fit. Added an opt-in log-binned `fitMethod` for evaluation; the default stays
  the linear fit.
- **"KR" normalization relabeled to Sinkhorn-Knopp — it was never Knight-Ruiz.**
  The `KRNormalization` module implements symmetric Sinkhorn-Knopp iterative
  matrix balancing, not the Knight-Ruiz (2013) algorithm it was named and cited
  for. The false citation is removed, the internal function is renamed
  `sinkhornKnoppBalance`, and all user-facing labels now read "Sinkhorn-Knopp" /
  "SK Bias". Internal symbol names and the `kr` session key keep the abbreviation
  for backward compatibility. Numeric behavior is unchanged.

### Changed
- **Toolbar reorganized to fit without horizontal scroll.** ~21 controls in one
  strip overflowed on typical laptop widths (the toolbar scrolled with a hidden
  scrollbar, so the right-hand panel toggles and the Clean/Faithful control sat
  off-screen). The rarely-used and occasional controls now collapse into
  click-to-open popovers: **Export ▾** (AGP/BED/FASTA), **File ▾** (Save/Load
  Session, Load FASTA/Track, Screenshot), and **Display ▾** (colormap, gamma,
  Min/Max contrast, Clean/Faithful overview). Mode buttons are a segmented
  control and Undo/Redo are icons. Always-visible controls drop from ~21 to ~12,
  fitting comfortably at ≥1280px. New lightweight `ToolbarPopovers` component
  (one open at a time; closes on outside-click/Escape/scroll/resize); all control
  IDs preserved so existing handlers are unchanged.

### Added
- **Overview detail mode (Clean / Faithful)** — a toolbar dropdown controlling
  how the overview represents sparse off-diagonal contacts, fixing the jarring
  inconsistency where the coarse overview was clean but zooming "revealed"
  off-diagonal signal that popped in (and changed with zoom). Root cause: the
  overview is built from the file's coarsest, most-lossy mip (sparse contacts
  averaged to ~0), while detail tiles use finer mips that retain them. Both modes
  are now consistent across zoom: the detail layer is **gated by its mode's
  overview** (`u_gateEnabled`/`u_gateThresh` in the tile shader, sampling a
  dedicated original-order gate texture), so detail only renders where that
  overview has signal — no pop-in or zoom-dependent shifting. **Clean** (default)
  uses the coarsest-mip overview (faint off-diagonal suppressed); **Faithful**
  assembles a *finer* mip at its native resolution (`assembleOverview()` in
  PretextParser, larger overview bounded by a size cap) so structured
  off-diagonal/haplotype contacts show at every zoom and in the minimap. (Native
  resolution, not max-pooling — max-pooling let a single contact light a whole
  coarse cell and flooded fragmented assemblies to solid red.) Because the raw tile bytes are transferred to (and owned
  by) the tile-decode worker, the Faithful overview is assembled **in that
  worker** on demand (`TileDecodeWorkerClient.assembleOverview()`); if it can't
  be produced it falls back to Clean rather than blanking the map. Mode persists
  in sessions. 4 new unit tests (overview-mode.test.ts).
- **Track name labels on canvas** — each analysis track now shows its name as a
  semi-transparent label on the top-edge (horizontal) and left-edge (rotated 90°)
  overlays, so tracks are identifiable without opening the sidebar config panel
- **Pattern Gallery discoverability** — "Pattern Gallery" link added to welcome
  screen hints row alongside Workflow Guide; steps 1-4 of the misassembly
  detection tutorial now include an inline "Open Pattern Gallery →" button;
  `showPatternGallery` field added to LessonStep schema
- **FASTA streaming parser** — `parseFASTAStream()` in FASTAParser.ts processes
  large files line-by-line via the Streams API, avoiding V8's ~1 GB string limit
  that caused silent 0-sequence results on 2+ GB FASTA files (issue #53). Gzip
  FASTA files (.fa.gz) now decompressed with pako; files >500 MB compressed show
  a clear error. Loading overlay shows byte progress. 9 new unit tests.
- **Export respects contig exclusion** — AGP, BED, and FASTA exporters now call
  `contigExclusion.getIncludedOrder()` so contigs marked EXC are omitted from all
  exported files. 4 new unit tests.

### Fixed
- **White detail-tile blocks that never disappeared** — zoomed-in tiles could get
  stuck "pending" (cancelled mid-decode and never re-queued), leaving permanent
  white squares. The decode guard is now state-based (re-queues anything not
  loaded) and the tile fragment shader discards empty fragments so the overview
  shows through instead of an opaque white tile (issue #42)
- **Detail-tile vertical flip / "chevron" at high zoom** — the tile vertex shader
  was missing the overview quad's V-flip, mirroring the entire detail layer into
  an anti-diagonal above ~150% zoom (the minimap/overview were always correct).
  Now matches the overview texcoord flip (issue #42)
- **Multi-second UI freeze on batch operations** — Auto-Sort/AutoCut/sort/batch
  cut/join on large assemblies (1000+ contigs) triggered a full UI refresh per
  sub-operation (≈O(N²)). Refresh is now suspended during batch/script/AI runs
  and applied once at the end (`suppressCurationRefresh`)
- **Contig exclusion and meta tags now survive reordering** — they were keyed by
  display position, so a move/sort mis-attributed them and exports omitted the
  wrong contigs. They are now keyed by contig identity and follow their contig
  across reorders (dropping naturally on cut/join). Excluded count is orphan-safe
- **Misassembly detection no longer runs on a stale compartment eigenvector**
  after a reorder: auto-recompute refreshes compartments when misassembly flags
  are in use, otherwise skips detection rather than mixing fresh insulation with
  a pre-reorder eigenvector
- Lesson 03 ("Detecting Misassembly Patterns") hardcoded "finch genome" references
  in step text — replaced with "the assembly" so the tutorial reads correctly
  regardless of what dataset is loaded
- E2E session-persistence test flakiness — `waitForFunction(!el.disabled)` before
  each analysis button click handles the ICE post-processing race (ICE re-runs
  compartments + P(s) after showing its toast, keeping buttons disabled). Native
  `el.click()` via `page.evaluate` bypasses Playwright's strict visibility
  requirement for elements in overflow-y:auto containers. Timeout raised to 150s.

### Changed
- **Rendering performance pass** (no user-facing API changes):
  - BC4 tile decode and `.pretext` parsing now run in Web Workers
    (`TileDecodeWorker`, `ParseWorker`), so panning/zooming and loading
    30–200 MB files no longer block the UI. Decode is debounced and buffers
    transfer back zero-copy; both have synchronous fallbacks.
  - Render loop only redraws when something changed (camera/hover/selection/
    data/animation) instead of every frame — idle CPU drops to ~0.
  - DerivedState caches invalidate only on contigOrder/map change, not on every
    state update (e.g. camera pan no longer recomputes contig boundaries).
  - Fewer per-frame allocations: cached contig-boundary uniform, batched
    detail-tile draws (shared GL state hoisted out of the per-tile loop),
    iterator instead of `Array.from` for single selection.
  - BC4 decode reuses scratch buffers; `subarray` (view) instead of `slice`
    (copy) before pako inflate.
  - AI assist subsystem is lazy-loaded on first use (main bundle 344 → 294 kB,
    99 → 84 kB gzip); production sourcemaps disabled.
  - Undo history capped at 200 operations to bound long-session memory.
  - ICE/KR normalization use a single working-matrix copy; `filterLowCoverageBins`
    uses a typed-array sort.
- TypeScript 5.9.3 → 6.0.3; removed unused `baseUrl` and `@/*` path alias from
  tsconfig.json (deprecated in TS 6.0, never referenced in source)
- vite 8.0.1 → 8.0.16, vitest 4.1.0 → 4.1.8, @vitest/coverage-v8 4.1.0 → 4.1.8,
  @playwright/test 1.58.2 → 1.60.0, @types/node 25.5.0 → 25.9.1
- CI actions: upload-pages-artifact v4 → v5, deploy-pages v4 → v5

### Added
- **Evo2HiC resolution enhancement** — ML-powered Hi-C contact map enhancement
  using the Evo2HiC foundation model (81M parameters, 177 species). Optional
  companion FastAPI server with real model weights or mock inference. Toggle
  between original and enhanced views, with automatic invalidation on curation.
  Tested on real King quail genome (645 contigs, 30 chromosomes).
- 49 new unit tests for Evo2HiC client and enhancement utilities
- **Contig meta tags** — classify contigs as haplotig, contaminant, unlocalised,
  or sex chromosome with colored sidebar badges and batch operations
- **Telomere detection** — scan reference FASTA for TTAGGG/CCCTAA repeat motifs
  at contig ends with genome-wide density profiling and visualization track
- **KR normalization** — Knight-Ruiz iterative matrix balancing as an alternative
  to ICE; faster convergence with sqrt(rowSum) correction
- **Contact map re-rendering** — heatmap now visually updates after every curation
  operation (cut/join/invert/move/sort) by reordering pixels from the original map
- **Lesson browser** — modal showing all 9 tutorials with difficulty badges,
  estimated time, and descriptions; replaces hardcoded lesson-01 button
- **Workflow guide** — 7-step recommended curation workflow modal accessible from
  welcome screen and command palette
- **Zoom controls** — +/- buttons with zoom percentage indicator; keyboard shortcuts
  (+/= to zoom in, - to zoom out)
- **Onboarding improvements** — welcome screen with tagline, 3 getting-started paths,
  specimen card tooltips, and post-load orientation toast
- **Export discoverability** — collapsible "Export Analysis Data" section with format
  labels, disabled states, Export All button, and 8 command palette entries
- **Edit mode hint** — one-time toast when clicking map in Navigate mode
- **AutoSort/AutoCut feedback** — enriched toasts showing before/after metrics
- **FASTA hint** — Analysis Panel prompts to load reference FASTA for telomere detection
- 3 new tutorial lessons: 3D Genomics Analysis, Contig Classification, Automated
  Misassembly Detection
- 3 new Hi-C pattern gallery entries: telomere signal, sex chromosomes, haplotig mirror
- 3 new AI prompt strategies: analysis-guided, haplotig detection, telomere-aware
- Export buttons for KR bias BedGraph
- CHANGELOG.md and CONTRIBUTING.md

### Fixed
- **Contact map not updating** after curation operations — the critical rendering
  bug that prevented users from seeing the effect of their curation work
- **Toolbar hidden on small screens** — replaced `display: none` with horizontal
  scroll so all buttons remain accessible at any viewport width
- **Data files not deployed** — moved `data/` to `public/data/` so Vite copies
  JSON files (tutorials, specimens, patterns, strategies) to the deployed site
- **Zoom button overlap** — repositioned zoom controls above minimap canvas
- Track color values now consistently use `#hex` format (fixes console warnings
  on `<input type="color">` elements)

### Changed
- Upgraded vite 5→8, vitest 2→4, @vitest/coverage-v8 2→4 (resolves 3 security
  vulnerabilities)

## [0.4.0] — 2026-02-22

### Added
- **ICE normalization** — Sinkhorn-Knopp iterative matrix balancing with
  low-coverage bin masking and optimized fused O(n²) passes
- **Directionality index** — Dixon et al. 2012 signed chi-square directionality
  scores with configurable window size and TAD boundary detection
- **Hi-C library quality metrics** — cis/trans ratio, short/long range ratio,
  contact density, per-contig cis ratios
- **Saddle plot** — compartment strength visualization with O/E enrichment by
  eigenvector quantile and inline SVG heatmap
- **Virtual 4C** — interactive locus contact profiling via Alt+click with
  distance-expected normalization
- Session persistence for all analysis results (ICE, directionality, quality,
  saddle) via optional `SessionAnalysisData` field
- P(s) decay auto-recomputes using ICE-normalized matrix when available
- Export buttons for directionality, ICE bias, quality metrics, and saddle TSV

## [0.3.0] — 2026-02-21

### Added
- **Pattern detection** — algorithmic inversion (anti-diagonal butterfly) and
  translocation (off-diagonal enrichment) detection with clickable result cards
  and "Go" camera navigation
- **Curation progress tracking** — real-time Kendall tau ordering quality feedback
  with trend arrows and resettable reference baseline
- **Scaffold auto-detection** — detect chromosome block boundaries from the
  block-diagonal structure of the contact map with automatic scaffold assignment
- **Cut review panel** — step-by-step guided walkthrough of misassembly-based cut
  suggestions with accept/skip/back controls and camera navigation
- Health score timeline sparkline in analysis panel
- Misassembly confidence scoring (TAD 50% + compartment 30% + decay 20%)
- Per-chromosome P(s) decay curves with multi-curve chart
- Debounced auto-recompute of insulation + P(s) after curation operations

## [0.2.0] — 2026-02-20

### Added
- **AI curation assistant** — vision-based contact map analysis using Anthropic
  Messages API with executable DSL command suggestions
- **Prompt strategy system** — 5 built-in strategies with custom editor, JSON
  export/import, and community strategy repository integration
- Per-suggestion feedback (thumbs up/down) with aggregate strategy ratings
- **3D genomics analysis** — insulation score + TAD boundaries, P(s) contact
  decay curve with power-law fitting, A/B compartment eigenvector via power
  iteration; all running in a background Web Worker
- **Misassembly detection** — automatic chimeric contig detection using TAD
  boundary and compartment switch signals with orange MIS badges
- **Composite health score** — 0–100 score combining contiguity, P(s) quality,
  integrity, compartment strength, and library quality
- Analysis BedGraph/TSV export and P(s) decay curve visualization with baseline
  comparison overlay
- **Tutorial system** — 6 interactive lessons covering the full curation workflow
  with step-based progression, hints, and Kendall tau assessment
- **Specimen catalog** — 10 curated specimens from GenomeArk spanning mammals,
  birds, reptiles, fish, amphibians, and invertebrates
- **Hi-C pattern gallery** — 8 reference patterns with visual descriptions and
  click-to-navigate
- **Benchmark system** — CLI pipeline for algorithm evaluation with regression
  testing against stored baselines

## [0.1.0] — 2026-02-06

### Added
- WebGL2-accelerated contact map rendering with tile-based LOD and LRU cache
- Six color maps with keyboard cycling and adjustable gamma correction
- Curation engine: cut, join, invert, move with full undo/redo
- Selection system: click, shift-range, ctrl-toggle, select-all
- Scaffold painting mode for chromosome assignment CRUD
- Contig exclusion (hide from exports without deleting)
- Batch operations: select by pattern/size, batch cut/join/invert/sort
- **Auto Sort** — Union Find link scoring and contig chaining
- **Auto Cut** — diagonal signal breakpoint detection
- 18-command curation DSL with script console and log replay
- Export: AGP 2.1, BED6, FASTA (with reverse complement), PNG screenshots
- Session save/load with full undo/redo stack
- Drag-and-drop file opening, BedGraph track loading, reference FASTA loading
- Minimap with click-to-navigate viewport indicator
- Comparison mode overlay (original vs curated boundaries)
- Command palette (Cmd+K) with fuzzy search
- Keyboard shortcuts for all operations
- Assembly quality metrics (N50/L50/N90/L90) with live tracking
- Responsive layout with mobile, tablet, and desktop breakpoints
- Waypoint markers with keyboard navigation
