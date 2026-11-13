# Blind curation of a butterflyfish map in OpenPretext

13 November 2026

## What was tested

Earlier checks showed that OpenPretext writes the right file when the edits
are known in advance. This one asks a different question: can a curator who
has only the map reach the answer a professional curator reached?

The curator here was Claude, working from screenshots of the running app. That
is a weaker curator than a trained person, so the misses below say more about
the curator and about what the app makes easy to see than about the file
formats.

## The genome

*Chaetodon trifascialis* (chevron butterflyfish), individual `fChaTrf1`, from
the Vertebrate Genomes Project's public GenomeArk bucket, under
`species/Chaetodon_trifascialis/fChaTrf1/assembly_curated/`:

| File | Role |
|---|---|
| `intermediates/fChaTrf1.haps_combined.mapped.PT.pretext` | The map before curation: both haplotypes, 105 sequences, 1.33 Gb |
| `intermediates/fChaTrf1.hap1.decontam.20230715.fasta.gz`, `...hap2...` | The assembly the map was built from |
| `intermediates/fChaTrf1.haps_combined.mapped.PT.pretext.agp` | The curator's AGP, written by PretextView 0.2.5. Not opened until the blind result was fixed |

It was picked by listing GenomeArk for individuals that publish all three
files and taking the smallest. Seven turned up; the listing dropped some
responses, so there are probably more.

## How blindness was kept

1. Only the map and the two assembly files were downloaded.
2. The curation was made and exported.
3. The exported AGP and the edit script were hashed and timestamped
   (`FROZEN.txt`).
4. Only then was the curator's AGP downloaded and compared.

## What was done in the app

Everything went through the built site in a browser (`drive.ts`):

- **One cut made with the mouse.** `H1.scaffold_1` is 60 Mb, twice the size of
  its neighbours, and its two halves share no contacts. In edit mode the
  cursor was put on the break at high zoom and `C` pressed.
- **Two moves and 48 scaffolds painted through the script console**
  (`curation.script`).
- **49 tags through the sidebar**: `Hap_1` and `Hap_2` on one contig of each
  chromosome, `Unloc` on one small scaffold.
- **Export from the Export menu** (`blind.agp`).

Every chromosome-scale scaffold was looked at on its own at higher zoom, and
the block where the two haplotypes meet was checked for breaks in the
diagonal.

## Result against the curator's AGP

| Curator's decision | Blind result |
|---|---|
| Break `H1.scaffold_1` into two chromosomes | Found. Cut 2 texels (81 kb) from the curator's cut |
| `H1.scaffold_24` (2.1 Mb) belongs with `H1.scaffold_23` | Found. Placed at the end; the curator marked it unlocalised |
| `H2.scaffold_25` (4.8 Mb) belongs with `H2.scaffold_24` | Found. Placed at the end; the curator marked it unlocalised |
| `H2.scaffold_26` (0.7 Mb) unlocalised on the same chromosome | Found, same treatment |
| `H2.scaffold_31` and `H2.scaffold_35` (0.16 and 0.12 Mb) unlocalised there | Missed |
| `H1.scaffold_26` (0.16 Mb) joined to the start of `H1.scaffold_4` | Missed |
| `H2.scaffold_28` (0.32 Mb) unlocalised on `H2.scaffold_14` | Missed |
| A 0.24 Mb piece inside `H1.scaffold_22`, and the matching 0.20 Mb piece inside `H2.scaffold_23`, cut out and marked unlocalised | Missed. The stripe was visible in the screenshots and was passed over |
| `H2.scaffold_14` and `H2.scaffold_24` turned round | Not done. Orientation of a whole chromosome only |
| Each haplotype-2 chromosome placed next to its haplotype-1 partner | Not done. See below |

No edit was made that the curator did not make. Both curations paint 48
chromosomes, 24 per haplotype.

The large decisions were found. Every miss is a piece under 0.35 Mb, which is
9 texels or fewer on this map.

## Result after Sanger's `pretext-to-asm`

Both AGPs were given to `pretext-to-asm` 1.4.1 with the combined assembly, and
the chromosome sequences compared (`score.py`; a chromosome and its reverse
complement count as the same):

| | Haplotype 1 | Haplotype 2 |
|---|---|---|
| Chromosomes in each result | 24 | 24 |
| Identical in sequence | 19 | 22 |
| Share of chromosome bases in identical chromosomes | 81% | 95% |

The seven that differ are the ones in the table above: the two halves of
`H1.scaffold_1` (81 kb on the wrong side of the cut), and the chromosomes with
a missed or differently treated small piece.

### The chromosome names came out wrong

`pretext-to-asm` named the curator's chromosomes `SUPER_1_Hap_1`,
`SUPER_2_Hap_1` and so on. It named the blind result's `SUPER_1A_Hap_1` to
`SUPER_1X_Hap_1`.

The tool pairs chromosomes across haplotypes by where they sit in the AGP: a
haplotype-1 scaffold followed by a haplotype-2 scaffold is one chromosome
pair. A run of scaffolds from the same haplotype is read as pieces of one
chromosome and lettered (`ChrNamer.build_groups` in
`tola/assembly/naming_utils.py`). The blind curation left the map as it was
loaded, all of haplotype 1 and then all of haplotype 2, so the tool read 24
pieces of one chromosome.

The sequences are right and the names are not. A curator of a two-haplotype
map has to interleave the partners, and nothing in OpenPretext says so.

## What this shows about OpenPretext

Worked as needed:

- The mouse cut landed where the cursor was, and the export, tags and
  painting produced a file the Sanger tool accepted without complaint.
- The whole curation took one cut, two moves, painting and tagging, with no
  errors in the page.

Got in the way:

1. **No coordinate at the cursor.** The tooltip gives the map position to
   three decimals, which is 33 texels on this map. A cut has to be placed by
   eye, and there is no way to type a position in base pairs.
2. **Colour differs between parts of one view.** After zooming, some regions
   were drawn red on white and others orange on cream, with a hard edge
   between them. Judging which end of a scaffold has more contacts across such
   an edge is not possible. This is the known colour shift between zoom
   levels.
3. **Small scaffolds are a few pixels wide.** The misses were all pieces of
   3 to 9 texels. There is no view that lists, for a small scaffold, which
   chromosome it contacts most.
4. **Zooming to a scaffold from the console crops its lower part** when the
   window is not square, and the tracks cover the top-left corner of the map.
5. **Nothing warns about haplotype order** before export (above).

## Limits

- One genome, and an easy one: 105 sequences, already close to chromosome
  scale, with one misjoin. A fragmented assembly would be a harder test.
- The curator saw screenshots, not a live display, and made far fewer
  inspections than a person would.
- The curator's AGP is one person's judgement. Marking a piece unlocalised or
  placing it at the end of the chromosome is a matter of practice, and the
  tool was not scored down for that difference except in the sequence table.

## Files

`drive.ts` drives the app (cached `tsx`, a preview server on port 4173).
`final.actions` is the full list of steps, `curation.script` the console part,
`blind.agp` the export, `FROZEN.txt` the hashes taken before the answer was
opened, `score.py` the sequence comparison. The downloads and outputs are in
the git-ignored `test-data/blind/`.
