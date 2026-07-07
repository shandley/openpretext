# Analysis module correctness audit (2026-07-06)

Read-only audit of `src/analysis/` for the same defect classes found and fixed
in ContactDecay (spurious R-squared on sparse curves) and KRNormalization
(mislabeled algorithm). Fifteen modules were covered by five parallel reviewers;
every high-severity finding below was re-verified by hand against the code.

## The through-line

Almost every high-severity finding is one pattern: a module returns a confident,
real-looking result on input that cannot support it (empty windows, all-zero
rows, no compartment structure, a fragmented assembly), with nothing to mark the
result as indeterminate. This is the same class as the ContactDecay R-squared=1
bug. It bites hardest on the small, sparse, fragmented genomes the beta testers
use (birds, microchromosomes), and several of these modules feed Paper 1.

The recommended remedy is consistent across them: detect the degenerate case and
return a `NaN` / null / "indeterminate" result plus a flag, rather than emitting
a seed pattern, a collapsed threshold, or a floored value as if it were a
measurement. The same `Number.isFinite` display discipline added for decay
applies.

## High severity

### H1. InsulationScore normalization is corrupted by an always-present outlier
`src/analysis/InsulationScore.ts:79,98`. Position 0 always has an empty upstream
window, so its raw score is 0; `normalizeInsulationScores` then takes
`log2(0 + 1e-10) = -33.2`, which becomes the min-max minimum and compresses all
real insulation variation into a sliver near 1.0. A true boundary where raw
insulation drops threefold normalizes to a prominence of about 0.05, below the
0.1 the interface documents, so it is silently missed. Every normalization is
affected, not only sparse maps; sparse maps make it worse.
Fix: compute min/normalization over valid (count > 0) positions only, or floor
at the smallest positive raw score instead of 1e-10.

### H2. ScaffoldDetection reports one chromosome for any fragmented assembly
`src/analysis/ScaffoldDetection.ts:154,159`. The boundary threshold is
`median(scores) * 0.3` and a boundary requires `score < threshold`. When half or
more of the adjacent-pair scores are 0 (the normal case for sparse/fragmented
genomes), the median is 0, the threshold is 0, and no boundary is ever found, so
every contig merges into a single block. Reproduced: six fully isolated contigs
return 1 block instead of 6.
Fix: derive the threshold from a positive statistic (a fraction of the max, or
the median of non-zero scores) and treat exact-zero scores as boundaries.

### H3. CompartmentAnalysis emits an artifact A/B track on no-compartment input
`src/analysis/CompartmentAnalysis.ts:230,282,354`. Power iteration is seeded with
a fixed alternating vector `[+1,-1,+1,-1,...]`. A genome with normal distance
decay but no compartments produces an all-ones observed/expected matrix, so every
correlation-matrix row is constant, all standard deviations are 0, and the
correlation matrix collapses to the identity. The alternating seed is a fixed
point of the identity, so the iteration "converges" at step 1 and the seed itself
is returned, normalized to a hard `[1,0,1,0,...]` A/B checkerboard. Nothing flags
the degeneracy (the `fill(0.5)` fallback only triggers when maxAbs is 0, which an
alternating vector never is). On real input with compartments the seed does find
the true first component, so the bug is specific to weak/absent structure, which
is exactly where a false positive is most misleading.
Fix: detect near-zero eigenvalue separation / immediate convergence / a
rank-deficient correlation matrix and return a flat eigenvector plus a
`degenerate` flag.

### H4. CentromereDetector calls confident centromeres on structureless input
`src/analysis/CentromereDetector.ts:295,302`. Prominence is measured on a
z-normalized signal and compared to `minProminence` (default 0.5), which is
nearly scale-free and almost always exceeded; confidence is then
`min(1, prominence/3)` on the same z-scaled value. There is no absolute-magnitude
floor. Reproduced: a 64x64 overview of pure noise split into 8 microchromosomes
yields a centromere call for all 8 contigs at confidences up to 0.95.
Fix: gate on an absolute inter-contact magnitude (pre-normalization) in addition
to z-prominence.

## Medium severity

### M1. MisassemblyDetector: cut-confidence inputs are wired wrong
`src/analysis/MisassemblyDetector.ts:347,394-404` and `src/ui/AnalysisPanel.ts:630-632`.
Three related issues: (a) the `insulationScores` parameter is declared but never
read; the TAD component uses `suggestion.strength` instead, so the insulation
profile the caller passes is discarded. (b) Multi-flag confidence is matched to
the contig midpoint, not each suggestion's pixel, so every suggestion in a contig
shares one compartment/decay value; the correct `flagMap` keyed by pixel is built
but never read. (c) The "decay" component is fed `cachedInsulation` as a proxy,
so two of the three "independent" signals collapse onto insulation and only
`strength` truly varies.
Fix: add `overviewPixel` to `CutSuggestion` and use the existing `flagMap`; feed
a real decay profile or drop the P(s) claim; use or remove `insulationScores`.

### M2. CheckerboardScore docstring is inverted relative to the code
`src/analysis/CheckerboardScore.ts:9-13` vs `226`. The header says "lower entropy
= stronger, more regular pattern ... the score is inverted ... 100 = perfectly
regular checkerboard," but the code computes `score = (entropy/maxH)*100` with no
inversion (the inline comment at line 224 confirms higher entropy gives a higher
score). A developer trusting the header reads the 0-100 number backwards.
Separately, whether "higher entropy of the cosine-distance histogram" should mean
"stronger compartmentalization" at all is a scientific judgment worth a second
look, since higher entropy usually reads as more disorder.
Fix: correct the header to match the implementation, and confirm the intended
direction.

### M3. CheckerboardScore ignores `minSamples` on its primary path
`src/analysis/CheckerboardScore.ts:204` vs documented `33`. `minSamples`
(default 200) is honored only in the whole-genome fallback; the per-chromosome
path uses a hardcoded `< 10`, so setting `minSamples` has no effect on real
multi-chromosome runs.

### M4. CheckerboardScore floods sparse maps with a "no data" sentinel
`src/analysis/CheckerboardScore.ts:122`. `cosineDistanceSubset` returns a fixed
1.0 whenever either row is all-zero, so empty scaffolds and microchromosomes fill
the histogram with 1.0 values indistinguishable from real distances, biasing the
score toward a value set by the empty fraction.
Fix: skip pairs where either row norm is 0.

### M5. SaddlePlot strength silently reads 0 on realistic input
`src/analysis/SaddlePlot.ts:184-202`. A realistic bimodal eigenvector populates
only the two extreme quantile bins, so each corner collapses to a single cell;
an empty AB corner makes `strength` silently 0, reported identically to a genome
with genuinely no compartmentalization. Empty cells are excluded from the means
rather than treated as low signal.
Fix: require a minimum populated-cell count per corner and return NaN/null with a
flag when underpopulated.

### M6. HealthScore integrity is 100 when misassembly detection never ran
`src/analysis/HealthScore.ts:84` and `src/ui/AnalysisPanel.ts:972`.
`scoreIntegrity(0)` returns 100, and `misassemblyCount` is non-nullable, but
`buildHealthScore` does not require detection to have run. A fresh load where the
user computes only decay reports a perfect integrity score, indistinguishable
from a genome that was assessed and found clean, unlike the other components,
which fall back to a neutral 50.
Fix: make `misassemblyCount` nullable (or pass an "assessed" flag) and return 50
when detection has not run.

### M7. HealthScore NaN guards check `!== null`, not finiteness
`src/analysis/HealthScore.ts:98-104,111-113`. After the recent decay fix,
`scoreCompartments` and `scoreLibraryQuality` still guard with `x !== null`, so a
NaN eigenvalue or ratio passes the guard and poisons `overall` to NaN. Upstream
currently keeps these finite, so this is a latent contract inconsistency rather
than a confirmed end-to-end failure.
Fix: use `Number.isFinite` in both scorers and mirror it at the call site.

### M8. HiCQualityMetrics contactDensity is mean-over-occupied, not documented
`src/analysis/HiCQualityMetrics.ts:123` vs docstring. The denominator counts only
pixels with value > 0, so a 5%-occupied map and a 95%-occupied map with the same
nonzero mean report identical "density." The metric is blind to sparsity, which
contradicts its docstring and defeats its purpose on the fragmented genomes it
targets.
Fix: divide by the full upper-triangle count, or rename the field.

### M9. Virtual4C log-transform ranks empty bins above depleted bins
`src/analysis/Virtual4C.ts:96-98`. With `logTransform` on, an empty bin
(O/E = 0) maps to 0 while a genuinely depleted bin (0 < O/E < 1) maps to a
negative log, so after min-max scaling the no-contact bin appears more enriched
than the depleted bin. Reproduced: O/E `[0, 0.5, 1, 4]` displays as
`[0.333, 0.0, 0.333, 1.0]`.
Fix: map non-positive values to the post-log minimum or mask them out of min/max.

## Low severity and documentation

- InsulationScore `boundaryProminence` doc says default 0.1, code uses 0.03
  (`InsulationScore.ts:21` vs `37`).
- InsulationScore and DirectionalityIndex have no contig awareness, so windows at
  contig junctions average across contigs and can manufacture a false boundary at
  each junction (`InsulationScore.ts:65-79`, `DirectionalityIndex.ts:62-88`).
  CheckerboardScore already accepts chromosome ranges; these two do not.
- PatternDetector `detectInversions` doc says default threshold 0.6, code uses 2.0
  (`PatternDetector.ts:45` vs `51`). Its "background rate at various distances" is
  a single flat genome-wide mean, not distance-corrected, so the ratio is not the
  observed/expected it is described as (`PatternDetector.ts:138-150`).
- CurationProgress reports Kendall tau = 1 for empty/trivial assemblies via
  `OrderingMetrics.kendallTau` returning 1 for length <= 1
  (`CurationProgress.ts:53`, `OrderingMetrics.ts:33`).
- HiCQualityMetrics `longShortRatio` returns 0 when short-range is empty (reads as
  the opposite of the truth), and `shortRangeThreshold` is a fixed 20 bins
  regardless of overview size, so it encodes different genomic distances across
  files. `cisTransRatio` actually computes the cis fraction, not a ratio.
- ICENormalization cites "Sinkhorn-Knopp (Imakaev et al. 2012)" for a symmetric
  sqrt-scaling update; the function is honestly named `sinkhornKnopp`, but Imakaev
  ICE and symmetric Sinkhorn-Knopp are commonly treated as close variants, so this
  citation note is lower-confidence than the KR one and warrants a check rather
  than an assertion (`ICENormalization.ts:1-11`).
- CompartmentAnalysis documents "positive = A, negative = B" but the eigenvector
  sign from power iteration is arbitrary and unanchored, so the A/B labels can
  flip (`CompartmentAnalysis.ts:35`).
- Checkerboard method cited as "Che et al. 2025" in HealthScore and "Che et al.
  2026" in CheckerboardScore; reconcile the year.

## Missing numeric tests

Every high-severity finding survived because the tests assert array shape,
finiteness, or "does not throw" rather than pinning an expected value on a known
input, and in two cases a test actively passes on the buggy output (the
CompartmentAnalysis uniform-map test and the Insulation boundary tests that feed
pre-built normalized scores). Any fix should land a test that pins the corrected
value or the indeterminate result on a synthetic degenerate input.

## Not defects

- MisassemblyDetector's HiArch / CenterFinder citation (Che et al., bioRxiv
  2025.07.05.663309, xjtu-omics/HiArch) was verified as real.
- TelomereDetector is clean (all divide-by-zero paths guarded; motif/RC counting
  sound), one low naming inconsistency aside.
- No dead documented parameters in Compartment, Saddle, ICE, Virtual4C, or
  HiCQuality; numerical divide-by-zero paths in those modules are largely guarded.
