---
title: "OpenPretext: browser-based Hi-C contact map curation with automated algorithms and integrated education"
author:
  - name: Scott A. Handley
    affiliation: "Department of Pathology and Immunology, Washington University School of Medicine, St. Louis, MO, USA"
    email: shandley@wustl.edu
    corresponding: true
bibliography: references.bib
output:
  word_document:
    reference_docx: genome-biology-template.docx
---

# Abstract

**Background:** Genome assembly curation --- the manual inspection and correction of Hi-C contact maps --- remains a critical bottleneck in chromosome-scale genome projects. The current standard tool, PretextView, requires desktop installation, offers no automated curation algorithms, and provides no structured training resources for new curators. As genome sequencing scales to thousands of species through initiatives such as the Earth BioGenome Project, both the throughput and accessibility of curation tools must improve.

**Results:** We present OpenPretext, a browser-native Hi-C contact map viewer and curation tool that requires no installation. OpenPretext includes a reverse-engineered, publicly documented parser for the `.pretext` binary format, WebGL2-accelerated rendering with tile-based level-of-detail for genomes up to 32,768 pixels (65,536 in high-resolution mode), and a full curation engine with cut, join, invert, move, scaffold assignment, and batch operations with unlimited undo/redo. We introduce two automated curation algorithms: AutoSort, a Union Find-based contig chaining algorithm with hierarchical merging, and AutoCut, a diagonal signal density analyzer for breakpoint detection. Benchmarking across 34 GenomeArk specimens spanning 7 taxonomic groups (birds, mammals, reptiles, fish, amphibians, sharks/rays, and non-vertebrate chordates) demonstrates a mean Kendall's tau of 0.988 for ordering accuracy, mean orientation accuracy of 0.974, and zero false positive breakpoints for 31 of 34 specimens (4 total false positives across all specimens), with a mean execution time of 3.8 seconds per genome. OpenPretext also provides an integrated education system with six progressive tutorial lessons, a 10-specimen teaching corpus with difficulty ratings, a pattern gallery of eight diagnostic Hi-C patterns, and self-assessment via Kendall's tau comparison against ground truth.

**Conclusions:** OpenPretext demonstrates that browser-based genome assembly curation can achieve high accuracy through signal-processing algorithms that generalize across more than 500 million years of genome architecture evolution. Its zero-installation deployment, automated algorithms, scripting DSL, and integrated education system address key barriers to scaling genome curation for large biodiversity genomics initiatives. OpenPretext is freely available under the MIT license at https://github.com/shandley/openpretext with a live demo at https://shandley.github.io/openpretext/.

**Keywords:** Hi-C, contact map, genome assembly, curation, WebGL, browser, education, automation

# Background

Chromosome-scale genome assemblies are foundational to modern genomics, enabling studies of chromosome evolution, gene regulation, and comparative genomics across the tree of life [@Rhie2021]. Hi-C chromatin conformation capture data provide the long-range contact information necessary to scaffold contigs into chromosomes [@Burton2013; @Lieberman-Aiden2009], and Hi-C contact maps --- two-dimensional heatmaps of pairwise chromatin contact frequencies --- are the primary visual tool for evaluating and curating these assemblies [@Rao2014; @Dudchenko2017].

Genome assembly curation is the process of manually inspecting contact maps to identify and correct misassemblies, orient contigs, and assign them to chromosomes. This process is essential for producing reference-quality genomes and is a requirement for submissions to the INSDC and RefSeq databases [@Howe2021]. Manual curation typically requires 2--8 hours per genome depending on assembly complexity, and must be performed by trained specialists who can distinguish genuine biological signals (such as centromeric signal depletion or A/B compartment patterns) from assembly errors [@Howe2021]. The Vertebrate Genomes Project (VGP), Darwin Tree of Life (DToL), Earth BioGenome Project (EBP), and European Reference Genome Atlas (ERGA) all mandate Hi-C-based curation as part of their assembly pipelines [@Rhie2021; @Blaxter2022; @Lewin2018; @ERGA2024]. With these initiatives collectively targeting reference genomes for tens of thousands of species, the curation bottleneck --- limited by the availability of trained curators and the throughput of existing tools --- is a growing constraint on genome production.

The current standard tool for Hi-C contact map curation is PretextView, developed by the Wellcome Sanger Institute as part of the Pretext suite [@Harry2022]. PretextView is a desktop OpenGL application that reads `.pretext` binary files produced by PretextMap [@Harry2022Map] from aligned Hi-C reads. While PretextView is widely used and effective, it has several limitations: it requires local installation and compilation; its binary file format is undocumented; it provides no automated curation capabilities; it lacks a scripting interface for reproducible workflows; and it offers no structured training resources for new curators.

Several other tools address aspects of Hi-C data visualization and scaffolding. Juicebox provides interactive contact map exploration with annotation layers but uses the `.hic` format rather than `.pretext` and does not support curation operations [@Durand2016]. HiGlass offers a tile-based web viewer optimized for browsing large matrices but is designed for exploration rather than assembly curation [@Kerpedjiev2018]. Automated scaffolding tools --- including SALSA2, 3D-DNA, and YaHS --- operate on raw Hi-C reads to produce new assemblies but do not provide interactive curation interfaces for manual refinement [@Ghurye2019; @Dudchenko2017; @Zhou2023]. The original Hi-C scaffolding approach of Burton et al. demonstrated the feasibility of using chromatin interactions for chromosome-scale assembly, but subsequent work has shown that automated scaffolding alone is insufficient for reference-quality genomes; manual curation remains essential to resolve complex structural features [@Burton2013; @Howe2021]. None of these tools read the `.pretext` format, provide integrated curation with automated algorithms, or include educational resources.

Here we present OpenPretext, a browser-native Hi-C contact map viewer and curation tool that addresses four gaps in the current ecosystem: (1) it provides the first open-source, publicly documented parser for the `.pretext` binary format; (2) it introduces automated curation algorithms benchmarked across 34 genomes from 7 taxonomic groups; (3) it includes an integrated education system with progressive lessons and self-assessment; and (4) it requires no installation, running entirely in the browser from a single URL.

# Implementation

## Architecture

OpenPretext is implemented in TypeScript with strict mode enabled, built with Vite, and rendered using WebGL2. The application has a single runtime dependency: pako for RFC 1951 raw deflate decompression. All user interface elements are implemented with pure DOM manipulation --- no UI framework (React, Vue, or Angular) is used, keeping the production bundle small and eliminating framework version churn. The codebase comprises approximately 12,000 lines of TypeScript across 30 modules, with 1,418 unit tests (Vitest) and 22 end-to-end tests (Playwright).

The architecture follows an event-driven pattern centered on a typed EventBus for inter-module communication and a singleton AppState with immutable update semantics and undo/redo stacks. The rendering pipeline uses a tile-based level-of-detail (LOD) system: the full contact map is divided into a grid of tiles (typically 32 x 32), each containing BC4-compressed texture data at multiple mipmap levels. A TileManager with an LRU cache loads and decodes tiles on demand based on the current camera viewport, enabling smooth interaction with genomes up to 32,768 pixels per dimension (65,536 in high-resolution mode; Figure 1A--B).

## Binary format parser

The `.pretext` file format encodes Hi-C contact maps as BC4 (RGTC1) compressed textures with raw deflate compression, organized into a header followed by upper-triangular tile blocks and optional graph extensions. Despite its widespread use across genome assembly projects, the format has never been publicly documented.

We reverse-engineered the complete binary specification by reading the C++ source code of PretextMap (file writing), PretextView (file loading), and PretextGraph (extension appending). The format begins with a 4-byte magic number (`pstm`), followed by a deflate-compressed header containing the total genome length (u64), per-contig records (fractional length as f32 plus 64-byte name), and three texture parameter bytes that determine the tile resolution, grid size, and mipmap depth. The tile data section contains `N(N+1)/2` upper-triangular blocks, each independently deflate-compressed, with all mipmap levels concatenated from highest to lowest resolution within each block. Optional graph extensions (magic `psgh`) append coverage, telomere, gap, and other annotation tracks. The full specification is published as part of the OpenPretext repository (docs/PRETEXT\_FORMAT.md).

For large genomes, the full contact map at maximum resolution can exceed 1 GB as a dense array. OpenPretext uses a `coarsestOnly` loading mode that decodes only the smallest mipmap level per tile, assembling a downsampled overview texture (typically 1,024 x 1,024 pixels) for initial display. Full-resolution tiles are decoded on demand as the user zooms in.

## AutoSort algorithm

AutoSort is a Union Find-based contig ordering algorithm that chains contigs into chromosome groups using pairwise Hi-C link scores. The algorithm operates in three phases (Figure 3A).

**Phase 1: Link scoring.** For every pair of contigs (i, j), the algorithm computes link scores across four orientations representing the four possible ways two contig ends can be adjacent: head-head (HH), head-tail (HT), tail-head (TH), and tail-tail (TT). Each orientation score is computed by sampling anti-diagonal intensity bands near the relevant corner of the inter-contig contact block, comparing observed intensity against an expected baseline derived from the genome-wide intra-contig diagonal profile, and applying a 1/sqrt(d) distance weighting to emphasize near-diagonal signal. Contigs smaller than 4 pixels in the overview map are excluded to prevent noise-driven scores. The result is a ranked list of all inter-contig links with their best orientation.

**Phase 2: Greedy Union Find chaining.** Links are processed in descending score order. Each contig begins as a single-element chain. A link is accepted if both contigs are at endpoints (head or tail) of different chains and the score exceeds a data-adaptive threshold. When a link is accepted, the two chains are merged with the appropriate orientation: chains may be reversed and contig inversion states flipped to satisfy the orientation constraint. This greedy strategy produces chains that are locally optimal and, because links are processed by strength, captures the strongest chromosomal signals first.

**Phase 3: Hierarchical chain merging.** After the initial chaining, an agglomerative merging pass iteratively combines chains whose inter-chain affinity (the maximum link score between any pair of contigs across two chains) exceeds an adaptive threshold. A safety guard prevents merges where the inter-chain affinity is less than 50% of the average intra-chain score, suppressing cross-chromosome contamination. Merges are orientation-aware, using the best inter-chain link's orientation to correctly position and orient the merged chain. This phase was the single largest algorithmic improvement, increasing mean chain completeness from 0.770 to 0.951 (+23 percentage points).

## AutoCut algorithm

AutoCut detects misassembly breakpoints by analyzing diagonal Hi-C signal density within each contig (Figure 3B). For each contig, the algorithm computes the mean contact intensity along the main diagonal using a sliding window. It then identifies regions where the intensity drops below a local baseline (computed with a wider sliding window at 4x the analysis radius), marking positions where the relative drop exceeds a threshold of 0.30. Contiguous low-density regions narrower than half the window size are filtered out. Candidate breakpoints are placed at the midpoint of each remaining region.

To distinguish genuine misassemblies from centromeric regions (which also exhibit reduced diagonal signal), AutoCut performs off-diagonal verification. At each candidate breakpoint, the algorithm compares the off-diagonal Hi-C signal against the median off-diagonal signal sampled from reference positions within the same contig. Real misassemblies show reduced signal both on and off the diagonal, while centromeres maintain off-diagonal contacts. Candidates with an off-diagonal ratio above 0.3 are classified as centromeric and retained. A final confidence filter (threshold 0.5) and minimum fragment size constraint complete the pipeline.

## Curation engine

OpenPretext provides a complete curation engine supporting cut, join, invert, and move operations with full undo/redo. Each operation records sufficient data in the undo stack to reverse itself, enabling unlimited backward traversal of the curation history. Additional capabilities include scaffold (chromosome) assignment with a visual painting mode, named waypoint markers, contig exclusion for export filtering, and batch operations for selecting, cutting, joining, inverting, and sorting contigs by various criteria.

A domain-specific scripting language (DSL) with 18 commands enables programmatic curation workflows. All UI operations have script equivalents, and a replay system can reconstruct DSL scripts from operation logs for reproducibility. Export formats include AGP 2.1 (assembly scaffolding), BED6 (scaffold-aware genomic intervals), FASTA (with reverse complement for inverted contigs), PNG screenshots, and JSON session files.

## Education system

OpenPretext includes an integrated education system designed for both self-directed learning and classroom instruction (Figure 4). The system comprises six progressive tutorial lessons spanning beginner to advanced difficulty:

1. **Reading a Hi-C Contact Map** (beginner, 10 min) --- Introduction to contact map visualization, diagonal structure, and navigation using the bluehead wrasse genome.
2. **Understanding Chromosome Structure** (beginner, 15 min) --- Chromosome blocks, contig ordering, and color map options using the koala genome.
3. **Detecting Misassembly Patterns** (intermediate, 15 min) --- Visual identification of inversions (butterfly patterns), anti-diagonal signals, and translocations using the zebra finch genome.
4. **Cutting and Joining Contigs** (intermediate, 20 min) --- Hands-on practice with cut, join, and undo/redo operations using the king quail genome.
5. **Manual Scaffold Assignment** (intermediate, 20 min) --- Scaffold creation, contig-to-chromosome assignment, and drag-and-drop reordering using the Nile crocodile genome.
6. **Full Curation Exercise** (advanced, 30 min) --- Capstone exercise combining all skills with automated tools as a starting point, assessed via Kendall's tau comparison against ground truth using the zebra finch genome.

The teaching corpus comprises 10 specimens from GenomeArk with curated difficulty ratings, spanning mammals (koala, bat), birds (king quail, zebra finch), reptiles (Nile crocodile, blind snake), fish (bluehead wrasse, spinyfin), amphibians (spadefoot toad), and invertebrates (lancelet). A pattern gallery presents eight diagnostic Hi-C patterns (strong diagonal, chromosome block, inversion, translocation, microchromosomes, low coverage, unplaced contigs, and A/B compartments) with visual examples and descriptions linked to specific genomic regions in the teaching specimens.

The capstone lesson includes a self-assessment system that computes the Kendall's tau rank correlation between the student's contig ordering and the ground truth ordering, providing tiered feedback: excellent (tau >= 0.95), good (tau >= 0.85), and needs improvement (tau < 0.85).

# Results

## Benchmark corpus

We evaluated OpenPretext's automated curation algorithms on 34 specimens from the GenomeArk public repository, spanning 7 taxonomic groups: birds (5), mammals (6), reptiles (7), fish (6), amphibians (3), sharks and rays (4), and non-vertebrate chordates (3). Contig counts range from 34 (*Branchiostoma lanceolatum* haplotype 2) to 5,506 (*Diretmus argenteus*), encompassing the full range of assembly complexity encountered in practice. The corpus includes cartilaginous fish (sharks, ratfish, manta ray), lobe-finned fish (coelacanth), holostean fish (gars), marsupials (koala), xenarthrans (armadillo), hemichordates (acorn worm), and cephalochordates (lancelet), representing over 500 million years of genome architecture evolution (Table 1).

Each specimen was evaluated using a post-curation pipeline: the curated `.pretext` file serves as both input and ground truth source, with chromosome assignments extracted from GenomeArk naming conventions (e.g., `SUPER_N`, `chrN`). AutoCut is run first to detect breakpoints, followed by AutoSort on the post-cut state, with predictions compared against name-derived ground truth.

**Table 1. Benchmark corpus.** Thirty-four GenomeArk specimens spanning 7 taxonomic groups. Columns: species, common name, taxonomic group, contig count, Kendall's tau (ordering accuracy), orientation accuracy, AutoCut false positives (FP), and execution time. On curated assemblies, the expected number of breakpoints is zero; FP counts the number of incorrectly detected breakpoints.

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
| *Anilios waitii* | Interior blind snake | Reptile | 124 | 1.000 | 1.000 | 1 | 1.5s |
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
| *Carcharias taurus* | Sand tiger shark | Shark | 1,711 | 0.998 | 0.994 | 0 | 7.2s |
| *Squalus suckleyi* | Pacific spiny dogfish | Shark | 3,203 | 1.000 | 1.000 | 0 | 2.8s |
| *Hydrolagus colliei* | Spotted ratfish | Shark | 1,038 | 0.998 | 0.991 | 0 | 5.4s |
| *Mobula birostris* | Giant oceanic manta ray | Shark | 4,714 | 1.000 | 1.000 | 0 | 4.4s |
| *Balanoglossus misakiensis* | Acorn worm | Hemichordate | 135 | 0.969 | 0.933 | 0 | 3.7s |
| *Branchiostoma lanceolatum* (hap1) | European lancelet | Cephalochordate | 65 | 0.903 | 0.938 | 0 | 2.4s |
| *Branchiostoma lanceolatum* (hap2) | European lancelet | Cephalochordate | 34 | 1.000 | 1.000 | 0 | 2.4s |
| **Mean (n=34)** | | | | **0.988** | **0.974** | **0.12** | **3.8s** |

## AutoSort performance

AutoSort achieved a mean Kendall's tau of 0.988 across all 34 specimens, indicating near-perfect recovery of the ground truth contig ordering (Figure 2A). Twenty-two of 34 specimens (65%) achieved tau >= 0.99, and all 34 achieved tau >= 0.90. The algorithm performed consistently across all taxonomic groups: sharks and rays achieved the highest mean tau (0.999), followed by amphibians (1.000 for all three specimens with chromosomal assignments), mammals (0.998), fish (0.990), reptiles (0.983), and birds (0.980). Non-vertebrate chordates showed the lowest group mean (0.957), driven primarily by the European lancelet haplotype 1 (tau = 0.903), a compact 65-contig assembly at the boundary of the algorithm's low-contig threshold (Table 2).

Mean orientation accuracy was 0.974, with all specimens achieving >= 0.925. Mean chain purity was 0.996, indicating that chains almost never mix contigs from different chromosomes --- 33 of 34 specimens had purity >= 0.987. Mean chain completeness was 0.951, meaning that on average 95.1% of each true chromosome's contigs were captured in a single predicted chain.

The algorithm scales to large assemblies: the silver spinyfin (*Diretmus argenteus*; 5,506 contigs) achieved tau = 1.000 in 4.6 seconds, and the giant oceanic manta ray (*Mobula birostris*; 4,714 contigs) achieved tau = 1.000 in 4.4 seconds. Mean execution time across all specimens was 3.8 seconds (range: 1.5--7.2 seconds), measured on a standard development workstation.

**Table 2. AutoSort performance by taxonomic group.** Mean metrics across 7 groups.

| Group | n | Mean tau | Mean orient. | Mean purity | Mean compl. |
|-------|---|----------|--------------|-------------|-------------|
| Birds | 5 | 0.980 | 0.967 | 0.996 | 0.968 |
| Mammals | 6 | 0.998 | 0.987 | 0.999 | 0.937 |
| Reptiles | 7 | 0.983 | 0.962 | 0.995 | 0.956 |
| Fish | 6 | 0.990 | 0.977 | 0.997 | 0.956 |
| Amphibians | 3 | 1.000 | 0.996 | 0.999 | 0.925 |
| Sharks/Rays | 4 | 0.999 | 0.996 | 1.000 | 0.954 |
| Non-vertebrate chordates | 3 | 0.957 | 0.957 | 0.985 | 0.958 |

## AutoCut performance

AutoCut was evaluated on curated assemblies where zero breakpoints are expected; any detected breakpoint is therefore a false positive. Thirty-one of 34 specimens produced zero false positives. Three specimens produced a total of 4 false positives: the interior blind snake (*Anilios waitii*; 1 FP on 124 contigs), the alligator gar (*Atractosteus spatula*; 2 FPs on 356 contigs), and Couch's spadefoot toad (*Scaphiopus couchii*; 1 FP on 577 contigs). The mean false positive rate was 0.12 per specimen. These false positives may reflect genuine structural features --- such as heterochromatin, centromeric signal depletion, or segmental duplications --- that produce signal discontinuities resembling misassembly breakpoints. No new AutoCut failures were observed among the 13 specimens added in the most recent corpus expansion, confirming that the algorithm generalizes well across diverse genome architectures including sharks, non-vertebrate chordates, and additional reptile and mammal lineages.

## Algorithm development trajectory

The automated curation algorithms were developed iteratively through four benchmark versions, with each version expanding the test corpus and refining the algorithms based on observed failure modes (Table 3).

**Table 3. Algorithm improvement across benchmark versions.** Metrics tracked across four development iterations.

| Metric | v1 (n=4) | v2 (n=21) | v3 (n=21) | v4 (n=34) |
|--------|----------|-----------|-----------|-----------|
| Mean Kendall's tau | 0.878 | 0.919 | 0.990 | 0.988 |
| Mean orientation accuracy | 0.918 | 0.966 | 0.979 | 0.974 |
| Mean chain purity | 0.991 | 0.983 | 0.997 | 0.996 |
| Mean chain completeness | --- | 0.770 | 0.951 | 0.951 |
| Total AutoCut FPs | 37 | 4 | 4 | 4 |
| Worst tau | 0.758 | 0.190 | 0.939 | 0.903 |
| Taxonomic groups | 3 | 5 | 5 | 7 |

Key algorithmic improvements included: a chain reversal bug fix (v2, the single largest contributor to improved tau scores); hierarchical chain merging replacing simple small-chain merging (v3, increasing completeness from 0.770 to 0.951); adaptive AutoCut thresholds with local sliding-window baselines and off-diagonal centromere verification (v2, reducing false positives from 37 to 4). The v4 expansion from 21 to 34 specimens --- adding sharks, non-vertebrate chordates, and additional reptiles and mammals --- showed no degradation in aggregate metrics, demonstrating that the algorithms generalize without taxon-specific tuning.

## Education system

The tutorial curriculum follows a pedagogical progression modeled on Bloom's taxonomy: from knowledge acquisition (lessons 1--2, recognizing map features) through comprehension (lesson 3, interpreting misassembly patterns) to application and synthesis (lessons 4--6, performing and assessing curation). The total estimated instruction time is approximately 110 minutes across six lessons.

The teaching corpus deliberately spans three difficulty levels. Beginner specimens (bluehead wrasse, 52 contigs; koala, 1,235 contigs) have clean diagonal signals that reinforce pattern recognition. Intermediate specimens (king quail, zebra finch, Nile crocodile) introduce microchromosomes, inversions, and orientation challenges. Advanced specimens (spinyfin with 5,506 contigs; lancelet with tau = 0.903) expose students to algorithmic edge cases and the limits of automated curation. This progression ensures that students encounter increasingly complex genomes only after mastering the prerequisite skills.

The capstone lesson's self-assessment quantifies curation skill as Kendall's tau against ground truth. The three feedback tiers (excellent >= 0.95, good >= 0.85, needs improvement < 0.85) were calibrated against the AutoSort benchmark: a student achieving tau >= 0.95 matches or exceeds the algorithm's performance on challenging specimens such as the zebra finch (tau = 0.939), while a score below 0.85 indicates fundamental ordering errors that require further practice.

## Software validation

The OpenPretext codebase includes 1,418 unit tests and 22 end-to-end tests covering the parser, curation engine, scripting DSL, export formats, tile rendering, and all benchmark metrics. All tests pass on current versions of Chromium, Firefox, and WebKit. The benchmark pipeline itself is fully reproducible: specimen download, algorithm execution, and metric computation are automated via command-line scripts included in the repository (Supplementary Methods).

# Discussion

OpenPretext addresses several limitations of the current genome assembly curation ecosystem. Table 4 compares its capabilities with PretextView, the current standard tool.

**Table 4. Feature comparison between OpenPretext and PretextView.**

| Feature | OpenPretext | PretextView |
|---------|-------------|-------------|
| Platform | Any modern browser | Desktop (Windows, Linux, macOS) |
| Installation | None (URL) | Compilation or binary download |
| .pretext format support | Full (reverse-engineered) | Full (native) |
| Automated curation | AutoSort + AutoCut | None |
| Scripting | 18-command DSL | None |
| Annotation tracks | Embedded + BedGraph upload | Embedded only |
| Export formats | AGP, BED, FASTA, PNG, JSON | AGP |
| Undo/redo | Unlimited | Limited |
| Assembly statistics | N50/L50/N90/L90, live tracking | None |
| Education/tutorials | 6 lessons, pattern gallery | None |
| Comparison mode | Original vs. curated overlay | None |
| Batch operations | Select/cut/join/invert/sort | None |
| Source code | Open (MIT) | Open (MIT) |

## Relationship to automated scaffolding tools

OpenPretext's AutoSort algorithm occupies a distinct niche relative to existing automated Hi-C scaffolding tools. Tools such as SALSA2, 3D-DNA, and YaHS operate upstream in the assembly pipeline: they take raw Hi-C read alignments and produce new scaffolded assemblies [@Ghurye2019; @Dudchenko2017; @Zhou2023]. AutoSort instead operates on the contact map representation already present in `.pretext` files --- the same representation that human curators inspect visually. This means AutoSort does not require access to the original reads or alignments, and its results are presented as interactive curation operations that the user can accept, modify, or undo individually. Direct quantitative comparison between AutoSort and scaffolding tools is not straightforward because they solve different problems (reordering a visual contact map versus constructing scaffold sequences from read data), operate on different inputs, and produce different outputs. Nevertheless, the high ordering accuracy (mean tau 0.988) demonstrates that the contact map representation retains sufficient information for effective automated ordering even without access to raw read-level data.

This design reflects a philosophy of automation as assistance rather than replacement. Howe et al. showed that manual curation remains essential for reference-quality genomes because automated tools can mishandle complex structural features such as segmental duplications, collapsed repeats, and heterochromatic regions [@Howe2021]. OpenPretext preserves the curator's ability to override any automated decision while providing algorithmic suggestions that accelerate the most routine aspects of the workflow --- particularly the initial contig ordering and orientation, which are the most time-consuming steps in manual curation.

## Browser deployment and accessibility

The browser-native deployment model offers significant practical advantages for the genome curation community. Genome curation workshops and university courses can use OpenPretext without requiring participants to install software, manage dependencies, or configure build environments. This is particularly relevant for biodiversity genomics initiatives such as ERGA, which coordinate across dozens of institutions with heterogeneous computing environments [@ERGA2024]. The live demo at https://shandley.github.io/openpretext/ provides immediate access to a working curation environment with real genome data, enabling new curators to begin learning within seconds of accessing the URL.

The integrated education system addresses a training gap that has received little attention in the literature. While curation training is typically delivered through in-person workshops and informal mentorship, these approaches do not scale to the global community of curators needed for projects targeting thousands of species. The six-lesson tutorial system embedded in OpenPretext provides a self-paced alternative with real genomes, progressive difficulty, and quantitative self-assessment --- capabilities that have no equivalent in existing tools.

## Format documentation

The public documentation of the `.pretext` binary format (docs/PRETEXT\_FORMAT.md) is, to our knowledge, the first complete specification of this format outside of the PretextMap and PretextView source code. The format's use of BC4 (RGTC1) texture compression and raw deflate encoding --- details that are not obvious from casual inspection of the code --- presented the primary reverse-engineering challenge. Publishing this specification lowers the barrier for other developers to build tools in the `.pretext` ecosystem, which currently serves as the de facto standard for Hi-C contact map storage in genome assembly projects.

## Limitations

Several limitations should be noted. First, the benchmark evaluation uses curated assemblies as both input and ground truth source, because pre- and post-curation `.pretext` files use incompatible contig naming systems (e.g., `scaffold_1.H1` versus `SUPER_2`). This means our evaluation measures how well the algorithms recover a known ordering from a curated contact map, rather than measuring end-to-end curation performance from a pre-curation state. While this is a valid test of the algorithms' ability to interpret Hi-C signal, a true end-to-end evaluation would require either solving the cross-file contig mapping problem or establishing a benchmark corpus with matched naming across pre- and post-curation files.

Second, the European lancelet haplotype 1 (tau = 0.903) represents the algorithm's weakest performance. This 65-contig assembly has compact chromosomes that occupy few pixels in the contact map overview, reducing the signal available for link scoring. The algorithm includes a low-contig guard (returning trivial chains for assemblies with fewer than 60 contigs), and the lancelet's 65 contigs fall just above this threshold. Compact genomes with few, large contigs per chromosome may benefit from specialized handling or higher-resolution scoring.

Third, orientation accuracy (mean 0.974) is lower than ordering accuracy (mean 0.988), with several specimens below 0.94. Orientation is determined by comparing contact intensity at contig corners, which degrades when contigs span few pixels in the overview map. This is inherent to operating on a downsampled contact map rather than the full-resolution data.

Fourth, OpenPretext requires a WebGL2-capable browser, which excludes some older devices. However, WebGL2 is supported by all current versions of Chrome, Firefox, Safari, and Edge on both desktop and mobile platforms, covering the vast majority of users.

## Future directions

Future directions include integration of machine learning models for contact map pattern recognition, multi-user collaborative curation sessions with real-time synchronization, and streaming of `.pretext` files directly from cloud repositories such as GenomeArk. The scripting DSL and operation logging provide full reproducibility of curation sessions, and the publicly documented file format specification may facilitate development of additional tools in the `.pretext` ecosystem. The benchmark framework, with its 34-specimen corpus and standardized metrics, also provides a foundation for evaluating future curation algorithms from other groups.

# Conclusions

OpenPretext demonstrates that browser-based genome assembly curation can achieve high ordering accuracy (mean Kendall's tau 0.988) through signal-processing algorithms that generalize across taxonomically diverse genomes. Its zero-installation deployment, automated curation algorithms, scripting DSL, and integrated education system address key accessibility, throughput, and training barriers in the current curation ecosystem. As genome sequencing initiatives scale to encompass thousands of species, tools that lower the barrier to entry for genome curation while maintaining quality standards will be increasingly important.

# Availability and requirements

- **Project name:** OpenPretext
- **Project home page:** https://github.com/shandley/openpretext
- **Live demo:** https://shandley.github.io/openpretext/
- **Operating system(s):** Platform independent (browser-based)
- **Programming language:** TypeScript
- **Other requirements:** WebGL2-capable browser (Chrome, Firefox, Safari, Edge)
- **License:** MIT
- **Any restrictions to use by non-academics:** None
- **RRID:** (to be assigned)

# List of abbreviations

- **AGP:** A Golden Path (assembly format)
- **BC4:** Block Compression 4 (RGTC1 texture format)
- **BED:** Browser Extensible Data (genomic interval format)
- **DToL:** Darwin Tree of Life
- **DSL:** domain-specific language
- **EBP:** Earth BioGenome Project
- **ERGA:** European Reference Genome Atlas
- **FASTA:** text-based format for nucleotide sequences
- **Hi-C:** high-throughput chromosome conformation capture
- **LOD:** level of detail
- **LRU:** least recently used (cache eviction policy)
- **VGP:** Vertebrate Genomes Project
- **WebGL2:** Web Graphics Library version 2

# Declarations

## Ethics approval and consent to participate

Not applicable.

## Consent for publication

Not applicable.

## Availability of data and materials

All benchmark specimens are publicly available from GenomeArk (https://www.genomeark.org/) via the AWS Open Data program (s3://genomeark, --no-sign-request). The benchmark pipeline, results, and specimen download scripts are included in the OpenPretext repository at https://github.com/shandley/openpretext under the bench/ directory.

## Competing interests

The authors declare that they have no competing interests.

## Funding

(To be completed)

## Authors' contributions

SAH conceived the project, developed the software, designed and executed the benchmark evaluation, and wrote the manuscript.

## Acknowledgements

We thank the Wellcome Sanger Institute Tree of Life programme for developing the Pretext suite, GenomeArk and the Vertebrate Genomes Project for making curated genome assemblies publicly available, and the Darwin Tree of Life, Earth BioGenome Project, and genome curation communities for establishing the standards and practices that motivated this work.

# Figure legends

**Figure 1. OpenPretext application overview.** (A) Welcome screen showing the specimen picker with curated teaching genomes organized by difficulty level. (B) Contact map view of the koala (*Phascolarctos cinereus*) genome displaying a clean diagonal pattern with chromosome blocks visible along the diagonal. The sidebar shows the searchable contig list with assembly statistics. Six color maps are available (Red-White shown). (C) Edit mode with cut and join operations demonstrated on the king quail (*Coturnix chinensis*) genome. The contig grid overlay highlights individual contigs; selected contigs are indicated in the sidebar. (D) Tutorial overlay active during Lesson 3 (Detecting Misassembly Patterns) using the zebra finch (*Taeniopygia guttata*) genome, showing step instructions and progress indicator. All panels are screenshots from the live application at https://shandley.github.io/openpretext/.

**Figure 2. AutoSort and AutoCut benchmark performance across 34 genomes.** (A) Kendall's tau (ordering accuracy) by taxonomic group. Each point represents one specimen; horizontal lines show group means. All 34 specimens achieve tau >= 0.90; 22 of 34 achieve tau >= 0.99. (B) Orientation accuracy by taxonomic group, same layout. Mean 0.974; all specimens >= 0.925. (C) Execution time versus contig count. Points colored by taxonomic group. The largest specimen (silver spinyfin, 5,506 contigs) completes in 4.6 seconds. The relationship is sublinear, indicating efficient scaling. Data from bench/data/results.json.

**Figure 3. Algorithm design schematics.** (A) AutoSort: Union Find chaining pipeline. Left: pairwise link scoring across four orientations (HH, HT, TH, TT) using anti-diagonal intensity bands near inter-contig block corners. Center: greedy chaining by descending link score, with chain reversal and inversion to satisfy orientation constraints. Right: hierarchical chain merging with safety guard (inter-chain affinity must exceed 50% of intra-chain signal). (B) AutoCut: breakpoint detection pipeline. Left: diagonal signal density computation with sliding window along each contig. Center: local baseline comparison with adaptive threshold (drop > 0.30 relative to 4x-radius baseline). Right: off-diagonal verification distinguishing misassemblies (reduced off-diagonal signal) from centromeres (maintained off-diagonal signal). Candidate breakpoints passing confidence filter (> 0.50) are placed at the midpoint of each low-density region.

**Figure 4. Integrated education system.** (A) Lesson progression showing six tutorials spanning beginner to advanced difficulty, with estimated times, specimen assignments, and pedagogical objectives following Bloom's taxonomy (knowledge, comprehension, application, synthesis). (B) Pattern gallery showing four of eight diagnostic Hi-C patterns: strong diagonal (normal intra-chromosomal signal), inversion (butterfly pattern at a misoriented junction), microchromosomes (small blocks common in bird karyotypes), and A/B compartments (checkerboard pattern from chromatin organization). Each pattern links to a specific genomic region in a teaching specimen. (C) Assessment panel from the capstone lesson (Lesson 6) showing the Kendall's tau score card comparing the student's contig ordering against ground truth, with tiered feedback (excellent >= 0.95, good >= 0.85, needs improvement < 0.85).

# Additional files

**Supplementary Figure S1. Algorithm development trajectory.** Mean Kendall's tau, orientation accuracy, chain purity, and chain completeness across four benchmark versions (v1, n=4; v2, n=21; v3, n=21; v4, n=34). Key algorithmic changes annotated at each version transition. Generated from bench/data/results.json.

**Supplementary Table S1. Full benchmark results for all 34 specimens.** Complete per-specimen metrics including Kendall's tau, orientation accuracy, chain purity, chain completeness, macro- and micro-average chromosome completeness, AutoCut precision/recall/F1, and execution time. Corresponds to data in bench/REPORT.md.

**Supplementary Methods. Benchmark reproduction pipeline.** Step-by-step instructions for downloading specimens from GenomeArk, running the benchmark suite, and generating report tables. Includes specimen acquisition scripts, parameter configurations, and ground truth extraction logic.

# References

<!-- References will be generated from references.bib by pandoc-citeproc -->
