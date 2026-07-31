# Lens 1 — Curation as a phenomenon: before/after pairs and reproducible batch curation

Author lens: study MANUAL ASSEMBLY CURATION ITSELF, at scale and reproducibly, using
the pre-curation vs curated contact-map pairs and the headless, scriptable curation
engine. The uncontested strength here is that OpenPretext can (a) load both the draft
and the curated `.pretext` for the same genome, (b) recompute a fixed suite of Mb-scale
architecture metrics on each, and (c) apply a batch/scripted rearrangement to a map and
re-measure, all headless and deterministic. No other tool in the landscape (PretextView,
JBAT, HiGlass, cooltools) packages that particular loop. The novelty is the QUESTION and
the paired dataset, not any new algorithm.

## The corpus, stated honestly up front

- 10 GenomeArk/VGP before/after PAIRS: koala, wrasse, quail, finch, crocodile, spinyfin,
  snake, toad, lancelet, bat. Vertebrate-heavy, plus two invertebrate chordates. Each has
  a pre-curation draft and a curator-finished assembly, both as native `.pretext`, plus a
  stored order/orientation diff.
- These are OTHER people's expert curation (VGP/GRIT curators). That is a strength: the
  pre-post diff is real expert ground truth, not my own edits.
- The "before" file is already Hi-C-scaffolded (a post-scaffolder draft, typically YaHS).
  So the pre-to-post delta is the CURATION INCREMENT on an already-diagonalized draft, not
  the effect of scaffolding. Every design below must say this or it will overclaim.
- N = 10 is small and vertebrate-heavy. Taxon-stratified claims are underpowered and are
  NOT made; taxon is carried only as a descriptive annotation, never a tested factor.
- Assembler/scaffolder is approximately CONSTANT across this VGP corpus. The lens sub-
  question "does curation vary by assembler" is NOT answerable here and is dropped, not
  fudged.
- Do NOT reuse the catalog's stored `benchmarkBaseline` F1/Kendall-tau/orientation numbers
  as the curation-magnitude measure. Report A5 shows those are AutoSort-vs-curated
  specificity artifacts computed on already-diagonalized maps (recall = 1 by construction,
  orientation ground truth hard-coded false, tau = 1 for < 60-contig cases). Derive the
  pre-to-post order/orientation change directly from the two files instead.
- Two pre-flight checks stated as gating steps, not assumptions: (1) confirm pre and post
  overview dimensions match per pair before any paired scalar delta; haplotig purging
  removes sequence and can shift the grid, so resample to a common bin count if they differ.
  (2) confirm the operation diff you rely on is actually derivable per pair (see Design B).

All three designs are methods/resource papers, not biology papers. Per B2, Genome Research
and Genome Biology desk-reject assembly-only or computational-only work without a leading
biological consequence, so those venues are out. The honest homes are GigaByte (Technical
Release), Bioinformatics (Application Note), F1000Research (Software Tool / workflow), or
GigaScience. I state this plainly against each design rather than letting the "biology"
framing tempt an overclaim.

---

## Design A (RANK 1) — The architectural footprint of curation

### 1. Question / hypothesis
What does manual curation actually change in the whole-genome contact map, and is that
change large enough to detect at Mb scale? Two-sided by design. The naive hypothesis
"curation systematically raises cis fraction / regularizes P(s)" is probably false as a
directional claim, and the reason it is false is itself the interesting result: curation
fixes a handful of Mb-scale errors among hundreds of already-placed contigs, so whole-genome
aggregates are dominated by the correctly-placed bulk and barely move. A small or null
aggregate footprint, with a large and measurable LOCAL reorder/reorient footprint, is the
finding.

### 2. Core measurement (the sensitive instrument, plays directly to the lens)
Do not difference two independently computed scalars as the primary result; that is noisy
and washes out. Instead, work inside the pre file's own grid:

- Take the pre overview matrix and the curator's order/orientation diff.
- Permute the pre matrix's contig blocks into the CURATED order and flip the reoriented
  blocks. This is reproducible batch curation applied to the before-map, which is exactly
  the capability the lens is about (the same permutation the headless engine performs).
- Measure the gain in within-block and near-diagonal contact mass from the pre arrangement
  to the curated arrangement, computed on the same grid. Report the fraction of total
  contact mass that moves onto the diagonal / into correctly-adjacent blocks.

This isolates the reorder-plus-reorient component of curation (the part cleanly measurable
at overview resolution), is far more sensitive than a scalar difference, and sidesteps the
cross-grid comparability confound entirely because everything happens in one grid.

### 3. Secondary measurement (aggregate metric deltas, exploratory table)
Paired within-genome deltas of the Mb-scale metric suite pre vs post: cis fraction, P(s)
exponent and R^2, checkerboard entropy (already [0,100]), compartment-strength ratio,
diagonal-concentration fraction. Reported as a descriptive per-species table with a paired
test on the pooled delta. Expect most of these near null; that is the honest secondary
result, not a failure. Flag that cis fraction is BIDIRECTIONAL: breaking a false join moves
contacts cis-to-trans, making a missed join moves trans-to-cis, so when both error classes
are present the aggregate partially cancels.

### 4. Feasibility at overview resolution
Feasible with what is in hand. The core measurement needs only the pre overview matrix plus
the order/orientation diff; both are available. The paired design makes each genome its own
control, which cancels genome-size and bp-per-pixel effects for the delta and largely cancels
the metric suite's self-consistency bias (a systematic bias present in both pre and post
cancels in the paired difference). Comparability across genomes is handled by the paired
design and by dimensionless metrics; the core diagonal-mass-gain metric is reported as a
fraction, not in pixels.

### 5. Honest weakness and whether it survives
- N = 10, vertebrate-heavy: pooled descriptive result only, no taxon test. Survives as a
  descriptive/methods claim.
- Only the reorder+reorient component is measured cleanly; cut/join effects are not fully
  captured at Mb resolution (Design B scope note applies). Survives if scoped as "the
  rearrangement footprint," not "all of curation."
- Aggregate deltas likely near null: survives because a null aggregate footprint next to a
  large local footprint is a coherent, reportable message ("curation's Mb-scale signature is
  local, largely invisible to whole-genome aggregates").
- Grid-mismatch from haplotig purging: handled by the pre-flight resample check.
- Self-consistent-not-cross-validated metrics (no cooltools comparison): matters less for a
  within-tool paired delta than for an absolute claim, but must be disclosed.

### 6. Venue and paper type
Methods/resource paper. GigaByte Technical Release or Bioinformatics Application Note are the
best fits; F1000 as fallback. It is a "what curation does, measured reproducibly" methods
contribution with a modest descriptive-biology surface (curation leaves a local Mb-scale
architectural footprint), not a biology paper. Not Genome Research/Biology material.

---

## Design B (RANK 2) — An Mb-scale taxonomy of what Hi-C curation catches

### 1. Question / hypothesis
Across the 10 pairs, what classes of large rearrangement does curation apply, how often, and
does the class mix track any measurable draft property (fragmentation, contig N50, draft cis
fraction)? This is the lens's "what classes of error does Hi-C catch, how often" question,
scoped to what is visible at overview resolution.

### 2. Capability that makes it feasible
The stored pre-to-post order/orientation diff makes reorder and reorient interventions
directly ENUMERABLE per genome without any inference: a contig that changed order position is
a reorder event, a contig whose orientation flipped is a reorient event. No other tool exposes
a headless, per-pair, before/after diff over the native curation format the community already
uses. Counts are then correlated (descriptively) with draft-map metrics computed by the same
in-tool suite.

### 3. Data / analysis and feasibility
- Reorder and reorient events: directly enumerable from the given diff. Feasible.
- Cut and join events: change contig identity, and exact cut positions are NOT recoverable at
  Mb resolution. FEASIBILITY GATE, stated as a pre-flight check: inspect whether the GenomeArk
  pre and post AGPs carry shared component IDs (source accessions). If they do, cut/join are
  enumerable from AGP provenance and can be included. If they do not, scope the study
  explicitly to reorder + reorient and declare cut/join census OUT OF SCOPE. Do not fuzzy-match
  by name/length and present it as a complete taxonomy.
- Outcome: a per-genome intervention-class table plus a pooled distribution, annotated by taxon
  and draft property. Feasible with overview data.

### 4. Honest weakness and whether it survives
- Undercounts curation. Howe 2021's 221 interventions/Gb is dominated by sub-Mb edits this
  design cannot see. This is a partial, large-event-biased census. Survives ONLY if titled and
  framed as "the Mb-scale rearrangement component of curation," never "how much curation happens."
- N = 10 caps any property correlation to exploratory/descriptive. No predictive model is claimed
  (the lens sub-question "is curation effort predictable" is acknowledged and answered "not with
  N=10"; a real predictor would need the full VGP/DToL release corpus, noted as the extension).
- Cut/join possibly out of scope pending the AGP-ID check: survives, because reorder+reorient
  alone is a coherent, honestly bounded contribution.

### 5. Venue and paper type
Methods/resource paper, same venue set as A (GigaByte, Bioinformatics App Note, F1000). Slightly
more descriptive-biology flavor than A (it characterizes real curator behavior), but the N=10
ceiling and the Mb-scale undercount keep it a resource contribution, not a biology paper. Weaker
than A because its central quantity depends on the AGP-ID feasibility gate and is intrinsically
partial.

---

## Design C (RANK 3) — A reproducible before/after curation benchmark corpus

### 1. Question / contribution
Package the 10 pre/post pairs as a standardized, versioned, reproducible benchmark: for each
genome, the draft map, the curated map, the derived order/orientation diff, and a fixed Mb-scale
metric-delta table, all produced by one headless pipeline that anyone can re-run on the native
files. The contribution is turning "what curation did to this genome" into a re-runnable
measurement rather than an expert's undocumented judgement, and offering it as a shared instrument.

### 2. Capability that makes it feasible
The headless curation-as-code path (`bench/curate.ts`): load a native `.pretext`, apply a DSL
script, assert on metrics, emit AGP, exit non-zero on failure, one execution surface shared by GUI
and CI. This is the strongest uncontested differentiator in the reports (A2 rank 1; B1 gap 2). It
lets the corpus be regenerated deterministically and lets a curation procedure be a versioned text
artifact with in-loop assertions on the contact map.

### 3. Data / analysis and feasibility
Fully feasible; it is mostly packaging plus the Design A/B measurement outputs. The metric-delta
table is Design A's secondary output; the intervention counts are Design B's output. Determinism
is demonstrated by re-running and showing identical AGP/metrics (the `replayLog` contract already
asserts same-input-plus-same-log reproduces snapshots).

### 4. Honest weakness and whether it survives
- Determinism alone is nearly trivial (A2: `replayLog` already asserts it). A paper billed on
  "curation is reproducible" is thin. Survives only if the headline is the CORPUS and the
  standardized metric-delta instrument, with determinism as a property, not the claim.
- It is a delivery vehicle for Design A's measurement; it does not stand fully independent. Honest
  framing: C packages what A measures. Present as a companion or as the resource half of an A+C
  submission, not as a separate novel result.
- 10 pairs is small for something called a community benchmark; say so and position it as a seed
  corpus with a documented acquisition pipeline (`bench/acquire`) for extension.
- The known reversibility caveats must ship with it: the 200-op undo cap, append-only contigs
  array, and lossy session-log replay (A2 section 4). A reproducibility resource that hides its
  own reproducibility limits would not survive review.

### 5. Venue and paper type
Resource/methods paper. Best fit GigaByte (FAIR, linked code+data, updatable article) or a
Bioinformatics Application Note; JOSS as a companion for the pipeline software itself. Pure
resource/methods, no biology claim.

---

## Ranking rationale (my own, honest)

1. **Design A** is most defensible because its core measurement (permute the before-map into the
   curated order in one grid, measure diagonal-mass gain) is sensitive, needs only data in hand,
   sidesteps the cross-grid comparability confound, is a genuine within-tool paired design, and
   yields a coherent result whether the aggregate footprint is large or null. It is the cleanest
   expression of the lens.
2. **Design B** answers the lens's "what does curation catch, how often" question most directly,
   but its central quantity is gated on the AGP-shared-ID check, it structurally undercounts (Mb
   scale only), and N=10 caps it to descriptive. Real, honestly bounded, but weaker.
3. **Design C** plays to the single strongest uncontested capability (headless curation-as-code)
   and is the safest to execute, but it is a packaging/resource contribution that leans on A's
   measurement and whose determinism headline is close to trivial. Best shipped WITH A, not alone.

Recommended primary: submit A and C together as one methods/resource paper (measurement + packaged
corpus and pipeline), with B folded in as the intervention-taxonomy section IF the AGP-ID check
passes, otherwise held for a follow-up with a larger release corpus.
