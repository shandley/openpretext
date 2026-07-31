# A4 — Education / Curriculum / Field-Guide / Specimen Infrastructure

Reviewer scope: the teaching layer of OpenPretext as a candidate publication (educational-resource or community-tool paper). Evidence base: source code, `public/data/*`, `guide/`, `README.md`, `CHANGELOG.md`, `bench/acquire`, `docs/`. The `manuscript/` tree was not read.

Note on counts: the shipped content is larger than the public docs claim. `README.md` (lines 40, 110, 227) and `CHANGELOG.md` still say "10 lessons / 10 specimens / 8 patterns." The filesystem shows **16 lessons, 16 specimens, 11 pattern-gallery entries, 8 AI strategies**. The numbers below are the real, verified counts. The doc drift is itself a maturity finding (section 2).

---

## 1. What the education/curriculum layer offers today

### Lessons — 16 total, in two distinct tracks

All 16 lesson JSON files live in `public/data/lessons/` and are registered in `src/ui/LessonBrowser.ts` (a modal browser with difficulty badges and time estimates). Each lesson is a sequence of steps with `title`, `instruction`, `expectedAction`, and `hint` fields. Difficulty tiers: beginner / intermediate / advanced. Estimated times range 10–30 min.

**Track 1 — guided core (lessons 01–10), on curated GenomeArk vertebrates.** These are scaffolded walk-throughs with an `expectedAction` per step and inline hints. Arc:
- 01 Reading a Hi-C Contact Map (beginner, wrasse, 8 steps)
- 02 Understanding Chromosome Structure (beginner, koala)
- 03 Detecting Misassembly Patterns (intermediate, finch)
- 04 Cutting and Joining Contigs (intermediate, quail)
- 05 Manual Scaffold Assignment (intermediate, crocodile)
- 06 Full Curation Exercise (advanced, finch)
- 07 3D Genomics Analysis (intermediate, koala)
- 08 Classifying Contigs with Meta Tags (intermediate, koala)
- 09 Automated Misassembly Detection (advanced, finch)
- 10 ML-Powered Enhancement / Evo2HiC (intermediate, quail, 13 steps)

The arc is coherent: read the map → chromosome structure → recognize errors → the two core operations (cut/join) → scaffold assignment → an integrated exercise → then the analysis, classification, automation, and ML layers.

**Track 2 — open exercises (lessons 11–16), on real UNCURATED Darwin Tree of Life assemblies.** This is the newer and more distinctive material. These have no answer key and `assessment: null`; the learner is explicitly told they are meeting a newly assembled species "just as a curator" does. Mix of QC ("is this already good?") and fix-it tasks:
- 11 Curate a Mollusc / Prickly Cockle (intermediate, QC)
- 12 Fix a Fragmented Assembly / Goose-foot Starfish (advanced, fix-it)
- 13 Verify a Model Genome / C. elegans (beginner, QC)
- 14 Read a Compact Genome / Button Mushroom (intermediate, contrast + QC)
- 15 Curate at Scale / Green Worm (advanced, ~8000 contigs, fix-it)
- 16 Read a Busy Map / Sycamore Maple (advanced, plant, reason biology-vs-error)

The guided→unguided-on-real-data progression is the pedagogical spine.

### Specimens — 16 total

`public/data/specimen-catalog.json`. Two provenance classes:
- **10 GenomeArk before/after PAIRS** (`genomeArkKeys.pre` / `.post`, with `benchmarkBaseline` F1/Kendall-tau/orientation): koala, wrasse, quail, finch, crocodile, spinyfin, snake, toad, lancelet, bat. Vertebrate-heavy plus two invertebrate chordates. These carry ground truth (the curated `post`), so they support scored benchmarking.
- **6 DToL single-stage EXERCISES** (`genomeArkKeys: null`, `benchmarkBaseline: null`, `releaseTag: "dtol-scaffolding"`): C. elegans, cockle, mushroom, starfish, earthworm, maple. Raw scaffolding only, no curated target.

Taxonomic breadth across the full catalog spans **8 groups**: mammal, bird, reptile, amphibian, fish, invertebrate, fungus, plant. The fungus (mushroom), plant (maple), and expanded invertebrate coverage are specifically the DToL contribution beyond the vertebrate-only GenomeArk set. Contig counts range 32 (mushroom) to 7,890 (earthworm), giving genuine scale variety.

Hosting: specimen `.pretext` files are served from Cloudflare R2 (`pretext-data.evomics.org`), off GitHub Pages, so the 1 GB Pages limit is not a constraint and all specimens are exposed with free egress + CORS (per project memory and loader `SPECIMEN_DATA_BASE_URL`).

### Pattern gallery — 11 entries

`public/data/pattern-gallery.json`, surfaced by `src/ui/PatternGallery.ts` with click-to-navigate example regions on a named specimen: clean-diagonal, chromosome-block, inversion, translocation, microchromosomes, sparse-signal, unplaced-contigs, compartments, telomere-signal, sex-chromosomes, haplotig-mirror. Each has a plain-language description, a "what to look for," and a linked specimen/region.

### AI prompt strategies — 8 entries

`public/data/prompt-strategies.json`: general, inversion-focus, scaffolding, fragmented-assembly, micro-chromosomes, analysis-guided, haplotig-detection, telomere-aware. These are LLM supplements that steer the in-app AI assistant toward a curation sub-task; they double as structured, expert-authored descriptions of each curation problem.

### Field guide — 3 pages (`guide/`, deployed on Vercel)

Plain-prose reference, independent of the app:
- `index.html`: reading a contact map, "four errors to fix and two things to leave alone," noisy-vs-diagram reality, a data-prep on-ramp, the draft→finished workflow, telling biology from error, and pointers into the interactive tutorials.
- `reading-the-analysis.html`: what each analysis-panel number means, A/B compartments + saddle plot, the four misassembly signatures, join support. Its `#analysis-*` anchors are deep-link targets from the app's help buttons.
- `glossary.html`: a categorized glossary (assembly/errors, reading the map, measuring the assembly, deeper measurements, real features, data I/O).

The guide carries the mission framing explicitly: curation "has been concentrated in a small number of large sequencing centers. OpenPretext runs the same workflow in a web browser at no cost, and this guide and its tutorials are intended to teach the process, so that a lab with a new genome can curate it themselves."

### Discovery tooling — `bench/acquire`

A stage-classified specimen-discovery CLI (`cli.ts` + `discover.ts` / `discover-tol.ts` / `download.ts` / `manifest.ts` / `s3.ts`). It enumerates GenomeArk before/after PAIRS (`--source genomeark`) and DToL single-stage exercises by taxon (`--source dtol --taxa molluscs,fungi`), builds a manifest with per-stage keys/sizes, and downloads by species or stage. This is the reproducible pipeline behind the catalog — a genuine infrastructure asset, not just a script.

---

## 2. Maturity and honesty framings

The teaching material is unusually candid about the limits of automation and of "correctness," which is a real strength for a scientific-education resource:

- **All 16 lessons have `assessment: null`.** Nothing claims to auto-grade the learner. For the DToL exercises this is principled: there is no curated ground truth for those species, so a score would be fabricated. Lesson 11 step 7 states this directly: "There is no automated score here, because there is no curated ground truth for this species yet. Judge the assembly yourself" and gives four concrete self-check questions.
- **Honest auto-cut treatment.** Lesson 11 step 4: run auto-cut and "expect it to find little or nothing to cut. That is a good outcome, not a failure." Step 6: "Knowing when an assembly is good enough is a real curation skill. Do not manufacture edits just to feel productive." This teaches restraint, which most tool tutorials omit.
- **Provisional pattern tags are labeled as such.** The catalog flags the mushroom ("Pattern tag provisional: the dense off-diagonal structure warrants review") and maple ("the checkerboard may reflect compartments, unpurged haplotypes, or repeats; review recommended") rather than asserting a confident classification.
- **Restraint themes carried into the guide** ("two things to leave alone," "telling biology from error").

Two maturity caveats:
- **Public docs undercount the shipped content** (README/CHANGELOG say 10/10/8; reality is 16/16/11). A resource-paper reviewer checking the artifact against its description would catch this; it should be reconciled before submission.
- **The auto-cut honesty text is correct but coexists with an unresolved algorithm limitation.** Project memory records that AutoCut found 0 breakpoints on overview-resolution DToL maps (cockle, starfish) even at default sensitivity, and this is flagged for a dedicated investigation. The lesson prose ("expect little or nothing") is genuinely right for clean assemblies, but it also happens to accommodate that open limitation. Frame it as "honest framing that also accommodates an unresolved AutoCut behavior," not as a clean pedagogical win.

---

## 3. Novelty / publication angle

There is a credible contribution here, and its defensibility depends entirely on how it is framed and where it is sent.

**What is genuinely novel and defensible (ground the claim in these, not in abstract "democratizing" language):**
1. **Two-track structure: guided → open-ended on real, uncurated data.** Lessons 1–10 are scaffolded with `expectedAction`/`hint` on curated vertebrates; lessons 11–16 drop the answer key and put the learner on real DToL assemblies, "just as a curator meets a newly assembled species." This mirrors how curation is actually learned (apprenticeship on real genomes) and is not something existing browser tools or the Sanger in-house route package as a public, self-serve curriculum.
2. **Taxonomic breadth beyond vertebrates.** 8 taxonomic groups including fungus and plant, with scale from 32 to ~7,900 contigs. Existing training material and reference sets skew vertebrate; the DToL exercise set broadens the phylogenetic and difficulty range.
3. **Integration.** A single artifact bundles a browser-native, no-install viewer + 16 tutorials + an 11-pattern reference gallery + a 3-page field guide + 16 hosted real specimens + a reproducible acquisition pipeline. The whole-package, zero-install, open framing is the practical differentiator against PretextView (desktop, install, center-internal training).

The mission — reducing reliance on a small number of centers and their in-house training — is real and is stated in the guide, but it should be the motivation, not the claim. The claim must rest on the concrete artifact above.

**Ranking of how to publish it (pick one primary framing, do not hedge across all three):**

- **PRIMARY (recommended): a standalone community/educational RESOURCE paper.** This is the plain reading of what exists — a reusable, open teaching resource with data, tools, and a curriculum. It is defensible *as a resource*, i.e., "here is an open, tested, broadly-taxa curriculum and specimen set for genome curation," without claiming measured pedagogy. Candidate venue types (offer as options to consider, not verified requirements — current submission criteria can't be confirmed from here): application-note / resource tracks such as Bioinformatics (Application Note), GigaScience / GigaByte, JOSS or JOSE (Journal of Open Source Education), F1000Research, BMC Bioinformatics (software/database). The resource must be framed honestly: an offered resource, not validated instruction.

- **FALLBACK (safest): the education layer as a section of a tool / application-note paper about OpenPretext.** Fully defensible today with no additional work. If the standalone resource case is judged thin by a reviewer, this is the fallback that survives.

- **NOT defensible: an education-RESEARCH paper claiming learning outcomes / gains.** All 16 lessons are `assessment: null`; there is no learner cohort, no pre/post instrument, no completion or transfer data. A venue that requires demonstrated learning outcomes cannot be satisfied with the current evidence. This is the ceiling — state it plainly.

The single discriminator for section-3 venue fit: **does the target require demonstrated learning outcomes?** If yes, this is not ready. If it accepts resources/tools on utility and openness, it is.

---

## 4. Honest limitations

- **No learning-outcome validation.** No user study, no learner cohort, no pre/post assessment, no completion analytics. Efficacy is asserted by design, not measured. This is the load-bearing limitation for any pedagogy claim.
- **No automated assessment anywhere.** `assessment: null` on all 16 lessons. For DToL exercises this is unavoidable (no ground truth for those species), but it means the curriculum cannot certify or score a learner even in principle for those cases.
- **Provisional pattern classifications.** Mushroom and maple pattern tags are explicitly flagged as needing expert review; the maple checkerboard is ambiguous between compartments, unpurged haplotypes, and repeats.
- **Teaching notes are expert-authored but not externally peer-reviewed.** The catalog `teachingNotes`, gallery descriptions, and guide prose read as authoritative but have not been through independent domain review as far as the artifact shows.
- **Pattern vocabulary is not a controlled ontology.** Specimen `patterns` tags and gallery `id`s do not use one shared vocabulary. Specimens carry tags like `inversions`, `misassembly`, `haplotype-switch`, `translocations`; the gallery uses `inversion` (singular), has no `misassembly` or `haplotype-switch` or `translocations` entry (it has `translocation`). So a specimen's pattern tags do not cleanly resolve to gallery entries. Minor, but a reviewer of a "reference resource" would note the lack of a controlled vocabulary.
- **Doc/content drift.** README and CHANGELOG describe 10/10/8 while the shipped artifact is 16/16/11. The public description understates and mismatches the resource.
- **AutoCut behavior on overview-resolution DToL maps is unresolved.** Auto-cut returns 0 breakpoints on some exercise specimens at default sensitivity (flagged for investigation). The exercises are written to remain correct regardless, but a learner running auto-cut on those maps sees the tool do nothing, and the underlying cause is open.
- **DToL exercises lack ground truth by construction**, so the fix-it lessons (starfish, earthworm, maple) cannot show a learner the "right answer" or confirm their edits improved the assembly — only self-assessment against qualitative criteria.
