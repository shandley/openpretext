# What the values in a .pretext file are, and what that means for the analyses

19 November 2026

## What was found

While looking into why colours change between zoom levels, the source of
PretextMap (the program that writes `.pretext` files) was read, at commit
`b4166f6` of sanger-tol/PretextMap. Before it writes each zoom level it runs
`ContrastEqualisation`, which:

1. scales rows and columns repeatedly until every row has the same maximum;
2. compresses each value, close to a square root;
3. stretches the result to 1 to 255;
4. equalises the histogram.

Each zoom level is treated separately. So a `.pretext` file holds an image
prepared for looking at. Within one level a brighter cell had more contact
than a darker one, more or less. The values are not contact counts, and
ratios, sums and slopes of them are not the Hi-C quantities of the same name.

Every analysis in OpenPretext reads these values. All of them except
`contacts` read one level, the coarsest (the "overview", usually 1024 cells
across), so they do not mix levels.

## What this means for each analysis

| Analysis | What it reads | What still holds | What does not |
|---|---|---|---|
| The map itself | Stored value at the level on screen | Which cells are brighter, within one level | Comparing brightness between zoom levels |
| P(s) contact decay | Mean value by distance from the diagonal | That contact falls with distance; a change after an edit on one map | The slope as a physical exponent; the "healthy" band of -1.0 to -1.5 |
| Health score (since removed) | 25% of it was how close the P(s) slope is to -1.15 | The other parts that do not use map values (contig N50) | The decay part; the library part (see below) |
| Insulation and TAD boundaries | Mean of the values in a window across each position | Where the minima are | The size of a score compared with published insulation scores |
| Directionality index | Sums of values up and down the diagonal | The sign and where it flips | The magnitude |
| A/B compartments | Each cell over the mean at its distance, then the first eigenvector | The checkerboard pattern and the sign of the eigenvector | Compartment strength as a number |
| ICE and Sinkhorn-Knopp balancing | Balances row sums of the stored values | It runs and evens out row sums | "Corrects biases in the contact counts": PretextMap has already row-scaled and then compressed the values, so this balances an image |
| Library quality (cis/trans, short/long) | Sums of stored values inside and between scaffolds | A rough comparison of one map before and after | A cis fraction of read pairs; compressing the values tends to raise the weak between-chromosome ones relative to the strong ones |
| Observed/expected view | Each overview cell over the mean at its distance | Brighter or darker than usual for that distance | The ratio as an enrichment of contacts |
| Misassembly, haplotig and join-support flags | Patterns in the values above | They look for relative patterns, which survive | Fixed thresholds were tuned on these values, so they hold only for `.pretext` input |
| Checkerboard score | Entropy of how alike the rows of each chromosome are | A change after an edit on one map | The comparison with the paper's 1,025 species, and the good/poor colouring (see below) |
| Centromere candidates | Where each large sequence contacts other sequences most | A position to look at | A centromere call: not checked against any map with known centromeres |
| `contacts` | Mean of a box at a detail level over the same between true neighbours | A ranking of candidate neighbours | A ratio of contacts; short pieces tie near 1 because values by the diagonal are at the top of the scale |

## The P(s) slope, measured

`decay-by-level.ts` fits the slope the way the app does, at the level the
app uses and at two finer levels of the same file (`decay-by-level.txt`).

- At the app's level the slope on nine real maps runs from -0.65 to -1.90.
- For one file it moves by up to 1.1 between levels: the koala gives -1.60
  at the app's level and -0.46 two levels finer. Part of that is the
  contrast step and part is that the fit covers a shorter stretch of genome
  at a finer level; this run does not separate the two.
- The curated king quail in the specimen catalog (`Coturnix_chinensis_post`)
  gives -1.90. The health score's decay part scores that 12 out of 100.
- R-squared is between 0.57 and 0.83 at the app's level, so a straight line
  fits none of them well.

This agrees with the retraction recorded in July 2026: the cross-species
P(s) result did not survive re-checking.

## The checkerboard score, measured

Added after the first version of this report, which left it out.

The score follows a method published for contact matrices, and the app
compared its entropy with the range that paper reports for 1,025 species
(2.3 to 3.0): "nearest species", "similar group" and "stronger than N% of
species". `checkerboard-by-level.ts` computes the entropy per chromosome with
the app's function, taking each sequence at least 2% of the map wide as a
chromosome (`checkerboard-by-level.txt`). The app itself uses painted
scaffolds, or the whole map when there are none, which its own comment says
gives lower values still.

- On six real maps it is between 0.96 and 1.70. Every one is below the
  lowest value in the paper's range.
- So the app's comparison gave the same answer for any map: the species
  with the lowest entropy as the nearest, and "stronger than 0%".
- The "percentile" was a straight-line position between the range's two
  ends, not a share of species.
- The blind snake's entropy is 0.96 at the app's level and 1.77 one level
  finer.
- The reference file described its scores with the opposite sign to the
  code.

The comparison, its reference file and the colouring are removed. The entropy
is still shown, uncoloured, with a note that it is for before-and-after use.

The centromere detector comes from the same paper. Its output is a position,
so it does not depend on the size of the values in the same way, but nothing
here has checked its calls against known centromeres. It is now labelled as
finding candidates.

## What was changed first (wording only)

- `docs/PRETEXT_FORMAT.md`: the four steps above, and what follows from them.
- `README.md`, the guide's analysis page and glossary, lesson 7's P(s) step,
  the caption under the P(s) chart in the app, and the header of
  `ContactDecay.ts`: each now says the values are contrast-adjusted and that
  the slope is for before-and-after comparison on one map.
- `contacts`: its help text, heading, module comment, changelog entry and
  report now say the score is a ratio of brightness.

No calculation was changed.

## What was decided and done afterwards (19 November 2026)

1. **The "healthy" P(s) band is removed** from the chart, the local-slope
   panel, the guide and the lessons.
2. **The health score is removed**: the card, the number in the stats strip,
   the module and its tests.
3. **ICE and Sinkhorn-Knopp balancing are kept and relabelled** "Balance
   rows", with tracks named "row factors". The calculation is unchanged.
4. **Lesson 7 is rewritten** around what the numbers are computed from.
   Lessons 9, 10, 11 and 13 and the analysis-guided AI prompt were corrected
   where they referred to the score or to a healthy slope.

Still as before:

- The library quality readout (cis/trans and the per-contig cis ratio) and
  the compartment strength readouts are shown with their old names.
- Centromere candidates are not validated. That needs maps of species with
  known centromere positions.
- The other lessons, the pattern gallery and the AI prompt text use "contact
  frequency" loosely (brighter means more contact). That is true enough and
  was left alone.
- The guide (`guide/`) is deployed separately on Vercel. The edits are in the
  repository and are not deployed.

## What this does not affect

Curation and export. Cuts, joins, moves, inversions, painting and the AGP,
FASTA and BED exports work on texel positions and sequence coordinates, and
do not read map values. PretextView shows the same adjusted values, so a
curator sees in OpenPretext what they would see there.
