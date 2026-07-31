# OpenPretext Publication Strategy (fresh evaluation, 2026-07-13)

Built entirely from the seven review reports in `reeval-2026-07-13/inputs/` (A1 format/rendering,
A2 curation/scripting/export, A3 analysis, A4 education/specimens, A5 AutoCut/AutoSort, B1
competitive landscape, B2 literature/venues). No prior publication plan was assumed or read.

---

## 1. The core publishable story

The single strongest, most defensible contribution is not any one feature but a specific
intersection that the competitive landscape leaves empty: **real assembly curation, in a browser,
with no install, on the native file the community already produces.** B1 makes the case cleanly.
The landscape splits on two axes. Web-native Hi-C tools exist (HiGlass, Juicebox.js) but they only
view. The tools that actually edit an assembly (PretextView, Juicebox/JBAT) are desktop. The
intersection (web-native plus curation-editing) has no verified occupant. That is the gap.

Around that core sit two differentiators that no incumbent curation tool advertises, and both
strengthen the same claim rather than competing with it:

- **Native `.pretext` parsing client-side, no server and no format conversion** (A1). PretextView
  needs a desktop install; HiGlass needs a server plus a tiling preprocessing step; Juicebox.js
  reads `.hic`, not `.pretext`. Opening the exact file DToL/VGP/EBP already generate, in a tab,
  with zero infrastructure, is the hard and specific part. The BC4/RGTC1 decoder and raw-deflate
  reader were reverse-engineered from the C++ sources; `docs/PRETEXT_FORMAT.md` is a real artifact.
- **Scriptable, headless, assertion-driven curation-as-code** (A2). One DOM-free executor runs the
  identical command surface in the browser and in `bench/curate.ts`: load a native `.pretext`,
  apply a DSL script, assert on N50/contig/scaffold/misassembly metrics, emit AGP, exit non-zero on
  failure. A curation procedure becomes a versioned, testable text artifact a CI system can gate on.
  Neither PretextView nor JBAT surfaces this.

### One-sentence thesis a reviewer cannot puncture

> OpenPretext is a zero-install, browser-native tool that performs reversible, scriptable
> genome-assembly curation directly on native Sanger `.pretext` contact maps and exports
> AGP/FASTA/BED, occupying a niche (web-native curation editing) that desktop editors
> (PretextView, JBAT) and browser viewers (HiGlass, Juicebox.js) leave empty.

Every clause of that sentence is supported by a fetched source in B1 and by the code in A1/A2.
It claims delivery and integration, not new method, so there is nothing for a reviewer to
puncture on novelty grounds.

### What is explicitly NOT novel (do not claim it)

- **In-browser viewing.** HiGlass and Juicebox.js already run in a browser (B1, Axis A).
- **Automated cut/sort.** PretextView already ships Pixel Sort and Pixel Cut; OpenPretext's
  AutoCut/AutoSort is an in-browser equivalent, not a new capability (B1, A5).
- **The analytics methods.** Every analysis module is a re-implementation of a published algorithm
  (insulation = Crane 2015, DI = Dixon 2012, ICE = Imakaev 2012, "KR" is actually Sinkhorn-Knopp,
  checkerboard = Che 2026); cooltools and FAN-C own this math at higher rigor and resolution (A3).
- **Interactive Hi-C reassembly itself.** JBAT pioneered point-and-click reassembly in 2018 (B1).
- **Unique reversibility.** JBAT/PretextView undo support was not confirmed either way (B1); do not
  claim OpenPretext is uniquely reversible.

The honest framing: OpenPretext brings the desktop-only Pretext/JBAT curation workflow into the
browser, adds scriptable reproducible curation-as-code and a teaching curriculum, while conceding
that browser viewing and automated cut/sort already exist elsewhere.

---

## 2. Ranked publication options

Ranked by (defensibility x effort-to-ready). Higher = stronger claim that is closer to submittable.

### Option A (PRIMARY) — Browser-native curation-as-code application note

- **Thesis:** the core story from section 1. A zero-install browser tool that edits native
  `.pretext` assemblies reversibly and scriptably, with live analytics recomputed on the curated
  arrangement, and exports AGP/FASTA/BED.
- **Venue: SUPERSEDED by the venue re-evaluation, see `venue-analysis.md`.** The initial
  read defaulted to an application-note tier (Bioinformatics App Note; GigaByte). A verified
  precedent check (HiGlass in Genome Biology 2018 and JBrowse 2 in Genome Biology 2023, both
  browser tools with no novel algorithm, published as GB Software papers) shows the project can
  credibly aim higher. Revised targeting: primary GigaScience Research article (best odds; its
  selection criteria are reproducibility/usability/utility, not impact, which fits the
  impact-not-novelty profile as it stands); stretch/ceiling Genome Biology Software (reachable
  only with a side-by-side demonstration of a clear advance over PretextView, which is the case
  study below); fallback Bioinformatics Application Note (precedent igv.js, gEVAL). PLOS Comp Biol
  is gated on documented adoption (which OpenPretext lacks); NAR Web Server eligibility for a
  purely client-side app is genuinely unresolved in the written rules and needs an editor inquiry.
  The honest asset: PretextView has no journal paper and JBAT is preprint-only, so "first
  peer-reviewed browser-native curation tool" is a legitimate novelty claim for the higher tier.
  To step up from floor to ceiling, add: (1) an end-to-end curation case study reproducing
  PretextView output on the same assembly (doubles as GB's side-by-side advance and GigaScience's
  required scientific conclusions), (2) numerical cross-validation of the analytics vs a reference
  implementation (cooltools/FAN-C), (3) a curation-as-code reproducibility demo, and, for PLOS or
  to strengthen GB, (4) adoption evidence. Items 1-2 overlap the blockers already listed below.
- **Claims it CAN make:** browser-native curation of native `.pretext`; scriptable/headless
  curation-as-code with in-loop assertions and a shared GUI/CI execution surface; reversible
  cut/join/invert/move within the undo window; self-contained sequence-provenance FASTA export that
  reverse-complements correctly through cut-then-invert-then-join without an external AGP; live
  client-side analytics recomputed as the user edits.
- **Claims it CANNOT make:** novel viewing, novel cut/sort, novel analytics methods, uniquely
  reversible, or any biological finding. Analytics correctness must be scoped to "self-consistent,"
  not "agrees with the community standard" (A3).
- **Blockers / prerequisites (all pulled from the reports):**
  1. **Close the BC4 CI ground-truth gap (A1, load-bearing).** The hard codec paths (index
     unpacking, both interpolation branches, column-major ordering) are validated only by
     gitignored, skip-in-CI tests and by a self-consistency check that cannot catch a decoder bug.
     A "faithfully shows the data" claim rests on this. Add a synthetic encode->decode round-trip or
     a committed reference tile with hand-computed pixels that runs in CI. A reviewer will ask why
     it is absent.
  2. **Disclose or fix the `MAX_UNDO_DEPTH = 200` reversibility caveat (A2).** A single autosort or
     autocut on a fragmented genome emits thousands of same-batch ops; the cap keeps only the last
     200, so the batch cannot be fully undone. Either make the autosort/autocut paths cap-immune
     (as the scaffold-bulk path already is, via a single before/after snapshot) or state plainly
     that exact reversibility holds only inside the 200-op window. Do not write "provably reversible"
     unqualified.
  3. **Reconcile documentation drift (A2, A4).** README says "13-command," CHANGELOG "18-command,"
     parser defines ~21; README/CHANGELOG say 10 lessons/10 specimens/8 patterns while the artifact
     ships 16/16/11. Any figure or table citing a count will be checked against the repo.
  4. **Disclose AGP/BED interoperability nuances (A2).** `groupContigsByScaffold` emits
     `scaffold_<numericId>`, dropping curator-assigned scaffold names; joined contigs export a
     synthetic `a+b` componentId and insert no gap where scaffold placement inserts a 200 bp N-run.
     Order and orientation are faithful; state the identifier and gap semantics.
  5. **Frame the rendering pipeline as sound engineering, not novelty, and phrase the tool
     comparison comparatively** (A1) rather than as a universal "no tool does this."

### Option B — Open teaching resource / curriculum paper

- **Thesis:** an open, zero-install, broadly-taxa curriculum and specimen set for genome curation,
  whose distinctive spine is a two-track progression: guided walk-throughs on curated vertebrates
  (lessons 01-10) then open-ended exercises with no answer key on real, uncurated DToL assemblies
  (11-16), mirroring how curation is actually learned (A4).
- **Venue (B2):** GigaByte (Technical Release, reproducibility + data + updatable-article model
  fits a living tool-plus-curriculum) or F1000Research (Software Tool Article plus documented
  workflows). PLOS Computational Biology Education (Ten Simple Rules / Quick Tips) fits a "how to
  curate" teaching piece but is short (<=2,500 words) and usually invited; query the editor first.
- **Claims it CAN make:** an offered, reusable resource with 16 tutorials, an 11-entry pattern
  gallery, a 3-page field guide, 16 hosted real specimens spanning 8 taxonomic groups (fungus and
  plant included, 32 to ~7,900 contigs), and a reproducible acquisition pipeline (`bench/acquire`).
  It can foreground the honesty framings (assessment:null where there is no ground truth; "expect
  auto-cut to find nothing, that is a good outcome"; provisional pattern tags labeled as such).
- **Claims it CANNOT make:** any learning-outcome or learning-gain claim. All 16 lessons are
  `assessment: null`; there is no learner cohort, no pre/post instrument, no completion or transfer
  data (A4). A venue that requires demonstrated learning outcomes cannot be satisfied. State this
  ceiling plainly. The mission ("democratizing curation") is motivation, not claim.
- **Blockers / prerequisites:** same doc drift as Option A (10/10/8 vs 16/16/11); no controlled
  pattern vocabulary (specimen tags do not cleanly resolve to gallery ids); provisional mushroom/
  maple classifications need expert review; teaching notes are expert-authored but not externally
  peer-reviewed; and the AutoCut-does-nothing-on-DToL-overview behavior (A5) coexists with the
  lesson prose, so frame that prose as "honest framing that also accommodates an unresolved AutoCut
  limitation," not a clean pedagogical win.
- **Note:** A4's own fallback is that this material is fully defensible today as a *section* of
  Option A with no additional work. If the standalone resource case reads thin, fold it in.

### Option C — JOSS software companion

- **Thesis:** a short, citable metadata wrapper over the open-source software, paired with Option A.
- **Venue (B2):** JOSS. Review is of the software itself via public GitHub issues; the paper is a
  ~1-page wrapper.
- **Claims / limits:** clean secondary output that yields a DOI; weak as a sole primary claim. JOSS
  wants feature-complete software, sustained open development, and evidence of research impact/
  adoption; watch the "not a thin client" bar. Pre-trained ML models are out of scope, so keep the
  external Evo2HiC/HiCFoundation ML features out of the JOSS framing.
- **Blockers:** essentially the same test/doc hygiene as Option A; low incremental effort once A is
  underway.

### Option D — AutoCut/AutoSort methods note (LATER, and only if re-benchmarked)

- **Thesis (the only currently honest one):** specificity, stability, and taxonomic generalization
  of an in-browser cut/sort heuristic across a broad corpus. NOT precision/recall/orientation
  accuracy of detection and scaffolding.
- **Venue:** would fit Bioinformatics Application Note or a short methods venue only after the
  re-benchmarking below. Not submittable as a correctness/methods paper now.
- **Blockers:** substantial, and detailed in section 3. As it stands the numbers would not survive
  a reviewer who reads `runner.ts` and `autocut-metrics.ts` (A5).

### Not an option — a comparative-genomics biology paper

The reports contain no biological finding. See section 4. Do not attempt this from current evidence.

---

## 3. The AutoCut/AutoSort question

**Now: no.** Per A5, there is no viable correctness/methods paper today, because the benchmark
measures the wrong thing:

- AutoCut is only ever evaluated on already-curated assemblies where the correct answer is "cut
  nothing." Reported "recall 1.000" is a code artifact: when ground-truth breakpoints number zero,
  `autocut-metrics.ts` returns recall = 1 by construction. AutoCut's actual sensitivity (its ability
  to find real misassemblies) is never measured anywhere in the repo. Worse, the benchmark ran at
  the 0.30 module default while the shipped app uses the more sensitive 0.20, so even the measured
  precision (0.91) is on the optimistic side.
- AutoSort ordering is scored against the same curated order it was handed, on an already-
  diagonalized map; for every specimen under 60 contigs the code returns the input order unchanged,
  so tau = 1.000 by construction. Orientation ground truth is hard-coded to `false` for every
  contig, so "orientation 0.974" measures orientation specificity, not recovery of a flipped contig.
- Separately, AutoCut structurally cannot resolve Mb-scale-bin misassemblies on small DToL overviews
  (the `minFragmentSize*2 = 32px` skip means a contig must span half a 64px map to even be
  considered). A5 reproduced 0 breakpoints at sensitivities 0.30/0.20/0.10/0.05. This is a genuine
  resolution limitation, not a tuning bug; do NOT "fix" it by loosening thresholds.

**Later: possibly, if re-benchmarked.** The exact work A5 specifies:
1. Measure AutoCut recall on assemblies with known implanted or documented misassemblies (break a
   curated assembly at known positions, or use pre-curation files with a real cross-file mapping),
   at the resolutions users actually run including small DToL overviews, and report the operating
   envelope honestly.
2. Measure AutoSort by scrambling and inverting a curated assembly and scoring recovery of the known
   order and orientation, dropping or separately reporting the under-60-contig trivial cases.
3. Fix the labeling: what the current harness measures is specificity/stability and taxonomic
   generalization of that stability, which is legitimate and publishable if framed as such.

**Is it worth it, given PretextView ships Pixel Cut/Sort?** Marginal as a standalone paper. Since
cut/sort is not a novel capability (B1), a rigorous recall benchmark would at best show OpenPretext
matches an existing desktop feature. The higher-value, lower-cost move is to do item 3 (relabel to
specificity/stability) and fold the honest benchmark into Option A as "an in-browser equivalent of
Pixel Cut/Sort, characterized for false-positive rate and taxonomic stability." Reserve the full
recall re-benchmark (items 1-2) only if a reviewer of Option A demands quantified detection accuracy,
or if the resolution-envelope characterization itself (a negative result about overview-scale limits)
turns out to be a worthwhile short note.

---

## 4. The biological-insight question

**No. OpenPretext cannot support a comparative-genomics biology paper on the strength of these
reports.** A3 is unambiguous: every analytics module is a re-implementation with no novel result, all
of it runs on the coarse overview `contactMap` (as small as 64x64, Mb-scale bins), and nothing is
cross-validated against cooltools or FAN-C on the same real matrix. The reports contain no finding.
I will not invent one.

The overview-resolution ceiling caps what the numbers even mean: insulation/DI "TAD boundaries" are
not TADs (TADs are sub-Mb; these are Mb-bin partition signals); compartments at Mb bins are marginal
and only A/B-oriented when a FASTA is loaded; P(s) returns NaN below 5 distinct distances precisely
because the overview often cannot support a trustworthy log-log fit. B2 adds the venue reality:
Genome Research desk-rejects computational-only or assembly-only work without a leading biological
consequence, and its own guidance says a reference-assembly contribution alone is no longer
competitive.

A biology paper would require, and the current evidence does not provide: (1) a specific biological
question, not a tool demonstration; (2) full-resolution matrices rather than the overview; (3)
analytics cross-validated against a community-standard implementation (cooltools/FAN-C) on the same
data; and (4) an actual measured finding across a cohort, with the statistics computed from the data
shown. None of that is in these seven reports. Keep any future biology paper entirely separate from
the tool paper, and do not sell OpenPretext as the headline in a Genome Research/Genome Biology
submission (B2).

---

## 5. Sequenced recommendation

**Write first — Option A, the browser-native curation-as-code application note.** This is the
highest defensibility at the lowest effort-to-ready. Critical path, roughly in order:

1. Close the BC4 CI ground-truth test (A1). This is the one fix that most directly protects the
   load-bearing "faithfully shows the data" claim, and it is cheap (a synthetic round-trip or a
   committed reference tile).
2. Resolve the reversibility caveat (A2): make autosort/autocut cap-immune, or state the 200-op
   window limit explicitly. Do not ship an unqualified "provably reversible."
3. Reconcile doc drift (command counts; 16/16/11 lesson/specimen/pattern counts) so every cited
   number matches the repo (A2, A4). Trivial, but embarrassing if a reviewer catches it.
4. Relabel the AutoCut/AutoSort benchmark to specificity/stability and disclose the app-vs-benchmark
   threshold mismatch (A5); present cut/sort as an in-browser Pixel Cut/Sort equivalent.
5. Disclose the AGP/BED scaffold-name and join-gap semantics (A2); scope analytics claims to
   "self-consistent," not "validated against cooltools/FAN-C" (A3).
6. Target Bioinformatics Application Note (primary) or GigaByte (values-aligned alternative).

**Write second — Option C, the JOSS companion,** paired with A. Low incremental cost once the test
and doc hygiene from step 1 above are done; yields a citable software DOI. Keep the external ML
features out of its scope.

**Write third (or fold in) — Option B, the education/resource paper.** After the same doc-drift fix
plus a controlled pattern vocabulary and a note on the provisional/AutoCut caveats. If a reviewer or
editor judges the standalone resource case thin, fold the curriculum into Option A as a section (A4's
own fallback), which is defensible today with no extra work. Send to GigaByte or F1000; treat PLOS
Comp Biol Education as invitation-gated.

**Do not write (for now):** the AutoCut/AutoSort standalone methods paper (Option D) unless the full
recall re-benchmark is done and yields a real result; and the comparative-genomics biology paper,
which the current evidence cannot support at all.

**Critical-path bottleneck:** two items gate everything and should start immediately: the BC4 CI
ground-truth test (step 1) and the benchmark relabeling (step 4). Doc drift (step 3) is near-zero
effort but must be cleared before any figure or table quotes a count.
