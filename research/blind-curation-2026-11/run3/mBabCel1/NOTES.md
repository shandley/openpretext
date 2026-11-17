# mBabCel1: notes on the blind curation

Map: the single `.pretext` in `input/` (4.83 Gb, 3,639 sequences, 147,471 bp per
texel, both haplotypes, names carry `.H1`/`.H2`). Only 1,251 sequences own a
texel. 41 scaffolds of 10 Mb or more hold 94.3% of the bases.

Everything was read from screenshots of the built site and from console
commands. The map file was not read by any script of mine. No other file of
this individual, no AGP other than my own exports, and no outside source was
opened.

## What I changed

Replayable as `curation.script` followed by the tags in `final.actions`
(`view.ts --actions "$(cat final.actions)"`). A second replay from the unedited
map gave a byte-identical export (`replay.agp`).

- **2 cuts**
  - `scaffold_15.H2` after 28,314,464 bp. A sharp break on its own diagonal (zoom
    `z/z15H2.png`): the two sides hardly contact. `contacts` gave 0.44 across
    the cut. The first part is the haplotype-2 copy of `scaffold_20.H1`; the
    second is the copy of the first 17 Mb of `scaffold_19.H1`.
  - `scaffold_17.H2` after 12,535,049 bp, and the first piece inverted. Against
    its partner `scaffold_16.H1` the first 12.5 Mb runs the other way
    (`g1/v16.png`), and the diagonal of 17.H2 has a jog at that point
    (`z/z17H2.png`). After the edit the two haplotypes match along their whole
    length (`g2/b16.png`).
- **2 inversions**: `scaffold_17.H2_L` (above) and `scaffold_21.H2` (so that the end
  matching the start of 16.H1 leads).
- **Moves**: 43 to bring partners together, 6 to regroup after the cuts, 3 to
  place loose pieces. Whole-scaffold order between chromosomes carries no
  meaning.
- **Joins made by painting** (pieces put in one chromosome):
  - haplotype 2 of the chromosome of `scaffold_4.H1`: `9.H2`, `19.H2`, `23.H2`
  - haplotype 2 of the chromosome of `scaffold_6.H1`: `26.H2`, `6.H2`
  - haplotype 1 of the chromosome with no haplotype-2 partner of its size:
    `10.H1`, `21.H1` (see below)
  - haplotype 2 of the chromosome of `scaffold_15.H1`: `16.H2`, `24.H2`
  - haplotype 2 of the chromosome of `scaffold_19.H1`: `15.H2` second part, `20.H2`
  - haplotype 2 of the chromosome of `scaffold_16.H1`: `21.H2`, `17.H2` first
    part (inverted), `17.H2` second part
- **40 painted scaffolds**, 20 of each haplotype, alternating haplotype 1 then
  its partner; 21 contigs tagged `Hap_1`, 27 tagged `Hap_2`. 4.585 of 4.832 Gb
  is painted.

## What I saw and left alone

- **Sharp domains inside `12.H1`/`10.H2`, `19.H1`, `6.H1`/`6.H2`, `17.H1`/`14.H2`,
  `14.H1`/`13.H2`, `10.H1`.** Each looks like two blocks with less contact
  between them. Test cuts (not kept) gave 0.92 to 1.07 across the boundary for
  6.H1, 17.H1, 14.H1, 13.H2 and 10.H1, so those are continuous. For 12.H1, 10.H2
  and 19.H1 the figure was 0.66 to 0.68, with only small scaffolds scoring
  higher. I took these for centromeres with unplaced satellite and did not cut.
  This is the decision I am least sure of.
- **The start of `15.H1` (about 16 Mb) contacts the second part of `19.H1`**
  (0.68 end to end, and a broad pink block). In a scratch layout with the two
  placed side by side (`sA/j.png`) there was no bright corner at the junction,
  so I did not join them.
- **A 2.5 Mb stripe at the start of `21.H1`** has no contact at all with `10.H1`
  while the rest of 21.H1 does. I left 21.H1 whole and joined it after 10.H1 in
  its file orientation. Its orientation is not settled by anything I could
  measure (0.79 against 0.76).
- **`22.H2`** is the copy of most of `21.H1` and contacts the end of `10.H1`. I
  painted it alone as the haplotype-2 partner. No sex-chromosome tag was given:
  10.H1 has no haplotype-2 copy of its size, which fits an X with a small Y,
  but I did not name it.
- **`24.H1` and `25.H2`** (3 Mb each) are copies of each other with no large
  partner. Unplaced.
- **Everything under 2 Mb** (about 1,200 sequences that own texels, 5% of the
  bases, most of them one to seven texels wide), and `22.H1`, `23.H1`, `25.H1`,
  whose ends score about 1.0 against dozens of other small scaffolds. Unplaced
  and unpainted; I could not judge them.
- Chromosomes 1 to 9, 11, 13 and 18 were looked at once each at 0.25 to 0.9
  screen pixels per texel (`g1/`). An inversion shorter than about 5 Mb would
  not have been visible, and I did not look closer.

## Uses of `contacts`

1. Ends of eight mid-sized scaffolds, before any edit. Mostly returned the
   other haplotype's copy. It did show `15.H2` right end against `16.H2` right
   end (0.79), which sent me to look at 15.H2. Changed a decision: yes, it led
   to finding the misjoin.
2. Eight test cuts at visible domain boundaries (`test1.script`). Confirmed
   the 15.H2 misjoin (0.44); cleared 6.H1, 17.H1, 10.H1; left 12.H1, 10.H2,
   19.H1 at 0.66 to 0.68. Changed decisions: it stopped me cutting 10.H1, whose
   two blocks look the most different by eye.
3. The inversion in 17.H2, on both haplotypes (`test2.script`). In 17.H2 the
   assembled join scored 0.87 and the inverted one 0.81; in 16.H1 the assembled
   joins scored 0.95 and 0.97 and the alternative 0.77. The scores alone did
   not decide it. I inverted because haplotype 1 was clearly supported, the
   diagonal of 17.H2 jogs at that point, and the result matches haplotype 1
   end to end.
4. `21.H1`, `14.H1`, `13.H2` test cuts (`test3.script`). Cleared 14.H1 and 13.H2
   (0.95, 0.98). For the stripe in 21.H1 it gave 1.00 across the cut with an
   8-texel window, which I did not trust at that size. No decision changed.
5. Eight loose pieces of 2 to 4 Mb. Placed three (`23.H2`, `24.H2`, `26.H2`),
   each of which scored 1.0 or more against one large scaffold of the other
   haplotype at one end and nothing comparable elsewhere. Changed a decision:
   yes, these would otherwise have stayed unplaced.

## What got in the way

- On this map the two haplotypes contact each other as strongly as a sequence
  contacts itself, so `contacts` lists the partner haplotype first almost
  every time and small scaffolds tie near 1.0.
- Tracks came back over the map after the analyses finished; I hid the track
  canvas with CSS in my copy of the driver.
- The whole-map view at any window size is too coarse to compare scaffolds
  under about 50 Mb; red saturates in small cells.
- The driver did not capture the export toast, so I checked the haplotype
  order from the exported file instead: painted scaffolds alternate Hap_1,
  Hap_2 throughout.
- No page errors were reported in any run.
