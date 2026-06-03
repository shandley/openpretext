---
title: "AutoSort and AutoCut: automated contig ordering and breakpoint detection for Hi-C contact map curation"
author:
  - name: Scott A. Handley
    affiliation: "Department of Pathology and Immunology, Washington University School of Medicine, St. Louis, MO, USA"
    email: shandley@wustl.edu
    corresponding: true
bibliography: references-paper2.bib
output:
  word_document:
    reference_docx: bioinformatics-template.docx
---

# Abstract

**Motivation:** Genome assembly curation, the manual inspection and correction of Hi-C contact maps, is a required step for reference-quality genomes in projects such as the Vertebrate Genomes Project, Darwin Tree of Life, and the Earth BioGenome Project. The current standard tool, PretextView, provides no automated algorithms, requiring curators to manually order and orient hundreds to thousands of contigs per genome. Automated scaffolding tools such as YaHS and 3D-DNA operate on raw Hi-C reads and do not integrate with the `.pretext` contact map format used across genome curation pipelines.

**Results:** We present AutoSort, a Union Find-based contig ordering algorithm, and AutoCut, a diagonal signal density analyzer for misassembly breakpoint detection. Both algorithms operate directly on the `.pretext` contact map and are implemented in OpenPretext, a browser-based curation tool. Benchmarking across 34 GenomeArk specimens spanning 7 taxonomic groups (birds, mammals, reptiles, fish, amphibians, sharks/rays, non-vertebrate chordates) demonstrates a mean Kendall's tau of 0.988 for ordering accuracy, mean orientation accuracy of 0.974, and zero false positive breakpoints for 31 of 34 specimens, with a mean execution time of 3.8 seconds per genome. The algorithms generalize across more than 500 million years of genome architecture evolution without taxon-specific tuning.

**Availability and implementation:** AutoSort and AutoCut are implemented in TypeScript within the OpenPretext platform and are freely available under the MIT license at https://github.com/shandley/openpretext. A live demo is at https://shandley.github.io/openpretext/.

**Contact:** shandley@wustl.edu

# 1 Introduction

Chromosome-scale genome assemblies depend on Hi-C chromatin conformation capture data to scaffold contigs into chromosomes (Burton et al., 2013; Lieberman-Aiden et al., 2009). Manual curation of Hi-C contact maps, the process of correcting misassemblies, orienting contigs, and assigning them to chromosomes, remains essential for reference-quality genomes and is required by INSDC and RefSeq (Howe et al., 2021). This process typically requires 2-8 hours per genome performed by trained specialists. As biodiversity genomics initiatives scale to thousands of species (Lewin et al., 2018; Blaxter et al., 2022; ERGA Consortium, 2024), the curation bottleneck is a growing constraint.

Automated Hi-C scaffolding tools, including SALSA2 (Ghurye et al., 2019), 3D-DNA (Dudchenko et al., 2017), and YaHS (Zhou et al., 2023), operate upstream on raw read alignments to produce new scaffold sequences. These tools do not read the `.pretext` contact map format (Harry, 2022a, 2022b), do not provide interactive curation interfaces, and cannot be applied within the visual curation workflow. PretextView, the standard contact map viewer, lacks any automated curation capability. AutoHiC (Zhang et al., 2024) applies deep learning trained on over 500,000 Hi-C contact map images to detect and correct assembly errors automatically, but similarly operates on raw Hi-C data before the contact map curation stage and does not provide an interactive curation interface for the `.pretext` workflow.

We introduce AutoSort and AutoCut, two signal-processing algorithms that operate directly on the Hi-C contact map as represented in `.pretext` files. AutoSort orders and orients contigs into chromosome-scale chains using a Union Find strategy. AutoCut detects misassembly breakpoints by analyzing diagonal signal density. Both algorithms are integrated into OpenPretext, a browser-based curation tool, where their results are presented as undoable curation operations that curators can accept, modify, or reject individually.

# 2 Algorithm

## 2.1 AutoSort

AutoSort chains contigs into chromosome groups in three phases. In Phase 1 (link scoring), for each contig pair, the algorithm scores four possible adjacency orientations (head-head, head-tail, tail-head, tail-tail) by sampling anti-diagonal intensity bands near the inter-contig block corners, comparing observed intensity to a genome-wide diagonal baseline, and applying 1/sqrt(d) distance weighting. Contigs smaller than 4 overview pixels are excluded.

In Phase 2 (greedy chaining), links are processed by descending score. Each contig begins as a single-element chain. A link is accepted when both contigs are at chain endpoints and belong to different chains. Chains are reversed and contigs inverted as needed to satisfy the orientation constraint implied by the link type.

In Phase 3 (hierarchical merging), an agglomerative pass combines chains whose inter-chain affinity exceeds an adaptive threshold. A safety guard rejects merges where the inter-chain affinity falls below 50% of the average intra-chain score, preventing cross-chromosome contamination. This phase increased mean chain completeness from 0.770 to 0.951.

## 2.2 AutoCut

AutoCut identifies breakpoints by computing sliding-window mean diagonal intensity for each contig and detecting regions where intensity drops below 30% of a local 4x-radius baseline. At each candidate, off-diagonal signal is compared to the contig median: genuine misassemblies show reduced off-diagonal signal, while centromeric regions maintain it. Candidates with off-diagonal ratio above 0.3 are classified as centromeric and retained. A confidence filter (threshold 0.5) and minimum fragment size constraint complete the pipeline.

# 3 Results

We benchmarked both algorithms on 34 curated specimens from GenomeArk, spanning 7 taxonomic groups with contig counts ranging from 34 to 5,506 (Table 1). Because the specimens are already curated, the expected number of AutoCut breakpoints is zero; any detection is a false positive. AutoCut is run first, followed by AutoSort on the post-cut state.

AutoSort achieved a mean Kendall's tau of 0.988 (Table 1). Twenty-two specimens (65%) reached tau >= 0.99, and all 34 exceeded 0.90. Performance was consistent across groups: sharks/rays (mean tau 0.999), amphibians (1.000), mammals (0.998), fish (0.990), reptiles (0.983), birds (0.980), and non-vertebrate chordates (0.957). The lowest single score was the European lancelet haplotype 1 (tau = 0.903), a 65-contig assembly where most contigs fall below the 4-pixel scoring threshold at overview resolution.

Mean orientation accuracy was 0.974 (all specimens >= 0.925). Mean chain purity was 0.996, indicating that chains almost never mixed contigs from different chromosomes. The algorithm scales to large assemblies: the silver spinyfin (5,506 contigs) achieved tau = 1.000 in 4.6 seconds, and the giant oceanic manta ray (4,714 contigs) reached tau = 1.000 in 4.4 seconds.

AutoCut produced zero false positives for 31 of 34 specimens. Three specimens yielded a total of 4 false positives: Wait's blind snake (1 FP), alligator gar (2 FPs), and Couch's spadefoot toad (1 FP). These may reflect genuine structural features such as heterochromatin or centromeric signal depletion that mimic misassembly signatures.

The algorithms were developed through four benchmark versions (Supplementary Table S1). Key improvements included a chain reversal bug fix (v2), hierarchical merging (v3, +23 percentage points chain completeness), and adaptive AutoCut thresholds with centromere verification (v2, reducing false positives from 37 to 4). The v4 expansion from 21 to 34 specimens, adding sharks, hemichordates, and cephalochordates, produced no degradation in aggregate metrics, confirming generalization without taxon-specific tuning.

Both algorithms operate on the downsampled overview contact map (typically 1,024 x 1,024 pixels) rather than the full-resolution tile data. This design enables execution in under 8 seconds for all specimens tested and avoids loading multi-gigabyte full-resolution matrices into memory. The trade-off is reduced precision for small contigs that span few overview pixels, particularly affecting orientation accuracy.

All results are reproducible via the benchmark pipeline included in the repository (`bench/` directory), which automates specimen download from GenomeArk, algorithm execution, and metric computation.

**Table 1.** Benchmark results for 34 GenomeArk specimens. tau: Kendall's tau ordering accuracy; Orient.: orientation accuracy; FP: AutoCut false positives.

| Species | Common name | Group | Contigs | tau | Orient. | FP | Time |
|---------|------------|-------|---------|-----|---------|-----|------|
| *Amazona ochrocephala* | Yellow-crowned amazon | Bird | 1,678 | 1.000 | 0.994 | 0 | 3.2s |
| *Agelaius phoeniceus* | Red-winged blackbird | Bird | 317 | 0.980 | 0.950 | 0 | 3.6s |
| *Taeniopygia guttata* | Zebra finch | Bird | 134 | 0.939 | 0.925 | 0 | 3.7s |
| *Coturnix chinensis* | King quail | Bird | 424 | 0.995 | 0.991 | 0 | 2.2s |
| *Cyanocitta cristata* | Blue jay | Bird | 315 | 0.988 | 0.975 | 0 | 2.7s |
| *Axis porcinus* | Hog deer | Mammal | 719 | 0.998 | 0.974 | 0 | 4.1s |
| *Marmota flaviventris* | Yellow-bellied marmot | Mammal | 813 | 0.999 | 0.994 | 0 | 3.4s |
| *Lestoros inca* | Inca shrew opossum | Mammal | 189 | 0.997 | 0.974 | 0 | 3.2s |
| *Artibeus lituratus* | Great fruit-eating bat | Mammal | 486 | 0.998 | 0.994 | 0 | 1.9s |
| *Phascolarctos cinereus* | Koala | Mammal | 1,235 | 1.000 | 1.000 | 0 | 3.1s |
| *Dasypus novemcinctus* | Nine-banded armadillo | Mammal | 559 | 0.996 | 0.984 | 0 | 3.8s |
| *Anilios waitii* | Wait's blind snake | Reptile | 124 | 1.000 | 1.000 | 1 | 1.5s |
| *Crocodylus niloticus* | Nile crocodile | Reptile | 122 | 0.985 | 0.943 | 0 | 4.2s |
| *Dermatemys mawii* | Central American river turtle | Reptile | 150 | 0.949 | 0.933 | 0 | 3.5s |
| *Aspidoscelis tigris* | Tiger whiptail lizard | Reptile | 185 | 0.978 | 0.973 | 0 | 2.3s |
| *Chitra chitra* | Asian softshell turtle | Reptile | 36 | 1.000 | 1.000 | 0 | 3.9s |
| *Indotestudo elongata* | Elongated tortoise | Reptile | 222 | 0.980 | 0.950 | 0 | 4.7s |
| *Gavialis gangeticus* | Gharial | Reptile | 160 | 0.989 | 0.938 | 0 | 5.2s |
| *Atractosteus spatula* | Alligator gar | Fish | 356 | 0.974 | 0.984 | 2 | 4.6s |
| *Thalassoma bifasciatum* | Bluehead wrasse | Fish | 52 | 1.000 | 1.000 | 0 | 4.7s |
| *Diretmus argenteus* | Silver spinyfin | Fish | 5,506 | 1.000 | 0.999 | 0 | 4.6s |
| *Osmerus mordax* | Rainbow smelt | Fish | 365 | 0.995 | 0.970 | 0 | 5.0s |
| *Latimeria chalumnae* | Coelacanth | Fish | 198 | 0.974 | 0.929 | 0 | 3.7s |
| *Lepisosteus oculatus* | Spotted gar | Fish | 832 | 0.999 | 0.982 | 0 | 3.1s |
| *Anomaloglossus baeobatrachus* | Pebas stubfoot toad | Amphibian | 3,642 | 1.000 | 0.998 | 0 | 6.4s |
| *Scaphiopus couchii* | Couch's spadefoot toad | Amphibian | 577 | 1.000 | 0.998 | 1 | 2.1s |
| *Eleutherodactylus marnockii* | Cliff chirping frog | Amphibian | 1,175 | 1.000 | 0.992 | 0 | 5.0s |
| *Carcharias taurus* | Sand tiger shark | Shark/Ray | 1,711 | 0.998 | 0.994 | 0 | 7.2s |
| *Squalus suckleyi* | Pacific spiny dogfish | Shark/Ray | 3,203 | 1.000 | 1.000 | 0 | 2.8s |
| *Hydrolagus colliei* | Spotted ratfish | Shark/Ray | 1,038 | 0.998 | 0.991 | 0 | 5.4s |
| *Mobula birostris* | Giant oceanic manta ray | Shark/Ray | 4,714 | 1.000 | 1.000 | 0 | 4.4s |
| *Balanoglossus misakiensis* | Acorn worm | Chordate | 135 | 0.969 | 0.933 | 0 | 3.7s |
| *Branchiostoma lanceolatum* (hap1) | European lancelet | Chordate | 65 | 0.903 | 0.938 | 0 | 2.4s |
| *Branchiostoma lanceolatum* (hap2) | European lancelet | Chordate | 34 | 1.000 | 1.000 | 0 | 2.4s |
| **Mean (n=34)** | | | | **0.988** | **0.974** | **0.12** | **3.8s** |

# Acknowledgements

We thank the Wellcome Sanger Institute Tree of Life programme for developing the Pretext suite, and GenomeArk and the Vertebrate Genomes Project for making curated genome assemblies publicly available. Specimens used in benchmarking were downloaded from the GenomeArk public S3 bucket (s3://genomeark).

# Funding

(To be completed)

# References

Burton,J.N. et al. (2013) Chromosome-scale scaffolding of de novo genome assemblies based on chromatin interactions. *Nat. Biotechnol.*, **31**, 1119-1125.

Blaxter,M. et al. (2022) Why sequence all eukaryotes? *Proc. Natl. Acad. Sci. USA*, **119**, e2115636118.

Dudchenko,O. et al. (2017) De novo assembly of the *Aedes aegypti* genome using Hi-C yields chromosome-length scaffolds. *Science*, **356**, 92-95.

ERGA Consortium (2024) The European Reference Genome Atlas: piloting a decentralised approach to equitable biodiversity genomics. *npj Biodivers.*, **3**, 28.

Ghurye,J. et al. (2019) Integrating Hi-C links with assembly graphs for chromosome-scale assembly. *PLoS Comput. Biol.*, **15**, e1007273.

Harry,E. (2022a) PretextView: Desktop application for viewing pretext contact maps. https://github.com/sanger-tol/PretextView

Harry,E. (2022b) PretextMap: Paired Read Texture Mapper. https://github.com/sanger-tol/PretextMap

Howe,K. et al. (2021) Significantly improving the quality of genome assemblies through curation. *GigaScience*, **10**, giaa153.

Lewin,H.A. et al. (2018) Earth BioGenome Project: Sequencing life for the future of life. *Proc. Natl. Acad. Sci. USA*, **115**, 4325-4333.

Lieberman-Aiden,E. et al. (2009) Comprehensive mapping of long-range interactions reveals folding principles of the human genome. *Science*, **326**, 289-293.

Rhie,A. et al. (2021) Towards complete and error-free genome assemblies of all vertebrate species. *Nature*, **592**, 737-746.

Zhang,T. et al. (2024) AutoHiC: a deep-learning method for automatic and accurate chromosome-level genome assembly. *Nucleic Acids Res.*, **52**, e92.

Zhou,C. et al. (2023) YaHS: yet another Hi-C scaffolding tool. *Bioinformatics*, **39**, btac808.
