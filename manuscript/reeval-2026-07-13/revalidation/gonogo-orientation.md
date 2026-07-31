# GO/NO-GO: in-app curated orientation survives to FASTA/AGP export

Date: 2026-07-13
Scope: OpenPretext (/Users/shandley/Code/software/openpretext), commit HEAD 7c7517b.
Question: when a curator inverts (and cuts/joins) contigs INSIDE the app and then
exports, does FASTA reverse-complement the inverted contigs and does AGP emit the
correct +/- orientation column? And does the prior "inverted: false" loader concern
touch this path?

## VERDICT: GO

In-app curated orientation is recorded in state and the undo stack, and it survives
to both exports. FASTA reverse-complements inverted contigs (including through
cut-then-invert-then-join). AGP emits the correct +/- orientation column. Verified by
174 passing unit tests across the five relevant files and by a headless CLI run on a
real 424-contig assembly where an in-app invert flipped exactly one AGP orientation
column from + to -. The "inverted: false" loader concern is confined to the fresh
.pretext load baseline and does NOT corrupt in-app-curated orientation on export.

One caveat that IS on the case-study path: invert-then-join is a standard curation
sequence, and joining two contigs of DIFFERING orientation collapses the merged AGP
orientation column to + (see Caveat below, demonstrated empirically). This does not
change the GO, because the orientation-concordance metric should score orientation from
the FASTA (segment-level revcomp, always correct) or from name-matched AGP W-lines, and
merged components receive a synthetic name (chrA+chrB) that matches no reference contig.
The caveat only bites a metric that reads the per-contig AGP orientation column for
merged components.

## 1. The in-app invert path records and applies orientation

File: src/curation/CurationEngine.ts

- invert(contigOrderIndex) (lines 343-377) toggles the contig's `inverted` flag via
  state.updateContig, AND reverse-complements the contig's sequence provenance
  (`sequenceSegments`) via flipSegments (lines 357-360). It records a full `invert`
  CurationOperation onto the undo stack including previousInverted and previousSegments
  (lines 362-372), so the operation is exactly reversible (undoInvert, lines 382-392;
  reapplyInvert for redo, lines 648-667).
- cut (lines 143-232) propagates orientation: each half inherits `contig.inverted`
  (lines 179, 190) and carries display-order `sequenceSegments` produced by
  splitDisplaySegments, which correctly maps a reverse-complemented segment's split to
  the opposite end of its source range (lines 82-111).
- join (lines 257-322) concatenates both inputs' segments (lines 279-282). `inverted`
  is preserved when both agree and defaults to false when they differ (lines 283-284) —
  this is the one caveat below; segments still export correctly.

Orientation state therefore lives on each contig (`inverted` + `sequenceSegments`) and
in the undo stack, and it is applied immediately (state mutation + render event).

## 2. The export path honours orientation

FASTA — src/export/FASTAWriter.ts
- resolveContigSequence (lines 99-118): a contig with `sequenceSegments` (any cut/join
  product) is rebuilt segment by segment, reverse-complementing each segment whose
  `revComp` flag is set (lines 104-113). A source contig with no segments is looked up
  by name and reverse-complemented iff `inverted` (lines 115-117). Both cases are
  covered. The header also records orientation= +/- (line 159-160).

AGP — src/export/AGPWriter.ts
- buildScaffoldAGPLines (lines 101-152): the orientation column (column 9) is
  `contig.inverted ? '-' : '+'` (line 144). Emitted through formatAGPLine (lines
  157-184) and exportAGP (lines 205-244).

## 3. Unit tests that pin this behaviour — ALL PASS

Ran: `npx vitest run tests/unit/fasta.test.ts tests/unit/export.test.ts
tests/unit/curation.test.ts tests/unit/agp-parser.test.ts tests/unit/curate-cli.test.ts`
Result: 5 files, 174 tests, 174 passed (0 failed). Duration ~170ms.

Directly load-bearing tests:
- fasta.test.ts "exportFASTA - inverted contig" > "should reverse complement sequence
  for inverted contig" (lines 373-385): asserts header `>ctg1 orientation=-` and the
  emitted sequence equals reverseComplement('ATCGATCG').
- fasta.test.ts "exportFASTA - cut/join sequence composition (orientation)"
  (lines 610-689): the case-study composite path.
  - "cuts an inverted contig into correctly reverse-complemented halves" (641-652).
  - "reverse-complements a cut half when it is subsequently inverted" (654-666):
    cut(0,4) then invert(0), asserts chr1_L => 'TTTT', chr1_R => 'CCCC', header
    orientation=-. This is cut-then-invert on a real CurationEngine call.
  - "joins two inverted contigs into the correct concatenated sequence" (668-688):
    two inverted contigs joined => 'TTTTCCCC' and header orientation=-.
- fasta.test.ts "should round-trip with inverted contigs by double-inverting"
  (lines 520-535): exported inverted sequence == reverseComplement(original).
- fasta.test.ts reverseComplement unit tests (lines 281-300).
- export.test.ts "buildScaffoldAGPLines" > "should set orientation to - for inverted
  contigs" (lines 182-199): asserts orientation '+' then '-' for a non-inverted then
  inverted contig.
- export.test.ts AGP full-file test (lines 354+) "should handle inverted contigs with -
  orientation".

## 4. Empirical CLI evidence on a real assembly

Tool: headless `bench/curate.ts` (applies a DSL script to a real .pretext, exports AGP).
File: test-data/Coturnix_chinensis_post.pretext (424 contigs).

Baseline (script `echo baseline`) — order index 1 is SUPER_3:
```
unplaced_1	1	104650381	1	W	SUPER_3	1	104650381	+
```
After in-app invert (script `invert #1`):
```
[ok  ] line 1: Inverted contig 'SUPER_3'  (invert #1)
unplaced_1	1	104650381	1	W	SUPER_3	1	104650381	-
```
Diff of the two AGP W-line sets: exactly one line changed, SUPER_3's orientation
column + -> -. Every other contig's orientation is untouched. This confirms the invert
recorded in-app propagates to the AGP orientation column on export, on a real assembly.

(FASTA revcomp cannot be shown from the CLI because .pretext files carry no nucleotide
sequences; the FASTA revcomp claim is pinned by the unit tests in section 3, which call
the real CurationEngine and exportFASTA.)

## 5. Scope of the "inverted: false" loader concern

The literal `inverted: false` assignments in a loader path are:
- src/ui/FileLoading.ts:84 — the fresh .pretext load. Every contig starts at
  inverted:false. This is the CORRECT baseline, not data loss: the .pretext binary
  format does not encode per-contig orientation at all (src/formats/PretextParser.ts
  contains zero orientation/invert/strand handling — grep is empty). In-app curation
  toggles orientation from this baseline, so the export path is unaffected.
- src/ui/FileLoading.ts:229 — synthetic demo data. Irrelevant to real curation.

The concern's phrasing ("inversion may not be recovered when LOADING an external
AGP/assembly") points at the AGP IMPORT path, which is DISTINCT from the fresh-load
path and DISTINCT from the case-study path:
- AGP import: src/ui/ExportSession.ts:198 deriveAGPPlan, then lines 210-214
  state.updateContigs applies `inverted: inv.inverted`. AGPParser.ts:64 reads
  `inverted: cols[8] === '-'`. So AGP import DOES recover orientation into the
  `inverted` flag, and on re-export FASTA/AGP reflect it correctly (source contigs have
  no segments, so the name-lookup + inverted revcomp branch is exactly right).
- Session import: ExportSession.ts:100-112 applies `override.inverted` too.

Conclusion on scope: the `inverted: false` loader literal affects ONLY the initial
fresh-load baseline and cannot corrupt in-app-curated orientation on export. The
case-study path (curate in-app, then export) never depends on recovering orientation
from an external file. Even the AGP-import path recovers orientation correctly. No
NO-GO condition found.

## Caveat (mixed-orientation join, ON the case-study path)

CurationEngine.join (lines 283-284): when the two joined contigs have DIFFERING
`inverted` values, the merged contig's `inverted` defaults to false. Invert-then-join is
a normal curation sequence, so this is on the case-study path, not off it.

Empirically demonstrated with the CLI on the real 424-contig assembly. Script
`invert #1` then `join #0 #1` (SUPER_1 is +, SUPER_3 was just inverted to -):
```
[ok  ] line 1: Inverted contig 'SUPER_3'
[ok  ] line 2: Joined contigs at positions 0 and 1
unplaced_0	1	289607445	1	W	SUPER_1+SUPER_3	1	289607445	+
```
The merged W-line reads orientation + even though SUPER_3 was inverted; AGP allows only
one orientation per component and cannot represent the mixed strandedness. Note the
merged component's synthetic name `SUPER_1+SUPER_3`.

Why this does NOT break the concordance metric (and does NOT flip the GO):
- FASTA export is segment-level and stays correct through mixed-orientation joins
  (each segment carries its own revComp flag; the inverted part is reverse-complemented
  regardless of the collapsed contig-level `inverted`).
- The merged contig has a synthetic name (chrA+chrB / SUPER_1+SUPER_3) that matches no
  reference contig, so a name-keyed metric skips it and a FASTA-alignment metric reads
  the correct sequence.
- The caveat only bites a metric that reads the per-contig AGP orientation COLUMN for
  merged components. Recommendation for the case-study protocol: score orientation from
  the FASTA (or from name-matched AGP W-lines), not from the AGP orientation column of
  merged components.

Test gap (flagged, not fixed): no unit test pins mixed-orientation join OUTPUT. The
passing join test at fasta.test.ts:668 joins two SAME-orientation contigs (both
inverted=true, so mergedInverted stays true and orientation=-). The claim that FASTA is
correct for a DIFFERING-orientation join is sound by construction (segment revComp flags
are independent of the collapsed contig-level flag) but is currently untested. A test
that inverts one of two adjacent contigs, joins them, and asserts the merged FASTA
sequence concatenates the plus-strand of one with the revcomp of the other would close
it.
