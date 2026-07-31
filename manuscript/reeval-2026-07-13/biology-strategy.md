# Biology-study strategy for OpenPretext (2026-07-13)

Integrates the firewalled re-validation of the original study and three blind
idea-generation lenses. Companion to `fresh-evaluation.md` (tool paper) and
`reconciliation.md` (tool-side reconciliation).

## 1. Verdict on the original study (N=18 P(s) R-squared)

Not salvageable on the data in hand. A blind, firewalled re-analysis
(`revalidation/audit-report.md`) found:

- The reported exponents and R-squared reproduce exactly as a plain full-range OLS
  fit; there is no hidden robustness.
- Per-species fits are wildly unstable to fit window (toad's R-squared ranges 0.05
  to 0.98).
- R-squared correlates negatively with the number of usable points (Pearson -0.52,
  p=0.028); refitting all species over a matched distance window collapses the
  spread and erases the correlation, and the full-range rank order does not persist.
- Conclusion: the between-species R-squared variation is largely a methodological
  artifact of overview resolution (point count and fit range), not biology. Overview
  pixel-domain data cannot establish a meaningful P(s) exponent or rank species by
  P(s) behavior.

Correction to an earlier framing of mine: pixels-vs-base-pairs is NOT the core
confound (a pixel/bp rescale is an additive shift on log-x, so slope and R-squared
are invariant to it). The real confounds are unequal sampled distance ranges and
point counts.

A proper test would require full-resolution matrices. Scoping
(`revalidation/data-acquisition-scoping.md`): GenomeArk/VGP publishes raw Hi-C reads
but no matrices (gharial alone is ~131 GB of reads), availability across the 18 is
uneven (koala has no reads there), and the path is align to pairtools to cooler to
cooltools. This is an HPC project, not a session task. A GEO series ("3D genomics
across the tree of life," GSE169088) may provide .hic for a subset; assembly-match
unverified. Even done, the biological result is unknown and the P(s) framing is not
the obvious vehicle.

## 2. Ranked slate of new study candidates

Nine raw ideas (three lenses x three) collapse to a few distinct, defensible ones.
The dominant convergent theme: use the 10 GenomeArk before/after pairs with
within-genome paired contrasts, which cancels the comparability trap exactly (same
genome, protocol, bp-per-bin on both sides).

**Tier 1 (feasible now, comparability-safe, genuinely OpenPretext-specific).**
A curation-impact / metric-robustness study on the before/after pairs:
- Architectural footprint of curation (lens 1 A): permute the pre-curation matrix
  into the curator's order within its own grid, measure within-grid diagonal and
  block contact-mass gain, plus aggregate metric deltas. Two-sided hypothesis: a
  small aggregate footprint next to a large local one is itself a finding.
- Assembly-state robustness of coarse metrics (lens 2 Study 1): which Mb-scale
  metrics change under curation and which are invariant, via the paired pre/post
  contrast.
- Which overview features are diagnostic of curation need, framed as queue triage,
  not hidden-quality revelation (lens 3 A), to survive the circularity confound.
- Validation spine (lens 3 D): the multi-mip trick, compute each metric at
  64/128/256/512/1024 px of the SAME file, to characterize resolution dependence
  with zero cross-genome variance, and cross-validate against cooltools/FAN-C. This
  also closes the standing A3 gap that the metrics are uncross-validated.

Venue: methods/resource (GigaByte, Genome Biology Methods, Bioinformatics). This is
NOT a biology-discovery paper. Honest limits: N=10, vertebrate-heavy, no taxon test;
the "before" is already YaHS-scaffolded so the delta is the curation increment;
inversions are not recoverable from the loader (ground truth must be order/partition
only); pre/post grids must be dimension-checked (haplotig purging can shift the grid).

Novelty confirmed (`revalidation/tier1-novelty-check.md`): genuinely open, not a
replication. The closest prior art is Howe et al. 2021 (GigaScience 10(1):giaa153),
which uses the same pre/post-across-a-panel design on 111 assemblies but measures
contiguity and intervention counts and uses Hi-C only qualitatively (before/after
images); it never recomputes Hi-C architecture metrics. A sweep of ~1,994 Howe citers
filtered on architecture-metric terms came back clean. The novel layer is the
measurement (Mb-scale Hi-C architecture metrics) plus the diagnostic framing (which
metrics move under curation, which are diagnostic of curation need). Reviewer risk:
make the diagnostic angle load-bearing, or it reads as "Howe with extra plots."

**Tier 2 (closest to actual biology, but bounded, not recommended as primary).**
Size-linked inter-chromosomal (trans) association across the ~9-10 chromosome-level
specimens, with avian microchromosome clustering as a positive control (lens 2
Study 2). Escapes the trap via chromosome-level within-genome contrasts, but the bird
phenomenon is already published (Hoencamp et al. Science 2021 on architecture types
across 24 species; avian microchromosome clustering established), trans signal is weak
at 64x64, and n is small. Better as a positive control inside Tier 1 than a standalone.

**Discard.** Cross-species compartment/saddle strength (lens 2 Study 3) and any
cross-species P(s)/exponent comparison: same pixel-domain trap as the original study.
Haplotig-burden-vs-heterozygosity (lens 3 C) is gated on a psgh coverage track the
catalog does not carry, plus purge_dups and heterozygosity-estimate confounds.

## 3. The honest meta-conclusion

There is no credible comparative-genomics BIOLOGY-DISCOVERY paper available from
OpenPretext at overview resolution. The overview ceiling means its defensible research
contributions are methodological and meta-scientific: about curation itself, and about
the behavior and validation of the Mb-scale metrics. That is a real and publishable
contribution, and it is genuinely enabled by OpenPretext's uncontested strengths
(paired native-.pretext panel, recompute-on-arrangement, reproducible batch pipeline),
but it should be named for what it is (methods/resource), not sold as a biological
insight.

## 4. Options for the biology thread

1. Reframe: pair the tool paper with a Tier 1 curation-impact / metric-robustness
   methods paper (feasible now, no new data, closes a real gap). Recommended.
2. Invest: commit to the HPC full-resolution reprocessing to attempt a genuine biology
   paper, with a NEW question (not the dead P(s) angle). Large cost, uncertain payoff;
   first cheap step is to verify GSE169088 coverage of these taxa before any compute.
3. Defer: ship the tool paper (and optional resource/education paper) now, hold the
   biology thread until a specific, resolution-appropriate question and its data exist.
