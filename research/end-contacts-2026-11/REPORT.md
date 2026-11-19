# Can contact scores find rearrangements inside a chromosome?

14 November 2026

## Why this was looked at

In the second blind curation (`research/blind-curation-2026-11/REPORT.md`)
every miss was an inversion or reorder inside a chromosome. Three of the four
were seen on the map and dismissed. The question here was whether OpenPretext
could compute something from the map that would have prevented that.

## What was tried

Two measures, both read from the map file's detail tiles and both expressed
relative to the contact between neighbouring stretches of unbroken sequence on
the same map (1.00 = like true neighbours, 0 = like distant sequence).

Note added 19 November 2026: "contact" in this report means the value stored
in the map file. Those values are contrast-adjusted by PretextMap and are not
contact counts, so the scores are ratios of brightness. See the section added
at the end.

1. **End contact.** The mean contact between a window at one contig end and a
   window at another. If two ends belong together the score is near 1. Ranking
   all other ends against one end says what the map puts next to it.
2. **Continuity.** The same measure between the windows either side of each
   position along a sequence. A fall marks a place where the two sides are not
   neighbours.

The code is `src/analysis/TileSampler.ts` and `src/analysis/EndContacts.ts`.
Windows are 24 texels unless a contig is shorter than two windows.

## How it was checked

Against three public curations where the map and the curator's AGP are both
available: the killifish `fAplLin1` and the butterflyfish `fChaTrf1` from the
blind runs, and the king quail `bCotChi1`. All three have already been opened
in this project, so none of this is a blind test.

- `bench/end-contacts-check.ts` applies the curator's AGP to the map, which
  gives the curator's pieces in the curator's order. For every join the
  curator made, it asks of each of the two ends where the curator's partner
  ranks among all other piece ends on the map.
- `bench/continuity-dips-check.ts` counts how many of the curator's cuts have
  a fall in continuity to 0.5 or below within one window, and how many such
  falls are at places the curator did not cut.

`output.txt` holds the full output.

## Results

Curator's partner ranked first, and in the first three:

| Map | Joins | First | First three |
|---|---|---|---|
| Killifish | 9 | 11 of 18 ends | 18 of 18 |
| Butterflyfish | 3 | 0 of 6 | 1 of 6 |
| King quail | 56 | 8 of 112 | 40 of 112 |

The same, counting only candidates of the end's own haplotype (read from the
`H1`/`H2` in the sequence names, which a curator can see):

| Map | First | First three |
|---|---|---|
| Killifish | 15 of 18 | 18 of 18 |
| Butterflyfish | 2 of 6 | 6 of 6 |
| King quail | 22 of 112 | 70 of 112 |

Curator's cuts that have a fall in continuity:

| Map | Cuts that could be scored | With a fall | Falls where the curator did not cut |
|---|---|---|---|
| Killifish | 9 | 5 | 0 |
| Butterflyfish | 5 | 1 | 2 |
| King quail | 23 | 5 | 2 |

## What the results mean

**End contact is evidence, not an answer.** Three things outrank the true
partner:

- The other haplotype. All three maps hold both haplotypes, and the two
  copies of a region contact each other as strongly as neighbours do. An end
  cannot tell its neighbour from its neighbour's copy, or from its own copy.
  Restricting to one haplotype roughly doubles or triples the hit rate.
- Short pieces. Most quail joins involve pieces a few texels wide. The
  brightest texels of the map are capped at the file's maximum value, so many
  candidates tie near 1.0.
- A piece the curator removed from between two others. It was their
  neighbour in the file and still scores as one over a few texels.

**A fall in continuity, when there is one, is nearly always a real cut**
(11 of 15 falls), but most cuts have none (11 of 37 found). A curator often
cuts where contact across the cut looks normal, because the evidence for the
cut is somewhere else on the map. This is not a detector of where to cut.

**The four rearrangements missed in the blind run are all visible in the end
scores once the pieces are cut.** For the inverted end of `scaffold_2.H1`,
after a cut at the curator's position the first piece's end scores 0.88
against the near end of the second piece and 1.61 against its far end. After
inverting the second piece the join scores 1.61 and ranks first. The same
holds for the inversion in `scaffold_2.H2` (0.63 against 0.90) and the
rearrangement in `scaffold_5.H1` (0.70 against 0.99). So the measure answers
"is this piece the right way round" once someone has decided where the piece
ends. It does not find the piece.

## What was built from this

- A console command, `contacts <contig>`, which prints for each end of a
  contig its score against its current neighbour, where that neighbour ranks,
  and the five strongest ends on the map. It changes nothing.
- Nothing is offered that proposes cuts or edits. The continuity functions
  stay in the module, with tests, and are not shown in the interface.

## What this leaves open

- Finding inversion breakpoints. A scan for distant positions that contact
  like neighbours was prototyped on the killifish and produced more false
  candidates than true ones: the haplotype copies, repeat-rich chromosome
  ends, and ordinary local structure all pass. It was not taken further.
- Whether the command changes what a curator decides. That needs a blind run
  on a genome not yet opened.
- Maps of one haplotype, where the largest source of confusion is absent,
  were not tested.

## Added 19 November 2026: do the scores mix zoom levels, and does it matter?

A `.pretext` file stores each zoom level with its own contrast adjustment
(see `docs/PRETEXT_FORMAT.md`, "Each level has its own contrast"), so a value
at one level cannot be compared with a value at another. The scorer picks the
level from the window size. Within one score the box and its reference are
read at the same level. Within one ranked list they are not: a short contig
has a short window and is read at a finer level than a long one. On the
killifish `fOphCon1`, 336 of the 550 top-five entries for 110 long-contig
ends were read at a different level from a long-against-long pair.

To see whether that harms the ranking, the scorer was given an option to
read every box at one fixed level, and `bench/end-contacts-check.ts --level`
was run on six genomes with a curator's file: the three above and the three
of the third blind curation. The count is how often the curator's partner
ranks first, and in the first three, among 628 ends (`levels.tsv`).

| Levels used | First, all candidates | First three | First, same haplotype only | First three |
|---|---|---|---|---|
| By window size (as shipped) | 102 | 275 | 200 | 377 |
| Full resolution for every box | 101 | 277 | 206 | 373 |
| One level coarser for every box | 114 | 237 | 195 | 329 |
| Two levels coarser for every box | 80 | 191 | 150 | 255 |

Reading everything at full resolution gives the same result as the shipped
rule, to within a few ends either way, and took about a third longer on the
killifish (12.8 s against 9.4 s). The coarser fixed levels put fewer partners
in the first three, most likely because a cell there is wider than a short
contig and takes in its neighbours.

So mixing levels within a list is real and is not what limits the ranking.
The shipped rule is kept. The option stays in the scorer for this check.

What this does not settle: the scores are ratios of contrast-adjusted values,
not of contact counts, at any level. "1.00" means "as bright as true
neighbours at this window size", and the ties near 1.0 for short pieces come
from values that sit at the top of the scale next to the diagonal (the
reference for a one-texel window on the killifish is 0.99 of the maximum).

### These six genomes are now development data

The comparison above read the curators' files for all six genomes, including
the three of the third blind curation. No setting was changed as a result,
so nothing shipped is fitted to them. But any later change to `contacts`
chosen with this table in view (for example the "one level coarser" row,
which ranks more partners first and fewer in the first three) would be
fitted to these answers. A claim that such a change helps needs genomes not
yet opened, drawn from the 46 left in
`research/blind-curation-2026-11/run3/pool.tsv`, with the setting fixed
before the draw.
