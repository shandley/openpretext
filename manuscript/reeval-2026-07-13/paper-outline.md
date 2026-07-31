# Revised paper outline: the OpenPretext tool paper

Written 2026-07-13. Reconciled 2026-07-31 to the venue decision and the case-study
scoping correction, both of which postdate the first draft of this outline.

**Target: Genome Biology**, software/tool paper. Fallback ladder if it declines:
GigaScience Research article, then Bioinformatics Application Note. See
`venue-analysis.md` and `README.md`.

Working title (options):
- "OpenPretext: browser-native, scriptable curation of Hi-C contact maps for genome
  assembly"
- "Democratizing genome-assembly curation: a zero-install, reproducible Hi-C curation
  tool"

## Framing rule for the whole paper

Claim delivery and integration, not new method. The three load-bearing, defensible
claims: (1) real curation in a browser with no install on the native `.pretext` file;
(2) reversible, scriptable curation-as-code (DSL + headless CLI) with a shared GUI/CI
execution surface; (3) the first peer-reviewed browser-native curation tool (PretextView
has no paper, JBAT is preprint-only). Everything else is supporting. Never claim novel
viewing, novel cut/sort, novel analytics, or a biological finding.

Lead the advance with claim (2). Reproducible, scriptable, CI-gated curation is the
capability no desktop incumbent has, and it is the reason a reviewer should care. The
quail example demonstrates that curation in the browser is real; it is evidence, not the
headline. Do not open the paper by comparing outputs with PretextView, which frames the
work as catching up rather than as adding something.

## Section outline

1. **Abstract.** Curation bottleneck; the tool; curation-as-code as the capability that
   distinguishes it; the quail worked example as evidence that browser curation reaches
   chromosome-scale results; availability.

2. **Background.**
   - Assembly curation is a manual, expert bottleneck in DToL/VGP/EBP (cite Howe 2021
     GigaScience giaa153, Rhie 2021 VGP; verify both).
   - The incumbent editors are desktop and expertise-siloed (PretextView at Sanger; JBAT).
     Browser Hi-C tools (HiGlass, Juicebox.js) only view, they do not curate. Name the
     empty niche explicitly (from `inputs/B1-competitive-landscape.md`).
   - The access/reproducibility/training gap: no install, no scripting, no teaching
     resource in the incumbent workflow. This is the paper's motivation (democratization),
     stated as motivation, not as a measured claim.

3. **Implementation (the tool).** Concise, honest, comparative.
   - Native `.pretext` in the browser: raw-deflate + BC4/RGTC1 CPU decode, worker overview
     assembly, WebGL2 LOD/LRU rendering. Frame as sound engineering; cite
     `docs/PRETEXT_FORMAT.md` as a reverse-engineered artifact.
   - Curation engine: reversible cut/join/invert/move; undo stack as source of truth;
     sequence-provenance FASTA export (correct reverse-complement through cut-then-invert-
     then-join without an external AGP); AGP/BED export.
   - Curation-as-code: the DSL, the assertion/predicate layer, macro recording, and the
     headless `bench/curate.ts` CLI that runs the same command surface in CI. This is the
     most differentiated part; give it room.
   - Integrated Mb-scale analytics: list them, but explicitly scoped as overview-resolution
     QC aids (re-implementations of published methods), not novel methods.
   - Teaching curriculum: lessons, specimens, the guided-then-open two-track structure,
     field guide. Supporting the democratization narrative. Re-count lessons, specimens,
     and taxa against the shipped catalog before writing; these numbers have drifted before.

4. **Results: the quail worked example (the demonstration).**
   - One end-to-end example on king quail *Coturnix chinensis* bCotChi1, the confirmed
     de-novo flagship. A curator takes the pre-curation assembly (post-YaHS scaffolding,
     before manual curation) into OpenPretext and curates it to chromosome scale.
   - Show the result side by side with the published PretextView-curated release,
     **qualitatively**: before, OpenPretext-curated, published-curated. The published
     release is real expert output, so the comparison is meaningful without a score
     attached to it.
   - Show the same curation replaying deterministically from a script through the headless
     CLI. This is where the paper's lead claim becomes visible: the curation is an artifact
     you can rerun, diff, and put under CI, which a GUI session is not.
   - If the IBE Barcelona collaborators curate rather than the authors, say so. Curation by
     non-Sanger biologists without Sanger tooling is the democratization evidence and the
     equivalence evidence in one result. See [[beta-testers]].
   - Scope note: this matches what accepted Genome Biology tool papers actually did.
     HiGlass (GB 2018) used two worked case studies and a qualitative feature comparison
     with no output-equivalence benchmark; JBrowse 2 (GB 2023) used capability breadth and
     use cases, with a speed benchmark rather than a correctness one. Verified against full
     text in `revalidation/gb-demonstration-precedent.md`.

5. **Validation.**
   - Reversibility and test coverage. State the `MAX_UNDO_DEPTH=200` caveat honestly, or
     make the autosort/autocut paths cap-immune first.
   - Orientation survives curation to export: FASTA reverse-complements inverted contigs
     including cut-then-invert-then-join, and AGP emits the correct strand column. Verified
     on bCotChi1 through the headless CLI.
   - The AutoSort/AutoCut heuristics presented as an in-browser equivalent of Pixel Cut/
     Sort, characterized for specificity and stability, not detection recall, per
     [[autocut-concern]].
   - Analytics stay scoped as self-consistent QC aids unless the cooltools cross-validation
     below is included.

6. **Discussion.**
   - Democratization and reproducibility as the contribution.
   - Honest limitations: overview-resolution ceiling (no sub-Mb biology; analytics are QC
     aids); no adoption metrics yet; a single worked example; curation is partly subjective.
   - Future: full-resolution path; broader curator studies; the quantitative concordance
     work below.

7. **Availability and reproducibility.** Live URL, source, license, specimen data on R2,
   the headless CLI and the scripts that reproduce the quail example, versioned.

## Figures (draft)

- Fig 1: the niche (2x2 landscape: web-vs-desktop x view-vs-curate) plus a screenshot.
- Fig 2: the tool anatomy (map + curation + analytics + console).
- Fig 3: curation-as-code, and the paper's money figure. A script, its assertions, the
  headless CI run, and the deterministic replay.
- Fig 4: the quail worked example. Before, OpenPretext-curated, published-curated, shown
  side by side without a concordance score.
- Fig 5: the curriculum and taxa breadth.

## Enhancers held in reserve

None of these gate submission. Each answers a reviewer question that may never be asked,
and each costs real work. Add them to strengthen the Genome Biology attempt, or in
response to review. The full designs are in `case-study-evaluation.md`, whose later
sections describe the quantitative version.

- **Quantitative concordance.** Score OpenPretext-vs-published agreement from the AGPs:
  chromosome assignment (adjusted Rand index or V-measure), within-chromosome order
  (Kendall-tau-style), orientation, and coarse break agreement. Needs scoring tooling.
  Caveat if built: joining two differing-orientation contigs collapses the merged AGP
  strand column to `+` while the FASTA stays correct, so score orientation from the FASTA
  or from name-matched W-lines.
- **Inter-curator control.** Two curators on one assembly, to show the tool difference sits
  inside normal curation variability. Mandatory only if a quantitative concordance number
  is reported, because such a number is uninterpretable without it.
- **Multi-assembly breadth.** Three to five assemblies including a hard bird-microchromosome
  case. Screen candidates with the discriminator: a GenomeArk assembly is scoreable by ID
  when `assembly_curated/.../pretextmap/*.pretext.*.agp` exists, and is not when the curated
  side has only `chromosomes.csv`. Koala is relatable but was already chromosome-level;
  finch needs an alignment step.
- **Analytics cross-validation against cooltools.** Load a public `.cool` matrix into a
  Float32Array, run OpenPretext's analysis functions on it, compare with cooltools or FAN-C.
  One or two datasets suffice. This is what would let the analytics claims drop the
  "self-consistent only" qualifier. Scott's decision pending on whether it goes in the first
  submission.

## Pre-submission blockers

In-control items, to clear before writing:

- BC4 codec CI ground-truth test.
- `MAX_UNDO_DEPTH=200` reversibility: fix or disclose.
- README/CHANGELOG count drift. Re-check current state before acting; a later documentation
  audit may already have resolved this.
- AGP scaffold-name and gap-semantics disclosure.

## Venue-fit checklist

- **Genome Biology (target).** Needs a clear advance over the incumbent. The advance is
  curation-as-code plus browser-native curation of the community's own format, evidenced by
  the quail example. Precedent is direct: HiGlass and JBrowse 2 are both browser tools with
  no novel algorithm, and neither ran an equivalence benchmark. The risk is positioning, so
  lead with the capability and never with the comparison.
- **GigaScience (first fallback).** Wants reproducibility, usability, utility, and a
  scientific conclusion. The headless CLI, the versioned scripts, and the R2-hosted data
  cover reproducibility; the quail example supplies the conclusion. Same content, lower bar.
- **Bioinformatics Application Note (floor).** The same content compressed to about 2,600
  words.
