# Third blind curation: three genomes drawn at random

17 November 2026. The rules are in `PREREGISTRATION.md`, committed
(`e6db8a6`) before the draw. The three results were committed (`4bb91f3`)
before any curator file was downloaded.

## What was run

`draw.py` took the first three genomes of a seeded shuffle of 49 public
curations not opened before in this project (`draw-order.txt`). None was
rejected.

| Individual | Animal | Genome on the map | Sequences | With a texel |
|---|---|---|---|---|
| `mCarSyr1` | Philippine tarsier | 7.98 Gb | 1,957 | 1,474 |
| `fOphCon1` | a killifish | 3.70 Gb | 969 | 605 |
| `mBabCel1` | babirusa | 4.83 Gb | 3,639 | 1,251 |

All three maps hold both haplotypes. Each was curated by a separate copy of
the Claude session, from the map alone, in the built site at `355be21`. Each
copy's notes, script and hashes are in the folder named after the
individual. Replaying each script from the unedited map reproduced the
exported file byte for byte.

## Result

"Wrong" is the share of the genome's bases that the two files put in
chromosomes that are not a pair, or that one file paints and the other does
not. The floor is the blind curation's own painting with no edits: every
sequence it painted, marked as a chromosome as loaded.

| | Tarsier | Killifish | Babirusa |
|---|---|---|---|
| Wrong, no edits | 19.63% | 13.12% | 4.11% |
| Wrong, blind curation | 5.82% | 2.24% | 2.62% |
| Curator's breaks matched | 11 of 52 | 10 of 40 | 2 of 19 |
| Curator's joins matched | 1 of 118 | 3 of 62 | 4 of 66 |
| Breaks made that the curator did not make | 4 | 3 | 0 |
| Joins made that the curator did not make | 2 | 5 | 4 |

What is left wrong after the blind curation, in Mb:

| | Tarsier | Killifish | Babirusa |
|---|---|---|---|
| Painted by the curator, left unpainted | 385 | 74 | 46 |
| Painted, the curator left unpainted | 39 | 0 | 0 |
| Painted by both, in different chromosomes | 40 | 8 | 80 |

The curator's breaks and joins by kind (`breakdown.py`):

| | Tarsier | Killifish | Babirusa |
|---|---|---|---|
| Breaks between chromosomes, found | 11 of 25 | 7 of 20 | 1 of 1 |
| Breaks inside a chromosome, found | 0 of 27 | 3 of 20 | 1 of 18 |
| Joins where the smaller piece is 5 Mb or more, found | 1 of 25 | 3 of 10 | 3 of 8 |
| Joins where the smaller piece is under 5 Mb, found | 0 of 93 | 0 of 52 | 1 of 58 |

## What this shows

**Sorting large sequences into chromosomes works again.** In each genome the
blind curation cut the wrong share of bases, by about two thirds in the
tarsier (19.6% to 5.8%), more in the killifish and about a third in the
babirusa. Sequence painted by both files but in different chromosomes fell
from 1,143 to 40 Mb in the tarsier and from 414 to 8 Mb in the killifish.

**Rearrangements inside chromosomes are still not found.** The curators made
65 breaks that leave both sides in one chromosome. The blind curations found
4. The second run found 0 of 5. The new aids did not change this.

**Small pieces were not attempted.** Of the curators' 246 joins, 203 have a
smaller piece under 5 Mb, and one of those was found. Each copy said in its
notes that it left sequences below a size (10 Mb, about 20 texels, 2 Mb)
unplaced because their ends score alike against dozens of others. Most of
what remains wrong in the tarsier and the killifish is this unplaced
sequence.

**Some edits were wrong.** Seven breaks and eleven joins across the three
are not in the curator's file. In the babirusa 80 Mb is painted into a
chromosome the curator did not put it in. The second run made no edit the
curator did not make; these harder genomes did.

**About half of the misjoins between chromosomes were found** (19 of 46).

## The `contacts` command

The copies used it 12 times and recorded what it changed:

- It led to finding one misjoin, placed about eight loose pieces with their
  orientation, showed two parts of one sequence were in the wrong
  order, and decided which haplotype carried one inversion.
- It stopped cuts at places that looked broken and were continuous: seven
  end blocks in the killifish that turned out to be one repeat family, and
  several domain boundaries in the babirusa.
- It did not discriminate for one inversion in each genome, and it ties across dozens of ends for small sequences and
  repeats. On these maps the other haplotype's copy comes first in almost
  every list.

Whether those decisions were right cannot be read off the totals, and the
run has no arm without the command.

## Departures from what was fixed beforehand

1. **The scoring script had an error, corrected after the scores were
   seen.** Bases that the curator painted into a chromosome with no pair in
   the other file, and that the other file left unpainted, were counted as
   right. That contradicts the definition written at the top of the script.
   It made a file with nothing painted score 0% wrong. The script is
   corrected in the same commit as this report. `scores-preregistered-script.txt`
   holds the output of the script as it was: 4.53%, 2.24% and 2.47% wrong for
   the three blind curations, against 5.82%, 2.24% and 2.62% corrected.
   Breaks and joins are unaffected. The figures reported for the first two
   runs do not change under the corrected script; both were rerun.
2. **The floor was built afterwards.** The rules asked each copy for a
   no-edit export, and each exported the map with nothing painted, which
   scores 88% to 96% wrong and says little. The floor the second run used
   (large scaffolds painted as loaded) was made from the two frozen files by
   `painted_floor.py`. It is not an export from the interface.
3. **One copy read the map file's header** with a script, for sequence
   names and widths. The map file was allowed.

## What this cannot show

As written beforehand: the curator is a language model reading screenshots;
three genomes; agreement with one curator is not correctness; no control
without the new aids. In addition, the three copies ran at the same time on
one machine, and each chose its own size below which it did not look.

## Files

`pool.tsv`, `draw.py`, `draw-order.txt`, `PREREGISTRATION.md`; per genome
`blind.agp`, `baseline.agp`, `floor.agp`, `curation.script`,
`final.actions`, `NOTES.md`, `FROZEN.txt`; `scores.txt`,
`scores-preregistered-script.txt`, `breakdown.py`, `painted_floor.py`. The
curator AGPs are public on GenomeArk at the keys in `pool.tsv` and are not
copied here.
