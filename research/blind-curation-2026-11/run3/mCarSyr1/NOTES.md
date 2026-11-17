# Blind curation of mCarSyr1: notes

Map: `input/mCarSyr1.HiC.combined.decontam.multimapping.haplotig.20260525.pretext`
(1,957 sequences, 1,474 with at least one texel; 7.98 Gb; 65,536 texels at
121.8 kb per texel; both haplotypes, named `.H1` and `.H2`).

Built site at commit `355be21`, driven with `view.ts` in this folder. Nothing
other than the map was opened. One pass.

## How to replay

```
tsx view.ts <map> <outdir> --noshots --script curation.script --actions "$(cat final.actions)"
```

`curation.script` holds every cut, move, inversion and painting.
`final.actions` tags the haplotypes through the sidebar and exports through
the Export button. A replay from the unedited map gave a file identical to
`blind.agp` (`w3/replay.agp`).

## What I changed

Counts: 15 cuts, 84 moves, 22 inversions, 81 painted scaffolds, 84 contigs
tagged `Hap_1` or `Hap_2`. 83.6% of bases are painted.

### 13 cuts where two chromosomes were joined

Each is a corner between two blocks with no contact between them, found on a
zoomed shot of the scaffold and placed on a deeper zoom (about 4 pixels per
texel) at the corner. Positions in bp of the original sequence:

- `scaffold_1.H1`: 116.45 Mb, 213.50 Mb, 300.14 Mb, 420.75 Mb
- `scaffold_1.H2`: 92.30 Mb, 188.30 Mb, 270.17 Mb, 415.07 Mb
- `scaffold_2.H1`: 119.05 Mb, 213.87 Mb
- `scaffold_3.H1`: 123.96 Mb
- `scaffold_4.H1`: 90.07 Mb
- `scaffold_6.H1`: 74.74 Mb

Least sure of these:

- `scaffold_1.H1` at 213.50 Mb. The two blocks either side do not contact
  each other, but an anti-diagonal line crosses the diagonal here and runs
  about 7 Mb each way: the end of one block looks like an inverted copy of the
  start of the next. I cut at the centre of that cross. I did not remove or
  tag anything as a duplicate.
- `scaffold_1.H2` at 270.17 Mb. The corner is less sharp, and the 10 Mb after
  it is paler with small anti-diagonal marks. I left that stretch with the
  following chromosome.
- `scaffold_4.H1` at 90.07 Mb: weakest fall in contact of the 13, clear by eye.

### Two inversions inside chromosomes

Both were found by putting each chromosome next to its copy in the other
haplotype and looking at the block between them: copies that agree give a
straight line, and a piece turned round in one of them gives a kink.

- `scaffold_9.H1`, from 45.20 Mb to its end (53 Mb), inverted. Against
  `scaffold_8.H2` the line ran one way for the first arm and the other way for
  the second. To decide which haplotype was wrong I measured, on each
  scaffold's own shot, the contact between the first arm's centromere end and
  positions along the second arm. In `scaffold_8.H2` it falls with distance
  from the centromere (0.27 to 0.18). In `scaffold_9.H1` it rises (0.17 to
  0.30). So the arm is the wrong way round in H1. The cut is at the corner
  after the bright repeat block at the centromere.
- `scaffold_6.H1`, from 74.74 Mb (the misjoin cut) to 87.76 Mb (13 Mb),
  inverted. Against `scaffold_33.H2` the first quarter of the block ran the
  other way. See `contacts` below for which haplotype.

After both, the blocks are straight lines (`w3/qcells.png`, `w3/q13s.png`).

### Pairing, order and orientation

- 39 chromosome pairs were set side by side, haplotype 1 first, from two
  measures that agreed: block contact on the whole-map shot (`pairs.py`) and
  `contacts` on every piece of 10 Mb or more.
- 20 haplotype-2 scaffolds were turned round so that each runs the same way
  as its haplotype-1 copy. The direction was read off the block between the
  two copies for every pair (`w2/cellsA.png`, `w2/cellsB.png`) and checked
  again after the edits.
- `scaffold_33.H1` (17.9 Mb) was placed before `scaffold_22.H1` in one
  chromosome: together they match `scaffold_15.H2` end to end.
- Each haplotype of each chromosome is its own painted scaffold.
- The export gave no haplotype-order warning.

### Painted without a partner

- `scaffold_5.H1` (155.8 Mb): no copy in haplotype 2. Probably a sex
  chromosome. Not tagged as one.
- `scaffold_29.H1` (45.6 Mb) and `scaffold_34.H2` (39.1 Mb): each has its own
  clear diagonal and no partner I could find. They are not copies of each
  other. They sit next to each other in the order only so that the export
  raises no warning; `pretext-to-asm` would name them as a pair.

## What I saw and left alone

- `scaffold_28.H1` against `scaffold_26.H2`: about 16 Mb of the H2 scaffold
  has no counterpart in the H1 scaffold, and the line jumps at 38.7 Mb of
  `scaffold_28.H1`, where contact along it also dips. A piece is probably
  missing from H1 there. I did not find it and did not cut.
- `scaffold_30.H1` against `scaffold_35.H2`: three segments in a different
  order in the two haplotypes. Painted as a pair, not rearranged.
- `scaffold_15.H1` and `scaffold_20.H1`: the last 10% or so of each has no
  counterpart in its H2 partner. Not cut.
- `scaffold_2.H2` at 108.0 Mb, `scaffold_28.H2` at 16.9 Mb, `scaffold_24.H1`
  at 52.0 Mb, `scaffold_12.H2` near 60 Mb, `scaffold_8.H2` at 44.6 Mb,
  `scaffold_17.H1` and `scaffold_17.H2` at 75.7 Mb: block boundaries with
  contact still present across them. Read as centromeres or repeat blocks.
- Small tails: the last 4 Mb of `scaffold_1.H1`, the last 4 Mb of
  `scaffold_12.H2`, the first 2.7 Mb of `scaffold_35.H2`. Could be separate
  pieces. Too small for me to judge.
- About 25 scaffolds of 10 to 30 Mb (`scaffold_37.H2`, `scaffold_31.H1`,
  `scaffold_38.H2` to `scaffold_50.H1` and others) are solid blocks that
  contact one another and much of the map: repeat arrays. Left unpainted.
  A few plain ones among them (`scaffold_41.H2`, `scaffold_40.H1`,
  `scaffold_44.H1` with `scaffold_45.H2`) have partners by `contacts` but I
  could not tell whether they are chromosomes or parts of larger ones. Left
  unpainted.
- Everything under 10 Mb (about 920 Mb, 11.5% of bases, 1,380 sequences): not
  looked at.
- No sequence was tagged as a haplotig, contaminant or unlocalised piece.

## Uses of `contacts`

1. **All 109 pieces of 10 Mb or more, after the 13 cuts** (`w1/contacts1.txt`).
   Used to pair haplotypes: a chromosome's end scores about 1.0 to 1.15
   against the matching end of its copy. It agreed with the whole-map block
   measure for every pair that had a clear end score, and it gave two things
   the block measure did not: that `scaffold_33.H1` belongs with
   `scaffold_22.H1` (its left end scores 1.14 against the left end of
   `scaffold_15.H2`), and the pair `scaffold_35.H1` with the 14 Mb tail of
   `scaffold_1.H2`. Changed decisions: yes, those two.
   It did not help with direction at first: I misread "right end against right
   end" as meaning the copies run opposite ways, and corrected that from the
   pictures. Across the misjoin cuts the two sides still score 0.3 to 0.45,
   so a score near 0.4 is this map's background, not weak support.
   Ends at chromosome tips and in the repeat scaffolds score near 1 against
   many unrelated ends; those lists were not usable.
2. **`scaffold_9.H1` and `scaffold_8.H2` cut at the centromere** (`w2/contacts-t1.txt`).
   Asked whether the second arm fits better turned round. Both haplotypes
   scored 0.65 across the centromere and the other orientation was not among
   the strongest, so it did not discriminate. Decision made from the contact
   profile between arms instead. Changed the decision: no.
3. **`scaffold_6.H1` and `scaffold_33.H2` cut around the inverted quarter**
   (same file). In H2 the piece's end scores 0.99 against the start of the
   rest of the chromosome, which is the order it is in. In H1 the piece's
   start scores 0.73 against the start of the rest, more than its end does
   against what follows it (0.59). That says H1 is the one turned round.
   Changed the decision: yes, it settled which haplotype to edit.

## Things in the app that got in the way

- Tracks could not be kept hidden with `X`; they came back after analyses and
  after console commands. I hid the track canvas with CSS in the driver.
- The view after `zoom <contig>` is offset from the diagonal by a fixed 36
  pixels in a 1500 by 1428 window, and after wheel zoom by a different
  amount, so the diagonal had to be found in each shot.
- Colours differ between zoom levels (red and white when zoomed out, orange
  and cream further in), and within one view where tiles of two levels meet.
- The whole-map view of 1,474 sequences is mostly grid lines in the lower
  right; nothing can be read there.
- Wheel zoom-out from a small contig did not scale by a constant factor per
  notch, so three pair shots had to be read by eye.
- `contacts` for 109 contigs took about three minutes while two other
  sessions were running.
