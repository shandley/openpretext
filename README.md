# OpenPretext

A browser-based Hi-C contact map viewer and genome assembly curation tool. It reads native `.pretext` files, renders them with WebGL2, and lets you curate an assembly into chromosomes, with nothing to install.

**[Try it now](https://shandley.github.io/openpretext/)**&nbsp;&nbsp;·&nbsp;&nbsp;**[Field guide to genome curation](https://openpretext-guide.vercel.app)**&nbsp;&nbsp;·&nbsp;&nbsp;**[Report an issue](https://github.com/shandley/openpretext/issues)**

Open the app and click **Load Example** to explore a real koala assembly, or **Start Tutorial** for a guided walkthrough.

![Contact map with sidebar](docs/images/screenshot-main.png)
*Contact map with contig sidebar, misassembly badges, annotation tracks, and analysis overlays.*

## What it is

OpenPretext is a browser-based alternative to [PretextView](https://github.com/sanger-tol/PretextView), the Wellcome Sanger Institute desktop tool that genome assembly teams (Darwin Tree of Life, Vertebrate Genomes Project, Earth BioGenome Project) use to inspect Hi-C contact maps and arrange contigs into chromosomes. OpenPretext runs anywhere a browser does, needs no install, and adds scripting, automated curation, 3D genomics analysis, and an optional machine-learning enhancement server.

New to genome curation? Start with the **[field guide](https://openpretext-guide.vercel.app)**. It teaches you to read a contact map and recognize the common misassemblies before you touch the tool.

## Quick start

Prerequisites: [Node.js](https://nodejs.org/) 22 or later.

```bash
git clone https://github.com/shandley/openpretext.git
cd openpretext
npm install
npm run dev
```

Open http://localhost:3000, then:

- Click **Load Example** to download and explore a real genome assembly.
- Click **Open**, or drag and drop a `.pretext` file from your computer.
- Click **Start Tutorial** for a guided walkthrough.

OpenPretext needs a local HTTP server; opening the files over `file://` will not work (CORS and ES module loading). Use `npm run dev` while developing, or `npm run build` then `npm run preview` for a production build.

## Learn

- **[Field guide to genome curation](https://openpretext-guide.vercel.app)**: a visual introduction to reading a Hi-C map, the misassembly signatures, and the curation workflow.
- **In-app tutorials**: 10 interactive lessons, from reading the map to a full curation exercise. Open the app and click **Start Tutorial**.
- **Pattern gallery**: a reference of Hi-C patterns (clean diagonal, inversions, translocations, micro-chromosomes, and more) with descriptions and click-to-navigate.

## Features

### Rendering

WebGL2 contact map at 60fps with tile-based level-of-detail, an LRU cache, and background decompression. Six color maps with keyboard cycling, adjustable gamma, a contig grid and edge labels, a click-to-navigate minimap, scaffold color bands, waypoint markers, annotation track overlays (line, heatmap, marker), and a comparison overlay of original versus curated boundaries. An observed/expected (O/E) view toggle divides out the distance-decay so long-range structure stands out (overview only; detail tiles stay raw at high zoom). A before/after view places the map as loaded beside the current curated arrangement.

### Curation

Cut, join, invert, and move contigs with full undo and redo. Drag-and-drop reordering, a click / shift-range / ctrl-toggle selection system, contig exclusion (hide from export without deleting), scaffold painting for chromosome assignment, waypoint markers, batch operations (select by name or size, batch cut / join / invert, sort by length), and meta tags to classify contigs as haplotig, contaminant, unlocalised, or sex chromosome.

### Automated curation

- **Auto Sort (Union Find)** scores every contig pair across four orientations using Hi-C link analysis, chains contigs into chromosome groups, and applies the needed inversions and reordering. Run it from the command palette, or Option+S (Alt+S) in edit mode.
- **Auto Cut (breakpoint detection)** finds misassembly breakpoints where the diagonal Hi-C signal drops and splits contigs there. Run it from the command palette, or Option+C (Alt+C) in edit mode.

A common recipe: run Auto Cut first to break misassemblies, then Auto Sort to group and orient the fragments. Every operation is individually undoable.

### AI-assisted curation

Vision-based analysis through the Anthropic Messages API. It captures the current map, builds assembly context from contig ordering, metrics, and scaffold assignments, and returns runnable DSL command suggestions with one-click Run buttons. Ships with eight prompt strategies (general, inversion detection, scaffold assignment, fragmented assemblies, micro-chromosomes, analysis-guided, haplotig detection, telomere-aware), a custom-strategy editor, JSON export and import, and one-click browsing of [community strategies](https://github.com/shandley/openpretext-strategies) from the panel. Your API key is stored locally and sent only to Anthropic.

### 3D genomics analysis

A suite of Hi-C metrics, all computed in a background Web Worker and exportable as BedGraph or TSV:

- **Insulation score and TAD boundaries** (Crane et al. 2015): a sliding off-diagonal window with boundaries detected as prominent local minima.
- **P(s) contact decay**: intra-chromosomal contact frequency versus distance with power-law fitting, whole-genome and per-chromosome, with a comparative baseline overlay, reference-slope guides at -1.0 and -1.5, and a local-slope panel (the windowed log-derivative) that shows where the curve plateaus or rolls off.
- **A/B compartments**: observed/expected normalization and first-eigenvector calculation, rendered as a heatmap track. When a reference FASTA is loaded, A and B are oriented by GC content (the gene-rich, GC-rich side is A); without one the split is real but the labels stay unoriented.
- **Matrix balancing**: two iterative bias-correction normalizations, ICE and KR, both Sinkhorn-Knopp variants, each producing a per-bin bias track and re-running downstream analysis on the balanced matrix.
- **Directionality index** (Dixon et al. 2012): signed directionality with TAD boundaries at sign-change crossings.
- **Hi-C library quality**: cis/trans ratio, short/long range ratio, contact density, and per-contig cis ratios.
- **Saddle plot** and **virtual 4C** (Alt+click any bin for a locus contact profile).
- **Telomere repeat detection** from a loaded reference FASTA (TTAGGG / CCCTAA motifs at contig ends).
- **Checkerboard score** (Che et al., Cell 2026): an entropy-based measure of A/B compartment regularity, with a reference comparison against a large species panel.
- **Centromere detection** (Che et al., Cell 2026): predicts centromere positions from inter-chromosomal contact hubs.
- **Composite health score** (0 to 100): combines contiguity (N50), P(s) decay quality, assembly integrity, compartment strength, and library quality, shown as a card in the sidebar.

### ML-powered enhancement (optional)

Integrates [Evo2HiC](https://github.com/CHNFTQ/Evo2HiC) foundation models through an optional companion server (`server/`). The core app works fully without it.

- **Resolution enhancement**: enhances low-resolution overview maps, revealing chromosome-territory boundaries, inter-chromosomal contacts, and distance-decay patterns below the raw data's noise floor.
- **Epigenomic track prediction**: predicts five chromatin tracks (DNase, CTCF, H3K27ac, H3K27me3, H3K4me3) from the contact map, useful for non-model organisms with no ChIP-seq data.
- **Seq2HiC prediction**: predicts a contact map from DNA sequence alone, for comparison against the observed map.

Toggle between original, enhanced, and predicted views in real time. All ML outputs clear automatically on a curation operation, and persist in saved sessions.

![Evo2HiC enhancement, King quail, original](docs/images/evo2hic-quail-original.png)
*Original Hi-C overview of King quail (Coturnix chinensis): 645 contigs, 30 chromosomes.*

![Evo2HiC enhancement, King quail, enhanced](docs/images/evo2hic-quail-enhanced.png)
*The same genome after Evo2HiC enhancement: inter-chromosomal contacts and distance-decay gradients become visible.*

### Misassembly detection

Automatic flagging of potential chimeric contigs from TAD-boundary and compartment-switch signals that fall inside a contig rather than at its edges, shown as orange MIS badges. Cut suggestions with composite confidence scoring, a step-by-step cut-review panel with camera navigation, algorithmic inversion and translocation pattern detection, and automatic scaffold (chromosome block) detection. Join support scores every contig junction by whether Hi-C contact carries across the boundary and flags the unsupported ones as weak joins, skipping intended chromosome boundaries between assigned scaffolds. A haplotig detector flags retained haplotigs from the bright duplicate block they leave against their homologous primary, reported as confirmed when read coverage near half the assembly median agrees and as an unconfirmed candidate otherwise, with a button to tag the confirmed ones.

### Export and import

AGP 2.1, BED6, and FASTA (with reverse complement for inverted contigs), PNG screenshots, BedGraph and TSV for every analysis track, session save and load (JSON with the full undo stack and analysis data), curation-log export, and AI-strategy JSON. Load a reference FASTA for curated sequence export, or a BedGraph file for a custom track. AGP import reads a prior curation and applies its contig order, orientation, and scaffold grouping back onto the loaded assembly, matching contigs by name and leaving any not named in the file at the tail.

### Scripting

An 18-command curation DSL covering every operation, with contig references by name or index (`#0`, `#15`), a script console with syntax highlighting, and replay from a curation log. Every UI curation operation has a script equivalent.

### Tutorials and example data

Ten interactive lessons with step-by-step instructions, hints, and UI highlighting, spanning reading the map, detecting and fixing misassemblies, scaffold assignment, 3D genomics analysis, meta tags, automated detection, and ML enhancement, ending in a self-checked full curation exercise. Ships with 10 curated GenomeArk specimens (mammals, birds, reptiles, fish, amphibians, invertebrates) loadable from the welcome screen, alongside the pattern gallery.

### Also included

Live assembly metrics (contig and scaffold N50/L50, N90/L90, auN, totals, per-contig stats, and the fraction assigned to scaffolds) with delta tracking, shown against the EBP `6.C.Q40` reference thresholds for contiguity and chromosome assignment; base accuracy (QV) is reported as not assessed, since a Hi-C map carries no read-level data to measure it. Real-time curation-progress scoring (Kendall tau against a reference ordering with trend arrows), annotation tracks from embedded `.pretext` graph extensions (coverage, gaps, telomeres, repeat density) or uploaded BedGraph files, four interaction modes (Navigate, Edit, Scaffold, Waypoint), a fuzzy command palette, and a CLI benchmark pipeline for evaluating the AutoSort and AutoCut algorithms against stored baselines.

## Keyboard shortcuts

Press `?` at any time for the full reference.

| Key | Action |
|-----|--------|
| `E` | Edit mode (cut / join / invert / move) |
| `S` | Scaffold painting mode |
| `W` | Waypoint mode |
| `Esc` | Navigate mode |
| `C` | Cut contig at cursor (edit mode) |
| `J` | Join selected contigs (edit mode), or jump to diagonal |
| `F` | Flip / invert selected (edit mode) |
| `H` | Toggle contig exclusion (edit mode) |
| `N` | Create a scaffold (scaffold mode) |
| `Option+S` / `Alt+S` | Auto Sort (edit mode) |
| `Option+C` / `Alt+C` | Auto Cut (edit mode) |
| `P` | Toggle comparison mode |
| `L` | Toggle contig grid |
| `I` | Toggle info sidebar |
| `X` | Toggle annotation tracks |
| `M` | Toggle minimap |
| `` ` `` | Script console |
| `]` / `.` | Next waypoint |
| `[` / `,` | Previous waypoint |
| `Up` / `Down` | Cycle color maps |
| `Left` / `Right` | Adjust gamma |
| `Home` | Reset view |
| `Cmd+K` | Command palette |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / redo |
| `Cmd+O` | Open file |
| `Cmd+S` | Screenshot |
| `Cmd+A` | Select all contigs (edit mode) |

## Curation workflow

**Manual.** Load a `.pretext` file, press `E` for edit mode, select contigs (click, shift-click for a range, ctrl-click to toggle), then cut (`C`), join (`J`), invert (`F`), and drag to reorder. Press `H` to exclude a contig from export, `S` to paint contigs into scaffolds, and export the result as AGP, BED, or FASTA. Toggle comparison mode (`P`) to see original versus curated boundaries.

**Automated.** Open the command palette (`Cmd+K`) and run **Auto cut: detect breakpoints**, then **Auto sort: Union Find**. Each cut and each sort operation is a separate undo step.

**AI-assisted.** Open the AI Assist panel, enter your Anthropic API key, choose a prompt strategy, and click **Analyze Map**. Review the suggestions and click **Run** to execute any DSL block. Browse or share strategies at [openpretext-strategies](https://github.com/shandley/openpretext-strategies).

**Scripting.** Open the script console (`` ` `` or the **Console** button) and run scripts with Ctrl+Enter, or generate one from the curation log with **From Log**. Type `help` for the DSL reference.

```
invert chr3                 # flip a misoriented contig
move #5 to 0                # move a contig to a new position
cut chr1 500                # cut at a pixel offset
join chr1_L chr1_R          # join two adjacent contigs
scaffold create Chromosome_1
scaffold paint #0 Chromosome_1
autocut
autosort
```

## File format support

- **`.pretext`**: native BC4-compressed contact maps from [PretextMap](https://github.com/sanger-tol/PretextMap), including embedded graph extensions from [PretextGraph](https://github.com/sanger-tol/PretextGraph).
- **`.bedgraph`**: annotation tracks loaded with the **Load Track** button.
- **`.fasta`**: reference sequences loaded with **Load FASTA** for curated export.
- **`.agp`**: a prior curation loaded with **Import AGP**, applying its order, orientation, and scaffold grouping to the current assembly.

For the binary format details, see [docs/PRETEXT_FORMAT.md](docs/PRETEXT_FORMAT.md).

## Development

```bash
npm run dev            # development server with hot reload (http://localhost:3000)
npm test               # unit tests (2,362 tests across 89 files, Vitest)
npm run test:visual    # end-to-end tests (35 tests, Playwright + Chromium)
npm run build          # production build to dist/
npm run preview        # preview the production build
```

### Benchmarks

```bash
npm run bench:acquire      # download test specimens from GenomeArk
npm run bench:run          # execute benchmarks
npm run bench:sweep        # sweep parameter ranges
npm run bench:regression   # compare against stored baselines
```

### Technology

TypeScript in strict mode, Vite for development and builds, WebGL2 for rendering, and [pako](https://github.com/nodeca/pako) as the single runtime dependency (for deflate decompression). Vitest and Playwright for testing. The UI is plain DOM, with no framework. The optional Evo2HiC server is Python and FastAPI.

<details>
<summary>Project structure</summary>

```
src/
  main.ts                    application entry point and orchestrator
  core/                      State (undo/redo), EventBus, DerivedState
  formats/                   .pretext parser (BC4/deflate), FASTA, BedGraph, synthetic data
  renderer/                  WebGL2 renderer, camera, tile LOD + decode worker, color maps,
                             labels, minimap, tracks, scaffold and waypoint overlays, reorder
  curation/                  cut/join/invert/move engine, selection, drag reorder, scaffolds,
                             waypoints, exclusion, misassembly flags, meta tags, AutoCut,
                             AutoSort, batch ops, quality and ordering metrics
  ai/                        Anthropic vision client, context builder, prompts, feedback, IO
  data/                      loaders for specimen catalog, lessons, prompt strategies
  scripting/                 DSL parser, executor, log-to-script replay
  analysis/                  insulation, P(s) decay, compartments, ICE and KR balancing,
                             directionality, library quality, saddle, virtual 4C, telomere,
                             misassembly, checkerboard, centromere, health score, scaffold and
                             pattern detection, curation progress, background worker + client,
                             Evo2HiC client and enhancement utilities
  export/                    AGP, BED, FASTA, analysis (BedGraph/TSV), PNG, curation log
  io/                        session save/load
  ui/                        38 UI modules (plain DOM)
public/data/                 specimen catalog (10 species), lessons (10), pattern gallery,
                             prompt strategies (8)
tests/                       unit (89 files) and e2e (Playwright)
bench/                       benchmark CLI, runner, regression, metrics, GenomeArk acquire
server/                      optional Evo2HiC server (Python / FastAPI)
```

</details>

## Obtaining test data

The quickest way to get real data is **Load Example** in the app, which downloads a curated GenomeArk specimen. For more assemblies, [GenomeArk](https://www.genomeark.org/) hosts public genome data, including Hi-C contact maps, from the Vertebrate Genomes Project.

## Background

PretextView is a core tool in genome assembly curation, used to visualize Hi-C contact maps and arrange contigs into chromosomes. It is developed by the Wellcome Sanger Institute as part of the Pretext suite:

- [PretextMap](https://github.com/sanger-tol/PretextMap): converts aligned Hi-C reads into `.pretext` contact maps.
- [PretextView](https://github.com/sanger-tol/PretextView): desktop viewer for manual curation.
- [PretextGraph](https://github.com/sanger-tol/PretextGraph): embeds BedGraph annotation tracks into `.pretext` files.
- [PretextSnapshot](https://github.com/sanger-tol/PretextSnapshot): command-line screenshot tool.

OpenPretext provides a browser-based alternative that works on any platform, requires no installation, supports trackpad input, and offers scriptable and AI-assisted curation.

## License

[MIT](LICENSE)

## Acknowledgments

- The [Pretext suite](https://github.com/sanger-tol) by the Wellcome Sanger Institute Tree of Life programme.
- [GenomeArk](https://www.genomeark.org/) and the Vertebrate Genomes Project for public genome assembly data.
- The Darwin Tree of Life, Earth BioGenome Project, and genome curation communities.
