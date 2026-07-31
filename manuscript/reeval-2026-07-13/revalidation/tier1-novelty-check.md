# Tier 1 novelty check: does the proposed pre/post-curation Hi-C-architecture study already exist?

Date: 2026-07-13
Scope: focused prior-art / novelty search for one specific proposed paper.

## The proposed paper (the thing being checked)

A systematic, quantitative study of how manual/assisted Hi-C-guided genome-assembly
curation changes the contact-map architecture and Mb-scale Hi-C metrics of an assembly,
measured pre- vs post-curation across a panel of genomes. Concretely: take pre-curation
(scaffolded but not yet manually curated) and post-curation assemblies, recompute coarse
whole-genome Hi-C metrics or contact-mass on both, and quantify what curation changes,
how much, and which metrics are diagnostic of curation need.

## Verdict (blunt)

The proposed paper appears genuinely open. I did not find any published work that recomputes
coarse whole-genome Hi-C contact-map metrics (contact mass, P(s) decay, insulation,
compartment strength) on matched pre- vs post-curation assemblies across a panel and reports
what curation changes and which metrics are diagnostic of curation need.

The field currently does two adjacent things, neither of which is the proposal:

1. It quantifies curation impact using contiguity/structural metrics (N50, scaffold count,
   assembly length, percent scaffolded to chromosome, counts of breaks/joins/removals).
   Howe 2021 is the definitive example. It does not compute Hi-C architecture metrics
   pre vs post.
2. It uses Hi-C contact maps qualitatively as a curation instrument (visual before/after
   screenshots to spot misjoins and false duplications), and separately establishes that
   misassemblies distort Hi-C-derived quantities (TAD merging, compartment-score shifts).
   Nobody has turned that around into a systematic pre/post-curation metric panel.

So the proposal is not a replication. The specific open part is: recomputing coarse Hi-C
architecture / contact-mass metrics on matched pre- and post-curation assemblies across a
panel, and framing those metrics as diagnostics of curation need.

## Closest prior work and exactly how the proposal differs

Closest prior work: Howe et al. 2021, "Significantly improving the quality of genome
assemblies through curation," GigaScience 10(1):giaa153, DOI 10.1093/gigascience/giaa153.
Verified title/authors/venue/year against the Oxford Academic record and the PMC record
(PMC7794651).
- https://academic.oup.com/gigascience/article/10/1/giaa153/6072294
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7794651/

What Howe 2021 actually measures (read from the PMC full text):
- Panel of 111 assemblies (174 Gb) curated for VGP and DToL.
- On average 221 interventions per Gb.
- Intervention breakdown reported as counts: on the order of 67 breaks, 105 joins, and
  49 removals of false duplications (per Gb-scale reporting).
- Mean scaffold N50 increased by 40 percent.
- Scaffold number decreased by 29 percent.
- Mean assembly length reduced by 2 percent.
- On average 96 percent of assembly sequence scaffolded to chromosome level.
- Hi-C is used qualitatively: before/after contact-map images (e.g. a starfish figure)
  show corrected misjoins and duplications. No P(s), insulation, compartment, or
  contact-mass metric is recomputed pre vs post.

How the proposal differs from Howe 2021: Howe already does the pre/post, across-a-panel,
this-is-what-curation-changes study, but the response variables are contiguity and
intervention counts, not contact-map architecture. The proposal keeps Howe's design
(matched pre/post across a panel) and swaps the measurement layer to coarse whole-genome
Hi-C metrics / contact-mass, then asks a question Howe does not: which of those metrics
move under curation and which flag that an assembly still needs curation. That measurement
layer and that diagnostic framing are the novel contribution. The risk is that a reviewer
reads the proposal as "Howe with extra plots" unless the diagnostic-of-curation-need angle
and the specific Mb-scale metrics are made load-bearing.

## What each search leg found

### 1. GRIT / Sanger Rapid Curation methodology and evaluation

- Howe 2021 (above) is the methodology-plus-impact paper. Quantifies pre/post with
  contiguity and intervention counts across 111 assemblies. Does not compute Hi-C
  architecture metrics. This is the single closest prior art.
- TreeVal (sanger-tol) generates evidence tracks and PretextSnapshot Hi-C maps to support
  curation; curation itself happens in PretextView/HiGlass. It is tooling to enable curation,
  not a pre/post metric study. https://pipelines.tol.sanger.ac.uk/treeval and
  https://github.com/BGAcademy23/treeval-curation

### 2. Works citing Howe 2021 that quantify curation impact on Hi-C architecture

- Checked directly via the citation graph, not just keyword proxies. Howe 2021 is OpenAlex
  work W3119817612 with roughly 1994 citing works
  (https://api.openalex.org/works/doi:10.1093/gigascience/giaa153). I filtered that citing
  set on the proposal's signature terms: "contact map curation", "Hi-C architecture curated
  assembly", "contact decay before after curation", "insulation score", "contact probability
  decay", "insulation compartment assembly". None returned a paper that recomputes Hi-C
  architecture metrics before vs after curation across a panel.
- The only curation-adjacent hits inside the citing set were MicroFinder (conserved gene-set
  mapping / assembly ordering for manual curation of bird microchromosomes, bioRxiv 2025 /
  GigaScience 2026) and Puzzler (below). Neither measures contact-map architecture pre vs
  post curation.
- Keyword web searches beyond the citing set surfaced only Hi-C scaffolding-tool benchmarks
  (compare tools on contiguity/QV/BUSCO, not curation on architecture) and the general fact
  that misassemblies distort Hi-C. None recompute architecture metrics pre vs post curation.
- Puzzler (Bishop et al., "Puzzler: scalable one-command platinum-quality genome assembly
  from HiFi and Hi-C," Bioinformatics Advances 6(1):vbaf329, 2026,
  https://academic.oup.com/bioinformaticsadvances/article/6/1/vbaf329/8432934) is a
  containerized one-command assembly pipeline validated across 12 eukaryotic genomes. It
  is an assembly tool, not a pre/post-curation architecture-metric study. Closed.

### 3. TreeVal / DToL curation QC, VGP curation evaluation, curation benchmark/reproducibility

- Rhie et al. 2021, "Towards complete and error-free genome assemblies of all vertebrate
  species," Nature (PMID 33911273, https://pubmed.ncbi.nlm.nih.gov/33911273/ and
  https://www.nature.com/articles/s41586-021-03451-0). Uses Hi-C heatmaps qualitatively
  after curation (arm-to-arm chromosome squares on the diagonal) and reports error classes
  (false duplications, missing GC/repeat-rich microchromosomes). Not a quantitative pre/post
  Hi-C architecture metric panel.
- No inter-curator reproducibility / curation-benchmark paper surfaced. Searches for
  "reproducibility of manual curation" and "inter-curator variability" returned only Howe
  2021 and assembler benchmarks, none addressing curator-to-curator agreement or a
  standardized curation benchmark. This is a separate open gap, adjacent to the proposal.

### 4. Papers measuring contact-map / P(s) / compartment / insulation changes draft-to-curated

- No panel-scale draft-to-curated architecture-metric study found.
- Related but not the proposal: work establishing that draft-assembly errors distort Hi-C
  readouts (wild-type cis-interactions appearing as translocations, merged/deleted TADs,
  shifted compartment scores). This motivates the proposal but studies distortion caused by
  errors, not the metric delta produced by curating those errors across a panel. Surfaced via
  the GENOVA case study (https://academic.oup.com/nargab/article/3/2/lqab040/6281451) and a
  plant Hi-C-junction refinement paper (https://doi.org/10.3390/plants12020320).
- "Identification of errors in draft genome assemblies at single-nucleotide resolution for
  quality assessment and improvement," Nature Communications 2023
  (https://www.nature.com/articles/s41467-023-42336-w). Title seen in search results;
  full text not fetched (paywall redirect), so treat specifics as unverified. From the
  title and abstract-level snippets it targets single-nucleotide error detection, not
  Hi-C contact-map architecture pre/post curation. Tangential, not the proposal.

## Fact-discipline notes

- Howe 2021 title, authors (Kerstin Howe, William Chow, Joanna Collins, Sarah Pelan,
  Damon-Lee Pointon, Ying Sims, James Torrance, Alan Tracey, Jonathan Wood), venue
  (GigaScience 10(1)), year (2021), and DOI (10.1093/gigascience/giaa153) were confirmed
  against the Oxford Academic and PMC records. The intervention-count numbers and percentage
  changes were read from the PMC full text via WebFetch; I report them as stated there.
- Rhie 2021 title/venue/PMID confirmed via the PubMed and Nature landing pages returned by
  search.
- The Nature Communications 2023 paper was NOT fetched (auth redirect); its scope is inferred
  from search snippets only and is flagged as unverified.
- Absence-of-prior-art claims are bounded by the searches actually run: PubMed, keyword web
  search, and a direct sweep of Howe 2021's citing literature via the OpenAlex citation graph
  (W3119817612, ~1994 citers) filtered on architecture-metric terms. The citing-set sweep
  makes the verdict stronger than a keyword search alone, but it filters on title/abstract
  text, so a paper that buried a pre/post architecture-metric analysis in its methods without
  naming it in the abstract could still be missed. "No such paper" therefore means "none
  found across PubMed, web, and a filtered citation sweep," not a proof of absence.
