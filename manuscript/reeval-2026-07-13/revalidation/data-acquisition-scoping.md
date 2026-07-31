# Data-acquisition scoping: full-resolution Hi-C for the 18-species P(s) re-analysis

Date: 2026-07-13
Question: can we obtain full-resolution Hi-C contact matrices (in genomic-distance
units) for the 18 species so P(s) contact-decay can be recomputed with a
community-standard tool (cooler/cooltools on .cool/.mcool, or from .pairs)? The
only local data is coarse overview `.pretext`, which is inadequate for a proper
distance-binned P(s) curve.

## Fact-discipline note

Every S3 path, byte size, accession, and record count below was fetched from a live
source during this session (GenomeArk S3 REST listing, NCBI E-utilities, Zenodo API,
4DN portal API, GenomeArk documentation). Claims I could not verify are marked
UNVERIFIED. I confirmed data availability directly for only 3 of the 18 species
(koala, gharial, lancelet) plus the 4DN organism catalog; the per-repository
conclusions are generalized from those spot-checks and from the repositories'
documented layout, and that generalization is itself flagged where it matters.

## The 18 species (scientific names read from analysis-dir filenames)

armadillo *Dasypus novemcinctus*; bat *Artibeus lituratus*; coelacanth *Latimeria
chalumnae*; crocodile *Crocodylus niloticus*; finch *Taeniopygia guttata*; frog
*Eleutherodactylus marnockii*; gharial *Gavialis gangeticus*; koala *Phascolarctos
cinereus*; lancelet *Branchiostoma lanceolatum*; quail *Coturnix chinensis*; shark
*Carcharias taurus*; stubfoot (toad) *Anomaloglossus baeobatrachus*; toad
*Scaphiopus couchii*; tortoise *Indotestudo elongata*; turtle *Dermatemys mawii*;
whiptail *Aspidoscelis tigris*; wrasse *Thalassoma bifasciatum*; xenopus *Xenopus
petersii*.

These are globally distributed vertebrates (plus one cephalochordate, the lancelet).
The distribution is consistent with Vertebrate Genomes Project / GenomeArk production,
not with Darwin Tree of Life, whose remit is British and Irish species. The DToL
teaching specimens used elsewhere in this project (cockle, starfish, etc.) are a
separate set and are not among these 18. I did not exhaustively confirm VGP origin
for all 18; I confirmed GenomeArk hosting for koala and gharial (below).

## 1. What is actually published and downloadable

### GenomeArk / VGP (the primary source for this set)

GenomeArk's documented bucket layout and two live listings agree: GenomeArk publishes
**raw Hi-C reads and curated assemblies, plus overview `.pretext` maps and QC PDFs. It
does not publish `.pairs`, `.cool`, `.mcool`, or `.hic` contact matrices.**

Per the GenomeArk bucket-structure documentation, a species assembly holds
`assembly_curated/`, `assembly_MT/`, `genomic_data/`, and `transcriptomic_data/`.
Under `genomic_data/` the platform-specific folders include `arima` (the Arima Hi-C
directory), `dovetail`, `bionano`, `pacbio_hifi`, `pacbio`, `illumina`, and others.
The `arima/` folder is documented to contain only `{prefix}_{runID}_R1.fastq.gz`,
`{prefix}_{runID}_R2.fastq.gz`, `re_bases.txt`, `README`, and `files.md5`. No
processed contact-matrix product is defined anywhere in the layout. The only
matrix-like artifact GenomeArk stores is the `.pretext` overview map itself (the
coarse product this re-analysis is trying to move beyond), generated from the
assembly under `assembly_curated/.../pretextmap/`.

Live confirmation, gharial *Gavialis gangeticus* assembly `rGavGan2`:
`species/Gavialis_gangeticus/rGavGan2/genomic_data/arima/` contains
- `rGavGan2_1.fastq.gz` = 63,929,797,135 bytes (~63.9 GB)
- `rGavGan2_2.fastq.gz` = 67,221,369,448 bytes (~67.2 GB)
- `re_bases.txt` = 21 bytes

So for the gharial the full raw Hi-C read pair is present and is ~131 GB compressed.
No `.cool`/`.pairs` anywhere in the tree.

Live confirmation, koala *Phascolarctos cinereus* assembly `mPhaCin1` (KeyCount 13,
full flat listing): the assembly has **no `genomic_data/` and no `arima/` at all.**
It holds only the curated assembly (`mPhaCin1.pri.cur.20250923.fasta.gz`, ~1.06 GB),
`.pretext` maps (`...cur.20250923.pretext`, ~113 MB, and multimap/mapqfilter
intermediates), coverage/gaps/telomere tracks, an AGP, a chromosomes CSV, and a QC
PDF. Filenames embed NCBI accession `GCA_003287225.2` and dates in 2025-09. **The
koala's raw Hi-C reads are not hosted under this GenomeArk assembly.**

This is a real, load-bearing finding: **GenomeArk hosting is heterogeneous across the
18.** Some assemblies (gharial) expose the raw Hi-C FASTQ; others (koala) expose only
the curated assembly plus the overview `.pretext`. Do not assume raw reads are present
for a species until its `genomic_data/arima/` prefix is listed. Each of the 18 needs
this one-line S3 check.

### Darwin Tree of Life / Sanger tolqc

Not expected to hold these 18 (wrong taxonomic remit; see above). For completeness, on
the DToL model: raw reads including Hi-C are submitted to ENA/SRA, and the Sanger Tree
of Life pipeline generates Hi-C contact maps as `.pretext`, browsable via ToLQC
(`tolqc.cog.sanger.ac.uk`). I did not find, in this session, DToL publishing public
`.cool`/`.mcool` matrices; that absence is UNVERIFIED for DToL specifically since none
of these 18 are DToL and I did not pull a DToL ENA record. If any species here turns
out to be DToL-sourced, its situation is the same in kind: raw reads on ENA, overview
map as `.pretext`, matrix reprocessing still required.

## 2. Reprocessing pipeline and its scale (if only raw reads exist)

For any species where only raw Hi-C reads are available (the gharial case), producing a
genomic-distance-binned matrix is a standard, well-trodden pipeline:

1. Align R1 and R2 independently to the curated assembly with `bwa-mem2` (or `bwa mem`,
   or `chromap` for speed). Hi-C reads are aligned as single-end and paired at the pair
   level, not as a normal paired-end alignment.
2. `pairtools parse` -> `pairtools sort` -> `pairtools dedup` (with `pairtools select`
   for mapping-quality and pair-type filters) to produce a deduplicated `.pairs` file.
3. `cooler cload pairs` (or `cload pairix`) to bin into a base-resolution `.cool`, then
   `cooler zoomify` to a multi-resolution `.mcool`.
4. `cooltools expected-cis` on the balanced `.mcool` to produce the P(s) curve in
   genomic-distance units. This is the community-standard contact-decay computation the
   re-analysis wants.

Scale, anchored to the one verified species (gharial, ~131 GB compressed paired Hi-C
against a crocodilian genome on the order of 2 to 2.5 Gb):

- Storage per species: raw reads ~50 to 150 GB compressed (gharial ~131 GB verified;
  the rest are ESTIMATES pending per-species checks). Intermediates (`.pairs`,
  sorted/dedup) commonly match or exceed the input, so budget a few hundred GB working
  space per species and multiple TB across 18.
- Compute per species: alignment dominates. Aligning ~10^8 to 10^9 Hi-C read pairs to a
  multi-Gb genome is on the order of tens to a few hundred CPU-hours per species; on a
  32 to 64 core HPC node that is roughly a few hours to about a day of wall time each.
  pairtools dedup and cooler binning add memory-heavy but shorter steps. These
  CPU-hour figures are ESTIMATES from the verified data volume and typical throughput,
  not benchmarked here.
- Aggregate: 18 species at this scale is a multi-TB download and hundreds to low
  thousands of CPU-hours. This is an HPC / cluster project, not a laptop or a
  single-workstation afternoon.

## 3. Deposited matrices on 4DN / Zenodo / GEO (spot-checks)

- **4DN Data Portal**: the portal's biosource organism catalog (fetched via its search
  API) is human, mouse, fruit fly, *C. elegans*, chicken, and a short tail of primates
  plus hamster, opossum, zebrafish. **None of the 18 are present** (no koala,
  coelacanth, gharial, crocodile, etc.). 4DN is not a source for this set.
- **Zenodo**: a query for `Branchiostoma lanceolatum Hi-C` returned 16 records; the
  ones carrying `.hic`/`.cool`/`.scool` matrices belong to other studies (human brain,
  Nagano single-cell, Miura). **No Hi-C contact matrix for the lancelet on Zenodo.**
- **GEO**: a `Latimeria chalumnae Hi-C` GEO query returned 0; a `Gavialis gangeticus`
  SRA query returned essentially nothing for Hi-C and only 1 SRA record for the
  organism total, meaning the gharial's reads live on GenomeArk S3, not fully mirrored
  to SRA. Keyword searches on GEO/SRA are unreliable for Hi-C (the strategy is often
  tagged "OTHER" or "Arima", not "Hi-C"), so these nulls are weak evidence, not proof
  of absence.
- **GEO, one real hit**: `Branchiostoma lanceolatum Hi-C` in GEO returned exactly one
  record, UID 200169088 = **GSE169088**, "3D genomics across the tree of life reveals
  condensin II as a determinant of architecture type" (a ~27-species tree-of-life Hi-C
  study). Its GEO esummary lists supplementary file types "BEDPE, FASTA, HIC, VCF, WIG"
  and links SRA study SRP175152 (accession as reported by the esummary; not
  independently confirmed). The presence of `HIC` supplementary files means **a
  processed Juicer-format contact matrix for a lancelet appears to be directly
  downloadable from GSE169088.** Caveats before relying on it: (a) it is built on that
  paper's own assembly, which may differ from the assembly analyzed locally here, so an
  assembly match must be checked before the P(s) result can be compared like-for-like;
  (b) `.hic` needs conversion (`hic2cool`) to feed cooler/cooltools; (c) I did not
  download the file or confirm the specific lancelet species/assembly inside it. Treat
  this as a verified lead, not a confirmed drop-in. The same paper very likely carries
  `.hic` for several other taxa in this list too, which is worth a direct GSE169088
  supplementary-file check for each of the 18.

## Bottom line (blunt)

A full-resolution, genomic-distance P(s) re-computation for these 18 is a **substantial
offline/HPC effort, not a modest download-and-recompute.** The dominant path is: pull
raw Arima Hi-C reads from GenomeArk (tens to ~130+ GB per species, verified for the
gharial), align with bwa-mem2, run pairtools + cooler to `.mcool`, then cooltools
`expected-cis`. Budget multi-TB storage and hundreds to low-thousands of CPU-hours
across the set.

Two complications sharpen the "not modest" verdict:
1. **Availability is heterogeneous.** At least one assembly (koala `mPhaCin1`) hosts no
   raw Hi-C reads on GenomeArk at all, only the curated assembly and the overview
   `.pretext`. Those reads must be sourced elsewhere (SRA under the original koala
   BioProject, UNVERIFIED) or that species dropped. Every one of the 18 needs an
   individual `genomic_data/arima/` S3 check before any compute is scoped.
2. **A few may be shortcut-able.** GSE169088 appears to publish processed `.hic`
   matrices for a lancelet and probably other tree-of-life taxa. Where a published
   matrix exists on a matching assembly, that species skips the whole reprocessing
   pipeline. This is worth checking per species first, because it could remove several
   from the HPC workload.

Recommended next step before committing HPC time: a cheap 18-row triage table with two
columns filled by direct check, (a) does `genomic_data/arima/` exist on GenomeArk and
how large, (b) is there a published `.hic`/`.cool` on GEO/Zenodo on the same assembly.
That table converts this from "reprocess everything" to a concrete, per-species plan.
