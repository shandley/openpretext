# Lens 2 — Mb-scale / whole-chromosome comparative architecture across broad taxa

Assigned lens: propose biological genomics study designs whose signal genuinely
lives at the Mb / whole-chromosome / whole-genome resolution the overview matrix
can see, so the coarse-bin ceiling is not a fatal flaw. Explicitly avoid a
cross-species P(s)-slope comparison (a known pixel-domain non-comparability
problem, pursued in an older study that was not read here).

Grounded in the capability reports A1-A5, B1, B2 and the shipped
`public/data/specimen-catalog.json`. No manuscript/analysis material was read.

## The comparability test that decides every design

A coarse Hi-C metric is comparable across genomes only if it reduces to a
within-genome or chromosome-level dimensionless contrast with no residual
physical-scale term. The overview matrix is in the pixel/bin domain and the
bp-per-bin differs by genome size (the catalog spans 29 to 180 Mb; at a 64x64
overview that is roughly 0.45 Mb per bin for the mushroom versus 2.8 Mb per bin
for the maple). Any metric whose value shifts with bin size, evaluated on genomes
whose bins mean different numbers of base pairs, inherits exactly the
P(s)-slope trap. This is the single filter I apply below, and it is what sorts a
defensible design from a trap wearing a different label.

Two facts I verified this session that bound the novelty of anything at this
scale:

- Hoencamp, Dudchenko et al., "3D genomics across the tree of life reveals
  condensin II as a determinant of architecture type," Science 372(6545):984-989,
  2021 (PMID 34045355, DOI 10.1126/science.abe2218; verified via search this
  session, confirm the exact locator before citing). They mapped chromosome-scale
  3D architecture across 24 eukaryotes spanning animals, fungi, and plants, and
  defined two recurring architecture types: a Rabl-like state (centromere
  clustering, telomere clustering, a telomere-to-centromere axis) versus a
  dispersed state, with condensin II as the switch. This paper sits directly on
  top of any cross-taxa Rabl or chromosome-territory question.
- Avian microchromosome nuclear clustering is already established: the emu genome
  paper (Genome Research 31(3):497, 2021) and chicken Hi-C work show small,
  gene-dense microchromosomes clustering in the nuclear interior with frequent
  trans contacts, macrochromosomes at the periphery with few. So "small
  chromosomes preferentially contact in trans" is a known phenomenon in birds,
  not an open discovery.

The consequence: at this scale the defensible contribution is almost never a new
phenomenon. It is either (a) a question the paired, curation-stage, native
`.pretext` corpus can answer that a full-resolution analytics stack has not been
pointed at, or (b) honest breadth with a known effect used as a positive control.
I rank the three designs on that basis.

---

## Study 1 (top-ranked, most defensible): assembly-state robustness of coarse whole-genome architecture metrics

### Question / hypothesis

How much do Mb-scale architectural readouts of the same genome change between its
draft (pre-curation) and curated (post-curation) assembly, and does the change
scale with the amount of curation applied? Concretely: for each metric in
{inter-chromosomal (trans) contact structure, cis fraction, compartment/saddle
strength, checkerboard/accordance score}, quantify the paired pre to post shift,
and test whether a draft assembly's misjoins and fragmentation systematically
distort the coarse-architecture number a downstream analyst would read off it.
Hypothesis: some of these metrics (trans structure, cis fraction) are strongly
assembly-state dependent and should not be reported on draft assemblies without a
caveat, while others (whole-genome compartment sign structure) are comparatively
stable.

### Why it is genuinely Mb-scale and feasible here

Every metric in the set is a whole-genome or whole-chromosome quantity that the
overview matrix already carries. Nothing sub-Mb (no TAD, no loop) is touched. The
overview is exactly the object the question is about.

### The OpenPretext capability that enables it, and why incumbents do not

The corpus holds 10 GenomeArk before/after PAIRS (`genomeArkKeys.pre` /
`.post`, each with a `benchmarkBaseline` giving F1, Kendall-tau, and orientation
accuracy of the curation) across mammal, bird, reptile, amphibian, fish, and
invertebrate-chordate taxa. OpenPretext reads both members of the pair natively
and runs one identical metric pipeline on each, recomputing on the curated
arrangement by design. cooltools, FAN-C, HiGlass, and Juicebox can each compute
trans and compartment quantities, but none of them ship this paired
curation-stage panel, and none are built to recompute a metric on a
just-rearranged assembly. The contribution is not an algorithm; it is a question
that only a paired, curation-in-the-loop, native-`.pretext` panel can pose, which
is precisely where this lens says novelty is allowed to live.

### Data and analysis needed, and feasibility

The pipeline already computes cis fraction, compartment eigenvector and saddle
strength, and the checkerboard score on the overview (A3). What is missing is a
chromosome-by-chromosome trans-enrichment reduction, a small analysis addition
computable from the overview matrix plus the scaffold boundaries that already
exist (do not describe it as already computed). The core of the study is then:
run the pipeline on `pre` and on `post` for all 10 pairs, difference each metric,
and regress the fractional change against the curation magnitude already recorded
in `benchmarkBaseline` (1 minus Kendall-tau as a reordering-burden proxy) and
against draft contig count. No full-resolution reprocessing is required.

### Honest confound, and whether it survives

Comparability is the strongest possible here: the contrast is within-species and
paired, so the same genome, the same library and protocol, and the same
bp-per-bin appear on both sides. The pixel-domain trap cancels exactly, and the
cross-taxon comparison is of a dimensionless fractional delta, not a raw
magnitude. The real confound is interpretive, not statistical: curation is
reordering, orientation, and joining, not new sequence, so some metrics (trans
contact between contigs that got moved) are by definition arrangement-dependent
and will change even with no biological meaning. The design must separate the
expected mechanical effect of reordering from spurious distortion, for example by
also computing each metric under a random reordering of the draft as a null. With
that null in place the finding survives as a characterization of metric
robustness. Two residual limits to state plainly: benchmarkBaseline treats
`post` as ground truth, which is a curation decision not a physical truth, and
n=10 is a small panel for a per-taxon claim, so the deliverable is a
characterization and a caution, not a law.

### Venue and whether it is biology or resource

Resource / methods, not a biology discovery. It answers "how much can you trust a
coarse Hi-C architecture number computed on a draft assembly," which is directly
useful to everyone who computes these metrics before curation is finished.
Candidate venues: GigaByte (Technical Release, reproducibility-first, matches
this exactly), Genome Biology (Method), or Bioinformatics if framed tightly. It
is the honest center of gravity for this lens because its comparability guarantee
is airtight and its enabling asset (the paired panel plus recompute-on-arrangement)
is genuinely specific to OpenPretext.

---

## Study 2 (second): size-linked inter-chromosomal association across taxa, with avian microchromosome clustering as a positive control

### Question / hypothesis

Reduce each chromosome-level genome to a chromosome-by-chromosome trans-enrichment
matrix and ask whether small chromosomes preferentially associate in trans, and
whether that size-assortativity generalizes beyond birds. Hypothesis: the avian
microchromosome-clustering signal reproduces on the curated bird specimens (a
built-in positive control), and the open question is whether any non-avian taxon
with a size-heterogeneous karyotype in the panel shows a comparable size-linked
trans structure.

### Why it is genuinely Mb-scale and feasible here

The unit of analysis is the whole chromosome. Collapsing bins to chromosomes and
measuring mean trans contact between chromosome pairs is inherently a
whole-chromosome, whole-genome operation. Microchromosome clustering is a nuclear
positioning phenomenon of chromosomes tens of Mb in size, each spanning several
overview bins. No sub-Mb resolution is needed.

### The OpenPretext capability that enables it, and why incumbents do not

The uniform one-pipeline metrics across an assembled cross-taxa chromosome-level
`.pretext` panel, with per-scaffold awareness and a Kendall-tau-benchmarked
curated `post` for each vertebrate, is the enabler. As in Study 1, cooltools
could compute the trans matrix, but the assembled comparative panel and the
chromosome-boundary metadata are what is actually scarce. This needs the same
small chromosome-level trans-network addition noted in Study 1.

### Data and analysis needed, and feasibility

Use the curated `post` maps. Chromosome-level assemblies with a known
chromosome count are the ~9-10 GenomeArk specimens (koala 16, wrasse 24, quail
30, finch 32, crocodile 16, spinyfin 24, toad 13, lancelet 19, bat 15;
`chromosomeCount` is null for the DToL exercise set and for snake). Build the
chromosome-by-chromosome mean-trans-enrichment matrix (observed trans over a
genome-wide trans expectation), then test size-assortativity within each genome
(does trans enrichment increase as the pair of chromosomes gets smaller) and
compare the within-genome effect size across genomes. No full-resolution
reprocessing is needed for the chromosome-level mean-trans version.

### Honest confound, and whether it survives

Comparability is handled by the chromosome-level, within-genome contrast plus
across-genome comparison of effect sizes, so the bp-per-bin trap is escaped the
same way as in Study 1. Four honest limits, and they bind harder than in Study 1:

- The phenomenon is known in birds (emu, chicken), so the bird result is a
  positive control, not a discovery. The novel content is only whether it
  generalizes to non-avian taxa, and how it looks on curation-stage maps.
- Trans signal is intrinsically weak, and at a 64x64 overview a chromosome of
  around 10 Mb spans only a few bins, so a small-small chromosome block may be
  one or two bins on a side with almost no signal. This is a real power limit;
  it is cheap to de-risk first by opening a curated specimen (finch or koala) in
  the tool and confirming an inter-chromosome block actually carries structure
  before claiming the method is turnkey.
- "Small chromosome" is a size-ranked proxy, not identical to a defined
  microchromosome, and there are only two birds (quail, finch) and about 9-10
  chromosome-level genomes total across 6 taxa.
- Each species is one library from one lab, so a per-species batch effect on
  overall trans level is confounded with any per-species trans claim; the
  within-genome assortativity contrast is what protects against this, and the
  cross-genome claim must stay at the level of effect-size rank.

It survives as a breadth / resource extension with birds as an internal positive
control. It does not survive as a claim to have discovered size-linked trans
clustering.

### Venue and whether it is biology or resource

Biology-adjacent resource. If a clean, unexpected non-avian positive emerges it
could reach a comparative-genomics venue (Genome Biology, or Genome Research if
the biological consequence is strong, though Genome Research now desk-rejects
descriptive-only genome work per B2); otherwise it is a resource / short
comparative note (GigaByte). Note explicitly that a standalone Rabl-versus-dispersed
screen is not proposed here as a separate design, because Hoencamp 2021 already
did that comprehensively across 24 species; the centromere/telomere-clustering
readout is at best a reproduction or a targeted extension to taxa that paper did
not cover, and should be framed as such rather than as novel.

---

## Study 3 (flagged, discard at overview resolution): cross-species compartment / saddle strength as a comparative trait

### Question / hypothesis

Is whole-genome A/B compartmentalization strength (the saddle statistic
(AA+BB)/(2*AB), GC-oriented when a FASTA is loaded) a conserved trait, or does it
vary systematically with genome size, GC content, or chromosome number across the
16-genome panel?

### Why it looks feasible, and why it is a trap

Saddle strength is dimensionless and computed by within-genome quantile ranking,
which makes it look like the ideal comparable metric, and A/B compartmentalization
is a legitimately Mb-scale phenomenon that appears on this lens's own list. So it
does not fail on scale. It fails on comparability. Compartment strength carries an
intrinsic resolution dependence: as bins coarsen and each bin averages over a
larger stretch of alternating A/B domains, the measured strength systematically
shifts. Because bp-per-bin varies across the panel (0.45 to 2.8 Mb per bin at a
64x64 overview), a cross-species ranking of saddle strength inherits exactly the
resolution confound that sinks the P(s)-slope comparison, only wearing a different
metric's name. A3 already warns that compartment calling at Mb bins is marginal;
this design would build a comparative claim on top of that marginal call. Discard
it at overview resolution.

### The tempting partial rescue, and why it fails

One might regrid every overview to a common bp-per-bin without touching
full-resolution data. This fails: the only common bin achievable by downsampling
is the coarsest one already present (around 2.8 Mb, set by the maple), which
leaves roughly 10 bins on the smallest genomes and guts compartment calling
entirely. The only real fix is to reprocess all specimens from full-resolution
matrices at a fixed physical bin size (for example 500 kb across the board),
which means going back to the `.cool` / `.pretext` full-resolution data outside
the overview path. If that reprocessing is done, the question becomes defensible
and interesting; at the shipped overview resolution it is not. It is also heavily
pre-empted by Hoencamp 2021 on the architecture-type axis, which further weakens
the standalone case.

### Verdict

Keep it in the writeup only as the explicit negative example: the design that is
genuinely Mb-scale, looks comparable, and is nonetheless the same pixel-domain
trap. It is the control that shows the comparability filter is doing real work,
not a study to run as-is.

---

## Ranking and the trap flag

1. **Study 1 (assembly-state robustness, paired pre/post).** Most defensible. The
   paired within-species contrast makes it the only design here with an airtight
   comparability guarantee, its enabling asset is genuinely specific to
   OpenPretext, and it has the least prior-art overlap. Resource / methods venue.
2. **Study 2 (size-linked trans association, birds as control).** Defensible as
   breadth with a positive control, but the core phenomenon is known in birds and
   the panel is small and trans-signal-limited at overview resolution. Escapes the
   comparability trap via chromosome-level within-genome contrasts. Resource or
   short comparative note.
3. **Study 3 (cross-species saddle strength).** Flagged and discarded at overview
   resolution. It is genuinely Mb-scale, which is why it is instructive, but it
   secretly depends on the same bin-size / pixel-domain trap as the
   cross-species P(s)-slope comparison, and it is largely pre-empted by Hoencamp
   2021. Rescue only with fixed-bp full-resolution reprocessing.

Cross-cutting honesty note carried from A3 and B1/B2: none of these introduce a
new algorithm, and the coarse metrics have not been cross-validated against
cooltools or FAN-C on the same real matrices. Any architectural number quoted at
overview resolution should be scoped as self-consistent until such a cross-tool
comparison exists, and the comparative claims above should lead with the
biological or resource question, not with the tool.
