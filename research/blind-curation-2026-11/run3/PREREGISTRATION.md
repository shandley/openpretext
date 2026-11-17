# Third blind curation: what is fixed before it starts

Written 17 November 2026, and committed before the draw is run or any file
of the drawn genomes is downloaded.

## Question

Does a curation made from OpenPretext's display alone, with the aids added
since the second run (the cursor's sequence position, `cut <sequence> at
<bp>`, the `contacts` command, the haplotype-order warning), come closer to
the curator's than doing nothing, on genomes not seen before? In particular,
does it now find rearrangements inside chromosomes, which the second run
missed entirely?

## Pool

`pool.tsv`: 49 individuals on GenomeArk (the public VGP data store) whose
`assembly_curated` folder holds a curator's PretextView AGP, the map that AGP
is named after, and an input assembly. They are the ones left from 99 after
removing the 44 already opened in this project (42 whose curator AGP was
downloaded while choosing the second run's genome, and the two genomes
curated in full). The pool was built from the bucket listing's file names and
sizes. No file of any of the 49 has been downloaded.

## Draw

`draw.py` shuffles the pool with the seed written in it and prints the whole
order. The run takes the first three in that order that pass these rules,
and no others:

1. The map file is 1 GB or smaller. (Larger maps have never been loaded in
   OpenPretext; this is a limit of the test, stated here so that it is not
   decided after seeing which genomes it removes.)
2. The map downloads and loads in the built site.

A genome is not replaced for any other reason. A genome that turns out to
have needed little curation is run and reported.

## Who curates

Three copies of the Claude session that wrote this, one per genome, working
separately and at the same time. Each is given the map file and nothing else
from that individual's folder.

Allowed: the map file; the built site at commit `355be21`, driven through a
browser; screenshots and scripts that measure them; every console command;
the sequence names in the map.

Not allowed: downloading or opening any other file from the individual's
folder, including the curator's AGP, the curated maps and the assemblies;
looking up the species' karyotype or assembly; opening `test-data/blind/cand`
or any earlier curator AGP for guidance.

Each copy makes one pass and stops when it judges the curation done. It
writes its edits as a replayable script, exports the AGP from the Export
menu, exports a no-edit AGP of the same map, and records the SHA-256 of both
in `FROZEN.txt`. It also writes notes: what it changed and why, what it saw
and left alone, and each use of `contacts` with whether it changed a
decision.

## Scoring

Only after all three are frozen is any curator AGP downloaded.

`../score_agp.py` as committed at `355be21`, tolerance 3 texels, run on the
blind AGP and on the no-edit AGP against the curator's:

- bases in the wrong chromosome, as a share of the genome;
- the curator's breaks matched;
- the curator's joins matched.

If the curator's AGP names sequences differently from the map by a prefix or
suffix applied to whole names, the names are aligned and both results are
reported. If names cannot be aligned that way, the genome is reported as not
scorable and is not replaced.

All three genomes are reported, whatever the result. For breaks and joins the
report also says which of the curator's were inside a chromosome
(inversions and reorders) and how many of those were found.

## What this cannot show

- The curator is a language model reading screenshots, not a person.
- Three genomes from a pool that is two-thirds mammals.
- Agreement with one curator's AGP is not the same as being right.
- There is no control run without the new aids, so a better result than the
  second run could come from the genomes and not from the aids.
