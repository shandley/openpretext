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
