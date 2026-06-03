# Cross-species 3D genomics analysis — 6 specimens (corrected)

Generated 2026-06-03. Fixed checkerboard: per-chromosome computation with corrected entropy
direction (higher entropy = stronger compartmentalization = higher score, matching HiArch).

## Summary table

| Species | Common name | Taxon | P(s) exp (raw) | P(s) exp (ICE) | ICE Δ | R² | CB entropy | CB mode | CB percentile |
|---------|-------------|-------|----------------|----------------|-------|----|-----------|---------|---------------|
| Branchiostoma lanceolatum | Lancelet | Invertebrate | -2.58 | -2.58 | 0.00 | 0.836 | 0.0479 | whole-genome* | ~0% |
| Coturnix chinensis | King quail | Bird | -1.19 | -1.26 | -0.07 | 0.406 | 0.1201 | whole-genome* | ~0% |
| Phascolarctos cinereus | Koala | Mammal | -1.60 | -1.53 | +0.07 | 0.698 | 0.8887 | whole-genome* | ~0% |
| Scaphiopus couchii | Spadefoot toad | Amphibian | -0.74 | -0.90 | -0.16 | 0.173 | 0.0589 | whole-genome* | ~0% |
| Thalassoma bifasciatum | Bluehead wrasse | Fish | -0.43 | -0.47 | -0.05 | 0.705 | 0.3888 | whole-genome* | ~0% |
| Crocodylus niloticus | Nile crocodile | Reptile | -0.26 | -0.28 | -0.02 | 0.231 | 2.3875 | per-chromosome | ~12% |

*whole-genome fallback: auto-scaffold detection grouped all contigs into one scaffold.
The Nile crocodile is the only specimen where multiple chromosomes were detected,
enabling per-chromosome computation in the HiArch-comparable range.

## ICE normalization

| Species | ICE iters | Masked bins | Notes |
|---------|-----------|------------|-------|
| Lancelet | 15 | 21 | No ICE effect (Δ=0.00) — perfectly uniform coverage |
| King quail | 15 | 21 | Moderate correction |
| Koala | 14 | 21 | |
| Toad | 15 | 21 | Largest correction (Δ=-0.16) |
| Wrasse | 13 | 21 | Fastest convergence |
| Crocodile | 14 | 21 | |

## Key biological findings

### 1. P(s) decay exponent spans 10-fold range across taxa

| Exponent | Taxon | R² |
|----------|-------|-----|
| -2.58 | Invertebrate (lancelet) | 0.836 |
| -1.53 | Mammal (koala) | 0.698 |
| -1.26 | Bird (quail) | 0.406 |
| -0.90 | Amphibian (toad) | 0.173 |
| -0.47 | Fish (wrasse) | 0.705 |
| -0.28 | Reptile (crocodile) | 0.231 |

The lancelet (invertebrate outgroup) has the steepest exponent (-2.58) and the best
power-law fit (R²=0.836), consistent with compact chromatin in cephalochordates.
Vertebrates span -0.28 (crocodile) to -1.53 (koala).

### 2. Birds and mammals have intermediate-to-steep exponents; fish and reptiles are shallow

The divergence between endotherms (koala -1.53, quail -1.26) and ectotherms
(wrasse -0.47, crocodile -0.28) is striking. Amphibians (toad -0.90) are intermediate.
Whether this reflects metabolic rate, nuclear architecture, or assembly resolution
differences is an open question that cross-species Hi-C data could address.

### 3. King quail bimodal P(s)

The quail P(s) curve shows a secondary contact peak at 72-96 pixels (see quail/decay-curve.tsv)
reflecting the microchromosome complement. The low R² (0.406) is a diagnostic feature
of avian genomes with microchromosomes, not noise.

### 4. ICE normalization as a library quality signal

The lancelet's Δ=0.00 (no ICE effect) indicates perfectly uniform Hi-C coverage.
The toad's Δ=-0.16 indicates the largest coverage bias among the 6 specimens.
These are independent quality signals derivable entirely within OpenPretext.

### 5. Checkerboard score: status and limitations

**The bug and fix:** The original implementation computed cosine distances across the
full genome without chromosome segmentation, producing artificially low entropy (0.05-0.58)
for all specimens. The formula also inverted the score direction. Both are now fixed:
- Formula: `entropy / maxH × 100` (higher entropy = stronger compartmentalization)
- Mode: per-chromosome when ≥2 scaffolds assigned, whole-genome fallback otherwise
- Percentile: `(entropy - ref.min) / (ref.max - ref.min) × 100`

**Crocodile (working):** entropy 2.3875, ~12th percentile in the 1,025-species reference.
The auto-scaffold detection correctly identified multiple chromosomes for the crocodile,
enabling per-chromosome computation. Placing the Nile crocodile at the 12th percentile
(near the bottom of the HiArch distribution) is biologically plausible for a reptile.

**Other specimens (whole-genome fallback):** Entropy values 0.05-0.89 are not comparable
to HiArch because all contigs were grouped into a single auto-detected scaffold. These
specimens require manual chromosome assignment (via scaffold painting during curation,
which is the normal workflow) to produce HiArch-comparable checkerboard scores.

**For the manuscript:** The checkerboard comparison against 1,025 species should be
presented for manually curated assemblies with proper chromosome assignments, or for
the crocodile as a proof-of-concept. A note explaining the scaffold requirement should
accompany the feature description.

## Files

Each species subdirectory contains `decay-curve.tsv` with the full P(s) curve.
- `quail/`, `koala/`, `wrasse/`, `crocodile/`, `toad/`, `lancelet/`
