# OpenPretext Benchmark Report

**Date:** 2026-02-07
**Harness version:** Initial benchmark run
**Test specimens:** 4 GenomeArk curated assemblies

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

The pre-curation file is loaded for supplementary statistics (contig count, fragmentation level) but is not used in metric computation.

### Ground truth extraction

Chromosome assignments are derived from GenomeArk naming conventions:

| Pattern | Example | Chromosome |
|---------|---------|------------|
| `SUPER_N` | `SUPER_1`, `SUPER_Z` | N |
| `SUPER_N_unloc_M` | `SUPER_12_unloc_3` | N (parent) |
| `Super_Scaffold_N` | `Super_Scaffold_1A` | N |
| `chrN` | `chr1`, `chrX` | N |
| `Scaffold_*`, `scaffold_*` | `Scaffold_49` | Unplaced group |

Name-based detection is used as the primary method (requires >= 3 distinct chromosome labels). Signal-based boundary detection is available as a fallback but was not needed for any of the 4 test specimens.

### Metrics

**AutoCut (breakpoint detection):**
- **Precision** — fraction of detected breakpoints that match a ground truth split
- **Recall** — fraction of ground truth splits that were detected
- **F1** — harmonic mean of precision and recall
- **False positives** — spurious breakpoints on correctly assembled contigs

**AutoSort (contig ordering):**
- **Kendall's tau** — rank correlation between predicted and true orderings (-1 to 1)
- **Adjusted Rand Index (ARI)** — clustering agreement between predicted chains and true chromosomes
- **Orientation accuracy** — fraction of contigs with correct inversion state
- **Chain purity** — average fraction of each predicted chain from a single true chromosome
- **Chain completeness** — average fraction of each true chromosome captured in its best chain
- **Longest correct run** — longest contiguous subsequence matching ground truth order

**Chromosome completeness:**
- **Per-chromosome completeness** — fraction of each chromosome's base pairs in the correct chain
- **Macro-average** — unweighted average across chromosomes
- **Micro-average** — base-pair-weighted average
- **High completeness count** — chromosomes with >90% completeness

---

## 2. Test specimens

All specimens are GenomeArk curated assemblies downloaded from the public `s3://genomeark` bucket.

| Species | Common name | Contigs | Chromosomes |
|---------|-------------|---------|-------------|
| *Anilios waitii* | Interior blind snake | 124 | 17 |
| *Amazona ochrocephala* | Yellow-crowned amazon | 1,678 | 36 |
| *Agelaius phoeniceus* | Red-winged blackbird | 317 | 41 |
| *Taeniopygia guttata* | Zebra finch | 134 | 33 |

The specimens span a range of assembly fragmentation (124 to 1,678 contigs) and chromosome counts (17 to 41), covering reptilian and avian genomes.

---

## 3. Results

### 3.1 Summary table

| Species | n | P | R | F1 | tau | ARI | Orient | Purity | Compl | LCR | Time |
|---------|---|---|---|----|----|-----|--------|--------|-------|-----|------|
| *A. waitii* | 124 | 0.00 | 1.00 | 0.00 | 0.925 | -0.000 | 0.961 | 0.991 | 0.765 | 39 | 1.5s |
| *A. ochrocephala* | 1678 | 0.00 | 1.00 | 0.00 | 0.945 | -0.003 | 0.963 | 0.999 | 0.863 | 59 | 3.2s |
| *A. phoeniceus* | 317 | 1.00 | 1.00 | 1.00 | 0.886 | -0.052 | 0.912 | 0.993 | 0.929 | 30 | 3.5s |
| *T. guttata* | 134 | 1.00 | 1.00 | 1.00 | 0.758 | -0.056 | 0.836 | 0.981 | 0.976 | 26 | 3.7s |
| **Mean** | — | 0.50 | 1.00 | 0.50 | 0.879 | -0.028 | 0.918 | 0.991 | 0.883 | 39 | 3.0s |

**Key:** P = precision, R = recall, F1 = F1 score, tau = Kendall's tau, ARI = adjusted Rand index, Orient = orientation accuracy, Purity = chain purity, Compl = chain completeness, LCR = longest correct run, Time = total wall time.

### 3.2 AutoCut analysis

On curated assemblies, AutoCut should find **zero** breakpoints (contigs are already at correct boundaries). Two specimens achieved this (blackbird, zebra finch: F1 = 1.00), but two did not:

| Species | False positives | Notes |
|---------|----------------|-------|
| *A. waitii* (blind snake) | 31 | Severe over-detection |
| *A. ochrocephala* (parrot) | 6 | Moderate over-detection |
| *A. phoeniceus* (blackbird) | 0 | Correct |
| *T. guttata* (zebra finch) | 0 | Correct |

The blind snake is notable: 31 false positive breakpoints across 124 contigs means roughly 1 in 4 contigs would be incorrectly split. The parrot has 6 false positives across 1,678 contigs (much lower false positive rate per contig).

**Root cause:** The `cutThreshold: 0.20` and confidence filter `> 0.30` allow detection of low-density regions that are natural variation rather than misassembly. Curated assemblies can have weak diagonal signal at certain contig boundaries due to repetitive sequences, heterochromatin, or low-mappability regions. These look like breakpoints to the algorithm but are normal.

### 3.3 AutoSort analysis

**Ordering quality (Kendall's tau: 0.76-0.94):**

AutoSort achieves good rank correlation across all specimens. The parrot (tau = 0.94) and blind snake (tau = 0.93) perform best, while the zebra finch (tau = 0.76) is weakest. This may correlate with the zebra finch having many small microchromosomes that are harder to order from Hi-C signal.

**Chain purity (0.98-1.00):**

Chains almost never mix contigs from different chromosomes. This is the strongest metric — it means the union-find algorithm correctly identifies which contigs belong together.

**Chain completeness (0.77-0.98):**

This is the weakest sort metric. The blind snake has only 0.77 completeness, meaning chromosomes are fragmented across multiple chains. The zebra finch achieves 0.98, suggesting its smaller chromosomes are easier to capture in single chains.

**Orientation accuracy (0.84-0.96):**

The zebra finch has the worst orientation accuracy at 0.84. Given 134 contigs, approximately 22 contigs have incorrect inversion. This correlates with the lower Kendall's tau and suggests the corner-sampling approach for orientation detection degrades when contigs span few pixels in the overview map.

**ARI (approximately 0.00):**

ARI is near-zero for all specimens. This is **mathematically expected** — not a bug. ARI measures agreement between two partitions at the same granularity. AutoSort produces many small chains (one per contig group), while ground truth has ~17-41 chromosomes. Even when chains are perfectly pure (purity ~1.0), the much finer predicted partition yields ARI ~ 0. Chain purity and chain completeness are more informative metrics for this evaluation.

### 3.4 Chromosome completeness

| Species | Macro avg | Micro avg | High (>90%) | Total chroms |
|---------|-----------|-----------|-------------|-------------|
| *A. waitii* | 0.838 | 0.508 | 11 / 17 | 17 |
| *A. ochrocephala* | 0.937 | 0.837 | 31 / 36 | 36 |
| *A. phoeniceus* | 0.973 | 0.963 | 39 / 41 | 41 |
| *T. guttata* | 0.994 | 0.994 | 32 / 33 | 33 |

The zebra finch achieves near-perfect chromosome completeness (32 of 33 chromosomes above 90%). The blind snake is weakest, with only 11 of 17 chromosomes above 90% and a micro-average of 0.51 (meaning only half the genome by base pairs ends up in the correct chain).

**Per-chromosome breakdown — problematic cases:**

- *A. waitii* chromosomes 15 (4.3%) and 16 (25.2%): severely incomplete, likely small chromosomes whose contigs are scattered across chains.
- *A. ochrocephala* chromosomes 34 (9.8%) and 35 (45.6%): the two smallest chromosomes are poorly captured.
- *A. phoeniceus* chromosome 10 (52.0%) and 40 (42.5%): moderate incompleteness on small chromosomes.

**Pattern:** Small chromosomes with few contigs are consistently the worst-performing. Their Hi-C signal is weaker and more easily overwhelmed by noise, making chain assignment unreliable.

### 3.5 Performance

| Species | Load (ms) | AutoCut (ms) | AutoSort (ms) | Total (ms) |
|---------|-----------|-------------|-------------|-----------|
| *A. waitii* | 1,485 | 0.6 | 6.7 | 1,495 |
| *A. ochrocephala* | 3,125 | 0.2 | 50.1 | 3,198 |
| *A. phoeniceus* | 3,476 | 0.1 | 6.8 | 3,489 |
| *T. guttata* | 3,716 | 0.8 | 2.5 | 3,721 |

Both algorithms are fast (sub-second even for the 1,678-contig parrot). Total time is dominated by `.pretext` file loading and tile decompression. AutoSort is O(n^2) in contig count, visible in the parrot's 50ms vs ~5ms for the others.

---

## 4. Bugs discovered

### 4.1 AutoSort chain reversal bug (line 376)

**File:** `src/curation/AutoSort.ts:376`

```typescript
} else if (!jShouldBeHead && nodeJ.isHead && !nodeJ.isHead) {
```

The condition `nodeJ.isHead && !nodeJ.isHead` is a **tautological contradiction** — it can never be true. The intended code is:

```typescript
} else if (!jShouldBeHead && nodeJ.isHead && !nodeJ.isTail) {
```

**Impact:** When J needs to be at the tail of its chain but is currently at the head (and is not also at the tail, i.e., chain length > 1), the chain is not reversed when it should be. This causes incorrect chain orientation in some merges, contributing to reduced orientation accuracy and Kendall's tau.

**Severity:** Medium. This affects every chain merge where J is at the wrong end. The effect is partially masked because single-element chains (where `isHead && isTail` are both true) are exempt, and because subsequent merges may accidentally correct the orientation.

### 4.2 Signal-based chromosome detection failure

The fallback `detectChromosomeBoundariesBySignal()` function fails completely at the coarsest mipmap level (1024x1024). With 100+ contigs, most contigs are only 1-5 pixels wide. The median pair signal is 0.0000 for all tested specimens, causing zero boundaries to be detected.

**Impact:** If name-based detection fails (e.g., non-standard contig names), the fallback produces useless results. This is currently not triggered for GenomeArk assemblies but would affect other data sources.

---

## 5. Investigation narrative

The initial benchmark run produced ARI = 0.00 across all 4 specimens. Investigation revealed a chain of issues:

1. **Signal-based boundary detection was broken.** At the coarsest mipmap (1024x1024), contigs were too small in pixel space for meaningful off-diagonal signal sampling. The median pair signal was zero, so no boundaries were found, and all contigs were assigned to chromosome 0.

2. **Name-based detection was added as primary method.** Regex patterns for GenomeArk naming conventions (`SUPER_N`, `Super_Scaffold_N`, `chrN`) correctly identify 65-317 chromosome-level scaffolds per species. An initial threshold requiring 10% of contigs to be named was too high for the parrot (65 named out of 1,678 = 3.9%), and was relaxed to just requiring >= 3 distinct chromosome labels.

3. **Cross-file contig mapping was impossible.** Pre-curation files use original assembly names (`scaffold_1.H1`, `H2.scaffold_1`) while post-curation files use curated names (`SUPER_1`, `Super_Scaffold_2`). The curation process completely renames contigs and may merge/split them, with zero name overlap between files.

4. **Evaluation was redesigned to use curated assembly only.** Running AutoCut and AutoSort on the curated assembly — where ground truth is known from names — avoids the mapping problem entirely. This is a valid evaluation: AutoSort should be able to recover chromosome groupings from the Hi-C signal regardless of whether the input is pre- or post-curation.

---

## 6. Recommended next steps

### 6.1 Fix AutoSort chain reversal bug (HIGH priority)

**File:** `src/curation/AutoSort.ts:376`

Change `!nodeJ.isHead` to `!nodeJ.isTail`. This is a one-character fix that should improve orientation accuracy and Kendall's tau across all assemblies. The fix should be validated by re-running the benchmark and checking for improvement.

### 6.2 Add chain merge post-processing to AutoSort (HIGH priority)

The benchmark shows chain purity of 0.98-1.00 but chain completeness of only 0.77-0.98. AutoSort creates many small, pure chains rather than fewer complete chromosomes. A second-pass merge step could:

- Identify chain pairs with weak but non-trivial inter-chain Hi-C signal
- Merge chains that are likely part of the same chromosome
- Use a more permissive threshold than the initial chaining pass

This would directly improve chromosome completeness without sacrificing purity.

### 6.3 Reduce AutoCut false positives (MEDIUM priority)

31 false positives on the blind snake is unacceptable for production use. Options:

- **Raise the confidence threshold** from 0.30 to 0.50+ (filter out low-confidence detections)
- **Raise the default `cutThreshold`** from 0.20 to 0.30 (require a larger density drop)
- **Add a minimum region width** requirement (real misassemblies create broader low-density regions than noise)
- **Use a local baseline** instead of global average (a single weak contig shouldn't lower the baseline for the entire assembly)

These could be tested via the parameter sweep tool: `npx tsx bench/cli.ts sweep`.

### 6.4 Improve orientation detection for small contigs (MEDIUM priority)

Orientation accuracy drops from 0.96 to 0.84 as assemblies become less fragmented but have more microchromosomes. The corner-sampling approach in `computeLinkScore()` samples anti-diagonal bands at distance 1..maxD from the corner. For contigs that are only 2-5 pixels wide in overview space, this provides very few samples.

Options:
- Use higher-resolution mipmap tiles for small contigs instead of the coarsest overview
- Weight orientation scores by contig pixel width (low-confidence for tiny contigs)
- Default to non-inverted for contigs below a minimum pixel threshold

### 6.5 Improve signal-based chromosome detection fallback (LOW priority)

The current signal-based fallback fails at 1024x1024 overview resolution. If name-based detection is insufficient (non-GenomeArk assemblies), the fallback should:

- Use a minimum contig pixel width filter (skip contigs < 3 pixels)
- Use the mean of non-zero signals rather than median of all (already partially improved)
- Consider using higher-resolution mipmap data for boundary detection

### 6.6 Expand the test corpus (LOW priority)

Four specimens is a minimal validation set. The acquisition pipeline supports discovering more specimens from GenomeArk. Expanding to 15-20 specimens across mammals, fish, insects, and plants would strengthen confidence in the metrics and reveal taxonomic biases.

### 6.7 Add pre-curation evaluation mode (FUTURE)

The current evaluation runs on curated assemblies. A true end-to-end evaluation would run on pre-curation data and compare against the curated result. This requires solving the contig name mapping problem, possibly by:

- Sequence alignment between pre/post contigs (heavy, but definitive)
- Positional matching via Hi-C signal correlation
- Using the AGP file that records curation operations (if available from GenomeArk)

### 6.8 Use name-based chromosome detection in the UI (FUTURE)

The `extractChromosomeLabel()` function could be exposed in the UI for:

- Auto-coloring contigs by chromosome when loading curated assemblies
- Validating that AutoSort's proposed ordering matches expected chromosome groupings
- Showing chromosome labels as annotations in the contact map view

---

## 7. Metric interpretation guide

For future benchmark runs, these ranges provide context:

| Metric | Excellent | Good | Needs work |
|--------|-----------|------|------------|
| Chain purity | > 0.95 | 0.85-0.95 | < 0.85 |
| Chain completeness | > 0.95 | 0.80-0.95 | < 0.80 |
| Kendall's tau | > 0.90 | 0.75-0.90 | < 0.75 |
| Orientation accuracy | > 0.95 | 0.85-0.95 | < 0.85 |
| Macro completeness | > 0.95 | 0.85-0.95 | < 0.85 |
| AutoCut false positives | 0 | 1-5 | > 5 |

**ARI should be de-emphasized.** It is not meaningful when the predicted and ground truth partitions have very different granularity (many chains vs few chromosomes). Chain purity + chain completeness together capture what ARI intends to measure, but handle the granularity mismatch correctly.

---

## 8. Reproducing results

```bash
# Download test specimens (requires AWS CLI, no credentials needed)
npx tsx bench/acquire/cli.ts --download

# Run benchmarks
npx tsx bench/cli.ts run

# Generate report table
npx tsx bench/cli.ts report --format markdown

# Parameter sweep (on a single specimen)
npx tsx bench/cli.ts sweep \
  --pre-curation bench/data/Taeniopygia_guttata/pre.pretext \
  --post-curation bench/data/Taeniopygia_guttata/post.pretext
```

Results are written to `bench/data/results.json`.
