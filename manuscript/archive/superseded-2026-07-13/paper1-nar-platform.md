---
title: "OpenPretext: a browser platform for Hi-C contact map curation, 3D genome analysis, and ML-powered enhancement"
author:
  - name: Scott A. Handley
    affiliation: "Department of Pathology and Immunology, Washington University School of Medicine, St. Louis, MO, USA"
    email: shandley@wustl.edu
    corresponding: true
bibliography: references-paper1.bib
output:
  word_document:
    reference_docx: nar-template.docx
---

# Abstract

Genome assembly curation, the manual correction of Hi-C contact maps, is a bottleneck in chromosome-scale genome projects. Curators currently rely on separate tools for visualization (PretextView), analysis (cooler, FAN-C), normalization (custom scripts), and machine learning (external pipelines), with no single platform integrating these capabilities. We present OpenPretext, a browser-native platform that unifies Hi-C contact map visualization, assembly curation, 3D genomics analysis, and ML-powered enhancement in a zero-installation interface. The platform includes a reverse-engineered parser for the .pretext binary format; automated curation algorithms (AutoSort and AutoCut) that achieve a mean Kendall's tau of 0.988 across 34 GenomeArk specimens spanning 7 taxonomic groups; a 3D genomics analysis suite comprising 21 modules for insulation scoring, contact decay, A/B compartment analysis, ICE and KR normalization, and directionality index computation; an entropy-based checkerboard score for quantifying compartment regularity with reference comparison against 1,025 species; centromere prediction from inter-chromosomal contact hubs; integration with the Evo2HiC foundation model for contact map resolution enhancement, epigenomic track prediction, and sequence-to-Hi-C prediction; and an education system with 10 progressive tutorial lessons. OpenPretext is implemented in TypeScript (27,137 lines, 2,278 tests) and is freely available under the MIT license at https://github.com/shandley/openpretext with a live demo at https://shandley.github.io/openpretext/.

# Introduction

Hi-C chromatin conformation capture data are essential for scaffolding genome assemblies into chromosomes (Lieberman-Aiden et al., 2009; Burton et al., 2013). Contact maps, two-dimensional heatmaps of pairwise chromatin interaction frequencies, serve as the primary visualization for evaluating assembly quality and guiding curation (Rao et al., 2014). Manual curation of these maps remains a requirement for reference-quality genomes submitted through the Vertebrate Genomes Project, Darwin Tree of Life, Earth BioGenome Project, and ERGA (Rhie et al., 2021; Blaxter et al., 2022; Lewin et al., 2018; ERGA Consortium, 2024). Howe et al. (2021) demonstrated that curation significantly improves assembly quality, but the process depends on trained specialists and typically requires 2-8 hours per genome.

The current tool landscape is fragmented. PretextView (Harry, 2022a) provides desktop contact map visualization and manual curation but requires local installation, a three-button mouse (a documented prerequisite in training workshops), and post-processing scripts to produce FASTA output. It has no scripting capability, no 3D genomics analysis, no assembly quality metrics, and a single-step undo with global scope. Juicebox (Durand et al., 2016) and HiGlass (Kerpedjiev et al., 2018) offer interactive visualization but do not support curation operations or read the .pretext format used across genome assembly pipelines. Analysis tools such as cooler (Abdennur and Mirny, 2020), FAN-C (Kruse et al., 2020), and HiCExplorer (Wolff et al., 2020) provide computational methods for insulation scoring, compartment analysis, and normalization, but require command-line expertise and separate installations. Recent machine learning approaches, including AutoHiC (Zhang et al., 2024) and Evo2HiC (Yang et al., 2025, preprint), have applied deep learning to automate assembly error correction and contact map enhancement, but these tools operate upstream of or independently from the visual curation workflow. No existing tool integrates browser-native .pretext visualization, curation with full undo/redo, 3D genomics analysis, and educational resources in a zero-installation interface.

Here we present OpenPretext, a browser-native platform that addresses this fragmentation. OpenPretext reads .pretext files directly in the browser, provides automated curation with full undo/redo, computes 3D genomics analyses in a background Web Worker, supports optional ML-powered enhancement via a companion server, and includes a 10-lesson education system, all accessible from a single URL with no installation.

# Platform overview

## Architecture

OpenPretext is implemented in TypeScript with strict mode, rendered using WebGL2, and built with Vite. The sole runtime dependency is pako for deflate decompression. The codebase comprises 27,137 lines across 110 modules, validated by 2,278 unit tests and 35 end-to-end tests. All user interface elements are pure DOM manipulation with no framework dependencies, keeping the production bundle compact.

The application includes the first publicly documented parser for the .pretext binary format, which uses BC4 (RGTC1) texture compression with raw deflate encoding. The full specification is published at docs/PRETEXT\_FORMAT.md. A tile-based level-of-detail system with LRU caching enables smooth interaction with genomes up to 32,768 pixels per side. For initial display, a coarsest-only loading mode assembles a downsampled overview (typically 1,024 x 1,024 pixels) from the smallest mipmap level of each tile.

## Curation engine

The curation engine supports cut, join, invert, and move operations with unlimited undo/redo; each operation records sufficient reversal data in the undo stack for complete backward traversal, and the full history is displayed in a sidebar panel. Scaffold assignment uses a visual painting mode with per-scaffold color coding. Batch operations enable selection by name pattern or size range, followed by batch cut, join, invert, or sort. A domain-specific language with 18 commands provides scripted curation workflows reproducible across sessions; a replay system reconstructs scripts from operation logs automatically. Export formats include AGP 2.1, BED6, FASTA (with reverse complement for inverted contigs), PNG screenshots, and JSON sessions with full analysis state. The platform runs in any modern browser with no installation: it works on desktop computers, laptops using trackpad gestures, and tablets.

Two automated curation algorithms are integrated. AutoSort, a Union Find-based contig chaining algorithm, orders and orients contigs by scoring pairwise Hi-C link strengths across four orientations and greedily building chromosome-scale chains with hierarchical merging. AutoCut detects misassembly breakpoints by analyzing diagonal signal density with adaptive thresholds and centromere verification. Benchmarking across 34 GenomeArk specimens spanning 7 taxonomic groups yields a mean Kendall's tau of 0.988 for ordering accuracy and zero false positive breakpoints for 91% of specimens (Handley, 2026).

# 3D genomics analysis suite

OpenPretext integrates 21 analysis modules that operate on the overview contact map in a background Web Worker, keeping the interface responsive during computation. Results are displayed as interactive annotation tracks overlaid on the contact map and can be exported as BedGraph or TSV files. Table 1 summarizes the analysis capabilities.

**Core analyses.** Insulation score computation uses a sliding off-diagonal window (Crane et al., 2015) to quantify local interaction strength, with TAD boundaries detected as prominent local minima. P(s) contact decay analysis fits a power-law exponent to the relationship between contact frequency and genomic distance; the exponent (typically -1.0 to -1.5 for well-compacted genomes) and R-squared goodness-of-fit are displayed alongside an interactive SVG chart with baseline comparison. A/B compartment analysis computes the observed/expected ratio, correlation matrix, and first eigenvector via power iteration, rendered as a heatmap track. Per-chromosome P(s) curves can be computed independently for each scaffold.

**Normalization.** ICE normalization (Imakaev et al., 2012) iteratively balances row and column sums using the Sinkhorn-Knopp algorithm, with low-coverage bins masked by quantile filtering. KR normalization (Knight and Ruiz, 2013) provides an alternative with tighter convergence. Both methods produce bias vector tracks and re-trigger downstream analyses on the corrected matrix.

**Advanced metrics.** The directionality index (Dixon et al., 2012) computes signed chi-square scores per bin with boundary detection at zero crossings. Saddle plots digitize bins by eigenvector quantile and compute mean O/E per quantile pair, visualized as an inline SVG heatmap. Virtual 4C extracts the contact profile at any viewpoint bin via Alt+click, normalized by distance-expected values. Hi-C library quality metrics (cis/trans ratio, short/long range ratio, contact density) integrate into the composite health score.

**Comparative genomics metrics.** The checkerboard score implements the entropy-based compartment regularity metric from HiArch (Che et al., 2026). For each chromosome, cosine distances between row pairs at near-diagonal offsets are histogrammed and their Shannon entropy computed; lower entropy indicates stronger, more regular A/B alternation. After computation, a reference panel compares the result against 1,025 species from the HiArch dataset, showing the nearest landmark species, matching taxonomic group, and approximate percentile.

**Table 3.** Checkerboard score reference data by taxonomic group (Che et al., 2026). Median entropy from 1,025 species; lower entropy indicates stronger compartment regularity. Species count reflects the HiArch dataset composition.

| Taxonomic group | Species (n) | Median entropy | Interpretation |
|-----------------|:-----------:|:--------------:|----------------|
| Mammals | 45 | 2.88 | Strongest compartmentalization |
| Birds | 35 | 2.82 | Strong; especially passerines |
| Reptiles | 15 | 2.75 | Intermediate; some one-compartment |
| Fish | 31 | 2.70 | Variable across teleosts |
| Amphibians | 8 | 2.65 | Moderate; limited sampling |
| Invertebrates | 766 | 2.60 | Highly variable |
| Plants | 107 | 2.58 | Weak; favor linear gene clustering |
| Fungi | 22 | 2.50 | Minimal compartmentalization |

**Structural feature detection.** Centromere positions are predicted using the CenterFinder algorithm (Che et al., 2026), which identifies inter-chromosomal contact hubs by computing per-contig inter-block row sums, blending with anti-diagonal Rabl folding signal, Gaussian smoothing, and peak detection. Telomere positions are detected by scanning loaded FASTA sequences for TTAGGG/CCCTAA repeat motifs at contig ends. Together, centromere and telomere tracks provide a complete chromosome structural map from Hi-C data and sequence alone, without external annotation. Misassembly detection identifies chimeric contigs by finding TAD boundaries and compartment eigenvector sign changes that fall inside (not at edges of) contigs, with composite confidence scoring (TAD 50%, compartment 30%, decay 20%) and a guided cut review panel.

**Composite health score.** A 0-100 score combines five weighted components: contiguity via N50 (20%), P(s) decay quality (25%), assembly integrity from misassembly count (20%), compartment strength blending eigenvector magnitude with checkerboard score (15%), and Hi-C library quality from cis/trans ratio (20%). The score is displayed as a card in the sidebar with component breakdown and sparkline history across curation operations.

**Table 1.** 3D genomics analysis modules in OpenPretext. All modules operate on the overview contact map and run in a background Web Worker. Output types: L = line track, H = heatmap track, M = marker track, S = scalar metric, C = chart.

| Module | Method | Reference | Output |
|--------|--------|-----------|--------|
| Insulation score | Sliding off-diagonal window | Crane et al., 2015 | L |
| TAD boundaries | Local minima of insulation | Crane et al., 2015 | M |
| P(s) contact decay | Power-law fit in log-log space | -- | S, C |
| Per-chromosome P(s) | Scaffold-aware decay curves | -- | C |
| A/B compartments | O/E, correlation matrix, PCA eigenvector | Lieberman-Aiden et al., 2009 | H |
| ICE normalization | Sinkhorn-Knopp iterative balancing | Imakaev et al., 2012 | L |
| KR normalization | Knight-Ruiz iterative balancing | Knight and Ruiz, 2013 | L |
| Directionality index | Signed chi-square statistic | Dixon et al., 2012 | L, M |
| Saddle plot | O/E by eigenvector quantile | Rao et al., 2014 | C |
| Virtual 4C | Distance-normalized contact profile | -- | L |
| Hi-C library quality | Cis/trans, short/long, density | -- | L, S |
| Checkerboard score | Cosine distance entropy | Che et al., 2026 | S |
| Centromere detection | Inter-contig contact hub peaks | Che et al., 2026 | L, M |
| Telomere detection | TTAGGG/CCCTAA repeat scanning | -- | M |
| Misassembly detection | Internal TAD + compartment signals | -- | M |
| Pattern detection | Anti-diagonal and off-diagonal ratios | -- | S |
| Scaffold detection | Block-diagonal boundary scoring | -- | S |
| Composite health score | 5-component weighted metric | -- | S |
| Curation progress | Kendall tau vs reference ordering | -- | S |

# ML-powered enhancement

OpenPretext supports optional integration with Evo2HiC (Yang et al., 2025, preprint), a deep learning model for Hi-C contact map enhancement trained on 177 species, via a companion server implemented in Python with FastAPI. This feature is optional and requires a separate Python process with GPU resources; the core curation and analysis functionality of OpenPretext does not depend on it.

When Evo2HiC model weights are available (via the Zenodo checkpoint), the server exposes three capabilities. **Resolution enhancement** uses the CDNA2d model (81 million parameters) to denoise low-resolution overview contact maps and sharpen chromosome boundaries; the enhanced map can be toggled against the original in real time and feeds into downstream analyses. **Epigenomic track prediction** uses the CDNAtrack model to predict five epigenomic tracks (DNase I hypersensitivity, CTCF binding, H3K27ac, H3K27me3, H3K4me3) from the contact map, providing chromatin state context for non-model organisms lacking ChIP-seq data. **Sequence-to-Hi-C prediction** generates an expected contact map from DNA sequence alone via the Seq2HiC model, enabling comparison between observed and sequence-predicted patterns that may reveal misassemblies or library biases.

When model weights are not available, the server provides a mock inference mode using Gaussian smoothing and bicubic upscaling; this is suitable for testing the interface but does not replicate Evo2HiC model output. The server auto-detects available hardware (CUDA, Apple Silicon MPS, or CPU). All ML outputs are cleared on curation operations and persisted in session files.

# Education and accessibility

OpenPretext includes 10 progressive tutorial lessons spanning beginner to advanced difficulty, covering contact map reading, chromosome identification, misassembly detection, curation operations, scaffold assignment, automated curation, 3D genomics analysis, contig classification, automated misassembly detection, and ML-enhanced workflows. Lessons use a 10-specimen teaching corpus from GenomeArk with curated difficulty ratings spanning mammals, birds, reptiles, fish, amphibians, and invertebrates. A pattern gallery illustrates 11 diagnostic Hi-C patterns with clickable navigation to example regions.

The capstone lesson includes self-assessment via Kendall's tau comparison against ground truth. An experimental AI-assisted mode uses a vision language model API to analyze contact map screenshots and suggest executable DSL commands; prompt strategies can be exported and shared between users via a community repository.

Browser-native deployment eliminates installation barriers. Genome curation workshops and university courses can use OpenPretext immediately from a URL, which is relevant for distributed initiatives such as ERGA that coordinate across dozens of institutions with heterogeneous computing environments (ERGA Consortium, 2024).

# Discussion

Table 2 compares OpenPretext to existing tools across visualization, curation, analysis, and machine learning dimensions. No other single tool spans all four. PretextView provides curation but no analysis, no scripting, no FASTA export without post-processing scripts, and a single-step undo; it requires local installation and a three-button mouse, which is a documented prerequisite in training workshops and a practical barrier for laptop users and global collaborators. Juicebox and HiGlass offer visualization but not curation. cooler, FAN-C, and HiCExplorer provide analysis but require command-line installation and do not read .pretext files.

The accessibility contrast matters at scale. Distributed genome assembly initiatives such as ERGA coordinate curation across dozens of institutions with heterogeneous hardware. Workshop participants frequently work on laptops without external mice. Browser-native deployment removes these barriers entirely: OpenPretext loads from a URL, requires no installation, and operates with mouse, trackpad, or touch input.

**Table 2.** Feature comparison across Hi-C tools. Columns grouped by capability dimension. PretextView is the standard .pretext curation tool; Juicebox and HiGlass are visualization tools; cooler and FAN-C are analysis libraries.

| Feature | OpenPretext | PretextView | Juicebox | HiGlass | cooler | FAN-C |
|---------|:-----------:|:-----------:|:--------:|:-------:|:------:|:-----:|
| **Deployment** | | | | | | |
| Browser-based (no install) | Yes | -- | Web + Desktop | Server | -- | -- |
| Reads .pretext format | Yes | Yes | -- | -- | -- | -- |
| Reads .hic format | -- | -- | Yes | Yes | -- | -- |
| Reads .cool/.mcool format | -- | -- | -- | Yes | Yes | Yes |
| Works without mouse (trackpad/touch) | Yes | -- | Partial | Partial | -- | -- |
| **Visualization** | | | | | | |
| Tile-based LOD rendering | Yes | Yes | -- | Yes | -- | -- |
| Annotation tracks | Yes | Embedded only | Yes | Yes | -- | Yes |
| Color maps | 6 | Yes | Yes | Yes | -- | -- |
| Assembly comparison overlay | Yes | -- | -- | -- | -- | -- |
| **Curation** | | | | | | |
| Cut / join / invert / move | Yes | Yes | JBAT only | -- | -- | -- |
| Undo/redo | Unlimited stack | Single-step, global | -- | -- | -- | -- |
| Scaffold/chromosome assignment | Yes | Yes | -- | -- | -- | -- |
| Contig meta tags | Yes | Yes | -- | -- | -- | -- |
| Automated contig ordering | Yes | Yes (Pixel Sort) | -- | -- | -- | -- |
| Breakpoint detection | Yes | Yes (Pixel Cut) | -- | -- | -- | -- |
| Batch operations | Yes | -- | -- | -- | -- | -- |
| Scripting / DSL | Yes (18 commands) | -- | -- | -- | -- | -- |
| Reproducible curation logs | Yes | -- | -- | -- | -- | -- |
| Assembly quality metrics | Yes (N50/L50/N90) | -- | -- | -- | -- | -- |
| **Export** | | | | | | |
| AGP 2.1 | Yes (full precision) | Yes (texel-limited) | -- | -- | -- | -- |
| BED6 | Yes | -- | -- | -- | -- | -- |
| FASTA (with rev-comp) | Yes | External scripts | -- | -- | -- | -- |
| Analysis data (BedGraph/TSV) | Yes (8 formats) | -- | -- | -- | -- | -- |
| **Analysis** | | | | | | |
| Insulation score + TADs | Yes | -- | -- | -- | Yes | Yes |
| A/B compartments | Yes | -- | -- | -- | Yes | Yes |
| P(s) contact decay | Yes | -- | -- | -- | Yes | Yes |
| ICE normalization | Yes | -- | -- | -- | Yes | Yes |
| KR normalization | Yes | -- | -- | -- | -- | Yes |
| Directionality index | Yes | -- | -- | -- | -- | Yes |
| Saddle plot | Yes | -- | -- | -- | Yes | Yes |
| Virtual 4C | Yes | -- | -- | -- | -- | Yes |
| Checkerboard score | Yes | -- | -- | -- | -- | -- |
| Centromere detection | Yes | -- | -- | -- | -- | -- |
| Telomere detection | Yes | Tracks only | -- | -- | -- | -- |
| Misassembly detection | Yes | -- | -- | -- | -- | -- |
| Composite health score | Yes | -- | -- | -- | -- | -- |
| Runs in background (non-blocking) | Yes | -- | -- | -- | -- | -- |
| **ML / AI** | | | | | | |
| Resolution enhancement | Yes (optional) | -- | -- | -- | -- | -- |
| Epigenomic track prediction | Yes (optional) | -- | -- | -- | -- | -- |
| Sequence-to-Hi-C | Yes (optional) | -- | -- | -- | -- | -- |
| AI-assisted curation | Yes (experimental) | -- | -- | -- | -- | -- |
| **Education** | | | | | | |
| Interactive tutorial lessons | 10 | -- | -- | -- | -- | -- |
| Hi-C pattern gallery | 11 patterns | -- | -- | -- | -- | -- |
| Curated teaching specimens | 10 genomes | -- | -- | -- | -- | -- |
| Self-assessment scoring | Yes | -- | -- | -- | -- | -- |
| **License** | MIT | MIT | MIT | MIT | BSD | MIT |

The checkerboard score and centromere detection, adapted from Che et al. (2025), provide comparative genomics context that is novel for a curation tool. Placing an assembly's compartment regularity against 1,025 species gives curators an evolutionary reference frame, and predicting centromere positions from Hi-C alone is valuable for non-model organisms lacking cytogenetic data.

Several limitations should be noted. The automated curation algorithms operate on the downsampled overview contact map, limiting precision for small contigs. The ML server is optional and requires a separate Python process. The checkerboard species reference data are derived from a single study and may not represent all lineages equally. WebGL2 is required, though it is supported by all current browsers.

Future directions include real-time collaborative curation sessions, streaming of .pretext files from cloud repositories, and expansion of the ML model suite as new foundation models for Hi-C become available.

# Availability

OpenPretext is implemented in TypeScript (27,137 lines) with a Python companion server (1,648 lines) and is freely available under the MIT license at https://github.com/shandley/openpretext. A live demo is at https://shandley.github.io/openpretext/. The codebase includes 2,278 unit tests and 35 end-to-end tests. The .pretext binary format specification is at docs/PRETEXT\_FORMAT.md.

# Acknowledgements

We thank the Wellcome Sanger Institute Tree of Life programme for developing the Pretext suite, GenomeArk and the Vertebrate Genomes Project for public genome assemblies, and the Darwin Tree of Life, Earth BioGenome Project, and genome curation communities.

# Funding

(To be completed)

# References

Abdennur,N. and Mirny,L.A. (2020) Cooler: scalable storage for Hi-C data and other genomically labeled arrays. *Bioinformatics*, **36**, 311-316.

Blaxter,M. et al. (2022) Why sequence all eukaryotes? *Proc. Natl. Acad. Sci. USA*, **119**, e2115636118.

Burton,J.N. et al. (2013) Chromosome-scale scaffolding of de novo genome assemblies based on chromatin interactions. *Nat. Biotechnol.*, **31**, 1119-1125.

Che,Y. et al. (2026) The evolution of high-order genome architecture revealed from 1,000 species. *Cell*, **189**, doi:10.1016/j.cell.2026.03.016.

Crane,E. et al. (2015) Condensin-driven remodelling of X chromosome topology during dosage compensation. *Nature*, **523**, 240-244.

Dixon,J.R. et al. (2012) Topological domains in mammalian genomes identified by analysis of chromatin interactions. *Nature*, **485**, 376-380.

Dudchenko,O. et al. (2017) De novo assembly of the *Aedes aegypti* genome using Hi-C yields chromosome-length scaffolds. *Science*, **356**, 92-95.

Durand,N.C. et al. (2016) Juicebox provides a visualization system for Hi-C contact maps with unlimited zoom. *Cell Syst.*, **3**, 99-101.

ERGA Consortium (2024) The European Reference Genome Atlas: piloting a decentralised approach to equitable biodiversity genomics. *npj Biodivers.*, **3**, 28.

Ghurye,J. et al. (2019) Integrating Hi-C links with assembly graphs for chromosome-scale assembly. *PLoS Comput. Biol.*, **15**, e1007273.

Handley,S.A. (2026) AutoSort and AutoCut: automated contig ordering and breakpoint detection for Hi-C contact map curation. *Bioinformatics*, (submitted).

Harry,E. (2022a) PretextView: Desktop application for viewing pretext contact maps. https://github.com/sanger-tol/PretextView

Harry,E. (2022b) PretextMap: Paired Read Texture Mapper. https://github.com/sanger-tol/PretextMap

Howe,K. et al. (2021) Significantly improving the quality of genome assemblies through curation. *GigaScience*, **10**, giaa153.

Imakaev,M. et al. (2012) Iterative correction of Hi-C data reveals hallmarks of chromosome organization. *Nat. Methods*, **9**, 999-1003.

Kerpedjiev,P. et al. (2018) HiGlass: web-based visual exploration and analysis of genome interaction maps. *Genome Biol.*, **19**, 125.

Knight,P.A. and Ruiz,D. (2013) A fast algorithm for matrix balancing. *IMA J. Numer. Anal.*, **33**, 1029-1047.

Kruse,K. et al. (2020) FAN-C: a feature-rich framework for the analysis and visualisation of chromosome conformation capture data. *Genome Biol.*, **21**, 303.

Lewin,H.A. et al. (2018) Earth BioGenome Project: Sequencing life for the future of life. *Proc. Natl. Acad. Sci. USA*, **115**, 4325-4333.

Lieberman-Aiden,E. et al. (2009) Comprehensive mapping of long-range interactions reveals folding principles of the human genome. *Science*, **326**, 289-293.

Rao,S.S.P. et al. (2014) A 3D map of the human genome at kilobase resolution reveals principles of chromatin looping. *Cell*, **159**, 1665-1680.

Rhie,A. et al. (2021) Towards complete and error-free genome assemblies of all vertebrate species. *Nature*, **592**, 737-746.

Wolff,J. et al. (2020) Galaxy HiCExplorer 3: a web server for reproducible Hi-C, capture Hi-C and single-cell Hi-C data analysis, quality control and visualization. *Nucleic Acids Res.*, **48**, W177-W184.

Yang,Y. et al. (2025) Evo2HiC: a multi-species foundation model for Hi-C contact map enhancement and epigenomic track prediction. *bioRxiv*, doi:10.1101/2025.11.18.689171.

Zhang,T. et al. (2024) AutoHiC: a deep-learning method for automatic and accurate chromosome-level genome assembly. *Nucleic Acids Res.*, **52**, e92.

Zhou,C. et al. (2023) YaHS: yet another Hi-C scaffolding tool. *Bioinformatics*, **39**, btac808.
