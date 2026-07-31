# A3 — Analysis subsystem assessment (in-browser Hi-C analytics)

Scope: `src/analysis/*`, the `AnalysisWorker`/`AnalysisWorkerClient` pair and its
synchronous fallback, plus the QC-metric code in `src/curation/QualityMetrics.ts`
and the O/E view in `src/ui/OEMapToggle.ts`. Assessed only against source, tests,
`README.md`, `CHANGELOG.md`, `guide/reading-the-analysis.html`, and `docs/`. No
manuscript material was read.

Bottom line up front: the math is competently implemented, unusually honestly
labeled, and self-consistency tested, but every method is a re-implementation of an
established algorithm, and all of it runs on the coarse overview `contactMap` (as
small as 64x64, Mb-scale bins). There is no method-level novelty. The one
publication-defensible contribution is the integration: live, client-side analytics
recomputed on the curated arrangement inside a browser-native curation tool.

---

## 1. Which modules are implemented, and what each computes

All numerical modules operate on the overview `contactMap` (row-major symmetric
`Float32Array`, dimension `round(sqrt(length))`), never full-resolution tiles. The
one exception is the haplotig coverage discriminator, which reads a full-resolution
coverage extension track. Heavy modules are dispatched to `AnalysisWorker` via
`AnalysisWorkerClient` (Promise-based, transferable typed arrays for zero-copy) with
a synchronous main-thread fallback when workers are unavailable (test env,
`file://`, or worker error). The worker path and the fallback call the identical
pure functions, so results are path-independent.

Matrix balancing
- `ICENormalization.ts` — symmetric Sinkhorn-Knopp iterative balancing (Imakaev et
  al. 2012, "ICE"). Per pass: `correction[i] = sqrt(rowSum[i])`, divide
  `M[i,j] /= correction[i]*correction[j]`, accumulate bias, recompute row sums in a
  fused O(n^2) pass; converge at `max|rowSum-1| < epsilon`. Defaults: 50 iters,
  eps 1e-4, low-coverage bins below the 2% quantile masked and excluded.
- `KRNormalization.ts` — the *same* Sinkhorn-Knopp algorithm (imports ICE's
  `computeRowSums`/`filterLowCoverageBins`), differing only in defaults (200 iters,
  eps 1e-6). The module header states plainly that this is Sinkhorn-Knopp, **not**
  the Knight-Ruiz (2013) Newton/CG algorithm, that the "KR" name is retained only
  for session/analysis-key backward compatibility, and not to re-introduce a
  Knight-Ruiz citation. So "ICE vs KR" in the app is two Sinkhorn-Knopp variants,
  not two distinct balancing methods.

Track / curve metrics
- `InsulationScore.ts` — Crane et al. 2015 insulation: mean contact in an
  off-diagonal `w x w` window (default w=10, clamped to `size/2`), log2 with a
  per-map positive floor, min-max normalized; boundaries are local minima with
  prominence >= 0.1. Contig-aware: positions without a full in-contig window are set
  NaN and excluded, which fixes a former false-boundary-at-every-junction artifact.
- `DirectionalityIndex.ts` — Dixon et al. 2012 signed chi-square DI over upstream/
  downstream single-column strips (default w=10); boundaries at negative-to-positive
  zero-crossings. Same contig-edge NaN guard. Simplified: uses one-wide strips, not
  the full triangular Dixon window.
- `ContactDecay.ts` — P(s): per-distance intra-contig mean via
  `computeIntraDiagonalProfileWithCounts`, OLS of log10(mean) vs log10(distance) →
  decay exponent + R^2. Guards: distances need >= `minCountForFit` (10) supporting
  pixel pairs; the fit needs >= `minFitPoints` (5) distinct distances or it returns
  NaN (not a spurious R^2=1 from 2 points). Optional opt-in `logbin` fit (10
  bins/decade, count-weighted). Also `computeLocalSlope` (windowed log-log
  derivative) and per-scaffold decay.

Compartments / structure
- `CompartmentAnalysis.ts` — genuine A/B pipeline: bin → expected[d] as the mean at
  each diagonal offset → O/E → Pearson correlation matrix of O/E rows → first
  eigenvector by power iteration (deterministic alternating +/-1 seed). A degeneracy
  guard returns a flat 0.5 / eigenvalue 0 when O/E is constant. Sign is arbitrary
  (see below).
- `GCContent.ts` — orients the compartment eigenvector by GC: stride-samples GC per
  overview bin from a loaded FASTA and flips the sign so the higher-GC lobe is A.
  Returns "unoriented" when GC is unavailable.
- `SaddlePlot.ts` — digitizes bins by eigenvector quantile rank (20 bins), averages
  O/E per quantile-pair, reports compartment strength `(AA+BB)/(2*AB)`; an
  `underpopulated` flag marks when corner cells are too few to be meaningful.
- `CheckerboardScore.ts` — HiArch "accordance" (Che et al., Cell 2026): cosine
  distance between row pairs at 5-15% diagonal offsets → 30-bin histogram → Shannon
  entropy → rescaled to [0,100]. Sign convention (higher entropy = stronger
  checkerboard, no inversion) verified in-code against the HiArch reference. A
  per-chromosome path (HiArch-comparable) and a whole-genome fallback (documented as
  *not* comparable) exist.
- `OEMapToggle.ts` (UI) — the observed/expected view. Reuses
  `computeExpectedContacts`/`computeOEMatrix`, reorders to display order, shows
  log2(O/E) on a diverging map (K=3, O/E=1 → white). Overview-only by construction.

Detectors (curation-facing)
- `MisassemblyDetector.ts` — fuses internal TAD boundaries (insulation) and gated
  compartment sign-flips (delta must exceed 0.25 x max|eigenvector|) that fall
  *inside* a contig; small contigs require both signals to corroborate. Composite
  cut confidence = 0.6*tadScore + 0.4*compScore. A former phantom "decay" component
  was honestly removed (comment in-file).
- `PatternDetector.ts` — inversions (anti-diagonal / diagonal mean ratio >= 2.0 per
  block) and translocations (off-diagonal block mean / a flat genome-wide baseline
  >= 2.0). The translocation baseline is explicitly *not* distance-corrected.
- `JoinSupport.ts` — per display-adjacent junction, `sum crossObs(d) / sum
  E(d)*crossN(d)` over d=1..6, with local (near-boundary) expected falling back to
  genome-wide P(s); robust MAD cutoff flags weak joins; skips intended
  cross-scaffold boundaries.
- `HaplotigDetector.ts` — block-O/E contact enrichment vs a distant partner (robust
  median + 3*MAD threshold, floor 2) as the trigger, then a full-resolution coverage
  ratio (<= 0.65 x genome median) as the discriminator; only contact+coverage
  agreement is reported "high"/`coverageConfirmed`.

Quality metrics
- `HiCQualityMetrics.ts` — library quality on the overview: cis fraction (named
  `cisTransRatio`, documented as a fraction not a ratio), long/short-range ratio at
  a fixed 20-bin split, mean-over-occupied-pixels (named `contactDensity`, not a
  fill density), per-contig/per-scaffold cis ratios, misjoin flags at cis < 0.5.
- `QualityMetrics.ts` (curation) + `StatsPanel.ts` (UI) — standard assembly stats:
  N50/L50/N90 by the usual cumulative-length walk, auN = sum(len^2)/total (contig
  and scaffold), scaffold N50 over grouped scaffold lengths, assigned fraction. The
  EBP "6.C.Q40" reference panel compares contig N50 (target >1 Mb) and chromosome
  assignment (target >= 90%) as context, and reports base accuracy QV as "not
  assessed" because Hi-C carries no read-level data.
- `HealthScore.ts` — 0-100 weighted composite of contiguity (20%), decay quality
  (25%, ideal exponent -1.15), integrity (20%), compartments (15%), library (20%);
  missing inputs map to a neutral 50 rather than 0.

Also present but out of core analytics scope: `Virtual4C.ts` (locus contact
profile), `CentromereDetector`/`TelomereDetector`/`ScaffoldDetection`, and the
external-service ML clients (`Evo2HiCClient`, `HiCFoundationClient`, `MLCodec`,
`Evo2HiCEnhancement`) — these call out to a server, they are not in-browser math.

---

## 2. Maturity

Honesty of labeling is the strongest aspect of this subsystem and is consistent
across modules. Concrete examples: the KR-is-Sinkhorn-Knopp header; the compartment
sign-is-arbitrary / A-B-needs-external-signal note; O/E "overview-zoom diagnostic,
not a replacement"; QV "not assessed"; P(s) NaN-not-spurious guard with an
explanation of why 2-point R^2 is meaningless; the logbin caveat that it "redefines
the metric" and raises R^2; checkerboard's documented single deviation from HiArch;
`contactDensity`/`cisTransRatio` field docs disclaiming their own misleading names;
misassembly's honest removal of a fake decay component. This is the labeling
discipline of scientific software written by someone who knows the caveats.

Numeric pinning (unit tests) is real but uneven:

- Tightly pinned against known inputs: `contact-decay` (recovers -1.0 and -1.5
  exponents from synthetic power-law maps, R^2 > 0.9; NaN guard on sparse maps),
  `compartment-analysis` (binning means, O/E ratios, 2x2 eigenvalue ~2, degeneracy
  → 0.5/eigenvalue 0), `oe-map` (log2 transform values, O/E=1 → 0.5), `gc-content`
  (GC 1.0/0.0/NaN, orientation flip), `quality-metrics` (N50, auN, assignedFraction
  exact), `health-score`, `misassembly-detector` (exact pixel/strength/midpoint),
  `directionality-index` (crossing position, strength, normalization).
- Shape/direction/count only (no absolute value pinned): `ice`/`kr` (convergence
  and symmetry, values pinned only on helpers), `insulation` (ordering and boundary
  counts), `saddle` (dimensions + strength>1 direction + underpopulated flag),
  `checkerboard` (bin structure + direction + the honesty guards),
  `pattern-detector` (shape only), `join-support` (flag counts only).

Critical maturity gap (this is central for a scientific-software paper): every
pinned test locks *internal self-consistency* on *synthetic* matrices. Nothing
cross-validates OpenPretext's insulation, compartment, balancing, or P(s) output
against the reference implementations it re-derives (cooltools, FAN-C) on the same
real matrix. "Well tested" here means "reproduces its own math on toy inputs," not
"agrees with the community standard." Reviewers of a software paper will ask for the
latter, and it does not currently exist.

Approximate-by-design modules to treat as heuristics, not measurements: DI
(single-strip, not the full Dixon window), PatternDetector translocations (flat,
non-distance-corrected baseline), HealthScore (magic constants -1.15, 0.85, x200,
/0.7 — heuristic weighting, not derived), the fixed 20-bin short/long split in
library quality (maps to different genomic distances across files).

---

## 3. Novelty ranking (publication-defensibility)

Be blunt: **no individual method in this subsystem is novel.** Each is a
re-implementation of a published algorithm, and the code says so:

- Insulation score — Crane et al. 2015.
- Directionality index — Dixon et al. 2012 (here simplified).
- A/B compartments — standard O/E-correlation first-eigenvector.
- ICE — Imakaev et al. 2012. "KR" — Sinkhorn-Knopp (not Knight-Ruiz); same family
  as ICE.
- Checkerboard/accordance — Che et al., Cell 2026 (HiArch).
- Saddle plot, O/E, P(s) decay — textbook Hi-C.
- auN / N50 / EBP thresholds — standard assembly QC.

Against the established stack, the ranking of "what survives":

1. **Nothing survives as a method.** cooltools and FAN-C own all of this math, more
   rigorously, at full resolution, as a library/CLI. As an analytics package
   OpenPretext is a coarser TypeScript subset and is not competitive on rigor.

2. **The integration is the contribution, and it is real but narrow.** The
   incumbents split cleanly:
   - cooltools / FAN-C: full-resolution analytics, Python, no interactive browser
     UI.
   - HiGlass / Juicebox(.js): browser-interactive, but they *display precomputed*
     tracks; they do not compute balancing/insulation/compartments client-side.
   - PretextView / Juicebox Assembly Tools / 3D-DNA: the *curation* incumbents (and
     the tools OpenPretext explicitly positions against) — they do **not** bundle a
     live Hi-C analytics layer.

   The one claim that clears all three comparisons: **live, client-side Hi-C
   analytics embedded in a browser-native curation loop on native `.pretext`,
   recomputed on the curated arrangement as the user cuts/joins/inverts** — no
   server, no precompute, no Python. That is an integration/interactivity claim, not
   a method claim. It is Applications Note / software-paper tier (e.g. Bioinformatics
   Applications Note), and it should be positioned against the curation incumbents
   (PretextView/JBAT), not merely against the viewers, or it understates its own
   comparison.

3. **Minor, defensible engineering points** (support the software paper, not
   headline novelty): the contig-aware insulation/DI edge handling that suppresses
   false junction boundaries on fragmented assemblies; the honesty scaffolding
   itself (degeneracy guards, NaN-not-spurious, coverage-confirmed haplotigs) as a
   model of how to expose uncertainty in an interactive tool.

Do not claim any specific algorithm as new. The AutoCut/AutoSort curation
algorithms may carry more method novelty, but they are outside this subsystem's
scope and are not assessed here.

---

## 4. Honest limitations — what must not be claimed as rigorous

Overview-resolution ceiling (the dominant constraint). Everything numerical runs on
Mb-scale bins. Sharpened per method:

- **Insulation / DI "TAD boundaries" are not TADs.** TADs are sub-Mb structures;
  Crane/Dixon operate at kb resolution. At Mb bins these are coarse partition
  signals, not TAD calls. The literature names overstate what the numbers are. On a
  64x64 map with w=10, only ~44 interior positions are even measurable.
- **Compartments at Mb bins are marginal.** The eigenvector split is real, but its
  resolution is far coarser than standard compartment calling, and A/B labels are
  only oriented when a FASTA is loaded (otherwise "compartment 1/2", correctly
  unlabeled).
- **P(s) is self-limited.** The fit returns NaN below 5 distinct distances precisely
  because the overview often cannot support a trustworthy log-log fit. Cross-sample
  R^2 comparisons are sensitive to linear-vs-logbin choice (documented).
- **Matrix balancing convergence is reported but unvalidated.** ICE/KR converge to
  unit row sums on the overview; there is no check that the resulting bias vector
  matches a full-resolution balancing.
- **Detectors degrade hardest at 64x64.** MisassemblyDetector, PatternDetector, and
  JoinSupport depend on multi-bin contigs; on tiny maps most contigs span 1-2 bins,
  so JoinSupport's confidence gate can exclude every junction from flagging and
  detectors go quiet. This is directly relevant to the standing AutoCut concern
  (AutoCut found 0 breakpoints on 64x64 DToL maps): it is an inherent
  overview-resolution limitation, not necessarily a bug.

No reference-implementation validation. As in section 2 — the modules are untested
against cooltools/FAN-C on real matrices. Any paper claim of correctness for
insulation/compartments/balancing should be scoped to "self-consistent" until a
cross-tool comparison exists.

ML resolution-enhancement overclaim (highest single publication risk). `README.md`
line 84 states the Evo2HiC/HiCFoundation enhancement reveals "inter-chromosomal
contacts and distance-decay patterns below the raw data's noise floor." Generative
enhancement can *hallucinate* structure that is not in the data — which directly
violates this repo's own invariant that rendering must never invent or drop signal.
These are external-service ML features, out of the in-browser-math scope, but this
claim must not appear in a paper without explicit validation that the enhancement
does not fabricate contacts.

Naming hazards to carry forward accurately in any writeup: "KR" is Sinkhorn-Knopp,
not Knight-Ruiz; `cisTransRatio` is a cis fraction, not a ratio; `contactDensity` is
a mean over occupied pixels, not a fill density; scaffold N50 uses total assembly
length as the denominator (standard N50, not NG50) while the EBP targets are
NG50-based (disclosed in the panel).
