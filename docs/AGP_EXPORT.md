# AGP export: what OpenPretext actually writes

This describes the AGP produced by `src/export/AGPWriter.ts` (`Export AGP` in the
toolbar and command palette, Cmd+G, and `bench/curate.ts`). Read it before you
feed an OpenPretext AGP into a downstream pipeline. Several columns carry
defaults rather than measurements, and object names are positional rather than
stable identifiers.

The file follows the AGP 2.1 column layout: nine tab-separated columns, `W` rows
for contigs and `N` rows for gaps, coordinates 1-based and inclusive, parts
numbered sequentially within each object.

## Object names

Two conventions, chosen per contig:

| Case | Object name |
|---|---|
| Contig assigned to a scaffold | `scaffold_<scaffoldId>` |
| Contig not assigned to a scaffold | `unplaced_<n>` |

`<scaffoldId>` is the numeric id the ScaffoldManager handed out, not the name the
curator sees. If you name a scaffold `Chr1` in the sidebar, or auto-assign
scaffolds (which names them `Chr1`, `Chr2`, ...), or create one from the script
console with a name, that name does not reach the AGP. The object is still
called `scaffold_<id>`. Ids are handed out in creation order and are not reset by
`resetScaffolds()`, so re-running auto-assign in the same session produces
higher-numbered objects for the same chromosomes: the second run of a 21-scaffold
auto-assign writes `scaffold_22` through `scaffold_42`.

`<n>` in `unplaced_<n>` is a counter over unscaffolded contigs in display order,
starting at 0. It is positional. Reorder two unplaced contigs and their names
swap; exclude one and every later unplaced contig shifts down by one. The name
therefore identifies a slot in one particular export, not a piece of sequence.
Do not use it as a key across two exports. The contig name in column 6 is the
stable identifier.

Contigs sharing a `scaffoldId` are grouped into one object even when they are not
adjacent in the display order. Whatever sat between them in the curated order is
written as a separate object, and the scaffold's own coordinates run on as if its
members were neighbours. The object appears at the position of its first member.

`src/export/BEDWriter.ts` reuses the same grouping function, so BED export
inherits all of this.

## Gap rows

Every adjacent pair within an object is separated by one `N` row:

```
scaffold_7	101	300	2	N	200	scaffold	yes	proximity_ligation
```

Three of the four gap fields are fixed defaults rather than anything derived from
the data:

- **200 bp** is a placeholder. OpenPretext has no evidence about the distance
  between two contigs; a Hi-C contact map does not measure gap length. Read the
  200 as "a gap of unknown size". It also means the object coordinates in
  columns 2 and 3 are not genomic distances.
- **`scaffold`** is the gap type for every gap. The writer never emits
  `centromere`, `telomere`, `contamination`, or any other type, even when the
  curator has applied a meta-tag saying as much.
- **`yes`** in the linkage column is hard-coded.

The fourth, **`proximity_ligation`**, does reflect the data: the ordering comes
from Hi-C contact.

`gapSize`, `gapType`, and `linkageEvidence` are parameters of `exportAGP`, but no
UI or CLI path passes them, so exported files always carry the values above.
Setting `gapSize: 0` suppresses gap rows entirely and makes components abut.

## Components and coordinates

Column 6 is the contig's current name in OpenPretext. Cut and join synthesize
names: a cut produces `<name>_L` and `<name>_R`, a join produces `<a>+<b>`.
Those strings are not headers in the input assembly FASTA. An AGP that mentions
them can only be resolved against the FASTA that OpenPretext exported from the
same session, not against the original assembly.

Columns 7 and 8 are always `1` and the contig's full length. A cut fragment is
described as a whole component of its own, not as an interval of its parent, so
the AGP does not record where in the parent the cut fell.

Column 5 is always `W`. A `.pretext` file's "contigs" are whatever sequences the
map was built from, which for a scaffolded assembly are scaffolds containing
their own N-runs. Writing them as `W` asserts they are gap-free, and any internal
gap in the input is invisible in the exported AGP.

Cut positions are quantized to the contact map's texture grid. `cut()` converts a
pixel offset to base pairs proportionally
(`Math.round(contig.length * pixelOffset / contigPixelLength)`), and every caller
supplies an integer pixel offset in texture space, so a fragment boundary is
accurate to at best one texture pixel: for a 3 Gb genome on a 32768-pixel map,
roughly 90 kb. Cursor precision at low zoom is coarser still. The exported FASTA
is cut at the same coordinate, so the two files agree with each other, but
neither locates a breakpoint at base resolution.

## Orientation

Column 9 is `+` or `-`, taken directly from the contig's `inverted` flag. The
writer never emits `?`, `0`, or `na`.

The column is written in the normal AGP sense: it tells you how to place the
*input* contig sequence into the object, so `-` means reverse-complement the
contig as it appears in the assembly you loaded. It is not a description of the
sequence OpenPretext's own FASTA export writes. That FASTA already has the
orientation applied (the record is emitted reverse-complemented, and its header
carries `orientation=-`). Applying the AGP orientation on top of an OpenPretext
FASTA record reverses it a second time.

Joins break the column in two ways, because one strand flag cannot describe a
component assembled from two independently oriented pieces. In both cases the
exported FASTA is correct, since it is rebuilt from the contig's
`sequenceSegments`, and the AGP is not.

**Differing orientations.** The merged contig's `inverted` flag collapses to
`false` (`CurationEngine.ts`, `join`), so the merged component is written `+` and
the inverted half's orientation is lost:

```
before:  scaffold_1  1    100  1  W  m    1  100  +
         scaffold_1  101  300  2  N  200  scaffold  yes  proximity_ligation
         scaffold_1  301  400  3  W  n    1  100  -
after:   scaffold_1  1    200  1  W  m+n  1  200  +
```

**Both halves inverted.** The flag survives and the AGP writes `-`, but
reverse-complementing a component also reverses the order of its parts, and the
join does not. Inverting `p` and `q` and then joining them gives the FASTA record
`revcomp(p) + revcomp(q)`, whereas `-` applied to a component named `p+q` means
`revcomp(q) + revcomp(p)`. Verified on `p = AAAAAGGGGG`, `q = TTTTTCCCCC`: the
FASTA holds `CCCCCTTTTTGGGGGAAAAA`, the AGP row describes
`GGGGGAAAAACCCCCTTTTT`.

Cuts do not have this problem. A `-` on `ctg1_L` places the forward left fragment
reverse-complemented, which is what the FASTA record holds. But the forward
fragment itself appears in no file OpenPretext writes, so a consumer has to
derive it.

The short version: if the curation contains any cut or join, take sequences from
the FASTA export and use the AGP for order and grouping only.

## Excluded contigs

Contigs excluded in the UI are dropped before grouping
(`contigExclusion.getIncludedOrder`). They produce no row, and the file carries
no record that they existed.

Coordinates close up around them. Excluding a middle member of a scaffold moves
every later component down, renumbers the parts, and removes one gap row, so
object coordinates from an export with exclusions cannot be compared with
coordinates from an export without them. A scaffold whose members are all
excluded disappears from the file. Excluding an unplaced contig renumbers the
`unplaced_<n>` objects after it.

## Round-tripping

`src/formats/AGPParser.ts` can read this file back. Order, orientation, and
scaffold membership survive. These do not:

- **Scaffold object names.** Import calls `createScaffold(objectName)`, so the
  imported name lives in the ScaffoldManager, but export writes
  `scaffold_<newId>`. Importing `scaffold_7` and exporting again typically yields
  `scaffold_1`.
- **Cuts and joins.** Import matches rows to loaded contigs by name. A freshly
  loaded `.pretext` contains no contig named `ctg1_L` or `ctg1+ctg2`, so those
  rows are reported as unmatched and skipped, and the pieces they describe stay
  as they were in the file. AGP alone cannot restore a curation that cut or
  joined anything. Use a session file for that.
- **Exclusions.** Excluded contigs are absent from the AGP, and import appends
  every loaded contig that the AGP does not mention to the tail of the order.
  They come back, in a different place, no longer excluded.
- **Gap sizes and types.** Import ignores `N` rows completely.
- **Meta-tags, waypoints, and undo history.** These are session state and are
  never written to AGP.

Import never drops a loaded contig, and a contig name appearing twice is matched
only on its first occurrence.

Reading a third-party AGP has one naming trap of its own: `parseAGP` treats any
object whose name begins with `unplaced_` as a singleton rather than a scaffold,
so a real scaffold called something like `unplaced_scaffolds` is imported as
loose contigs with no grouping.

## Reproducibility

`exportAGP` omits the generation timestamp by default (`timestamp: null`), so the
same curation exports byte-identical AGP on every run and two runs of a script
can be diffed. Pass `timestamp` explicitly to stamp one. The header is:

```
##agp-version	2.1
# Curation performed using Hi-C contact map data
```

The second line is a fixed string, present whether or not any curation happened.
`includeHeader: false` drops both lines.

The version line separates `##agp-version` from `2.1` with a tab, while the NCBI
specification writes it with a space. Parsers that treat `#` lines as comments
are unaffected; a strict check on the version line may not recognise it.

## If you are deciding whether to use this file

Safe to rely on: the order of components within each object, the contig names in
column 6 as keys into the OpenPretext FASTA export, part numbering and
coordinate arithmetic within an object, and the orientation column for contigs
that came from the input assembly unchanged.

Not safe to rely on: object names as identifiers across exports, the orientation
column for cut or joined components, gap lengths as distances, gap types as
annotations, object coordinates as genomic positions, and the file as a complete
record of a curation session.

OpenPretext's FASTA export writes one record per curated contig, in curated
order, reverse-complemented where inverted, and with the same contigs excluded.
It does not emit N-padded scaffold sequences. To build scaffold sequences,
concatenate the FASTA records in the order this AGP gives, without re-applying
column 9, and choose your own gap length.
