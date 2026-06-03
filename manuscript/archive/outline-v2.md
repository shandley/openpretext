# OpenPretext v2 Manuscript Outline

## Working Title

"OpenPretext: an integrated browser platform for Hi-C contact map curation, 3D genome analysis, and ML-powered enhancement"

## Target Journal

Genome Biology -- Software article track (or Nucleic Acids Research -- Web Server/Software issue)

## Narrative Arc

The old draft told a story about "browser-based curation with automated algorithms." The tool has grown into something fundamentally different: an integrated platform that unifies visualization, curation, 3D genomics analysis, machine learning, and comparative genomics in the browser. No single existing tool spans all of these -- users currently need PretextView + cooler/HiGlass + custom R/Python scripts + separate ML pipelines. OpenPretext collapses this into one URL.

The new narrative: **"OpenPretext bridges the gap between genome assembly curation and 3D genome analysis, providing a zero-installation platform that integrates automated curation algorithms, a comprehensive analysis suite, ML-powered enhancement, and comparative genomics metrics in the browser."**

## Key Claims (each needs supporting evidence)

1. Browser-based curation matches desktop tool capabilities (AutoSort tau=0.988 across 34 genomes)
2. Integrated 3D analysis suite eliminates the need for external tools (12 analysis modules, all in-browser)
3. ML integration (Evo2HiC) enhances low-resolution maps and predicts epigenomic tracks for non-model organisms
4. Comparative genomics metrics place assemblies in evolutionary context (checkerboard score vs 1,025 species)
5. Centromere + telomere detection from Hi-C alone provides chromosome structural maps without annotation
6. Education system with 10 progressive lessons addresses the curation training bottleneck

## Revised Structure

### Abstract (~300 words)

Rewrite to cover the full platform. Key numbers to include:
- 34-specimen AutoSort/AutoCut benchmark (tau=0.988)
- 21 analysis modules, 12 focused on 3D genomics
- Evo2HiC integration (81M params, 177 species, 3 capabilities)
- Checkerboard score benchmarked against 1,025 species
- Centromere detection from Hi-C inter-chromosomal contact hubs
- 10 tutorials, 2,258 tests across 84 files
- 26,836 lines TypeScript + 1,648 lines Python

### Background

Keep the existing curation bottleneck framing but expand to include:
- The disconnect between curation tools and analysis tools (users need separate software for compartments, TADs, etc.)
- The emergence of ML for Hi-C (cite Evo2HiC, HiArch, and other recent work)
- The need for comparative metrics as species counts grow (EBP, DToL scaling)
- Gap: no single tool provides curation + analysis + ML + education in one interface

### Implementation

#### Architecture (keep, update stats)
- 26,836 lines TypeScript, 110 modules, 2,258 tests
- Single runtime dependency (pako)
- Web Worker for background computation

#### Binary format parser (keep as-is, still unique contribution)

#### Curation engine (keep, condense slightly)
- AutoSort (Union Find, tau=0.988) -- condense from current ~3 pages to ~1.5 pages
- AutoCut (diagonal signal density, 4 FPs across 34 genomes) -- condense to ~0.5 page
- Full curation operations, DSL, batch operations

#### 3D Genomics Analysis Suite (NEW -- major new section)
- **Core analyses:** insulation score (Crane 2015), P(s) contact decay with power-law fitting, A/B compartments (O/E + PCA eigenvector)
- **Normalization:** ICE (Sinkhorn-Knopp, Imakaev 2012) and KR (Knight-Ruiz 2013)
- **Advanced metrics:** directionality index (Dixon 2012), saddle plot (compartment strength), Virtual 4C (locus contact profiling)
- **Checkerboard score:** entropy-based compartment regularity (Che et al. 2025), with species reference comparison against 1,025 species
- **Centromere detection:** CenterFinder algorithm predicting centromere positions from inter-chromosomal contact hubs (Che et al. 2025)
- **Telomere detection:** FASTA-based TTAGGG/CCCTAA repeat scanning
- **Composite health score:** 5-component weighted metric (N50, P(s), integrity, compartments+checkerboard, library quality)
- **Misassembly detection:** TAD boundary + compartment switch analysis for chimeric contigs, with confidence scoring and guided cut review
- **Pattern detection:** algorithmic inversion and translocation identification
- All analyses run in background Web Worker; results as overlay tracks

#### ML-Powered Enhancement (NEW -- major new section)
- Companion FastAPI server with 3 Evo2HiC model capabilities:
  1. Resolution enhancement (CDNA2d, 81M params, trained on 177 species)
  2. Epigenomic track prediction (CDNAtrack -- DNase, CTCF, H3K27ac, H3K27me3, H3K4me3)
  3. Seq2HiC (predict Hi-C from DNA sequence alone)
- Mock mode for testing; real model weights from Zenodo checkpoint
- GPU acceleration (MPS/CUDA auto-detection)
- DNA sequence encoding pipeline (one-hot, tiling, mappability)
- Enhanced maps feed into downstream analysis (insulation, compartments, P(s))

#### AI-Assisted Curation (NEW -- brief section)
- Claude vision API integration for contact map analysis
- 8 built-in prompt strategies + custom strategy editor
- Executable DSL suggestions with one-click Run buttons
- Community strategy sharing (export/import JSON)

#### Education System (keep, update to 10 lessons)
- 10 lessons (was 6), now covering 3D analysis, meta tags, misassembly detection, Evo2HiC
- 10-specimen teaching corpus
- Pattern gallery (11 patterns, was 8)
- Self-assessment via Kendall tau

### Results

#### Automated curation benchmark (keep Table 1 + Table 2, condense text)
- 34 specimens, 7 taxonomic groups
- Mean tau=0.988, orientation=0.974, 4 total FPs
- Condense from ~2 pages to ~1 page since it's no longer the sole focus

#### 3D analysis validation (NEW)
- Demonstrate that browser-computed insulation/compartments match established tools (cooler, fanc, etc.) on reference datasets
- Health score components correlate with known assembly quality
- Checkerboard scores for our 10 teaching specimens placed in context of 1,025 HiArch species
- Centromere predictions validated against known centromere positions (if we can find annotated genomes in our corpus)

#### ML enhancement evaluation (NEW)
- Before/after enhancement on King quail (real .pretext)
- Predicted epigenomic tracks compared to known marks (if available)
- Seq2HiC predicted vs observed contact patterns

#### Education system evaluation (keep, update)
- Updated lesson count (10) and test count (2,258)

### Discussion

- Reframe around the integrated platform concept
- Compare to the ecosystem of separate tools users currently need
- Feature comparison table: update to include analysis, ML, comparative genomics columns
- Limitations: overview resolution constraint (keep), WebGL2 requirement (keep), ML server optional, checkerboard reference data limited to paper's species
- Future: real-time collaborative curation, streaming from cloud, expanded ML models

### Figures

1. **Platform overview** -- 4-panel: (A) welcome screen, (B) contact map with analysis tracks, (C) analysis panel with health score + checkerboard + species reference, (D) Evo2HiC enhancement before/after
2. **AutoSort/AutoCut benchmark** -- (A) tau by group, (B) orientation by group, (C) time vs contigs (keep from v1)
3. **3D analysis suite** -- (A) insulation + TAD tracks on example genome, (B) P(s) decay chart with baseline overlay, (C) A/B compartment heatmap, (D) saddle plot, (E) checkerboard score with species reference panel
4. **ML enhancement** -- (A) original King quail, (B) enhanced, (C) predicted epi tracks, (D) Seq2HiC predicted vs observed
5. **Centromere + telomere detection** -- (A) centromere signal track + markers, (B) telomere track, (C) combined view showing chromosome structural map
6. **Education system** -- (A) lesson browser, (B) tutorial overlay, (C) assessment score card

### Tables

1. Benchmark corpus (34 specimens) -- keep from v1
2. AutoSort by taxonomic group -- keep from v1, condense
3. Feature comparison: OpenPretext vs PretextView vs Juicebox vs HiGlass vs cooler -- expanded
4. 3D analysis modules summary (21 modules, method, reference, output)
5. Checkerboard scores for teaching specimens vs HiArch reference groups

### New References Needed

- Crane et al. 2015 (insulation score)
- Dixon et al. 2012 (directionality index, TADs)
- Imakaev et al. 2012 (ICE normalization)
- Knight & Ruiz 2013 (KR normalization)
- Che et al. 2025 (HiArch -- checkerboard, CenterFinder, 1,025 species)
- CHNFTQ Evo2HiC (Zenodo DOI + GitHub)
- Anthropic Claude (for AI-assisted curation)

### Authors

- Scott A. Handley (corresponding)
- Consider adding Rosa Fernandez lab members if they contribute validation/feedback

### What to Archive from v1

The v1 draft is preserved at manuscript-v1-archived-2026-03-26.md. Key content to carry forward:
- Abstract structure (expand)
- Background section (expand with analysis/ML gaps)
- AutoSort/AutoCut descriptions (condense)
- Benchmark tables 1-3 (keep)
- Education section (update)
- Limitations discussion (update)
- References.bib (expand)

### Estimated Scope

- Core prose: ~6,000-7,000 words (Genome Biology Software allows up to 8,000)
- 6 figures, 5 tables
- ~25-30 references
