# N=13 cross-species analysis — complete dataset

Generated 2026-06-04. 13 chordate specimens across 8 taxonomic groups spanning 500+ Myr.

## Complete dataset

| Species | Common name | Taxon | P(s) exp | R² | TADs | Mean ins |
|---------|-------------|-------|----------|-----|------|----------|
| B. lanceolatum | Lancelet | Cephalochordate | -2.58 | 0.836 | 57 | 0.133 |
| C. taurus | Sand tiger shark | Chondrichthyes | -1.48 | 0.834 | 35 | 0.222 |
| P. cinereus | Koala | Mammalia | -1.53 | 0.698 | 8 | 0.430 |
| C. chinensis | King quail | Aves | -1.26 | 0.406 | 39 | 0.173 |
| A. lituratus | Great fruit-eating bat | Mammalia | -1.14 | 0.665 | 20 | 0.165 |
| A. tigris | Tiger whiptail | Reptilia | -1.09 | 0.316 | 21 | 0.312 |
| S. couchii | Couch's spadefoot toad | Amphibia | -0.90 | 0.173 | 26 | 0.090 |
| L. chalumnae | Coelacanth | Actinistia | -0.80 | 0.824 | 72 | 0.199 |
| D. novemcinctus | Nine-banded armadillo | Mammalia | -0.66 | 0.814 | 57 | 0.185 |
| T. guttata | Zebra finch | Aves | -0.59 | 0.485 | 18 | 0.554 |
| T. bifasciatum | Bluehead wrasse | Actinopterygii | -0.47 | 0.705 | 40 | 0.189 |
| E. marnockii | Cliff chirping frog | Amphibia | -0.32 | 0.179 | 15 | 0.510 |
| C. niloticus | Nile crocodile | Reptilia | -0.28 | 0.231 | 16 | 0.508 |

## The real finding: R² quality separates taxonomic groups

Mean P(s) power-law R² by taxonomic group (ranked):

| Group | Mean R² | n | Interpretation |
|-------|---------|---|----------------|
| Cephalochordate | 0.836 | 1 | Cleanest — compact ancestral chromatin |
| Chondrichthyes | 0.834 | 1 | Cartilaginous fish: clean |
| Actinistia | 0.824 | 1 | Lobe-finned fish: clean |
| Mammalia | 0.726 | 3 | Consistently clean |
| Actinopterygii | 0.705 | 1 | Teleost fish: clean |
| Aves | 0.446 | 2 | Intermediate — microchromosome effect |
| Reptilia | 0.274 | 2 | Irregular — non-power-law decay |
| Amphibia | 0.176 | 2 | Most irregular — lowest R² of all groups |

The P(s) R² quality metric cleanly separates tetrapod groups:
- **Clean (R²>0.6)**: all fish, all mammals, shark, lancelet
- **Moderate (R²=0.4-0.6)**: birds (microchromosome effect)
- **Irregular (R²<0.4)**: reptiles + amphibians (all 4 specimens)

## What the amniote hypothesis looked like and why it failed

At N=6, koala and crocodile (both amniotes with 16 large chromosomes) showed high
insulation (>0.3), while wrasse, toad, lancelet showed low insulation. This looked
like an amniote signal.

At N=13:
- Frog (*E. marnockii*, non-amniote) has insulation 0.510 — same as crocodile
- Bat and armadillo (both amniotes) have low insulation (0.165, 0.185)
- The insulation pattern is driven by file-to-file variation and chromosome
  structure at overview resolution, not phylogenetic position

**Conclusion**: the insulation score at overview resolution is not a reliable
cross-species metric. The P(s) R² quality metric is more robust.

## Biological interpretation

Amphibians and reptiles consistently deviate from power-law P(s) contact decay
(R²<0.4). Birds are intermediate (R²~0.45), consistent with their evolutionary
derivation from archosaur reptiles but modified by endothermy and genome
streamlining. Mammals, fish, sharks, and the invertebrate outgroup all show
clean power-law decay (R²>0.6).

This may reflect:
- Ectothermic tetrapods (reptiles, amphibians) having more complex heterochromatin
  organization that creates non-power-law contact patterns
- Birds retaining some reptilian chromatin characteristics but modified by
  microchromosome compartmentalization
- The ancestral chordate state (lancelet, sharks, fish) showing the cleanest
  power-law decay

## What the amniote insulation story WAS based on (N=6 limitation)

The original observation that koala (mammal, 16 chr) and crocodile (reptile, 16 chr)
had high insulation (>0.3) while other specimens did not was driven by chromosome
SIZE at overview resolution: both had large chromosomes (~64 px each) enabling
detection of intra-chromosomal insulation structure. With more specimens, the
pattern breaks because other factors (file version, normalization, genome repeat
content) confound cross-specimen insulation comparisons.
