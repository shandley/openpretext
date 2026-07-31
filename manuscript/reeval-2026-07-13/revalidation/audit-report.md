# Blind re-validation of cross-species P(s) decay fits

Date: 2026-07-13
Scope: independent recomputation and confound audit of 18 per-species Hi-C
contact-probability decay curves (`<species>/decay-curve.tsv`).
Method: read only the raw TSV curves. No prior report, findings file, or
conclusion was consulted. All 18 species treated symmetrically; no species pair
was singled out.

Scripts and outputs: `revalidate.py`, `revalidation-table.csv` (this directory).
Environment: Python via uv (numpy, scipy).

## What the data actually are

Each curve has four columns (distance, mean_contacts, log10_distance,
log10_contacts). The distance axis is integer pixels of a coarse overview
contact map, running 1, 2, 3, ... up to a per-species maximum. That maximum
(the "n_points" below) is the diagonal pixel extent of that species' overview
map, and it ranges from 15 (xenopus) to 170 (tortoise). It is a property of how
the genome was binned into the overview, not a biological quantity. This is the
central methodological variable in what follows.

## 1. Reproduction

Recomputing the OLS fit of log10_contacts on log10_distance over all points
(1..n) reproduces the header values essentially exactly for every species:

- max absolute difference in decay exponent: 0.00005
- max absolute difference in R-squared: 0.00007

So the precomputed header exponents and R-squared values are a plain OLS fit
over the full available pixel range, with no hidden sub-range or weighting.
Full per-species numbers are in `revalidation-table.csv`.

Recomputed values (exponent, R-squared, n_points):

| species | n | exponent | R2 |
|---|---|---|---|
| armadillo | 56 | -0.660 | 0.814 |
| bat | 87 | -1.138 | 0.665 |
| coelacanth | 54 | -0.801 | 0.824 |
| crocodile | 105 | -0.281 | 0.231 |
| finch | 145 | -0.585 | 0.485 |
| frog | 165 | -0.321 | 0.179 |
| gharial | 103 | -0.596 | 0.778 |
| koala | 166 | -1.529 | 0.698 |
| lancelet | 31 | -2.582 | 0.836 |
| quail | 46 | -1.265 | 0.406 |
| shark | 44 | -1.480 | 0.834 |
| stubfoot | 159 | -0.195 | 0.364 |
| toad | 73 | -0.895 | 0.173 |
| tortoise | 170 | -0.361 | 0.467 |
| turtle | 158 | -0.541 | 0.221 |
| whiptail | 89 | -1.086 | 0.316 |
| wrasse | 25 | -0.474 | 0.705 |
| xenopus | 15 | -0.459 | 0.679 |

## 2. Robustness of each fit

For every species I refit under four variations: drop the first 3 pixel bins,
drop the first 5 pixel bins, restrict to the window common to all species
(1..15 px, capped by the shortest curve, xenopus), and log-spaced binning over
distance (15 bins) so that the many long-range points do not swamp the fit.

The per-species R-squared moves enormously across these variants. The spread
(max minus min R-squared over the five fit definitions) per species:

- smallest spread: shark 0.083, coelacanth 0.087, lancelet 0.132
- largest spread: toad 0.938, whiptail 0.721, crocodile 0.675, frog 0.643,
  stubfoot 0.641, turtle 0.616, quail 0.614

Ten of eighteen species swing by more than 0.30 in R-squared depending purely on
which pixel range and binning you choose. Several species that look like a poor
power-law fit over the full range (toad 0.17, crocodile 0.23, turtle 0.22, frog
0.18) become good-to-excellent fits (0.74 to 0.98) once the fit is restricted to
short range. The exponent is similarly unstable: for example crocodile moves
from -0.28 (full) to a steeper short-range slope, and armadillo from -0.66 to
-0.34 in the common window. A single reported R-squared or exponent per species
is therefore not a stable property of that species; it is a property of the
chosen fit range on that species' particular pixel grid.

## 3. Confound structure

### 3a. Fit quality is tied to point count

Across the 18 species, R-squared over the full range is negatively correlated
with n_points:

- R2(full) vs n_points: Pearson r = -0.518 (p = 0.028), Spearman rho = -0.517
  (p = 0.028)

More available pixels means a lower R-squared. The mechanism is direct. A short
curve (few pixels) only samples the steep near-diagonal decay, which is close to
a straight line in log-log. A long curve extends out into the flat, noisy
long-range plateau, where a single power law fits badly, so R-squared drops. The
exponent shows the same directional pull (signed exponent vs n_points Pearson r
= +0.380, p = 0.12): longer curves are dragged toward shallower (less negative)
slopes as the flat tail is included. This trend is not significant on its own but
is consistent with the same mechanism.

A linear regression of R-squared on n_points has its own R-squared of only 0.27,
so point count does not explain all of the cross-species spread by itself.
Ordering all 18 by their residual from that regression (symmetrically, no
species highlighted): toad, crocodile, quail, whiptail, frog, turtle sit below
the line; koala, gharial, coelacanth, armadillo, shark, lancelet sit above it.
That residual structure is not stable under the fit-range control in 3c: the
rank order of species by R-squared over the full range does not carry over to a
matched short window (Spearman rank correlation between full-range and
common-window R-squared is 0.33, p = 0.19, not significant). For example the
worst full-range fit (toad, 0.17) becomes the best common-window fit (0.98). So
the residual ordering is not a fixed per-species property.

### 3b. Pixel axis versus base-pair axis

It is tempting to say the exponents and R-squared values are not comparable
across species because the x-axis is pixels rather than base pairs, and
base-pairs-per-pixel differs by genome size. That specific argument is
mathematically wrong and should not be made. If base-pairs-per-pixel is a
constant c for a species, then log(distance_bp) = log(distance_px) + log(c),
which is an additive shift of the log-x axis. Both the OLS slope and the Pearson
R-squared are invariant to an additive shift (and to any affine rescaling) of x.
So converting pixels to base pairs would not change any exponent or any
R-squared reported here.

The non-comparability is real, but for two different reasons:

1. Different species sample a different genomic distance range. Because both
   base-pairs-per-pixel and the maximum pixel extent differ, each species' curve
   covers a different span of true genomic separation and lands on a different
   portion of a decay that is not a single power law. Comparing a slope fit over
   one span to a slope fit over a different span compares different things.
2. Different point counts and effective bin widths drive R-squared mechanically,
   as shown in 3a and 3c.

### 3c. The spread collapses under a common fit window

This is the decisive test. Refitting every species over the identical window
1..15 px (the widest window all 18 share) does two things:

- The cross-species R-squared spread collapses. Full-range R-squared has
  standard deviation 0.241 and ranges 0.173 to 0.836. In the common window the
  standard deviation falls to 0.101 and the range compresses to 0.679 to 0.995.
  The species that looked like poor fits over their full range are the ones that
  jump up the most.
- The correlation between R-squared and n_points disappears: from Pearson
  r = -0.518 (p = 0.028) over the full range to r = -0.179 (p = 0.48) in the
  common window. Once every species is fit over the same short window, the
  point-count relationship is gone, which is what you expect if that
  relationship was an artifact of unequal fit ranges.

Log-spaced binning tells the same story: R-squared standard deviation falls to
0.099 (range 0.550 to 0.891). Rebalancing away from the over-sampled flat tail
also compresses the between-species differences.

The exponent spread also shrinks under the common window (standard deviation
0.578 to 0.299), for the same reason.

To check that this is not just an artifact of a very short 15-point fit, I also
refit the 13 species with n_points of at least 50 over a wider common window of
1..50 px. The same compression holds: R-squared standard deviation for these 13
falls from 0.241 over their full ranges to 0.086 over the shared 1..50 window
(range 0.662 to 0.971). Matching the fit window compresses the between-species
spread whether the window is 15 or 50 pixels wide.

### 3d. Genome size correlation: not run

The species dirs carry binomial names in filenames but no assembly accession,
and the specific assembly used to generate each overview map is not identified
in the data. Per the no-fabricated-identifiers rule, I did not map common or
binomial names to genome sizes from memory, and I did not run an
R-squared-versus-genome-size correlation on unverified sizes. n_points is in any
case a direct, in-data proxy for map resolution and already carries the
confound test in 3a and 3c, so nothing is lost by skipping the genome-size
correlation. If this test is wanted later, each assembly would need to be pinned
to a specific accession and its size fetched and cited from NCBI or GenomeArk
first.

## 4. Blind verdict

The cross-species variation in R-squared, and to a large extent in the decay
exponent, is plausibly and largely explained by methodological artifacts rather
than by biology. The evidence:

- The header values reproduce exactly, so this is not a fit-implementation
  question; the reported numbers are exactly what a full-range OLS gives.
- R-squared is significantly, negatively correlated with the number of pixel
  bins available per species (r about -0.52), with a clear and expected
  mechanism (longer curves reach into the flat, noisy long-range regime where a
  single power law fits poorly).
- Fixing the fit window across all species collapses the R-squared spread by
  more than half and erases the point-count correlation. The apparent
  differences are substantially a function of how far out each species' overview
  map extends and how the linear pixel sampling weights the tail, not of the
  contact decay itself.
- Every per-species R-squared and exponent is highly sensitive to fit-range and
  binning choices (R-squared swings of 0.3 to 0.9 for many species), so no
  single reported value is a stable per-species property.

What cannot be concluded from these data. These are coarse overview maps, on the
order of tens to a couple hundred pixels along the diagonal, with one pixel
spanning a large and species-dependent number of base pairs. At that resolution
you cannot establish a genuine, biologically meaningful power-law exponent or a
per-species goodness-of-fit for P(s), and you cannot rank species by P(s)
behavior. Any cross-species P(s) claim (exponent differences, R-squared
differences, one taxon decaying more cleanly than another) is not supportable
from this pixel-domain overview data. Residual between-species structure remains
after the point-count regression, but the n_points correlation and most of the
spread vanish under a matched fit window, the full-range R-squared rank order
does not carry into that window, and the smaller residual spread that remains at
15 to 50 pixel resolution is indistinguishable from short-fit noise and cannot
be attributed to biology. Demonstrating real
biology in contact-probability decay would require full-resolution,
base-pair-binned P(s) curves computed over matched genomic distance ranges with
matched binning, ideally with per-species replicate or bootstrap uncertainty on
the exponent, not a single OLS line through a short vector of overview pixels.
