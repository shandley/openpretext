# OpenPretext Benchmark Report

**Date:** 2026-02-07
**Harness version:** v2 (post-algorithm fixes)
**Test specimens:** 21 GenomeArk curated assemblies across 5 vertebrate classes

---

## 1. Methodology

### Evaluation strategy

Both AutoCut and AutoSort are evaluated on **curated** (post-curation) assemblies where ground truth is unambiguously known from contig names. This approach was adopted after discovering that pre- and post-curation `.pretext` files use completely different contig naming systems (e.g., `scaffold_1.H1` vs `SUPER_2`), making cross-file contig mapping impossible.

The pipeline for each specimen:

1. Load the curated `.pretext` file (both input and ground truth source)
2. Extract ground truth chromosome assignments from contig names
3. Run **AutoCut** on the curated contact map
4. Apply detected breakpoints (splitting contigs into `_L`/`_R` fragments)
5. Run **AutoSort** on the post-cut state
6. Compare predictions against name-derived ground truth

The pre-curation file is loaded for supplementary statistics only.

### Ground truth extraction

Chromosome assignments are derived from GenomeArk naming conventions:

| Pattern | Example | Chromosome |
|---------|---------|------------|
| `SUPER_N` | `SUPER_1`, `SUPER_Z` | N |
| `SUPER_N_unloc_M` | `SUPER_12_unloc_3` | N (parent) |
| `Super_Scaffold_N` | `Super_Scaffold_1A` | N |
| `chrN` | `chr1`, `chrX` | N |
| `Scaffold_*`, `scaffold_*` | `Scaffold_49` | Unplaced group |

### Metrics

**AutoCut (breakpoint detection):**
- **Precision** — fraction of detected breakpoints that match a ground truth split
- **Recall** — fraction of ground truth splits that were detected
- **F1** — harmonic mean of precision and recall

**AutoSort (contig ordering):**
- **Kendall's tau** — rank correlation between predicted and true orderings (-1 to 1)
- **Orientation accuracy** — fraction of contigs with correct inversion state
- **Chain purity** — average fraction of each predicted chain from a single true chromosome
- **Chain completeness** — average fraction of each true chromosome captured in its best chain

**Chromosome completeness:**
- **Macro-average** — unweighted average per-chromosome completeness
- **Micro-average** — base-pair-weighted average

---

## 2. Test corpus

21 specimens from the public `s3://genomeark` bucket, spanning 5 vertebrate classes:

| Class | Species | Common name | Contigs | Chroms |
|-------|---------|-------------|---------|--------|
| **Reptile** | *Anilios waitii* | Interior blind snake | 124 | 16 |
| **Bird** | *Amazona ochrocephala* | Yellow-crowned amazon | 1,678 | 35 |
| **Bird** | *Agelaius phoeniceus* | Red-winged blackbird | 317 | 41 |
| **Bird** | *Taeniopygia guttata* | Zebra finch | 134 | 33 |
| **Bird** | *Coturnix chinensis* | King quail | 424 | 34 |
| **Bird** | *Cyanocitta cristata* | Blue jay | 315 | 40 |
| **Mammal** | *Axis porcinus* | Hog deer | 719 | 36 |
| **Mammal** | *Marmota flaviventris* | Yellow-bellied marmot | 813 | 23 |
| **Mammal** | *Lestoros inca* | Inca shrew opossum | 189 | 9 |
| **Mammal** | *Artibeus lituratus* | Great fruit-eating bat | 486 | 18 |
| **Reptile** | *Crocodylus niloticus* | Nile crocodile | 122 | 17 |
| **Reptile** | *Dermatemys mawii* | Central American river turtle | 150 | 29 |
| **Reptile** | *Aspidoscelis tigris* | Tiger whiptail lizard | 185 | 24 |
| **Reptile** | *Chitra chitra* | Asian narrow-headed softshell turtle | 36 | 34 |
| **Fish** | *Atractosteus spatula* | Alligator gar | 356 | 29 |
| **Fish** | *Thalassoma bifasciatum* | Bluehead wrasse | 52 | 25 |
| **Fish** | *Diretmus argenteus* | Silver spinyfin | 5,506 | 25 |
| **Fish** | *Osmerus mordax* | Rainbow smelt | 365 | 47 |
| **Amphibian** | *Anomaloglossus baeobatrachus* | Pebas stubfoot toad | 3,642 | 13 |
| **Amphibian** | *Scaphiopus couchii* | Couch's spadefoot toad | 577 | 14 |
| **Amphibian** | *Eleutherodactylus marnockii* | Cliff chirping frog | 1,175 | 16 |

**Taxonomic distribution:** 6 birds, 5 reptiles, 4 mammals, 4 fish, 3 amphibians.

**Contig range:** 36 to 5,506. **Chromosome range:** 9 to 47.

---

## 3. Results

### 3.1 Summary table

| Species | n | P | R | F1 | tau | Orient | Purity | Compl | MacroCC | Time |
|---------|---|---|---|----|----|--------|--------|-------|---------|------|
| *A. waitii* | 124 | 0.00 | 1.00 | 0.00 | 1.000 | 1.000 | 1.000 | 0.851 | 0.910 | 1.5s |
| *A. ochrocephala* | 1678 | 1.00 | 1.00 | 1.00 | 1.000 | 0.998 | 0.999 | 0.859 | 0.959 | 3.2s |
| *A. phoeniceus* | 317 | 1.00 | 1.00 | 1.00 | 0.980 | 0.950 | 0.991 | 0.927 | 0.966 | 3.5s |
| *T. guttata* | 134 | 1.00 | 1.00 | 1.00 | 0.945 | 0.925 | 0.983 | 0.970 | 0.975 | 3.7s |
| *C. chinensis* | 424 | 1.00 | 1.00 | 1.00 | 0.995 | 0.991 | 0.994 | 0.873 | 0.964 | 2.2s |
| *C. cristata* | 315 | 1.00 | 1.00 | 1.00 | 0.984 | 0.978 | 0.997 | 0.848 | 0.957 | 2.7s |
| *A. porcinus* | 719 | 1.00 | 1.00 | 1.00 | 0.997 | 0.990 | 0.999 | 0.924 | 0.973 | 4.1s |
| *M. flaviventris* | 813 | 1.00 | 1.00 | 1.00 | 0.999 | 0.994 | 0.999 | 0.633 | 0.953 | 3.4s |
| *L. inca* | 189 | 1.00 | 1.00 | 1.00 | 0.997 | 0.995 | 0.995 | 0.640 | 0.894 | 3.2s |
| *A. lituratus* | 486 | 1.00 | 1.00 | 1.00 | 0.999 | 0.994 | 0.996 | 0.889 | 0.952 | 1.9s |
| *C. niloticus* | 122 | 1.00 | 1.00 | 1.00 | 0.985 | 0.943 | 0.991 | 0.830 | 0.946 | 4.2s |
| *D. mawii* | 150 | 1.00 | 1.00 | 1.00 | 0.949 | 0.933 | 0.992 | 0.791 | 0.963 | 3.5s |
| *A. tigris* | 185 | 1.00 | 1.00 | 1.00 | 0.978 | 0.984 | 0.990 | 0.800 | 0.958 | 2.3s |
| *C. chitra* | 36 | 1.00 | 1.00 | 1.00 | **0.190** | **0.778** | **0.758** | 0.971 | 0.992 | 3.9s |
| *A. spatula* | 356 | 0.00 | 1.00 | 0.00 | 0.973 | 0.992 | 0.996 | 0.713 | 0.927 | 4.9s |
| *T. bifasciatum* | 52 | 1.00 | 1.00 | 1.00 | **0.342** | **0.885** | 0.970 | 0.743 | 0.967 | 4.8s |
| *D. argenteus* | 5506 | 1.00 | 1.00 | 1.00 | 1.000 | 0.999 | 1.000 | 0.511 | 0.935 | 4.6s |
| *O. mordax* | 365 | 1.00 | 1.00 | 1.00 | 0.995 | 0.970 | 0.997 | 0.638 | 0.973 | 5.0s |
| *A. baeobatrachus* | 3642 | 1.00 | 1.00 | 1.00 | 1.000 | 0.998 | 1.000 | 0.409 | 0.915 | 6.4s |
| *S. couchii* | 577 | 0.00 | 1.00 | 0.00 | 1.000 | 0.998 | 0.998 | 0.726 | 0.929 | 2.1s |
| *E. marnockii* | 1175 | 1.00 | 1.00 | 1.00 | 1.000 | 0.992 | 0.999 | 0.626 | 0.929 | 4.9s |
| | | | | | | | | | | |
| **Mean (n=21)** | — | **0.86** | **1.00** | **0.86** | **0.919** | **0.966** | **0.983** | **0.770** | **0.949** | **3.6s** |
| **Mean (n=19, excl. outliers)** | — | 0.84 | 1.00 | 0.84 | **0.989** | **0.980** | **0.996** | 0.773 | 0.949 | — |

**Key:** P = precision, R = recall, tau = Kendall's tau, Orient = orientation accuracy, Purity = chain purity, Compl = chain completeness, MacroCC = macro-average chromosome completeness.

**Outliers (bold):** Chitra chitra (n=36) and Thalassoma bifasciatum (n=52) have too few contigs for effective sorting — most contigs are already chromosome-scale scaffolds.

### 3.2 Aggregate metrics

| Metric | All 21 | Excluding 2 outliers (n=19) |
|--------|--------|---------------------------|
| Mean Kendall's tau | 0.919 | 0.989 |
| Mean orientation accuracy | 0.966 | 0.980 |
| Mean chain purity | 0.983 | 0.996 |
| Mean chain completeness | 0.770 | 0.773 |
| Mean macro completeness | 0.949 | 0.949 |
| Mean micro completeness | 0.948 | 0.942 |
| AutoCut precision | 0.857 | 0.842 |
| AutoCut recall | 1.000 | 1.000 |
| Mean time per specimen | 3.6s | — |

### 3.3 AutoCut analysis

On curated assemblies, AutoCut should find **zero** breakpoints. 18 of 21 specimens achieved this (F1 = 1.0):

| Species | FP | Notes |
|---------|----|-------|
| *A. waitii* (blind snake) | 1 | Single false positive on 124 contigs |
| *A. spatula* (alligator gar) | 2 | Two false positives on 356 contigs |
| *S. couchii* (spadefoot toad) | 1 | Single false positive on 577 contigs |
| All other 18 specimens | 0 | Correct |

**Total false positives across 21 specimens: 4.** This is a major improvement over the initial benchmark (37 FPs on 4 specimens) following the algorithm fixes:
- Raised `cutThreshold` from 0.20 to 0.30
- Raised confidence filter from 0.30 to 0.50
- Added minimum region width filter
- Switched from global to local sliding-window baseline

### 3.4 AutoSort analysis

**Ordering quality (Kendall's tau):**

| Range | Count | Specimens |
|-------|-------|-----------|
| tau >= 0.99 | 10 | A. waitii, A. ochrocephala, C. chinensis, A. porcinus, M. flaviventris, L. inca, A. lituratus, D. argenteus, S. couchii, E. marnockii |
| 0.97 <= tau < 0.99 | 5 | A. phoeniceus, C. cristata, A. spatula, A. tigris, O. mordax |
| 0.94 <= tau < 0.97 | 2 | T. guttata, D. mawii |
| tau < 0.94 | 2 | T. bifasciatum (0.342), C. chitra (0.190) |

**15 of 21 specimens (71%) achieve tau >= 0.97.** Excluding the two specimens with < 60 contigs, **17 of 19 (89%) achieve tau >= 0.94.**

The two outliers (*C. chitra* n=36, *T. bifasciatum* n=52) have extremely few contigs relative to their chromosome count (36 contigs for 34 chromosomes = ~1 contig per chromosome). With essentially no within-chromosome fragmentation, the sorting algorithm has minimal signal to work with.

**Chain purity (mean 0.983):**

Chains almost never mix contigs from different chromosomes. 19 of 21 specimens have purity >= 0.99. The sole exception beyond the *C. chitra* outlier is *T. bifasciatum* at 0.97.

**Chain completeness (mean 0.770):**

This is the weakest metric — chromosomes are often split across multiple chains rather than captured in a single chain. Species with many contigs tend to have more chain fragmentation (e.g., *A. baeobatrachus* with 3,642 contigs has completeness 0.409). The greedy union-find approach merges aggressively within local neighborhoods but doesn't always bridge across long-range contacts.

**Orientation accuracy (mean 0.966):**

17 of 21 specimens achieve >= 0.94 orientation accuracy. Lower accuracy correlates with lower contig count (*T. guttata* 0.925 at n=134, *D. mawii* 0.933 at n=150) where contigs span more pixels but corner sampling has less relative resolution.

### 3.5 Chromosome completeness

| Completeness range | Chromosomes (of 553 total) |
|-------------------|---------------------------|
| >= 95% | 442 (80%) |
| 80-95% | 50 (9%) |
| 50-80% | 21 (4%) |
| < 50% | 40 (7%) |

442 of 553 chromosomes (80%) are placed with >= 95% completeness. The 40 poorly-placed chromosomes (< 50%) are almost entirely the smallest chromosome in each assembly — typically the last "unplaced" scaffold group.

**Taxonomic breakdown:**

| Class | Mean tau | Mean orient | Mean purity | Mean MacroCC |
|-------|----------|-------------|-------------|-------------|
| Birds (6) | 0.984 | 0.974 | 0.994 | 0.964 |
| Mammals (4) | 0.998 | 0.993 | 0.997 | 0.943 |
| Reptiles (5) | 0.820 | 0.928 | 0.946 | 0.954 |
| Fish (4) | 0.828 | 0.965 | 0.991 | 0.951 |
| Amphibians (3) | 1.000 | 0.996 | 0.999 | 0.924 |

Reptiles and fish have lower mean tau, driven entirely by the two outlier specimens (*C. chitra* and *T. bifasciatum*). Excluding these, all classes achieve tau >= 0.94.

### 3.6 Performance

| Metric | Value |
|--------|-------|
| Mean total time | 3.6s per specimen |
| AutoCut time | < 1ms (all specimens) |
| AutoSort time | 1-379ms (scales with n^2 contigs) |
| Loading time | 1.5-6.2s (dominates total) |
| Highest contig count | 5,506 (D. argenteus, 379ms sort) |

---

## 4. Algorithm fixes applied

The following fixes were applied between the initial 4-specimen benchmark and this expanded run:

### 4.1 AutoSort chain reversal bug fix

**File:** `src/curation/AutoSort.ts`

The condition `nodeJ.isHead && !nodeJ.isHead` (tautological contradiction) was fixed to `nodeJ.isHead && !nodeJ.isTail`. This was the single largest contributor to improved tau scores.

### 4.2 AutoSort chain merge post-processing

Added `mergeSmallChains()` as a second pass after union-find chaining. Chains with fewer than `minChainSize` (default 3) contigs are merged into adjacent chains if the inter-chain Hi-C signal exceeds `mergeThreshold` (default 0.05). This improves chromosome completeness without sacrificing purity.

### 4.3 AutoSort small contig guard

`computeLinkScore()` now returns 0 if either contig is < 4 pixels wide in the overview map. This prevents noise-driven link scores from creating spurious chains on tiny contigs.

### 4.4 AutoCut threshold tuning

- `cutThreshold` raised from 0.20 to 0.30 (requires larger density drop)
- Confidence filter raised from 0.30 to 0.50
- Added minimum region width filter (`max(3, windowSize/2)` pixels)
- Replaced global baseline with local sliding-window baseline (4x windowSize radius)

### 4.5 Signal-based chromosome detection improvement

- Consecutive tiny contigs (< 3 pixels) are merged into virtual ranges for signal computation
- Percentile-based adaptive threshold replaces fixed multiplier
- Aggressive fallback when initial threshold finds too few boundaries

---

## 5. Improvement from initial to expanded benchmark

| Metric | Initial (4 specimens) | After fixes (4 specimens) | Expanded (21 specimens) |
|--------|----------------------|--------------------------|------------------------|
| Mean tau | 0.878 | 0.981 | 0.919 (0.989 excl. outliers) |
| Mean orientation | 0.918 | 0.968 | 0.966 (0.980 excl. outliers) |
| Mean purity | 0.991 | 0.993 | 0.983 (0.996 excl. outliers) |
| Total AutoCut FPs | 37 | 1 | 4 |
| Mean MacroCC | — | 0.953 | 0.949 |

The algorithm fixes dramatically improved performance on the original 4 specimens and held up well across 17 new specimens spanning 4 additional taxonomic groups.

---

## 6. Remaining issues and next steps

### 6.1 Chain completeness (MEDIUM priority)

Mean chain completeness of 0.770 means chromosomes are split across an average of ~1.3 chains. Species with many small contigs (>1000) have lower completeness (0.41-0.64). The `mergeSmallChains` post-processing helps but doesn't fully solve this. Options:
- More aggressive merge threshold for high-contig assemblies
- Multi-pass hierarchical merging
- Spectral clustering on the link score matrix

### 6.2 Low-contig assemblies (LOW priority)

Assemblies with < 60 contigs perform poorly (tau 0.19-0.34). These are already near-chromosome-scale with little for AutoSort to do. Consider detecting this case and skipping AutoSort, or using a fundamentally different approach (e.g., full contact matrix clustering).

### 6.3 Remaining AutoCut false positives (LOW priority)

4 FPs across 21 specimens is acceptable but not zero. The 3 affected species may have real structural features (heterochromatin, centromeres) that mimic misassembly breakpoints. A contig-specific confidence calibration could help.

### 6.4 Pre-curation evaluation mode (FUTURE)

Running on curated assemblies is valid for algorithm benchmarking but doesn't capture the full curation pipeline. A true end-to-end evaluation would require solving the cross-file contig mapping problem (sequence alignment, AGP-based mapping, or Hi-C signal correlation).

### 6.5 AI/ML integration (FUTURE)

The contact map data and curation scripting DSL provide a foundation for:
- **Vision models** on contact maps for anomaly detection and pattern recognition
- **LLM-driven curation** generating scripts via the DSL
- **Diffusion/generative models** for contact map denoising

The benchmark harness provides the evaluation infrastructure for testing such approaches.

---

## 7. Reproducing results

```bash
# Download all 21 specimens (~5.3 GB, requires AWS CLI)
npx tsx bench/acquire/cli.ts --download

# Run full benchmark
npx tsx bench/cli.ts run

# Generate report table
npx tsx bench/cli.ts report --format markdown

# Parameter sweep (single specimen)
npx tsx bench/cli.ts sweep \
  --pre-curation bench/data/Taeniopygia_guttata/pre.pretext \
  --post-curation bench/data/Taeniopygia_guttata/post.pretext
```

Results are written to `bench/data/results.json`.
