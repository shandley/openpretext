# Evaluating the curation case study (2026-07-13)

The claim it must support (the venue unlock): a curator using OpenPretext produces genome
curation equivalent to the incumbent expert workflow (Sanger experts in PretextView) on
real assemblies, reproducibly. This is Genome Biology's "clear advance/equivalence"
demonstration and GigaScience's required scientific conclusion.

## Is a formal case study REQUIRED for Genome Biology? No (2026-07-13 review).

Verified against the full text of two accepted Genome Biology tool papers
(`revalidation/gb-demonstration-precedent.md`): a formal quantitative concordance or
equivalence study against an incumbent is NOT required. HiGlass (GB 2018) demonstrated its
advance with two worked case studies plus a qualitative feature comparison and no
output-equivalence benchmark; JBrowse 2 (GB 2023) used capability breadth and use cases,
with only a speed benchmark (not correctness) vs igv.js/JBrowse 1. The norm is
demonstration of utility (worked examples, capability breadth, reproducibility, open
availability), not a scored equivalence.

Implication and scoping correction: the earlier design below (3-5 assemblies, a mandatory
inter-curator control, the multi-curator program) is what a strong QUANTITATIVE equivalence
CLAIM would need, which is above the GB bar. Right-sized to precedent:
- A single end-to-end worked example on quail (the confirmed de-novo GO flagship): a curator
  curates the pre-curation assembly in OpenPretext and it is shown side-by-side, QUALITATIVELY,
  against the published PretextView-curated release, plus a deterministic curation-as-code
  replay. This matches what HiGlass/JBrowse 2 actually did.
- The lead advance to foreground is the POSITIVE novel capability (reproducible, scriptable,
  CI-gated curation-as-code) that no desktop incumbent has, not the defensive "we match
  PretextView."
- The quantitative concordance metric, the inter-curator control, multi-assembly breadth, and
  analytics cross-validation vs cooltools are ENHANCERS that pre-empt reviewer asks, not gates.
  Add them if aiming to maximize GB odds or in response to reviewers; do not gate submission
  on them.

The rest of this document details the fuller quantitative version, kept for when/if it is
wanted. Read it as the enhanced option, not the required baseline.

## What "reproduce PretextView's output" can mean (three designs)

**Design 1 (recommended core): concordance against the published curated release.**
The GenomeArk before/after pairs give a pre-curation assembly (post-YaHS scaffolding,
before manual curation) and the curated release, which was curated by VGP/Sanger experts
in PretextView. The curated release IS PretextView's output. A curator independently
curates the pre-curation assembly in OpenPretext, blind to the release, and we score
concordance. Strength: the ground truth is real expert output, most data is in hand, and
we never have to run PretextView ourselves. Weakness: needs a human curator, curation is
partly subjective, and the pre/post must be relatable to score (see GO/NO-GO).

**Design 2 (optional add-on): within-curator head-to-head.** The same curator curates the
same assembly in both PretextView and OpenPretext; compare outputs plus time/experience.
Controls for the curator and yields UX/time data. Costs a PretextView install and double
the curation work; feasible only on one assembly.

**Design 3 (secondary, weak alone): automated curation-as-code.** Use AutoSort/AutoCut +
scripts to recover the curated order programmatically. Fully reproducible and needs no
human, but the heuristics are weak (see `inputs/A5-autocut-autosort.md`) and cannot
reproduce expert manual decisions. Use only as a "what the automation alone recovers"
breadth panel, not the main result.

Recommended: Design 1 as the core, with a small Design 2 head-to-head on one assembly for
a within-curator control and UX/time data, and Design 3 as an automated breadth comparison.

## The metric (the crux technical problem)

Both curated outputs must be expressed as arrangements of the same input pieces, then
compared. From the AGPs (scaffold -> component contigs):
- Chromosome assignment agreement: contig -> chromosome labels compared with a clustering
  agreement metric (adjusted Rand index or V-measure). Robust at Mb scale.
- Order agreement: within matched chromosomes, adjacency agreement or a Kendall-tau-style
  order concordance.
- Orientation agreement: fraction of contigs with matching strand (verify OpenPretext
  actually records orientation through curation; A5 flagged a loader path that sets
  inverted:false).
- Join/break agreement: shared adjacencies (joins) and shared break points. Note:
  OpenPretext curation happens at overview resolution, so break positions are coarse,
  while the published curation broke at base-pair precision. Score breaks as coarse
  agreement and lead with order/orientation/chromosome-assignment, which are the metrics
  that are meaningful at Mb scale.

**The inter-curator control is essential, not optional.** Concordance is only interpretable
against a baseline: have two curators independently curate at least one assembly, measure
curator-vs-curator concordance, and show that OpenPretext-vs-published concordance is
comparable. "Expert-equivalent" means the tool difference is within normal curation
variability, not that it hits an impossible 100 percent.

## Data: have vs need

- Have: 4 local overview .pretext (quail, snake, koala, finch) plus ~10 R2-hosted
  before/after pairs (the pre-curation maps a curator would work from).
- Need (GO/NO-GO): the published curated AGP/assembly for each chosen species from
  GenomeArk, AND confirmation that the pre-curation and curated AGPs reference a relatable
  component set (same contig identities/coordinates). If component IDs do not match, a
  sequence-alignment step is required to relate them, which is real added work. Verify this
  on two species before committing.
- Analytics cross-validation (separate, lighter): needs one or two public .cool/.mcool.
  OpenPretext reads .pretext, not .cool, so cross-validate at the function level: load a
  .cool matrix into a Float32Array, run OpenPretext's analysis functions on it, and compare
  to cooltools/FAN-C on the same matrix. One or two datasets suffice; a model organism or a
  GSE169088 taxon works. This closes the "self-consistent only" gap from A3.

## Who curates (a real decision, with a strategic payoff)

The strongest option is the IBE Barcelona beta testers (Belen, Carlos, Rosa), who are
non-Sanger genome biologists (see [[beta-testers]]). If they curate and reach concordance,
that single result is simultaneously the equivalence demonstration AND the democratization
evidence: expert-equivalent curation by people without Sanger training or tooling. That is
a far stronger paper than Scott curating it himself. It costs coordination and their time,
and needs a blind protocol.

## Scale

- 3 to 5 assemblies: one clean, one fragmented, one hard case (bird microchromosomes, e.g.
  finch or quail).
- At least one assembly curated by 2 curators for the inter-curator baseline.
- Design 2 head-to-head on 1 assembly; Design 3 automated panel across all chosen assemblies.

## Effort and critical path

1. GO/NO-GO (small, do first): download curated AGPs for 2 species; confirm pre/post
   component relatability; confirm OpenPretext records orientation through a curation.
2. Build concordance-scoring tooling (AGP diff -> ARI/V-measure, order tau, orientation,
   break coarse-agreement). Moderate coding, testable in CI, reusable.
3. Recruit curators + write a blind curation protocol (the schedule-dominant, human step).
4. Curation: N assemblies, plus the inter-curator and head-to-head arms.
5. Analytics cross-validation harness (.cool -> Float32Array -> OpenPretext vs cooltools).
6. Write up as section 4-5 of the paper (`paper-outline.md`).

## Honest risks

- Subjectivity: inter-curator variability could depress concordance even when the tool is
  fine. Mitigated only by the inter-curator control, which is why it is mandatory.
- Overview-resolution: break localization is coarse; keep breaks as a secondary, coarse
  metric and lead with Mb-scale-robust agreement.
- Orientation recording: verify the loader/curation path preserves orientation before
  relying on orientation concordance (A5).
- Relatability: if pre/post AGPs do not share component IDs, add a sequence-alignment step
  (more work). This is the main feasibility unknown and the first thing to check.
- Curator availability: the Barcelona dependency is real; a fallback is Scott plus one
  collaborator, which weakens the democratization angle but keeps the equivalence result.

## Bottom line

Feasible and high-leverage. The core (Design 1 concordance with an inter-curator control)
uses data largely in hand plus a bounded amount of scoring tooling and human curation. It
converts "web reimplementation" into "demonstrated expert-equivalent curation," which is
exactly what lifts the paper from application-note tier to GigaScience/Genome Biology. The
single most valuable variant is to have the non-Sanger Barcelona collaborators do the
curation, so equivalence and democratization are shown in one result. The first concrete
step is the cheap GO/NO-GO check on AGP relatability and orientation recording.

## GO/NO-GO verification results (2026-07-13): GO

Both gates passed. Details in `revalidation/gonogo-orientation.md` and
`revalidation/gonogo-agp-relatability.md`.

**Orientation recording: GO.** In-app curated orientation is recorded in state and the
undo stack and survives to export: FASTA reverse-complements inverted contigs (including
cut-then-invert-then-join) and AGP emits the correct +/- column. 174/174 relevant unit
tests pass; empirically confirmed on real bCotChi1 quail data via the headless CLI (one
invert flipped exactly one AGP line). The prior `inverted: false` concern is a correct
load baseline (the .pretext format encodes no orientation), not data loss, and does not
touch the in-app curate-then-export path. Caveat for the metric: joining two
differing-orientation contigs collapses the merged AGP orientation column to + (FASTA
stays correct), so score orientation from the FASTA or name-matched W-lines, not the
merged-component AGP column.

**AGP relatability: GO, and it is workflow-determined, not species-determined.** The
discriminator (reusable to screen the whole catalog): a GenomeArk assembly is scoreable
by ID if `assembly_curated/.../pretextmap/*.pretext.*.agp` (PretextView export, with
Painted rows) exists; it is NOT if the curated side only has a `chromosomes.csv`.
- King quail *Coturnix chinensis* bCotChi1: RELATABLE-BY-ID. The curated AGP's 513
  components resolve to the pre-curation scaffolds with coordinates and orientation
  (spans agree to 0.01 percent). De-novo scaffold-to-chromosome curation. Strongest case,
  the flagship.
- Koala *Phascolarctos cinereus* mPhaCin1: RELATABLE-BY-ID, but the input was already
  chromosome-level, so it scores QC-of-a-curated-assembly, not de-novo curation. A clean
  second GO, weaker scientifically.
- Zebra finch *Taeniopygia guttata* bTaeGut1: NEEDS-ALIGNMENT (NO-GO by ID). GenomeArk
  has only a chromosomes.csv; pre-to-post IDs are broken for chromosome-assigned sequence.
  The hard bird-microchromosome case would need a sequence-alignment step or a substitute
  found via the discriminator.

**Consequence for the plan:** not every before/after pair is scoreable by ID, so the
specimen set must be screened with the discriminator to assemble 3-5 GO cases (prefer
de-novo like quail over already-chromosome-level like koala). Quail is the confirmed
flagship. The "hard case" slot needs a de-novo specimen with a modern PretextView-export
AGP, found by screening, since finch as-is requires alignment.
