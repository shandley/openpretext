# Revised paper outline: the OpenPretext tool paper (2026-07-13)

Single primary paper. Written once, targeted so it fits both tiers of the venue ladder.
Primary target GigaScience Research article; written to also satisfy Genome Biology
Software (the ceiling) via the case study; Bioinformatics Application Note is the floor
fallback. See `venue-analysis.md` and `fresh-evaluation.md`.

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

## Section outline

1. **Abstract.** Curation bottleneck; the tool; the case-study result (concordance with
   expert PretextView curation); availability. One quantitative hook from the case study.

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
   - Teaching curriculum: 16 lessons, 16 specimens across 8 taxa, guided-then-open two-track
     structure, field guide. Supporting the democratization narrative.

4. **Results / Case study (THE demonstrated advance; this is what lifts the venue).**
   - See `case-study-evaluation.md` for the full design. In brief: independent curation of
     pre-curation assemblies in OpenPretext, scored for concordance against the published
     PretextView-curated releases (the expert ground truth), on a small set of real
     assemblies including a hard case (bird microchromosomes).
   - Report concordance of chromosome-scale curation decisions (order, orientation, joins,
     breaks, scaffold assignment), with honest treatment of inter-curator variability.
   - Curation-as-code reproducibility: the curation replays deterministically from a script.
   - If curated by the non-Sanger IBE Barcelona collaborators, that IS the democratization
     evidence (expert-equivalent curation without Sanger training/tooling).

5. **Validation.**
   - Numerical cross-validation of the analytics against cooltools/FAN-C on one or two
     public reference matrices (closes the standing "self-consistent only" gap; see
     `inputs/A3-analysis.md`).
   - Reversibility and test coverage (state the `MAX_UNDO_DEPTH=200` caveat honestly, or
     fix the autosort/autocut paths to be cap-immune first).
   - The AutoSort/AutoCut heuristics presented as an in-browser equivalent of Pixel Cut/
     Sort, characterized for specificity/stability (NOT detection recall), per
     [[autocut-concern]] framing.

6. **Discussion.**
   - Democratization and reproducibility as the contribution.
   - Honest limitations: overview-resolution ceiling (no sub-Mb biology; analytics are QC
     aids); no adoption metrics yet; case-study N is small; curation is partly subjective.
   - Future: full-resolution path; broader curator studies.

7. **Availability and reproducibility.** Live URL, source, license, specimen data on R2,
   the headless CLI and scripts for the case study, versioned. (Strong for GigaScience.)

## Figures (draft)

- Fig 1: the niche (2x2 landscape: web-vs-desktop x view-vs-curate) + a screenshot.
- Fig 2: the tool anatomy (map + curation + analytics + console).
- Fig 3: curation-as-code (a script, its assertions, the CI/headless run, deterministic
  replay).
- Fig 4: THE case study (before / OpenPretext-curated / published-PretextView-curated,
  with the concordance metric).
- Fig 5: analytics cross-validation vs cooltools; and the curriculum/taxa breadth.

## Pre-submission blockers (from the capability review; do these first)

BC4 codec CI ground-truth test; reversibility caveat resolved or disclosed; README/
CHANGELOG count drift fixed (16/16/11; DSL command count); AGP scaffold-name/gap semantics
disclosed. The case study (section 4) and analytics cross-validation (section 5) are the
highest-leverage additions and are what raise the venue ceiling.

## Venue-fit checklist

- GigaScience: reproducibility + usability + utility + a scientific conclusion (the case
  study supplies the conclusion; the CLI/data supply reproducibility). Best odds.
- Genome Biology Software: needs a clear demonstrated advance over the incumbent -> the
  case-study concordance IS that demonstration. Reach, but real (HiGlass/JBrowse2 precedent).
- Bioinformatics App Note: the floor; the same content compressed to ~2,600 words.
