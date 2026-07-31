# Competitive Landscape: Hi-C Contact Map Visualization and Genome Assembly Curation Tooling (2023-2026)

Research date: 2026-07-13. Purpose: inform the publication strategy for OpenPretext (browser-native `.pretext` parsing, WebGL2 rendering, reversible + scriptable curation, in-browser Hi-C analytics, teaching curriculum).

Fact discipline note: every capability, license, and publication claim below was fetched from a real source in this session. URLs are cited inline and collected at the end. Where a fact could not be confirmed, it is flagged explicitly. Absence-of-publication claims are scoped to "not found in these searches," not "does not exist."

## 1. Comparison table

| Tool | What it does | Viewer vs curation | Web-native / no-install | Open source / license | Associated publication (verified) |
|---|---|---|---|---|---|
| **PretextView** (Sanger) | Views `.pretext` contact maps; interactive assembly editing (reorder/split contigs, scaffold mode, waypoints, extension overlays, Pixel Sort, Pixel Cut); exports AGP | **Curation** (edit + AGP export) | **No** — desktop app (Windows/Mac/Linux), needs OpenGL 3.3, 2 GB RAM | Yes — **MIT** (per `meson.build`) | No dedicated PretextView paper found in these searches. Used/cited in Howe et al. 2021 (GigaScience) curation methods; sorting algorithm cites YaHS (Zhou et al. 2023, Bioinformatics) |
| **PretextMap** (Sanger) | Converts SAM-formatted read pairs into `.pretext` genome contact maps (the generator that feeds PretextView) | Neither (map generation) | No — command-line | Yes (GitHub sanger-tol) | None found in these searches |
| **PretextSnapshot** (Sanger) | Command-line image generator for `.pretext` maps (whole map, per-sequence, or custom regions) | Viewer (static image export) | No — command-line only | LICENSE file present; specific type not confirmed this session | None found in these searches |
| **Juicebox (desktop)** + **JBAT** (Aiden Lab) | Java desktop app; visualizes `.hic`; **Juicebox Assembly Tools** superimposes contig/scaffold positions on the heatmap and supports interactive point-and-click (re)assembly (move/split), heatmap updates in real time | **Curation** (JBAT assembly editing) | **No** — desktop Java (assembly code moving to `juiceboxgui` repo) | Yes — **MIT** | JBAT: Dudchenko et al. 2018 (bioRxiv, `10.1101/254797`); core Juicebox: Durand, Robinson et al. 2016 (Cell Systems) |
| **Juicebox.js** (Aiden Lab / IGV team) | Browser `.hic` contact-map viewer; depends on igv.js; embeddable | **Viewer only** (no editing features listed on the web-app doc) | **Yes** — runs in browser, public instance | Yes — **MIT** (github.com/igvteam/juicebox.js) | Robinson et al. 2018, Cell Systems, "Juicebox.js Provides a Cloud-Based Visualization System for Hi-C Data" (PMID 29428417) |
| **HiGlass** | Web-based, zoomable, multi-view synchronized viewer for genome interaction maps; data-agnostic multiscale viewer; comparison/linking of views | **Viewer / analysis display** (not assembly curation) | **Yes** — web-based (also self-hostable server) | Open source (project site higlass.io) | Kerpedjiev et al. 2018, Genome Biology, `10.1186/s13059-018-1486-1` |
| **cooler / cooltools** (Open2C) | Python: `cooler` stores/accesses large Hi-C matrices; `cooltools` extracts features (distance decay, compartments, domains, dots) | Analytics stack (no viewer, no curation) | No — Python library/CLI | Open source (github.com/open2c) | cooltools: Open2C et al. 2024, PLOS Comp Biol, `10.1371/journal.pcbi.1012067` |
| **FAN-C** (Vaquerizas lab) | Python API + CLI: matrix generation, analysis, visualization for C-like data; TAD/loop aggregate plots; multi-dataset comparison | Analytics + static plotting (no interactive curation) | No — Python/CLI | Open source (github.com/vaquerizaslab/fanc) | Kruse, Hug, Vaquerizas 2020, Genome Biology, `10.1186/s13059-020-02215-9` |
| **TreeVal** / **curationpretext** / **rapid-curation** (Sanger) | Nextflow pipelines that *generate evidence* for manual curation: HiC maps plus telomere/gap/coverage/repeat tracks ingested into PretextView (and files for JBrowse2, Juicebox, HiGlass) | Evidence generation (feeds the curation tools; not itself a viewer/editor) | No — Nextflow (Docker/Singularity) | Open source (github.com/sanger-tol) | TreeVal versioned on WorkflowHub; no standalone journal paper confirmed this session |
| **3D Genome Browser**, **HiCube**, **CHiCP** | Web-based Hi-C / 3D-genome / capture-Hi-C viewers (context only) | **Viewer only** | Yes | Various | 3D Genome Browser: Genome Biology 2018; HiCube: Bioinformatics 2023; CHiCP: PMC4978926 (not individually deep-verified this session) |

## 2. Gap analysis

The landscape splits cleanly along two axes, and the honest gap sits at their intersection.

**Axis A — where the tool runs.** Web-native Hi-C tools exist and are mature: HiGlass and Juicebox.js both run in a browser with no install. So "browser-based Hi-C visualization" is NOT an open gap. Claiming novelty on browser rendering alone would overstate.

**Axis B — what the tool lets you do.** Real assembly curation (move, split, scaffold, invert, export AGP) is done in **desktop** tools: PretextView (OpenGL desktop) and Juicebox+JBAT (Java desktop). The browser-native tools on Axis A are viewer-only — Juicebox.js's web-app documentation lists no editing features, and HiGlass is a data-agnostic viewer, not an assembly editor.

**The intersection is empty, and that is the genuine gap:** there is no verified web-native, no-install tool that performs actual assembly *curation* (not just viewing). To edit an assembly today a curator installs PretextView or desktop Juicebox. OpenPretext's defensible novelty is therefore browser-native curation, not browser-native viewing.

Three narrower claims survive scrutiny and should carry the pitch:

1. **Native `.pretext` parsing in the browser.** The `.pretext` format is the working format of the Sanger/DToL/VGP/EBP curation pipeline (produced by PretextMap, consumed by PretextView, generated by the TreeVal/curationpretext pipelines). No verified web tool reads `.pretext` natively — Juicebox.js reads `.hic`, HiGlass reads its own tiled formats. A browser tool that opens the exact file the community already generates is a specific, verifiable gap.

2. **Scriptable / headless curation-as-code.** None of the curation tools surfaced (PretextView, JBAT) advertise a scripting/DSL interface for reproducible, replayable curation. This is a clean differentiator. (Reproducible *analysis* is well served by cooltools/FAN-C, but that is analytics, not assembly editing.)

3. **In-browser teaching / curriculum.** Curation training today runs through installed desktop tools and instructor-led workshops (e.g. Physalia, EBP-Nor, BGA courses feeding PretextView/JBAT). A zero-install tool with a built-in lesson curriculum lowers the training barrier in a way no verified competitor does.

**Where NOT to overstate (honest limits):**

- **Automated cut/sort is not novel.** PretextView already ships "Pixel Sort" (link-score fragment ordering) and "Pixel Cut" (Hi-C-density-based contig breaking). OpenPretext's AutoCut/AutoSort should be framed as an in-browser equivalent, not a new capability. (This also aligns with the local memory flag that AutoCut needs its own investigation before any strong claim.)
- **Reversibility (undo) is likely not unique.** JBAT is an interactive point-and-click reassembly tool; undo was not confirmed either way in these searches, so do not claim OpenPretext is uniquely reversible without checking JBAT/PretextView directly.
- **Interactive assembly editing itself is not new** — JBAT pioneered point-and-click Hi-C reassembly in 2018. The novelty is the *delivery* (browser, no install) plus scriptability and native `.pretext`, not the act of editing.
- **In-browser analytics** overlaps a crowded, mature analytics space (cooltools, FAN-C, cooler). The differentiator is that OpenPretext runs a curation-relevant subset live in the browser next to the map, not that it computes metrics no one else can.

**Closest competitor(s):** two, on the two axes.
- On the **file-format / workflow** axis: **PretextView** — OpenPretext is literally positioned as its web alternative, same `.pretext` file, same curation workflow, same overlays and AGP export. The difference is desktop vs browser + scriptability + curriculum.
- On the **curation-interactivity** axis: **Juicebox + JBAT** — the other tool that does real interactive Hi-C assembly editing, also desktop.

The publication framing that holds up: OpenPretext brings the desktop-only Pretext/JBAT curation workflow into the browser with no install, adds scriptable/reproducible curation-as-code, and adds a teaching curriculum — while being honest that browser viewing (HiGlass, Juicebox.js) and automated cut/sort (PretextView) already exist.

## 3. Strongest verified sources (URLs fetched this session)

- PretextView repo (desktop, MIT, editing modes, Pixel Sort/Cut, AGP): https://github.com/sanger-tol/PretextView
- PretextView license confirmation (MIT, via meson.build): https://github.com/sanger-tol/PretextView/blob/master/meson.build
- PretextMap repo (SAM → `.pretext`): https://github.com/sanger-tol/PretextMap
- PretextSnapshot repo (CLI image generator): https://github.com/sanger-tol/PretextSnapshot
- Juicebox desktop + JBAT (Java, MIT, interactive reassembly): https://github.com/aidenlab/Juicebox
- Juicebox.js web app doc (browser viewer, no editing listed): https://igv.org/doc/juiceboxjs.html
- Juicebox.js paper (Robinson et al. 2018, Cell Systems): https://www.cell.com/cell-systems/fulltext/S2405-4712(18)30001-2
- JBAT paper (Dudchenko et al. 2018, bioRxiv): https://www.biorxiv.org/content/10.1101/254797.full.pdf
- HiGlass paper (Kerpedjiev et al. 2018, Genome Biology): https://genomebiology.biomedcentral.com/articles/10.1186/s13059-018-1486-1
- cooltools paper (Open2C 2024, PLOS Comp Biol): https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1012067
- FAN-C paper (Kruse et al. 2020, Genome Biology): https://genomebiology.biomedcentral.com/articles/10.1186/s13059-020-02215-9
- Foundational manual-curation methods (Howe et al. 2021, GigaScience; uses PretextView + HiGlass + gEVAL): https://academic.oup.com/gigascience/article/10/1/giaa153/6072294
- TreeVal pipeline (evidence generation feeding PretextView): https://github.com/sanger-tol/treeval
- curationpretext pipeline: https://github.com/sanger-tol/curationpretext
- rapid-curation: https://github.com/sanger-tol/rapid-curation

## Could not verify this session (flagged)

- **No dedicated PretextView journal/preprint publication** was found in these searches. It appears cited through the Howe et al. 2021 curation paper and YaHS, but absence here is search-scoped, not proof none exists.
- **No "automated/deep-learning PretextView curation" paper** was found (a targeted search returned unrelated results). Status: unconfirmed either way.
- **PretextSnapshot exact license type** not confirmed (LICENSE file exists; type not read).
- **JBAT / PretextView undo (reversibility) support** not confirmed — do not claim OpenPretext is uniquely reversible without a direct check.
- **TreeVal standalone journal publication** not confirmed (versioned on WorkflowHub; may be documented in a Sanger/DToL methods paper not fetched here).
- 3D Genome Browser / HiCube / CHiCP were surfaced via search snippets for context only and not individually deep-verified.
