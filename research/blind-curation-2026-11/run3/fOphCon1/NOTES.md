# fOphCon1 blind curation: notes

Third blind run, one pass, from the map alone. Built site at `355be21`.
Map: 969 sequences, 3.70 Gb, 112.8 kb per texel. 44 sequences are wider than
150 texels and hold 92% of the map; 364 own no texel.

Replay: `view.ts <map> shots --noshots --actions "$(cat final.actions)"`.
`final.actions` runs `curation.script` in the console, tags through the
sidebar, and exports with the Export menu button. Replayed twice from the
unedited map; both exports have the same SHA-256 (`FROZEN.txt`). The export
toast was "AGP exported", with no haplotype-order warning.

Positions below are texels within the original sequence.

## What I changed

13 cuts, 57 moves (every painted piece is placed by position), 5 inversions,
48 painted scaffolds (24 chromosomes, two haplotypes each), 57 contigs tagged
`Hap_1` or `Hap_2`, one tagged `Unloc`.

### Misjoins cut (two blocks with no contact across the point)

| Sequence | Cut at | Evidence |
|---|---|---|
| scaffold_1.H1 | 731 | corner; the two sides have different partners (scaffold_7.H2; scaffold_1.H2) |
| scaffold_1.H2 | 657 | corner; right side pairs with scaffold_9.H1 |
| scaffold_2.H1 | 675 | corner; left side pairs with scaffold_10.H2 |
| scaffold_2.H2 | 543, 560, 576 | three corners; two 16-texel blocks between two chromosomes |
| scaffold_3.H2 | 427 | corner; sides pair with scaffold_22.H1 and scaffold_11.H1 |
| scaffold_4.H2 | 441 | corner; sides pair with scaffold_10.H1 and scaffold_12.H1 |
| scaffold_15.H2 | 96 | corner; contact across it 0.06 |

Corners were located from 80-texel windows (`corner.py`), to about a texel.

### Rearrangements inside a chromosome

- **scaffold_2.H1, 675 to 1125: two parts in the wrong order.** Cut at 882.
  The end of the second part (1125) contacts the start of the first (675):
  `contacts` 0.97, against 0.67 for the join as assembled; the screenshot
  gradient agrees (`quad.py`: strongest at first-part start against
  second-part end). The partner scaffold_20.H2 runs through the second part
  and then into the start of the first. Second part moved before the first.
- **scaffold_1.H1, 731 to 947: a block the wrong way round.** Cut at 947 and
  inverted. Contact between the block and the rest of the chromosome is
  strongest at the block's far end and falls steadily toward the junction
  (0.77 to 0.53 across the block). `contacts` after the edit: 1.01, from 0.60.
- **scaffold_1.H2, 507 to 657: the same block in the other haplotype, the
  same way.** Cut at 507 (a 3-texel empty stripe lies at 505 to 508) and
  inverted. Gradient 0.60 at the far end against 0.48. `contacts` after:
  0.72, from 0.54. Less sure than the haplotype-1 copy.
- **scaffold_8.H1, last 19 texels.** Cut at 693. The piece contacts the
  interior of the same scaffold (strongest 415 to 510 texels in, 0.95) far
  more than the sequence next to it (0.5). It forms a broad stripe, not a
  line, so I could not find a slot. Painted into the chromosome and tagged
  `Unloc`.

### Pieces joined to a chromosome

- scaffold_15.H2 0 to 96, inverted, after scaffold_16.H2 (`contacts` 1.06;
  partner scaffold_7.H1 is longer than scaffold_16.H2 by about that much).
- scaffold_21.H2, inverted, after scaffold_4.H2 0 to 441 (1.06).
- scaffold_22.H2 before scaffold_4.H2 441 to 930 (1.05).
- scaffold_23.H2 before scaffold_15.H2 96 to 613 (0.73; its other end matches
  the start of the partner scaffold_8.H1 at 1.15).
- scaffold_24.H2, inverted, after scaffold_20.H2 (0.84; a block of it matches
  scaffold_2.H1 675 to 882 in the partner cell). The least sure of the joins.

### Haplotype pairs

Pairs were read from a whole-map screenshot (`cells.py`) and checked in
zoomed views of each pair's cell (`pvsheet1.png`, `pvsheet2.png`): each shows
one straight line. Chromosomes are laid out haplotype 1 then haplotype 2.

## What I saw and left alone

- **Blocks of 35 to 55 texels at one end of scaffolds 7.H2, 10.H1, 15.H1,
  12.H2, 16.H1, 14.H2 and 1.H1.** They look detached at low zoom. All of them
  contact one another at 1.15 to 1.22, so they are one repeat family, and
  each contacts its own scaffold at 0.67 to 0.88 with the gradient the right
  way. Left attached.
- **Empty stripes with a small square where they cross** (scaffold_4.H1 at 49
  to 75, scaffold_6.H2 at 241 to 261, scaffold_20.H2 at 238 to 252,
  scaffold_19.H1 near 483, scaffold_17.H1 at 425 to 460). Contact across each
  is normal. Read as unmappable sequence, not breaks. The scaffold_17.H1 one
  is a 35-texel block that contacts neither side; I could not tell an
  insertion from a centromere and left it.
- **scaffold_2.H2 543 to 560 and 560 to 576.** Cut out and left unpainted.
  They contact only the small repeat scaffolds.
- **scaffold_8.H1 686 to 693.** A 7-texel square between the main part and
  the end piece. Left on the main part.
- **Saturated squares inside scaffold_3.H2 (427 on) and scaffold_11.H1.**
  Repeats that contact each other; no break in the diagonal.
- **scaffold_27.H2.** One part contacts the end of scaffold_9.H1 and the rest
  contacts the scaffold_1 block. Both ends are in a repeat family. Not placed.
- **Every other small scaffold.** Of the 25 that are 20 texels or wider, 22
  contact only other repeat scaffolds at saturating scores. Not placed. The
  roughly 900 below 20 texels were not looked at.
- **Whole-chromosome orientation.** Single-scaffold chromosomes were not
  turned to match their partner.
- Haplotype 2 is shorter than haplotype 1 in most pairs (by up to 150
  texels in scaffold_3.H2 427 on against scaffold_11.H1). I did not find the
  missing pieces.

## Uses of `contacts`

1. **On every piece after the first round of cuts (30 pieces).** Changed
   decisions:
   - Showed the end blocks listed above are one repeat family. I had them
     down as seven end pieces to cut off; none was cut.
   - Showed scaffold_2.H1's two parts are in the wrong order. I had read the
     point at 882 as a possible second misjoin.
   - Placed scaffold_15.H2 0 to 96, scaffold_21.H2 and scaffold_22.H2, and
     gave their orientation.
   - Named the partner of each cut piece by which haplotype-1 end it matches.
2. **On the 25 small scaffolds 20 texels or wider.** Placed scaffold_23.H2
   and pointed to scaffold_24.H2; showed the rest cannot be placed.
3. **On sub-pieces of scaffold_15.H2 0 to 96, scaffold_1.H1 and
   scaffold_1.H2.** Stopped me cutting scaffold_15.H2's piece in three (the
   sub-blocks seen at high zoom score 0.99 to 1.08 against each other). Did
   not settle the scaffold_1 block: both of its ends and its neighbours carry
   one repeat, so the end scores could not separate the two orientations.
   The screenshot gradient decided that.
4. **On the final layout (17 pieces).** Every join made is listed with its
   score above. No decision changed.

Where it did not help: any end inside a repeat family ties with dozens of
others, and it only returns the five strongest, so a specific pair has to be
laid side by side to be read.

## Scripts written for this run (in this folder)

`view.ts` (driver; square canvas, track overlay hidden, `ask:` action that
prints console output), `prof.py`, `corner.py`, `corners_all.py`,
`ends_all.py`, `quad.py`, `col.py`, `pairviews.py`, `grid.py`. All measure
screenshots; none reads the map file. `hdr.ts` was used once to list
sequence names and texel widths from the file header.

## App problems met

- Tracks hidden with `X` come back when the analysis finishes; I hid the
  track canvas with a style rule.
- `zoom <contig>` crops the contig unless the canvas is square.
- No way to view an off-diagonal cell by name; I computed wheel positions.
- `contacts` cannot be asked for one named pair.
