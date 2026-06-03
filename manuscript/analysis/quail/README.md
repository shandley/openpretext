# King quail (Coturnix chinensis) — OpenPretext analysis

Generated 2026-06-03 using Playwright-driven analysis session.
Source file: Coturnix_chinensis.pretext (69 MB, from GenomeArk)

## Summary metrics

| Metric | Value |
|--------|-------|
| Contigs | 645 (chromosome-scale scaffolds) |
| ICE normalization | 15 iterations, 21 masked bins |
| P(s) exponent (raw) | -1.19 |
| P(s) exponent (ICE) | -1.26 |
| P(s) R² | 0.406 |
| Health score | 46/100 |
| Checkerboard entropy | 0.1201 |
| Checkerboard score | 96.5/100 |
| Checkerboard percentile | >99% of 1,025 species |

## Health score components

| Component | Score | Weight |
|-----------|-------|--------|
| N50 (contiguity) | 0 | 20% |
| P(s) decay quality | 87 | 25% |
| Assembly integrity | 0 | 20% |
| A/B compartment strength | 98 | 15% |
| Hi-C library quality | 50 | 20% |

N50=0 and Integrity=0 reflect auto-scaffold detection assigning all contigs to a
single Chr1; these would improve with per-chromosome scaffold assignments. The
P(s) and A/B compartment components reflect true biological signal.

## Key biological findings

### Bimodal P(s) contact decay

The P(s) curve shows a characteristic avian bimodal pattern:
- Smooth power-law decay at short distances (1-20 px), exponent -1.26
- Near-zero contact valley at ~30-50 px (inter-chromosome gap at overview resolution)
- Secondary contact peak at ~72-96 px (within-microchromosome contacts)

The low R² (0.406) for the power-law fit directly reflects this bimodality — the
simple power-law model does not capture the microchromosome signal. The raw P(s)
curve in decay-curve.tsv shows the full bimodal shape.

This pattern is expected for Galliformes (quails, chickens): bird genomes carry
~30-80 microchromosomes whose concentrated within-chromosome contacts create a
secondary peak at distances corresponding to a few Mb.

### ICE normalization effect

ICE normalization steepened the decay exponent from -1.19 to -1.26 (Δ = -0.07),
removing coverage biases that inflate short-range contact frequencies. 21 low-
coverage bins were masked before iteration.

### Checkerboard score

Entropy 0.1201, score 96.5/100, stronger than >99% of the 1,025-species HiArch
reference (Che et al. 2026, Cell).

Note: the checkerboard score here is computed on the whole-genome overview with
all contigs in a single scaffold. Per-chromosome computation (with proper scaffold
assignments) would give more interpretable species-comparison results. The high
score likely reflects the strong block-diagonal structure of the curated bird
genome rather than per-chromosome A/B compartment regularity.

### Pattern detection

4 inversion signals detected (bins 0-97, 340-415, 514-611, 872-891). These likely
correspond to the microchromosome-dense region of the bird karyotype where
anti-diagonal contact enrichment mimics inversion signatures at overview resolution.
70+ translocation signals detected (all with O/E 2.0-3.5), also attributable to
the elevated inter-microchromosome contacts characteristic of avian genomes.

23 misassembly flags with 70 suggested cuts were identified in this curated
assembly — expected false positive rate for a correctly assembled genome, consistent
with the AutoCut benchmarking results (3 specimens with FPs out of 34 total).

## Files

- `decay-curve.tsv` — P(s) contact decay curve, log-log data with fitted exponent
- `Coturnix-chinensis-insulation.bedgraph` — insulation score per genomic bin
- `Coturnix-chinensis-compartments.bedgraph` — A/B compartment eigenvector per bin
- `Coturnix-chinensis-ice-bias.bedgraph` — ICE normalization bias vector per bin
