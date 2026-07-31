# Publication re-evaluation (2026-07-13/14) — START HERE

This directory is a from-scratch re-evaluation of OpenPretext's publication strategy,
run deliberately firewalled from the old plan's findings. If you are resuming, read this
file first, then `manuscripts` memory, then the specific docs below.

## The decision (current)

**Target: Genome Biology** (tool/software paper), decided by Scott 2026-07-14. Fallback
ladder if it declines: GigaScience Research article, then Bioinformatics Application Note.

## What the re-evaluation concluded

- The **old two-paper plan is dead.** The N=18 P(s) R² "biological insight" was RETRACTED
  by a blind re-validation (it is a resolution/point-count artifact of overview
  pixel-domain fitting, not biology). The standalone AutoSort/AutoCut methods paper is not
  viable (PretextView already ships Pixel Cut/Sort; the benchmark measures the wrong thing).
- The **defensible paper is one browser-native, scriptable curation-as-code tool paper.**
  Lead the advance with the positive novel capability (reproducible, scriptable, CI-gated
  curation-as-code that no desktop tool has) and the unoccupied web-native-curation niche.
  Never headline "web version of PretextView."
- A **formal concordance case study is NOT required for GB** (verified against the full text
  of HiGlass GB 2018 and JBrowse 2 GB 2023; both demonstrated utility via worked examples,
  no equivalence benchmark). The right-sized demonstration is one worked quail example plus a
  curation-as-code replay. Heavier concordance/inter-curator/cross-validation work is an
  enhancer, not a gate.
- No biology-discovery paper is feasible at overview resolution. A proper P(s) re-test would
  need full-resolution matrices (an HPC reprocessing project). See `biology-strategy.md`.

## GO/NO-GO for the (optional) case study: GO

- Orientation survives in-app curation to export (FASTA revcomp + AGP), verified + tested.
- Quail (bCotChi1) is RELATABLE-BY-ID (de-novo, the flagship). Koala is a GO but
  already-chromosome-level (weaker). Finch NEEDS-ALIGNMENT.
- Discriminator to screen more specimens: curated side has
  `assembly_curated/.../pretextmap/*.pretext.*.agp` = GO; only `chromosomes.csv` = NO-GO.

## Document index

- `fresh-evaluation.md` — the firewalled tool-paper strategy (venue note superseded by
  `venue-analysis.md`).
- `venue-analysis.md` — verified venue precedent and the GigaScience/GB/Bioinformatics ladder.
- `reconciliation.md` — fresh evaluation vs the archived plan.
- `biology-strategy.md` — biology verdict + ranked alternative-study slate.
- `paper-outline.md` — concrete section-by-section outline for the tool paper.
- `case-study-evaluation.md` — the quail case study: requirement verdict (not required),
  right-sized design, full quantitative option, and the GO/NO-GO results.
- `inputs/` — the 7 firewalled capability + field reports (A1-A5, B1, B2).
- `revalidation/` — the blind P(s) audit (`audit-report.md`, `revalidate.py`,
  `revalidation-table.csv`), data-acquisition scoping, Tier 1 novelty check, the two
  GO/NO-GO reports, and the GB-demonstration-precedent check.
- `study-ideas/` — the three idea-generation lens reports.

## Next steps (not yet started)

1. Build the quail worked example (curate in OpenPretext, side-by-side vs published
   PretextView curation, deterministic curation-as-code replay). This is the Results spine
   and the key figure. GO verdict already cleared it.
2. Clear the in-control pre-submission blockers: BC4 codec CI ground-truth test;
   `MAX_UNDO_DEPTH=200` reversibility (fix or disclose); README/CHANGELOG count drift
   (10/10/8 -> 16/16/11; DSL command count); AGP scaffold-name/gap-semantics disclosure.
3. Draft the manuscript from `paper-outline.md`; build the five figures.

## Open decisions (Scott)

- Curators for the quail demo: the IBE Barcelona beta testers (adds democratization
  evidence, needs coordination) vs Scott + one collaborator for a first pass.
- Whether to include the analytics cross-validation vs cooltools in the first submission
  (enhancer) or hold it for reviewers.

## Housekeeping / git state

Nothing is committed (per Scott's standing rule). The archive move of the old drafts to
`manuscript/archive/superseded-2026-07-13/` is staged (git renames) but not committed. All
reeval docs are untracked on disk. Pre-existing strays (old manuscript deletions,
docs/email-update-*.txt, manuscript/figures/, pnpm-lock.yaml, test_quail.fasta) are not ours
to resolve. No code was changed this session.
