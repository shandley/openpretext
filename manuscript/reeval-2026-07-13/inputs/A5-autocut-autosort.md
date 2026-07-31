# A5 — AutoCut and AutoSort: honest technical assessment

Reviewer note: this assessment is based only on source (`src/curation/AutoCut.ts`,
`src/curation/AutoSort.ts`), their unit tests, the benchmark harness (`bench/`),
`bench/REPORT.md`, and `CHANGELOG.md`/`README.md`. No manuscript draft was read.
All 54 unit tests in `auto-cut.test.ts` + `auto-sort.test.ts` pass on the current tree.

---

## 1. What AutoCut and AutoSort actually do

### AutoCut (`src/curation/AutoCut.ts`)

Purpose: propose within-contig breakpoints to cut suspected misassemblies.

Input / resolution. It runs **only on the overview `contactMap`** (a Float32Array of
`size * size`), never on full-resolution tiles. `size` is whatever the overview
happens to be for the loaded file. In the benchmark this is ~1024px (coarsest mip of
GenomeArk files, see `bench/loader.ts` + REPORT §6.2). In the browser on real DToL
files the overview can be as small as 64x64 (per project CLAUDE.md and the standing
concern). This resolution difference is the whole story for section 3.

Algorithm, per contig:
1. Map the contig's texture-space range to an overview pixel range
   `[overviewStart, overviewEnd)`.
2. **Skip the contig entirely if `overviewLength < minFragmentSize * 2`** (default
   16 → 32 px).
3. `computeDiagonalDensity`: average a `windowSize`-wide band around the diagonal at
   each pixel.
4. `detectBreakpoints`: build a **local baseline** by averaging density over a
   `±windowSize*4` (= ±32px default) window; mark pixels where the relative drop
   `(baseline - density)/baseline > cutThreshold`; keep contiguous low regions wider
   than `max(3, windowSize/2)` (= 4px default); take each region midpoint; enforce
   `minFragmentSize` from edges/each other. Returns `[]` if `len < minFragmentSize*2`.
5. Off-diagonal verification (`computeOffDiagonalScore`): reject candidates whose
   off-diagonal signal ratio is `>= offDiagonalThreshold` (0.3) — meant to spare
   centromeres (which dip on-diagonal but keep inter-arm signal).
6. Final filter: keep breakpoints with `offset` inside the contig **and
   `confidence > 0.5`**.

Thresholds. Module `DEFAULT_PARAMS`: `cutThreshold 0.30, windowSize 8,
minFragmentSize 16, offDiagonalThreshold 0.3`. **Inconsistency worth flagging:** the
shipped app path (`BatchOperations.autoCutContigs`, prompt in `BatchActions.ts`) uses
`cutThreshold 0.20` — more sensitive than the module default. I verified `bench/cli.ts
run` passes no `autoCutParams` to `runBenchmark`, so the benchmark genuinely ran at the
0.30 module default. So the numbers in `bench/REPORT.md` are not the config a user runs
by default (0.20), and because 0.20 is the *more* sensitive setting, the app's
real-world false-positive rate is likely **worse** than the benchmarked precision 0.91
— i.e. even the one property the benchmark does measure is measured on the optimistic
side.

### AutoSort (`src/curation/AutoSort.ts`)

Purpose: propose a contig order + orientation by chaining Hi-C link scores.

Input / resolution: same overview `contactMap`.

Algorithm:
1. Build overview pixel ranges per contig.
2. `computeIntraDiagonalProfile`: expected intensity at each diagonal distance `d`
   (normalization baseline).
3. `computeLinkScore`: for every contig pair and all 4 end orientations (HH/HT/TH/TT),
   sample anti-diagonal bands near the relevant corner, score
   `1 - |observed - expected|/expected`, weight by `1/sqrt(d)`. **Returns 0 if either
   contig is < 4 overview px.**
4. Threshold: adaptive `min(85th-percentile link score, hardThreshold=0.2)`.
5. `unionFindSort`: greedy endpoint chaining in descending score order, flipping
   orientation as links dictate.
6. `hierarchicalChainMerge`: agglomerative second pass, orientation-aware, with a
   safety guard (reject a merge if inter-chain affinity < 50% of the weaker chain's
   mean intra-chain score) and an adaptive threshold `max(mergeThreshold, uf*0.3)`.
7. **`autoSort` returns trivial identity chains for any assembly with < 60 contigs**
   (each contig its own chain, in input order). `autoSortCore` bypasses this for
   per-scaffold use.

The orientation double-reverse bug that the test file still labels "KNOWN-FAILING"
(auto-sort.test.ts:483-557) has in fact been fixed in the code (the reverse-once
logic + comments at AutoSort.ts:383-406 and 712-743); those tests pass now. The stale
"KNOWN-FAILING" comment should be cleaned up but the behavior is correct.

---

## 2. Test / benchmark coverage and the numbers the code actually produces

### Unit tests

Reasonable and mostly honest. AutoCut tests pin threshold behavior (a 25% drop is not
cut at 0.30, a 35% drop is), the confidence floor, narrow-region filtering, and the
small-contig skip. AutoSort tests pin union-find chaining, both merge passes, the
safety guard, the <4px guard, and — importantly — orientation correctness on
multi-element merges. These are unit-level correctness checks on **synthetic** maps.
They do not establish accuracy on real data; they establish that the code does what
the code intends.

### Benchmark (`bench/`, REPORT.md)

Headline reported numbers (n=34 curated GenomeArk assemblies): AutoCut precision 0.91 /
recall 1.00 / F1 0.91; AutoSort Kendall tau 0.988, orientation 0.974, chain purity
0.996, completeness 0.951. The harness is reproducible (`npx tsx bench/cli.ts run`)
**if** you can download ~7.5 GB of specimens; the specimen files are not in the repo,
so I could not re-run end-to-end here. The pipeline code itself runs and is clear.

The problem is not reproducibility — it is **what the benchmark measures**. Read
`bench/runner.ts` and `bench/ground-truth.ts` carefully:

1. **AutoCut is only ever evaluated on already-curated assemblies, where the correct
   answer is "cut nothing."** REPORT §1 and runner.ts:1-20 say this outright: "On
   curated assemblies, AutoCut should find zero breakpoints." Ground-truth breakpoints
   come only from `_L`/`_R` split pairs present in the curated file (`detectSplits`),
   which are essentially absent in joined GenomeArk SUPER scaffolds.

2. **Therefore AutoCut "recall = 1.000" is a definitional artifact, not a measurement.**
   In `autocut-metrics.ts`, when `groundTruth.length === 0` the function returns
   `recall = 1` by construction (lines 75-86). The three "failing" specimens with
   detections but no ground-truth splits get exactly `P=0, R=1, F1=0` — which is
   precisely what the REPORT table shows for *A. waitii*, *A. spatula*, *S. couchii*.
   **AutoCut's true recall — its ability to find real misassemblies — is never measured
   on real or curated data anywhere in this repo.** (The synthetic unit tests do
   exercise the detection path on a hand-built signal gap, so the code works; but no
   quantitative recall on real assemblies exists.) The benchmark is a specificity /
   false-positive-rate test mislabeled with precision/recall/F1.

3. **AutoSort's orientation ground truth is hard-coded to `false` for every contig**
   (runner.ts:219, 240: `mappedInversions.set(orderPos, false)`). The curated file's
   real per-contig orientation is not recovered (the loader sets `inverted:false` for
   all). So "orientation accuracy 0.974" measures **orientation specificity** — how
   often AutoSort avoids a spurious inversion on an already-diagonalized map — not
   recovery of true orientation (whether it can correctly re-orient a flipped contig).

4. **AutoSort ordering is evaluated on input that is already in ground-truth order.**
   `autoSort` is handed `curatedAssembly.contigOrder` (the curated order) and scored
   against that same order. On an already-diagonalized map, adjacent contigs have the
   strongest links, so preserving order is easy. For the many specimens with < 60
   contigs (e.g. *C. chitra* 36, *T. bifasciatum* 52, lancelet hap2 34) the < 60 guard
   returns the **input order unchanged**, so tau = 1.000 **by construction**, not by
   any sorting work. The task the benchmark scores ("reproduce the order you were
   handed on a clean map") is materially easier and different from the real task
   (order + orient a fragmented, scrambled pre-curation assembly).

5. REPORT §6.3 is admirably honest that on true pre-curation assemblies AutoSort forms
   far fewer multi-contig chains (1-13) than there are chromosomes (13-32), because
   only the ~10-50 largest contigs clear the 4px scoring floor at overview resolution.
   That is the real operating regime, and the reported tau/orientation numbers do not
   come from it.

Net: the benchmark demonstrates **specificity and stability** (AutoCut rarely
over-cuts a finished assembly; AutoSort rarely scrambles a finished one) across a
genuinely broad taxonomic corpus. It does **not** demonstrate sensitivity (AutoCut
recall) or de-novo scaffolding/orientation accuracy, which are the properties a reader
of a methods paper would assume those headline numbers describe.

---

## 3. The AutoCut zero-breakpoint concern on DToL overview maps

**(a) What resolution does it operate on?** The overview `contactMap` only. On DToL
files loaded in the browser that overview can be 64x64 (or otherwise small); the
benchmark, by contrast, runs at ~1024px on GenomeArk files. **The benchmark never
exercises the 64x64 regime**, so it cannot and does not reflect the DToL behavior.

**(b) Are the thresholds unreachable at 64x64 / Mb-scale bins?** Yes, structurally,
before sensitivity even matters:
- `autoCut` skips any contig with `overviewLength < minFragmentSize*2 = 32` px. On a
  64px-wide overview the entire genome is 64px, so a contig would have to span **half
  the whole map** just to be considered. A DToL curated map has tens of chromosome
  scaffolds each occupying a handful of pixels → essentially every contig is skipped →
  zero candidates. This alone produces the observed 0 breakpoints and is independent of
  the sensitivity slider.
- `detectBreakpoints` independently returns `[]` when `len < 32`.
- The baseline window is `±windowSize*4 = ±32px`; on a 64px map that is the whole map,
  so the "local" baseline is the global mean and local contrast is washed out.
- A real misassembly at Mb-scale bins disrupts ~1 bin, which is narrower than the
  `minRegionWidth = max(3, windowSize/2) = 4px` floor and below the `confidence > 0.5`
  gate after smoothing.

These are all **absolute pixel constants tuned for ~1024px overviews.** At 64-256px
they are 4-16x too coarse.

**Empirical confirmation (I ran this, no code changed).** A 64x64 overview with 8
contigs of 8px each and a clear blanked diagonal gap returns `totalBreakpoints = 0` at
every sensitivity tested — cutThreshold 0.30, 0.20, 0.10, and 0.05 all give 0 — because
each 8px contig is below the `minFragmentSize*2 = 32px` skip. A control with a single
64px contig spanning the whole map (past the skip) still returns 0, because the gap is
narrower than `minRegionWidth` and the smoothing/confidence gates suppress it. This
reproduces the standing "0 breakpoints on cockle/starfish at 0.20" observation directly
and shows it is not a sensitivity-tuning question.

**(c) Bug, tuning issue, or genuine limitation?** Primarily a **genuine resolution
limitation**, compounded by hard-coded absolute-pixel thresholds. It is not a logic
bug: the code executes exactly as written and correctly declines to cut when it cannot
resolve structure. Three layers stack up:
1. Fundamental: at Mb-scale bins a single-bin misassembly is at or below the
   algorithm's spatial resolution — AutoCut can only "see" what the overview resolves.
2. Structural: the `minFragmentSize*2` skip and 32px baseline window make sub-32px
   contigs invisible regardless of signal.
3. Tuning: fixed pixel windows rather than resolution-relative ones.

Manual cuts work on the same maps because the curator cuts at a chosen texture-space
pixel based on what they see, not gated by these density/confidence thresholds — a
different code path entirely. Raising sensitivity (lowering `cutThreshold`) will not
help while the `minFragmentSize*2` skip and confidence floor dominate; the empirical
"0 at 0.20" observation is consistent with the code. **Do not "fix" by loosening
thresholds** — that would trade the (well-verified) low false-positive rate for noise.
The honest framing is that AutoCut is an overview-resolution tool and cannot resolve
Mb-scale-bin misassemblies on small DToL overviews.

---

## 4. Publication-readiness verdict

Blunt: **not ready as a methods paper about AutoCut/AutoSort correctness on the
strength of the current benchmark.** The algorithms are sound, reasonable heuristics
and the code is clean, tested, and reversible. But the benchmark does not measure the
two properties a methods paper would claim:

- **AutoCut has no recall/sensitivity measurement at all.** "Recall 1.000" is a
  code artifact of evaluating on assemblies with zero ground-truth breakpoints. There
  is currently no evidence AutoCut detects real misassemblies, and section 3 shows it
  structurally cannot on the small-overview DToL maps that motivated the concern. A
  breakpoint-detection paper cannot stand on a specificity-only evaluation.

- **AutoSort's ordering is scored on pre-sorted input on a clean map (tau inflated,
  and =1.0 by construction for every < 60-contig specimen), and its orientation ground
  truth is hard-coded to "not inverted."** The reported tau/orientation numbers do not
  come from the de-novo scaffolding regime the algorithm is for.

What would make it defensible:
1. Evaluate AutoCut recall on assemblies with **known implanted or documented
   misassemblies** (e.g. programmatically break a curated assembly at known positions,
   or use pre-curation files with a real cross-file contig mapping), and report at the
   resolutions users actually run (including small DToL overviews). Report the
   operating envelope honestly — "detects misassemblies resolvable at overview scale;
   below X bp/px it cannot."
2. Evaluate AutoSort by **scrambling and inverting** a curated assembly and measuring
   recovery of the known order + orientation, so orientation ground truth is real and
   the ordering task is non-trivial. Drop or separately report the < 60-contig trivial
   cases so tau=1.0-by-construction rows don't inflate the mean.
3. Fix the labeling: what the current harness measures is specificity/stability and
   taxonomic generalization of that stability — a legitimate and publishable result if
   framed as such, but it is not precision/recall/orientation accuracy of detection and
   scaffolding.

There may well be a solid short paper here, but it needs an evaluation that measures
the actual tasks. As it stands the correctness question is not merely open — the
current numbers would not survive review by anyone who reads `runner.ts` and
`autocut-metrics.ts`. Resolve the evaluation first.

Minor cleanups noted in passing (not blockers): app default `cutThreshold 0.20` vs
benchmarked 0.30; stale "KNOWN-FAILING" comment on now-passing orientation tests.
