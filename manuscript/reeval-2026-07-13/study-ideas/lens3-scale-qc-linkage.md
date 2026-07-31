# Lens 3 study ideas: scale, automation, and linking Hi-C architecture to assembly quality across many genomes

Author lens: systematic large-N questions made feasible by headless, scriptable, reproducible processing of native `.pretext` files, plus any linkage between overview-scale Hi-C architecture and assembly quality or genome properties.

This document proposes three concrete study designs, ranked by defensibility. It is deliberately blind to the older study under `manuscript/analysis/` and `manuscript/archive/`; these are alternatives.

## What the lens can and cannot spend

The unique asset is uniform, reproducible batch processing. `bench/acquire` enumerates and downloads GenomeArk before/after curation pairs and DToL single-stage assemblies with a stage-classified manifest. `bench/curate.ts` loads a native `.pretext` in Node, applies a DSL script through the same executor the browser uses, asserts on N50/contig/scaffold/misassembly metrics, and emits AGP, exiting non-zero on failure. The analysis modules (P(s) decay exponent and R2, cis fraction, insulation, compartment strength, checkerboard/accordance, join-support anomaly rate, haplotig flags, misassembly flags, auN, scaffold N50) all run headlessly on the overview matrix. No desktop tool can process hundreds of genomes identically and reproducibly the way this pipeline can. That is the whole argument for feasibility, and it is a real one.

Three hard constraints shape every design below.

1. Overview resolution only. Every metric runs on the coarsest-mip overview (Mb bins, as small as 64x64 for real DToL files, up to roughly 1024px for large GenomeArk files). No sub-Mb claim is available. Insulation and directionality "boundaries" are coarse partition signals, not TAD calls; compartments are marginal at Mb bins; detectors go quiet at 64x64 (A3, A5).

2. Comparability. Base pairs per pixel differ by one to two orders of magnitude across genomes, because the overview is a fixed-ish pixel grid over genomes spanning roughly 100 Mb to 3 Gb. Any absolute overview metric conflates biology with resolution. Every design below handles this the same way, described once here and referenced later:
   - Within-file multi-mip calibration. Each `.pretext` carries a mip pyramid. Computing a metric at several mip levels of the same file (64, 128, 256, 512, 1024 px) measures resolution sensitivity with zero cross-genome confound, because genome identity is held fixed. This requires a small harness extension to assemble overview matrices at a chosen mip level rather than only the coarsest, but it is squarely within the existing parser's capability (A1 confirms the pyramid is present and the tile path already reads multiple mips).
   - Resolution-robust features only. Any feature fed into a cross-genome comparison must be rank-based or ratio-based, or read at a matched base-pairs-per-pixel level, so absolute pixel scale does not leak back in.

3. Fabrication risk on ground truth. BUSCO completeness, QV, contig/scaffold N50, heterozygosity, assembler/scaffolder/platform metadata, and any BioProject or genome-note identifiers must be gathered from authoritative sources (NCBI E-utilities, GenomeArk metadata, GenomeScope reports in genome notes) and verified, never recalled from memory. Each design states this explicitly. Where an identifier cannot be verified in-session, the honest move is to surface the gap, not to produce confident-looking output.

---

## Design D: an operating-envelope calibration and cross-tool validation of Mb-scale Hi-C metrics (most defensible)

This is the safest design and the least biologically interesting one. It serves the automation half of the lens fully and the architecture-to-quality half not at all. It is a methods and resource contribution, and its defensibility comes precisely from the fact that it makes no claim that can be empirically wrong.

### Question

Across genomes spanning two to three orders of magnitude in genome size, at what base-pairs-per-pixel does each overview Hi-C metric (P(s) exponent and R2, insulation boundary density, compartment strength and saddle strength, checkerboard/accordance, cis fraction, join-support anomaly rate) stabilize, and at what resolution does it become unreliable? And do the overview implementations agree with the reference implementations (cooltools, FAN-C) on the same real matrices?

### Why automation makes it feasible where manual tools cannot

Two things only a uniform headless pipeline can do. First, compute each metric at every mip level of every file across a large size-stratified corpus, which is thousands of metric evaluations that no point-and-click desktop tool exposes. Second, run the identical metric definition across every genome, so the only thing varying is resolution and genome, not operator choices. The within-file multi-mip sweep is the core move: it isolates resolution sensitivity per metric without any cross-genome confound.

### Data and analysis, and feasibility at overview resolution

- Corpus: 100 to 300 assemblies pulled via `bench/acquire`, stratified by genome size. GenomeArk and DToL together already span mammal, bird, reptile, amphibian, fish, invertebrate, fungus, plant. Download volume is the main cost (roughly 7.5 GB bought 34 specimens in the existing bench), but the pipeline exists for exactly this.
- Per file, assemble overview matrices at each available mip level and compute all metrics at each level. Plot each metric against base-pairs-per-pixel; identify the resolution at which the metric plateaus (within-file, so any drift is pure resolution effect).
- Cross-tool validation on a subset: for perhaps 10 to 20 files where the source cooler or `.hic` is available, run cooltools and FAN-C at matched coarse binning and compare insulation, compartment eigenvector sign and magnitude, and P(s) exponent against the overview values. This directly closes the single largest gap A3 identifies: nothing currently cross-validates these re-implementations against community standards on real matrices.
- Deliverable: a published resolution envelope per metric ("trustworthy above X bp/px, degrades below") plus a normalization recipe for cross-genome comparison, plus the agreement table against cooltools/FAN-C.

Feasibility is high. The multi-mip assembly and metric evaluation are cheap once the overview is decoded. The cross-tool subset is bounded and small. No fabricated identifiers are required beyond the assembly accessions themselves, which come from the acquire manifest.

### Honest confound and whether it survives

The main risk is that this reads as engineering housekeeping rather than a study. It survives as a resource paper because the community genuinely lacks a resolution envelope for coarse-bin Hi-C metrics, and because the cross-tool agreement table is a real validation that every downstream user of these numbers needs. The confound that would sink a discovery paper (bp/pixel conflation) is here the subject, not a nuisance, so there is nothing left to confound. The one thing to state plainly: this design does not link architecture to assembly quality, so it is the backbone that Design A stands on, not a biology result.

### Venue and type

Resource or methods. GigaByte (Technical Release, reproducibility-first, links code and data) is the cleanest fit; Bioinformatics Application Note if folded into the tool paper as its validation section; F1000 as a versioned fallback. Not a biology venue.

---

## Design A: automated triage of curation effort from a cheap pre-curation Hi-C read (most on-lens)

This is the design that actually exercises both halves of the lens: large-N automation and a link from overview architecture to a quality-relevant outcome. Its defensibility rests entirely on framing it as triage, not as hidden-quality discovery.

### Question

Can a set of cheap overview-scale Hi-C features computed on a draft (pre-curation) assembly predict how much curation that draft will need, well enough to prioritize a queue of fresh assemblies so a human curator looks at the worst ones first?

### The framing that makes it survive: triage, not revelation

The killer confound is circularity, not library depth. The curator made the cuts, joins, and reorderings by looking at the same contact map the predictor reads. "Hi-C predicts curation burden" is partly "Hi-C predicts what an expert did while staring at Hi-C." Framed as hidden-quality revelation, that is fatal. Framed as triage, it is the point: the useful, real task is "given 300 fresh assemblies and one curator-week, which should a human open first," and a predictor that recovers the expert's own visual signal is exactly what triage wants. The claim must be bounded to prioritization and stated with the circularity in the open, not sold as Hi-C uncovering quality that other data misses.

The wrong targets, stated so a reviewer sees we know it: BUSCO and QV are gene-content and base-accuracy measures that Hi-C carries essentially no signal about (A3 reports QV as "not assessed" because Hi-C has no read-level data), so predicting them from Hi-C is close to hopeless and should not be attempted. Contig N50 is fixed upstream of Hi-C by the contig assembler, and scaffold N50 is downstream of the Hi-C scaffolder, so predicting it is either weak or circular. The correct target is structural curation load: the amount and kind of reordering, cutting, and joining a curator applied, which is precisely what Hi-C does carry signal about (misjoins, missed joins, haplotig placement).

### Why automation makes it feasible where manual tools cannot

Two capabilities are load-bearing. First, the before/after pairs: GenomeArk exposes pre-curation and post-curation assemblies for many species, and `bench/acquire` classifies them by stage. The post assembly is ground truth for what curation did. Second, headless diffing at scale: `bench/curate.ts` and the AGP writer let us diff pre against post programmatically across hundreds of pairs to quantify curation burden uniformly. No manual tool computes a consistent burden score across a large pair set.

### Data and analysis, and feasibility at overview resolution

- Ground-truth burden per pair, from a pre-versus-post diff: Kendall tau between pre and post contig order, count of contigs that changed scaffold assignment, number of cut and join operations implied by the contig-set difference, and the N50 improvement ratio. Aggregate into a burden score, and also keep the components so the model can be inspected.
- Important limitation to state up front: the loader sets `inverted:false` on all contigs when reading curated files (A5), so the burden ground truth can capture order changes and cut/join counts but cannot reliably recover per-contig inversions. The burden score must therefore be defined on order and partition changes, and must not silently claim orientation recovery.
- Predictor features on the draft overview, all resolution-robust per the comparability rule: cis fraction, join-support anomaly rate (fraction of display-adjacent junctions flagged weak), misassembly-flag density, count of off-diagonal enrichment blocks (candidate misjoins) normalized by contig count, and rank-transformed P(s) R2. Feed these into a simple, interpretable model (regularized regression or a shallow tree) and evaluate ranking quality (Spearman of predicted versus actual burden, and precision-at-top-k for the triage use case).
- Comparability: features must be rank or ratio based, or read at a matched bp/pixel level via the multi-mip machinery from Design D, so genome size does not become the predictor.
- Metadata (assembler, platform, sequencing center) gathered and verified from GenomeArk metadata and NCBI, never fabricated, and used as covariates so the model is not secretly learning "VGP recipe versus DToL recipe."

Feasibility is moderate to high. Every feature already computes headlessly. The pre/post diff is straightforward AGP and order arithmetic. The real work is assembling a clean, verified pair corpus and defining the burden score defensibly.

### Honest confound and whether it survives

Circularity, handled by the triage framing above, is the central one and it converts to bounded scope rather than a flaw. Two residual confounds remain and must be reported. Library depth and protocol (Arima versus OmniC, read depth) drive cis fraction and join-support more than assembly structure does; include them as covariates and report how much predictive power survives their removal. Purging pipeline variation upstream (whether purge_dups was run, and how hard) affects haplotig-related features independent of the draft's true burden; record it where the genome note states it. The study survives as an honest triage benchmark: it either shows a cheap Hi-C read usefully ranks curation queues, which is directly useful to DToL/VGP/EBP given the 221-interventions-per-Gb manual bottleneck (Howe 2021), or it shows the signal is too confounded to triage, which is also a publishable and useful negative for a community betting on automation.

### Venue and type

Benchmark or methods, framed as a QC-triage tool study. Bioinformatics (research or Application Note if paired with the tool), GigaScience or GigaByte for the reproducibility framing. Not a biology-discovery venue: the outcome is a prioritization signal, not a biological finding.

---

## Design C: haplotig burden versus heterozygosity across taxa (thinnest, biology-shaped but gated)

This is the only design shaped like a biology-discovery question, and it is the least defensible of the three. It has a hard feasibility gate that must be checked before any write-up, and several confounds that keep it exploratory even if the gate passes.

### Question and hypothesis

Does the haplotig burden detectable in a pre-curation overview scale with organism heterozygosity across taxa? Hypothesis: high-heterozygosity genomes (many invertebrates, plants, marine species) leave more unpurged haplotypic duplication in the primary assembly, producing more haplotig signal (contact enrichment against a distant partner, plus coverage depression) that a uniform detector picks up across many genomes.

### The go/no-go gate, to resolve before writing anything as clean

The haplotig detector's coverage discriminator reads a full-resolution `psgh` coverage extension track (A3). The contact-enrichment step is only the trigger; the coverage step is the confirmation, and only contact-plus-coverage agreement is reported high-confidence. I checked the specimen catalog: it records no coverage-track presence, so this is an empirical gate, not a known quantity. Before treating C as viable, pull a handful of GenomeArk and DToL `.pretext` files via `bench/acquire` and test whether they carry the `psgh` coverage extension. If most lack it, the detector degrades to contact-enrichment-only, haplotig calls become low-confidence, and C is not viable at scale. This is the gate, not a footnote.

### Why automation would make it feasible

If the gate passes, only a uniform headless run of the same detector across a large, taxon-diverse, size-stratified set can put haplotig burden and heterozygosity on the same axis for enough genomes to see a trend. Manual inspection cannot produce a consistent burden number across hundreds of genomes.

### Data and analysis, and feasibility

- Haplotig burden per genome: fraction of contigs flagged, or total flagged length over assembly length, computed identically across the corpus. Must be read at a matched bp/pixel level or rank-normalized, because the detector degrades at 64x64 (A3) and small-overview genomes would otherwise look artificially haplotig-free.
- Heterozygosity per genome from public sources: GenomeScope estimates reported in DToL/VGP genome notes, or SNP-based heterozygosity from the sequencing project. These are patchy and noisy, and every value must be gathered and verified from the genome note or NCBI, never recalled. Where a value is unavailable or unverifiable, the genome is excluded, not guessed.

### Honest confound and whether it survives

Several, and together they hold C at exploratory. Purge pipeline variation is the worst: haplotig burden in the assembly reflects how hard purge_dups was run upstream as much as the organism's true heterozygosity, so the response variable is partly a pipeline artifact. Heterozygosity estimates are patchy and method-dependent. The detector degrades at small overview resolution, so genome size correlates with measured burden through a resolution artifact unless carefully matched. And the coverage-track gate may fail outright. The biology (heterozygosity to haplotig) is real and expected, which cuts both ways: a positive result is unsurprising and a null could be pipeline noise. C is worth listing because it is the only lens-3 idea with a biological question at its center, but it should be pursued only if the coverage-track gate passes and the purge-pipeline confound can be at least partially controlled, and it should be labeled exploratory throughout.

### Venue and type

Biology-adjacent, but only if it clears the gate and confounds. A positive, confound-controlled result could fit Genome Biology or Genome Research as a comparative-genomics note, but Genome Research's own guidance rejects computational work without clear biological consequence, so the bar is high. More realistically this is an exploratory section within a larger tool or resource paper, not a standalone biology submission.

---

## Ranking and bottom line

1. Design D (resolution envelope and cross-tool validation). Most defensible, because it makes no claim that can be wrong and it closes A3's real validation gap. Purely methods and resource; serves the automation half of the lens, not the linkage half. It is the safest paper and the least exciting one, and it is the backbone Design A needs.

2. Design A (curation-effort triage from cheap Hi-C). The most on-lens design and the one worth building toward, provided it is framed as triage and prioritization, with circularity stated as bounded scope rather than hidden. Benchmark or methods, directly useful to the curation bottleneck. Its ground-truth burden score must be defined on order and partition changes only, because inversions are not recoverable from the curated files.

3. Design C (haplotig burden versus heterozygosity). Thinnest. The only biology-shaped question, but gated on whether the `.pretext` files carry the coverage track, and confounded by upstream purging, patchy heterozygosity estimates, and resolution artifacts. Exploratory only; check the gate before investing.

Blunt summary: D is a strong resource paper and a safe first output. A is the real target and the one that justifies the lens, if the triage framing is held honestly. C is a maybe that should not be written up as clean until its coverage-track gate is empirically checked. All three depend on the same two disciplines: the within-file multi-mip trick to defeat the bp-per-pixel confound, and verified rather than fabricated ground-truth identifiers.
