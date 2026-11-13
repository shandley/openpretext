# Export compatibility with the Sanger and VGP curation pipelines: findings and plan

Date: 2026-11-13. Status: research complete, no code changed.

Sources, all in this directory:

- `pretextview-agp.md`: PretextView's AGP writer, read from its source at release 1.0.7.
- `downstream-tooling.md`: `pretext-to-asm` (Sanger Tree of Life) and `vgl-curation` (VGP), read from source.
- `agp-spec-and-validators.md`: the NCBI AGP 2.1 specification, validators, archive rules, other tools.
- Local ground truth: `test-data/case-study/quail/`, a released Sanger curation of king quail
  (the `.pretext` map and the AGP PretextView 0.2.5 wrote from it).

## What the downstream tools need

Both pipelines take the AGP that PretextView writes plus the pre-curation FASTA. They do not take
a curated FASTA from the viewer.

`pretext-to-asm` (sanger-tol/agp-tpf-utils):

- Requires the header line `# HiC MAP RESOLUTION: <float> bp/texel` and exits without it.
- Column 6 must be a sequence name in the input FASTA, with columns 7 and 8 in that sequence's
  coordinates. A cut contig is several rows with the same name. Rows from one sequence must tile
  it exactly or the tool raises an error.
- Reads tags from column 10 onward, case-sensitive: `Painted`, `Haplotig`, `Unloc`, `Contaminant`,
  `Target`, `FalseDuplicate`, `Primary`, `Singleton`, chromosome names such as `X`, `W`, `B1`.
  Any other word is silently treated as a haplotype name.
- Ignores object coordinates, part numbers and gap rows. Moves a breakpoint to a real gap when it
  is within about one texel of one, otherwise cuts the contig at the AGP coordinate.
- Adds back every input sequence the AGP does not mention, as an unplaced scaffold.

`vgl-curation` (VGP, also the Galaxy post-curation workflow):

- Needs object names ending `_<integer>`, haplotype tags `Hap_1` and `Hap_2`, and input names
  containing `H1`/`hap1` or `H2`/`hap2`.
- Reads `Painted` in column 10 and one of `Unloc`, `Haplotig`, `X`, `Y`, `W`, `Z` in column 11, by position.
- Uses object coordinates and gap rows, so the 100 bp gaps end up in the assembly.

## What PretextView writes

- Header: `##agp-version<TAB>2.1`, a `# DESCRIPTION:` line, and the resolution line.
- Rows come from map fragments in display order. Component id is the original sequence name.
  Coordinates are derived from texels only: `beg = floor(p0 * L / N) + 1`,
  `end = floor((p0 + len) * L / N)`, where `p0` is the fragment's first texel within its original
  sequence, `L` the genome length and `N` the map width in texels.
- Gap rows `U 100 scaffold yes proximity_ligation` between every adjacent pair in a painted scaffold.
- Painted scaffolds first, as `Scaffold_1..K` numbered by map position (contiguous runs only), then
  each unpainted fragment as its own one-row object.
- `Painted` in column 10 on painted rows, then one tag per column.
- Orientation is forced to `+` on unpainted fragments and single-fragment scaffolds (default option).
- Sequences that own no texel are left out.

## Where OpenPretext differs today

| Area | OpenPretext now | Needed |
|---|---|---|
| Component names | invents `name_L`, `name_R`, `a+b` | original sequence name on every row |
| Component coordinates | always `1..length` | interval of the original sequence, PretextView's arithmetic |
| Resolution header | absent | required by `pretext-to-asm` |
| Gap rows | `N 200` | `U 100` (the spec requires 100 for type U) |
| Object names | `scaffold_<id>`, `unplaced_<n>` | `Scaffold_<n>` by map position |
| Scaffold grouping | by id, even when not adjacent | contiguous runs |
| Tags | none written; four lower-case tags, one per contig | PretextView vocabulary, several per contig |
| Sex chromosomes | one generic tag | the chromosome's name (`X`, `Y`, `Z`, `W`, ...) |
| Excluded contigs | dropped from the file | must be present; a missing piece of a cut contig is a fatal error downstream, and a missing whole sequence is added back as unplaced |
| AGP import | matches by name only; cannot read cuts or tags | read PretextView AGPs, including cuts, paint and tags |

## Checked against the quail curation

Using only the header of `bCotChi1.combined.pretext` and the released AGP:

- The resolution string we would compute (`59245.052002`) equals the one in the file.
- For 482 of the 485 sequences in the AGP, our parsed texel width reproduces PretextView's end
  coordinate exactly. Every cut in the file falls on a texel boundary under the formula above, and
  every cut sequence tiles exactly.
- Three sequences get one texel in PretextView and none in our parser, and three get a texel from
  us and are absent from the AGP. PretextView assigns texels to sequences by a rule that differs
  from ours at these edges. The rule has to be read from PretextView's loader and matched, because
  it also decides where contig boundaries are drawn.

## A defect found on the way (not yet confirmed by a test)

Contig lengths come from float32 fractions in the map header, so they are approximate. FASTA export
of a cut contig ends the last piece at the approximate length. When the true sequence is longer,
the bases past that point are dropped.

## Plan

1. **Texel ownership.** Read PretextView's loader, match its sequence-to-texel rule, and pin it
   with the quail file (all 485 sequences, and the 160 that own no texel).
2. **Row model and writer.** Build AGP rows from the display mapping (texel spans), not from contig
   records: original names, PretextView's coordinate arithmetic, `U 100` gaps, `Scaffold_<n>`
   numbering, the resolution header, the singleton orientation rule. Rejoined pieces of one
   sequence merge back into one row. Offer two files from one model: the PretextView-compatible
   file (with tag columns) and a strict nine-column AGP 2.1 file for validators and archives.
3. **Tags.** Replace the four single tags with PretextView's vocabulary, several per contig, with
   named sex chromosomes and haplotype tags. Carry them through cut, join, sessions and the sidebar.
4. **Import.** Read a PretextView AGP onto a loaded map: cuts from intervals, order, orientation,
   paint and tags. This is also the test vehicle for step 5.
5. **Acceptance tests.**
   - Import the released quail AGP onto its map and export: the rows must equal the original.
   - The 14 real PretextView AGPs in `agp-tpf-utils/tests/data` (MIT): round-trip each through our
     model, then run `pretext-to-asm` itself on our export and compare with the expected outputs
     shipped in that repository.
   - Run NCBI `agp_validate` on the nine-column file.
6. **FASTA and BED.** Fix the dropped bases. No downstream tool reads a scaffold-structure BED, so
   keep it only as a convenience and make it use the same row model.
7. **Docs and UI.** Rewrite `docs/AGP_EXPORT.md`, add the export choice to the UI, and state the
   pixel-resolution limit the same way PretextView does.

## Decisions needed

1. **Excluded contigs in the PretextView-compatible file.** They must be written. Proposal: each
   excluded contig must carry a tag that says why (`Contaminant`, `Haplotig` or `FalseDuplicate`),
   which is how the Sanger tool removes sequence; export stops and lists any excluded contig
   without one.
2. **Cut pieces left in place.** Proposal: keep them as separate rows, as PretextView 1.0.6 and
   1.0.7 do, because a cut is a deliberate edit. Earlier releases and the unreleased next one merge
   them, which makes such a cut invisible downstream.
3. **Which pipeline first.** Proposal: Sanger `pretext-to-asm` first (it has fixtures and we can run
   it), VGP second.

## Not established

- Whether ENA's Webin validator accepts `proximity_ligation` as linkage evidence. Its source omits
  it; this needs a real Webin test.
- PretextView 1.0.6 and 1.0.7 behaviour for adjacent cut pieces is read from code, not from a run.
- `agp_validate` and `pretext-to-asm` have not been run on this machine yet.
