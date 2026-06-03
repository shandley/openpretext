# OpenPretext Two-Paper Strategy

## Paper 1: NAR Web Server Issue -- Platform Paper

### Title
"OpenPretext: a browser platform for Hi-C contact map curation, 3D genome analysis, and ML-powered enhancement"

### Target
Nucleic Acids Research -- Web Server Issue (annual, deadline typically ~January, published July)

### Format
~4,000 words, 3-5 figures, 2-3 tables, ~25 references

### Narrative
OpenPretext is the first tool to unify Hi-C contact map visualization, genome assembly curation, 3D genomics analysis, machine learning enhancement, and comparative genomics metrics in a zero-installation browser interface. It eliminates the need for separate tools (PretextView for curation, cooler/fanc for analysis, custom scripts for normalization, external ML pipelines for enhancement) by integrating all capabilities into a single URL.

### Structure

**Introduction (~600 words)**
- Hi-C curation bottleneck (brief -- 2 paragraphs)
- The fragmented tool landscape: curation (PretextView), analysis (cooler, fanc, HiCExplorer), visualization (HiGlass, Juicebox), ML (Evo2HiC) are all separate
- No existing tool spans curation + analysis + ML in one interface
- OpenPretext addresses this with a browser-native integrated platform

**Platform Overview (~800 words)**
- Architecture: TypeScript + WebGL2, single dependency, 26,836 lines, 2,258 tests
- Reverse-engineered .pretext parser (first public specification)
- Curation engine: cut/join/invert/move, unlimited undo, 18-command DSL, batch operations
- Automated curation: AutoSort (Union Find chaining) and AutoCut (diagonal signal breakpoint detection) -- summarize in 1-2 paragraphs, point to Paper 2 for details
- Export: AGP, BED, FASTA, PNG, session save/load

**3D Genomics Analysis Suite (~800 words)**
- Core: insulation score + TAD boundaries, P(s) contact decay, A/B compartments
- Normalization: ICE (Imakaev 2012) and KR (Knight & Ruiz 2013)
- Advanced: directionality index, saddle plot, Virtual 4C, Hi-C library quality
- Checkerboard score (Che et al. 2025): entropy-based compartment regularity with species reference comparison (1,025 species from HiArch)
- Centromere detection: CenterFinder algorithm from inter-chromosomal contact hubs
- Telomere detection: FASTA-based repeat scanning
- Misassembly detection: TAD + compartment chimera flagging with confidence scoring and guided cut review
- Composite health score: 5-component 0-100 metric (N50, P(s), integrity, compartments+checkerboard, library quality)
- All run in background Web Worker; results as interactive overlay tracks

**ML-Powered Enhancement (~600 words)**
- Companion FastAPI server with 3 Evo2HiC capabilities:
  1. Resolution enhancement (CDNA2d, 81M params, 177 species)
  2. Epigenomic track prediction (CDNAtrack -- DNase, CTCF, H3K27ac, H3K27me3, H3K4me3)
  3. Seq2HiC (predict Hi-C from DNA sequence alone)
- Mock mode for testing; real weights from Zenodo
- GPU auto-detection (MPS/CUDA)
- Enhanced maps feed into downstream analysis
- Key use case: non-model organisms with no ChIP-seq data

**Education and Accessibility (~400 words)**
- 10 progressive tutorial lessons (beginner to advanced)
- 10-specimen teaching corpus from GenomeArk
- 11-pattern Hi-C pattern gallery
- Self-assessment via Kendall tau
- AI-assisted curation with Claude vision API (8 strategies)
- Zero installation -- works from a URL

**Results Highlights (~600 words)**
- AutoSort: mean tau=0.988 across 34 genomes, 7 taxonomic groups (brief, point to Paper 2)
- Checkerboard scores for teaching specimens placed against 1,025-species reference
- Health score validation across diverse assemblies
- ML enhancement before/after on King quail (visual comparison)
- Centromere detection validated against known positions (if available)

**Discussion (~400 words)**
- Feature comparison table: OpenPretext vs PretextView vs Juicebox vs HiGlass vs cooler
- Browser deployment advantages for workshops, courses, global collaborations
- Limitations: overview resolution, WebGL2 requirement, ML server optional
- Future: collaborative curation, cloud streaming, expanded ML models

### Figures

1. **Platform overview** (4-panel): (A) welcome screen with specimen catalog, (B) contact map with analysis tracks + sidebar, (C) Evo2HiC before/after enhancement, (D) analysis panel with health score + checkerboard + species reference
2. **3D analysis suite** (4-panel): (A) insulation + TAD tracks, (B) P(s) decay chart, (C) saddle plot, (D) centromere + telomere tracks showing chromosome structural map
3. **Feature comparison** (table-as-figure or supplementary): OpenPretext vs 5 existing tools across 15+ capability dimensions

### Tables

1. Analysis module summary: 21 modules, method/reference, output type
2. Feature comparison: OpenPretext vs PretextView vs Juicebox vs HiGlass vs cooler vs HiCExplorer
3. Checkerboard scores for teaching specimens vs HiArch taxonomic group medians

### Key References (~25)
- Lieberman-Aiden 2009, Rao 2014 (Hi-C)
- Rhie 2021 (VGP), Howe 2021 (curation importance)
- Harry 2022 (PretextView/Map)
- Durand 2016 (Juicebox), Kerpedjiev 2018 (HiGlass)
- Crane 2015 (insulation), Dixon 2012 (DI/TADs)
- Imakaev 2012 (ICE), Knight & Ruiz 2013 (KR)
- Che et al. 2025 (HiArch -- checkerboard, CenterFinder)
- Evo2HiC (Zenodo DOI + GitHub)
- Blaxter 2022 (DToL), Lewin 2018 (EBP), ERGA 2024
- Ghurye 2019 (SALSA2), Dudchenko 2017 (3D-DNA), Zhou 2023 (YaHS)

---

## Paper 2: Bioinformatics Application Note -- Algorithm Paper

### Title
"AutoSort and AutoCut: automated Hi-C contact map curation algorithms benchmarked across 34 genomes"

### Target
Bioinformatics -- Application Note (~2 pages, 1,500 words, 1 figure, 1 table)

OR

Bioinformatics -- Software Article (~4,000 words, more room for algorithm details)

### Narrative
Focused, algorithmic paper. AutoSort is a Union Find-based contig chaining algorithm; AutoCut detects misassembly breakpoints via diagonal signal density analysis. Benchmarked across 34 GenomeArk specimens spanning 7 taxonomic groups and >500 million years of genome evolution. Mean Kendall's tau 0.988, zero false positive breakpoints for 91% of specimens.

### Structure (Application Note -- tight)

**Summary (~150 words)**
- AutoSort + AutoCut for automated Hi-C curation
- 34 genomes, 7 groups, tau=0.988, 4 total FPs
- Implemented in OpenPretext (browser-based)

**Main Text (~1,200 words)**

*Motivation*
- Manual curation is the bottleneck (2-8 hours/genome)
- Existing scaffolders (SALSA2, 3D-DNA, YaHS) operate on raw reads, not contact maps
- No automated algorithms exist for the .pretext contact map curation workflow

*Algorithm*
- AutoSort Phase 1: pairwise link scoring across 4 orientations (HH/HT/TH/TT) using anti-diagonal intensity bands with 1/sqrt(d) distance weighting
- AutoSort Phase 2: greedy Union Find chaining in descending score order with orientation-aware merging
- AutoSort Phase 3: hierarchical chain merging with safety guard (inter-chain affinity > 50% of intra-chain score)
- AutoCut: sliding-window diagonal signal density with adaptive local baseline, off-diagonal centromere verification, confidence filtering

*Results*
- 34 specimens, 7 taxonomic groups (birds 5, mammals 6, reptiles 7, fish 6, amphibians 3, sharks 4, chordates 3)
- Mean tau=0.988, orientation=0.974
- 31/34 specimens with zero AutoCut FPs
- Scales to 5,506 contigs in 4.6 seconds
- Algorithm development trajectory: 4 versions, tau improved from 0.878 to 0.988

*Discussion*
- Operates on contact map representation, not raw reads
- Automation as assistance: all operations undoable, manual override preserved
- Lancelet edge case (tau=0.903): resolution limit at 1,024-pixel overview

**Supplementary**
- Full benchmark table (34 specimens, all metrics)
- Algorithm pseudocode
- Development trajectory table

### Figure
1. (A) AutoSort pipeline schematic (link scoring -> Union Find -> chain merging), (B) tau distribution by taxonomic group, (C) AutoCut breakpoint detection with centromere verification

### Table
1. Benchmark results: 34 specimens with tau, orientation, FPs, time (carry from v1 Table 1)

### Key References (~15)
- Same core set minus the analysis/ML references
- Focus on scaffolding tools (SALSA2, 3D-DNA, YaHS) and curation literature

---

## Timeline and Dependencies

Paper 2 (Bioinformatics) can be submitted first since most content exists in v1 draft:
- Condense v1 manuscript to Application Note format
- Update test counts and stats
- Add any new benchmark specimens if desired
- Submission: ready within 1-2 weeks

Paper 1 (NAR Web Server) requires more new writing:
- 3D analysis suite section (new)
- ML enhancement section (new)
- Comparative genomics validation (new)
- Figures need to be generated
- Submission: 4-6 weeks, targeting next Web Server issue deadline

Cross-references: Paper 1 cites Paper 2 for algorithm details ("AutoSort and AutoCut algorithms are described in detail in [Paper 2]"). Paper 2 cites Paper 1 for the platform context ("implemented within the OpenPretext platform [Paper 1]").

## Author Considerations

- Paper 1 (NAR): Scott Handley + potentially Rosa Fernandez lab if they contribute validation data or analysis
- Paper 2 (Bioinformatics): Scott Handley (algorithm is entirely your work)
- Both: acknowledge Claude/Anthropic as AI coding assistant in acknowledgements section
