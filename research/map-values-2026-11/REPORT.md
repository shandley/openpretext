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
| Health score | 25% of it is how close the P(s) slope is to -1.15 | The other parts that do not use map values (contig N50) | The decay part; the library part (see below) |
| Insulation and TAD boundaries | Mean of the values in a window across each position | Where the minima are | The size of a score compared with published insulation scores |
| Directionality index | Sums of values up and down the diagonal | The sign and where it flips | The magnitude |
| A/B compartments | Each cell over the mean at its distance, then the first eigenvector | The checkerboard pattern and the sign of the eigenvector | Compartment strength as a number |
| ICE and Sinkhorn-Knopp balancing | Balances row sums of the stored values | It runs and evens out row sums | "Corrects biases in the contact counts": PretextMap has already row-scaled and then compressed the values, so this balances an image |
| Library quality (cis/trans, short/long) | Sums of stored values inside and between scaffolds | A rough comparison of one map before and after | A cis fraction of read pairs; compressing the values tends to raise the weak between-chromosome ones relative to the strong ones |
| Observed/expected view | Each overview cell over the mean at its distance | Brighter or darker than usual for that distance | The ratio as an enrichment of contacts |
| Misassembly, haplotig and join-support flags | Patterns in the values above | They look for relative patterns, which survive | Fixed thresholds were tuned on these values, so they hold only for `.pretext` input |
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

## What was changed now (wording only)

- `docs/PRETEXT_FORMAT.md`: the four steps above, and what follows from them.
- `README.md`, the guide's analysis page and glossary, lesson 7's P(s) step,
  the caption under the P(s) chart in the app, and the header of
  `ContactDecay.ts`: each now says the values are contrast-adjusted and that
  the slope is for before-and-after comparison on one map.
- `contacts`: its help text, heading, module comment, changelog entry and
  report now say the score is a ratio of brightness.

No calculation was changed.

## What is not changed and needs a decision

1. **The "healthy" P(s) band** is still drawn on the chart and still named in
   the guide and lesson 7, now with a caveat beside it. On this evidence it
   should go.
2. **The health score** still gives 25% to the P(s) slope and 20% to the
   library ratio. Lesson 7 calls the score "your compass". It was already a
   candidate for removal.
3. **ICE and Sinkhorn-Knopp balancing** are still offered as bias correction.
   Lesson 7 teaches ICE that way.
4. **Lesson 7 as a whole** teaches these numbers as measurements. It needs a
   rewrite or removal once 1 to 3 are decided.
5. **The other lessons, the pattern gallery and the AI prompt text** use
   "contact frequency" loosely (brighter means more contact). That is true
   enough and was left alone.
6. **The guide** (`guide/`) is deployed separately on Vercel. The edits here
   are in the repository and are not deployed.

## What this does not affect

Curation and export. Cuts, joins, moves, inversions, painting and the AGP,
FASTA and BED exports work on texel positions and sequence coordinates, and
do not read map values. PretextView shows the same adjusted values, so a
curator sees in OpenPretext what they would see there.
