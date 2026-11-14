# Changelog

All notable changes to OpenPretext are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **A warning about haplotype order when exporting AGP.** `pretext-to-asm`
  pairs the two copies of a chromosome by their position in the file, and
  names scaffolds of one haplotype that follow one another as parts of one
  chromosome (`SUPER_1A`, `SUPER_1B`) without a message. The export now says
  when the layout will do this, and when it holds one of two layouts the tool
  stops on (a painted scaffold with no haplotype tag among tagged ones; a
  chromosome with no scaffold of the first haplotype). The file is still
  written. The rule is transcribed from agp-tpf-utils 1.4.1 and
  `bench/haplotype-order-check.ts` compares it with the tool on eight made-up
  layouts. See `docs/AGP_EXPORT.md`.
- **The cursor's position in sequence coordinates.** The tooltip and the
  status bar give the original sequence and base pair under the cursor, the
  texel within the contig, the position of the row under the cursor when it is
  a different place, and in edit mode where pressing `C` would cut. The
  figures use the AGP writer's arithmetic, so they are the coordinates an
  export would carry. They replace a "Map pos" fraction with three decimals,
  which on a 32,768-texel map resolved to about 33 texels.
- **`cut <sequence> at <bp>` in the script console.** Breaks an original
  sequence at a base-pair position (`cut scaffold_1 at 24.09Mb`) on the
  nearest texel boundary, wherever that position now lies on the map: inside
  an inverted, moved, cut or joined contig. The message reports where the
  break went.
- **AGP export that the curation pipelines can read.** The exported AGP now
  has PretextView's layout, which is the input to Sanger's `pretext-to-asm`
  and the VGP post-curation scripts: the map resolution in the header, every
  row naming an input sequence and an interval of it at texel resolution,
  `U 100` gap rows, objects named `Scaffold_<n>`, `Painted` in column 10 and
  tags after it. The earlier file invented names for cut and joined contigs
  (`name_L`, `a+b`), which no downstream tool could resolve. Checked three
  ways: importing the AGP of a released Sanger curation (king quail) and
  exporting it again reproduces all 605 rows; for the 14 real curations in
  `agp-tpf-utils`' test data, `pretext-to-asm` gives identical output from
  OpenPretext's file and from PretextView's (`bench/agp-acceptance.ts`); and
  both flavours pass a checker written from the AGP 2.1 specification over
  random curations. A second menu entry writes the same layout in nine
  columns for validators; NCBI's `agp_validate` reports no errors in it for
  15 real curations (`bench/ncbi-validate.ts`). The VGP `split_agp` script
  gives the same output from OpenPretext's file as from PretextView's
  (`bench/vgp-acceptance.ts`). Details and limits are in `docs/AGP_EXPORT.md`.
- **AGP import reads cuts, scaffolds and tags.** Importing a PretextView (or
  OpenPretext) AGP now applies its cuts, order, orientation, painted scaffolds
  and tags. An AGP for a different assembly or map resolution is refused, and
  nothing changes. Import AGP is in the File menu as well as the command
  palette.
- **File checksums.** A `.pretext` file has no checksum of its own, so damage
  that leaves every size intact cannot be found by reading it. OpenPretext now
  computes the MD5 and SHA-256 of each file it loads. Click the file name in
  the status bar (or run "File checksums" from the command palette) to see
  them and to paste the checksum published with the file; the dialog says
  whether it matches. It accepts a bare value or a line from `md5sum`,
  `sha256sum` or `shasum`. Computing both adds about 0.3 s to loading a 105 MB
  file.
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
- **"KR" normalization**: a second Sinkhorn-Knopp matrix-balancing variant
  alongside ICE, with sqrt(rowSum) correction. Originally mislabeled KR/Knight-Ruiz;
  see the relabel note under Fixed. The `kr` key is kept only for session-file
  back-compat.
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

### Changed
- **Excluded contigs are written to the pipeline AGP, and must say why.** The
  downstream tool removes sequence by tag and puts back anything the AGP does
  not mention, so leaving an excluded contig out did not remove it. Each
  excluded contig must now carry `Haplotig`, `Contaminant` or `FalseDuplicate`;
  the export stops and names any that does not. The standard AGP, BED and
  FASTA still leave excluded contigs out.
- **BED export follows the standard AGP.** Same objects and coordinates, with
  each line named `sequence:begin-end`.
- **Contig tags use PretextView's vocabulary, and a contig can carry several.**
  The four lower-case tags (haplotig, contaminant, unlocalised, sex chromosome)
  are replaced by the tags PretextView writes and the Sanger and VGP tools
  read: `Haplotig`, `Contaminant`, `FalseDuplicate`, `Unloc`, named sex and B
  chromosomes (`X`, `Y`, `Z`, `W`, `X1`, `B1`, ...), haplotypes (`Hap1`,
  `HAP1`, `Hap_1`, ...), `Target`, `Primary` and `Singleton`. A contig holds
  at most one chromosome name, one haplotype and one reason for removal. The
  sidebar refuses a tag that is not one word and catches near misses such as
  `haplotig`, because the downstream tools match tags exactly and read an
  unknown word as a haplotype name. Sessions are now version 3; version 2
  sessions still load, with their tags converted, except that an old "sex
  chromosome" tag cannot be converted (it never recorded which chromosome)
  and is reported.
- **Contig boundaries match PretextView's.** The texels a contig owns are now
  derived exactly as PretextView derives them, which moves some boundaries by
  one texel on real maps and decides the coordinates in an exported AGP.
- **Each screen pixel shows one stored value when zoomed in.** Magnified views
  read the nearest texel instead of blending neighbours, so bins appear as
  crisp squares and a contig's edge is never mixed with whatever sits next to
  it in the file. The level drawn is the finest whose texels are at least one
  screen pixel wide, so no stored value at that level is skipped. When the map
  is drawn smaller than its texture, texels are averaged.
- **The whole-map view is drawn from the finer stored level by default.** The
  overview setting chooses between two resolutions stored in the file, now
  labelled Fine (about 2048 px across, the new default) and Coarse (the file's
  lowest level, the old default, where faint contacts are averaged away). Fine
  suits a full window, including HiDPI displays, and matches what the detail
  tiles show just past the zoom threshold. The overview texture is also
  mipmapped, so in a small window faint contacts are averaged down instead of
  appearing or vanishing with the pixel grid.
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
- Upgraded vite 5→8, vitest 2→4, @vitest/coverage-v8 2→4 (resolves 3 security
  vulnerabilities)

### Fixed
- **FASTA export of a cut contig no longer drops bases.** Contig lengths in a
  map file are rounded, and the last piece of a cut sequence ended at the
  rounded length, losing the bases past it. Records are now cut at the AGP's
  coordinates and the piece that reaches the end of a sequence runs to its true
  end. A sequence too small to own a map texel is always written, whole.
- **Sessions saved before the boundary change still open.** Contig boundaries
  moved by one texel on some maps (see Changed). A session saved earlier holds
  the old positions and would have been refused as belonging to a different
  assembly. It is now adjusted on restore: every texel stays where the curator
  put it, and the restore says how many contigs moved. Checked on four real
  maps with cuts at every affected contig.
- **Tags and exclusions survive a cut or join.** Cutting an excluded contig
  produced two pieces that were no longer excluded, so sequence the curator had
  removed (a contaminant, say) went back into the exported FASTA, AGP and BED.
  Tags were lost the same way. Now both pieces of a cut take the tag, notes
  and exclusion of the contig they came from, and undo restores the contig
  with its marks.
- **A contig too small to appear on the map cannot be joined.** A sequence
  shorter than about one texel is on the contig list but owns no part of the
  map, and an AGP has no row for it, so a join that included one could not be
  written down. Such a join is now refused with a message; the sequence is
  exported on its own, as before.
- **A join that would change the export is refused.** Joining an excluded
  contig to an included one has no safe automatic result: the joined contig
  either exports the excluded sequence or drops the included one. The join is
  now refused with a message naming the two contigs, in the editor, in batch
  join (which then joins nothing), in scripts and their preview, and on redo.
  Exclude or include both and the join goes ahead. A joined contig keeps a tag
  when both parts carry the same one; otherwise the tag is not kept and the
  message says which, including when the join is redone after a part's tag
  was changed.
- **Incomplete and damaged `.pretext` files are refused.** A file cut short by
  an unfinished download or copy used to load with the missing part of the map
  drawn blank, and a tile that failed to decompress was replaced with zeros,
  both without a word to the user. A header with impossible values could hang
  the page. The reader now checks the header, every contig length and the
  presence and size of every map tile (each must be a complete compressed
  stream that decompresses to the right length), and refuses the file with a message
  that says what is wrong (for example which tile the file ends in). A refused
  file changes nothing: the landing screen stays up, or the assembly already
  loaded and its edits stay as they were. If the map is whole but a track
  after it is cut short or damaged, the map loads and a warning names the
  track that was left out. The checks are listed in `docs/PRETEXT_FORMAT.md`,
  section 6.4.
- **Browser shortcuts no longer edit the assembly.** In Edit mode, Cmd/Ctrl+C
  (copy) cut the contig under the pointer, Cmd/Ctrl+F (find) inverted the
  selection, and Cmd/Ctrl+J and +H joined and excluded. Single-key shortcuts
  now act only when pressed without Cmd, Ctrl or Alt, and not while a dropdown
  or editable field has focus.
- **Analyses, auto-cut, auto-sort and scaffold detection read the map as
  curated.** The stored overview matrix stays in file order, and these tools
  lay contigs out in display order, so after any move or inversion they were
  reading one contig's contacts under another's coordinates. They now read a
  display-order matrix built from the same mapping the renderer uses.
  Scaffold-aware auto-sort gives each scaffold a matrix of its own contigs.
  Compartment orientation by GC reorders the GC profile the same way.
- **Results are recomputed for the new layout after an edit.** Insulation,
  P(s), directionality, compartments, ICE or Sinkhorn-Knopp balancing, library
  quality, pattern detection, the saddle plot and telomere positions are redone
  about a second after the last edit. Before, only three of these were, and the
  balanced matrix from the old layout was fed back into them. Virtual 4C,
  checkerboard, centromere and cut-suggestion results are cleared, since they
  were asked for at a position that has moved.
- **No toast per analysis after each edit.** The automatic recompute is shown
  by the recomputing indicator only.
- **Loading a second assembly starts clean.** The undo history, scaffolds,
  selection, waypoints, tracks, reference FASTA and analysis results of the
  previous assembly are all dropped when a new file loads. Before, Undo after a
  second load threw an error or applied the first file's edits to the second,
  and a FASTA export could take sequences from the wrong assembly when contig
  names matched. A FASTA loaded before any map is still kept for that map.
- **A session saved after a cut or join restores.** Sessions now record the
  whole contig table, so the pieces made by cutting and joining come back with
  their map position and sequence coordinates. A session is checked against the
  loaded file first and refused, changing nothing, if it belongs to another
  assembly or does not show every part of the map exactly once. Sessions from
  earlier versions still load when nothing in them was cut or joined; one that
  was is refused with the reason, because it never recorded the pieces.
- **Sessions keep contig tags and exclusions.** Haplotig, contaminant,
  unlocalised and sex-chromosome tags (with their notes) and the contigs
  excluded from export are saved with the session and put back on the same
  contigs when it is restored. They were dropped before, so a restored session
  exported contigs the curator had excluded.
- **Restoring a session clears the undo history** instead of leaving operations
  that referred to the assembly it replaced. Scaffolds come back with their
  saved ids and colours.
- **Redo reapplies a whole script, auto-sort or auto-cut** in one step, as Undo
  removes it. Redo used to bring back one operation of the batch at a time.
- **The demo assembly is the same on every load**, and its last contig no
  longer runs two pixels past the edge of the map.
- **Cut on an inverted contig no longer rearranges the map.** The two pieces
  were given each other's texels, so the display changed on the cut and each
  piece exported the other end's sequence coordinates.
- **Join keeps exactly the two contigs' texels.** Joining contigs that are not
  neighbours in the file used to claim everything between them, so a later cut
  at the visible seam landed in the wrong place.
- **Moving a contig to the right lands where asked.** `move` put the contig one
  position short of the target when moving right, could not move a contig to
  the end, and treated a one-slot move right as nothing. This affected the
  script commands `move ... to`, `before` and `after`, and dragging. A script
  written to compensate for the old behaviour will now place contigs one
  position further right.
- **Zoomed-in detail no longer hides or invents signal.** The detail layer used
  to be masked by the coarse overview, which hid most weak off-diagonal contact,
  and let the overview show through wherever a detail texel was empty, which
  painted empty texels with a coarse average. A loaded detail tile is now drawn
  in full, and the contig grid and highlight are drawn over it.
- **The zoomed-in map follows curation.** Detail tiles are stored in file
  order and used to be drawn there, so after a move or invert the zoomed view
  showed pre-edit data under the post-edit grid. The map is now drawn in one
  pass that maps every screen pixel from the curated layout to the file, and
  the overview and the detail tiles share that mapping, so they cannot
  disagree. Textures are no longer rebuilt on each edit.
- **Detail tiles on screen are never evicted.** The cache held at most 256
  tiles while a wide window could need 672, which left a permanent patchwork of
  two resolutions. Tiles now live in one array texture sized from a memory
  budget, visible tiles are never displaced, and no float copy of each tile is
  kept.
- **Grid lines keep a constant on-screen width** instead of thickening into a
  band at high zoom.
- **A long batched action can no longer outrun the undo stack.** The stack was
  capped at 200 operations and trimmed from the front, on the stated assumption
  that every operation is independent. Batched ones are not: auto-sort emits an
  operation per moved contig, so on a 1245-contig assembly a single click pushed
  roughly 2,400. Trimming cut the front off that batch, and undo, which pops
  while the top carries the batch id, could then only walk back the retained
  tail, leaving an order no undo could restore. Script preview was worse: it
  reverts by undoing its own batch, so a dry run could permanently change the
  assembly. Trimming now retreats to a batch boundary, so the oldest retained
  operation is never mid-batch and a batch larger than the cap is kept whole;
  script runs and previews additionally suspend trimming until their operations
  are stamped. The cap is 1,000 (about 10 MB on a 1245-contig assembly, measured)
  and is now a soft target, since both rules can hold more. When operations are
  dropped the undo panel says so rather than letting the list quietly end. Also
  fixes three batch contexts that leaked on early return and stamped unrelated
  later operations with a stale batch id.
- **Eleven of sixteen specimen contig counts were wrong.** Most recorded the
  post-curation file's count while the catalog entry serves the pre-curation
  file, so the picker understated the work in an assembly, sometimes by half
  (the snake read 124 against a true 240). Every count was re-derived by parsing
  the header of the file actually served.
- **The shortcuts modal named the wrong key for Navigate mode.** It listed `N`,
  which creates a scaffold. `Esc` returns to Navigate.
- **The track gutters no longer cover each other or their own labels.** The top
  gutter's bands run the full canvas width and the left gutter's columns the full
  height, so the two contested the top-left corner and paint order alone decided
  which showed; panning the map so its left edge left the window put the columns
  straight over the track names. The corner now belongs to the top gutter, the
  left columns begin below it, and the names sit on one opaque block sized to the
  widest of them, so nothing passes underneath them. Where the map's left edge is
  on screen, the usual view, the block falls on the gutter's own dark background
  and is invisible. Contig labels live on a canvas layered above the tracks, so
  they could not be hidden by the block and instead ran across it; each is now
  centred in the part of its contig that clears the gutter rather than in the
  contig as a whole, which also keeps a partly scrolled-off contig labelled.
- **Reset view is reachable on a Mac.** It was bound only to Home, which laptop
  keyboards do not have (it is Fn + Left), and the command palette matched on
  command names alone, so searching "home", "fit", or "zoom out" found nothing.
  `0` now resets the view, Home still works, and the palette searches shortcuts
  and keywords as well as names.
- **The map now shares one vertical coordinate convention with everything drawn
  over it.** The vertex shaders placed the map in a y-up space while the camera,
  the overlays (tracks, contig labels, minimap, scaffold and waypoint overlays,
  the drag-reorder indicator), and `canvasToMap`/`mapToCanvas` all worked in
  genomic y-down coordinates. A quad texcoord flip hid the disagreement at
  `camera.y == 0.5`, so a reset view looked correct and everything drifted from
  there by twice the vertical offset. Dragging up moved the map down while the
  left-edge tracks moved up (reported by Carlos at IBE Barcelona); zoom-to-cursor
  anchored the wrong row and walked off the diagonal as you zoomed; and detail
  tiles were placed mirrored block-by-block against the overview, so past a few
  hundred percent the detail layer showed the anti-diagonal counterpart of the
  region you were looking at instead of the region itself. Each vertex shader now
  performs the single y flip that clip space needs and nothing re-flips it, which
  also corrects click hit-testing, the contig highlight, and the minimap viewport
  box away from center. Horizontal behaviour was never affected.
  A saved session or waypoint written by an earlier build stores a `camera.y`
  under the old reading, so restoring one lands at the vertically mirrored
  position. These are not migrated on load: the old value was already pointing
  somewhere other than where the map drew it, and carrying it forward would
  preserve that. Any pan corrects it, and no curation data is involved.
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
- **Contact map not updating** after curation operations — the critical rendering
  bug that prevented users from seeing the effect of their curation work
- **Toolbar hidden on small screens** — replaced `display: none` with horizontal
  scroll so all buttons remain accessible at any viewport width
- **Data files not deployed** — moved `data/` to `public/data/` so Vite copies
  JSON files (tutorials, specimens, patterns, strategies) to the deployed site
- **Zoom button overlap** — repositioned zoom controls above minimap canvas
- Track color values now consistently use `#hex` format (fixes console warnings
  on `<input type="color">` elements)

### Security
- **Names from files are shown as text.** Contig names from a `.pretext` file,
  track names from a BedGraph file, and scaffold names and colours from a
  session or AGP file were written into several panels as HTML. A crafted file
  could run script in the page, where a stored AI API key is readable. They are
  now escaped everywhere they are shown (contig and scaffold lists, tooltip,
  undo history, track list, cut suggestions and review, pattern list, command
  palette, P(s) legend).
- **Content security policy.** The page now allows script only from its own
  origin: no inline script, inline event handlers or eval. If markup from a
  file ever reaches the page again, it cannot execute.

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
