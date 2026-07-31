# Reconciliation: fresh evaluation vs. the archived plan (2026-07-13)

This layer is deliberately separate from `fresh-evaluation.md`. The fresh evaluation
was written by an agent with no knowledge of the old plan, so it stands on the
current evidence alone. This document is where the old plan is compared back in.

## The archived plan (early 2026)

Two papers:
- Paper 1: a large platform/software paper describing OpenPretext, bundled with a
  "biological insight" derived from using the system. The insight asset was an N=18
  cross-species P(s) decay R-squared analysis (the gharial-vs-crocodile contrast).
  Venue drifted between Nucleic Acids Research (the draft filename) and Genome
  Biology (later notes).
- Paper 2: a short AutoSort/AutoCut methods paper. Venue: Bioinformatics.

## What survives the fresh evaluation

- **The tool paper survives, but leaner and re-aimed.** The fresh evaluation's Option
  A (browser-native, scriptable curation-as-code application note) is the healthy core
  of old Paper 1, minus the biological-insight half and minus the platform-grandeur
  framing. Target is an application-note tier venue (Bioinformatics App Note or
  GigaByte), not a Genome Biology headline.
- **The curriculum becomes its own optional contribution** (Option B) or a section of
  the tool paper. This did not exist as a distinct idea in the old plan.

## What does NOT survive

- **Old Paper 2 (short AutoCut/AutoSort methods) is not viable as written.** Two
  independent reasons converge:
  1. External: PretextView already ships Pixel Cut and Pixel Sort, so automated
     cut/sort is not a novel capability (competitive-landscape report B1).
  2. Internal: the existing benchmark measures the wrong thing. AutoCut "recall 1.000"
     is a construction artifact (recall is defined as 1 when there are zero ground-truth
     breakpoints, and the benchmark files are already-curated assemblies with none).
     AutoSort "orientation 0.974" measures specificity against hard-coded-false ground
     truth, not recovery of true orientation, and ordering tau is 1.000 by construction
     for every specimen under 60 contigs (report A5).

  This vindicates the standing AutoCut suspicion and the manuscripts-note caveat that
  the AutoSort 0.974 needed re-measuring. Both were right. The honest path is to
  relabel the benchmark as specificity/stability and fold it into the tool paper, and
  reserve a real detection-recall re-benchmark only if a reviewer demands it.

- **The biological-insight half of old Paper 1 is not supported by the current
  software evidence.** The analysis modules are competent re-implementations running on
  the coarse overview matrix (as small as 64x64, Mb bins), none cross-validated against
  cooltools or FAN-C. On that basis alone there is no biology paper.

## The one distinction that matters for the biology decision

The fresh evaluation says "no biology paper" about the software's **in-browser
analytics as they run**. That is not the same as a verdict on the **archived N=18 P(s)
R-squared finding itself**, which lives in `manuscript/analysis/` and was computed
offline, not through the overview-resolution browser path. The firewalled agents never
saw that data, by design.

So the archived finding has not actually been evaluated on its own merits here. Whether
it is a real, publishable comparative-genomics result is a separate question, and the
existing manuscripts notes already flag prerequisites for trusting it: the insulation
and TAD-boundary files need regenerating after the contig-awareness change, and the
per-scaffold ContactDecay R-squared fit had a sparse-fit robustness caveat.

This is a decision for Scott, not something the firewall should settle by default:
- Option 1: let the biology paper go for now, ship the lean tool paper, keep the
  archived analysis as data.
- Option 2: commission a separate, firewalled re-validation of the N=18 P(s) R-squared
  finding on its own merits (regenerate the analysis at full resolution, cross-validate
  against a community-standard implementation, re-measure the R-squared robustly), then
  decide if it is a standalone biology paper kept entirely separate from the tool paper.
