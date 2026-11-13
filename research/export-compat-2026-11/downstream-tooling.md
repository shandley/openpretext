# What happens to a PretextView AGP after curation: downstream tooling

Research date: 2026-11-13. Everything below was read from the cited repository at the commit or date shown. Each fact is labelled **[source]** (read in code), **[docs]** (README, help text or official page) or **[third party]** (tutorial or downstream user). Items that could not be confirmed are marked NOT FOUND and collected in section 10.

No code from these repositories was executed. Behaviour described from source is a reading of the code, not an observed run.

## 0. Repositories checked

| Repository | Exists | License | State when read |
|---|---|---|---|
| `sanger-tol/agp-tpf-utils` https://github.com/sanger-tol/agp-tpf-utils | yes | MIT ("Copyright (c) 2023 Tree of Life programme") | HEAD `74af3fb`, 2026-11-12. `pyproject.toml` version `1.4.1`. Latest GitHub release `v1.4.0` (2026-09-21); tag `v1.4.1` exists. Bioconda recipe `pretext-to-asm` is at 1.4.1. |
| `sanger-tol/rapid-curation` | name redirects | n/a | `gh api repos/sanger-tol/rapid-curation` returns `sanger-tol/curation-resources`. The repository was renamed. |
| `sanger-tol/curation-resources` https://github.com/sanger-tol/curation-resources | yes | MIT | HEAD `d876318`, 2026-08-13. Current home of the Sanger curation workflow README. |
| `wtsi-grit/rapid-curation` (GitLab) https://gitlab.com/wtsi-grit/rapid-curation | yes | MIT ("Copyright (c) 2021 Genome Research Ltd.") | Last commit 2026-06-10. README banner: "THIS REPOSITORY IS NO LONGER MAINTAINED. PLEASE SWITCH TO NEW REPOSITORY AT - Curation Resources". Still holds `rapid_split.pl`, `rapid_join.pl`, `rapid_split.py`, `rapid_join.py`, `multi_join.py`. |
| `sanger-tol/curationpretext` | yes | not detected by GitHub (`NOASSERTION`) | Release 1.6.1, 2026-03-24. |
| `sanger-tol/treeval` | yes | `NOASSERTION` | Release 1.4.8, 2026-07-22. |
| `sanger-tol/PretextView` | yes | not checked | Sanger fork; README read for its AGP section only. |
| `sanger-tol/curationtoolkit` | yes | not checked | README only; launches map builds, not relevant to AGP. |
| `sanger-tol/Pretext-curation-tools` | yes, but empty | n/a | Clone reports an empty repository. |
| `thebgacademy/manual-curation` https://github.com/thebgacademy/manual-curation | yes | MIT | HEAD `7e325a5`, 2024-10-01. Biodiversity Genomics Academy training by the Sanger GRIT team. Documents the older script chain. |
| `Nadolina/Rapid-curation-2.0` https://github.com/Nadolina/Rapid-curation-2.0 | yes | none | Last push 2024-09-17. README: "this software is no longer being maintained." Original VGP post-curation scripts. |
| `vgl-hub/vgl-curation` https://github.com/vgl-hub/vgl-curation | yes | MIT | v1.1, 2026-01-21. Maintained successor of Rapid-curation-2.0. |
| `galaxyproject/tools-iuc`, `tools/vgp_processcuration` | yes | MIT | Galaxy wrappers for `vgl-curation` 1.1. |
| `galaxyproject/iwc`, `workflows/VGP-assembly-v2/post-curation-processing` | yes | not checked | Workflow v0.3, 2026-10-19. |
| `zilov/grit` https://github.com/zilov/grit | yes | none | Last push 2026-11-10. "GRIT CLI toolkit for genome curation related steps". Wraps `pretext-to-asm`. Treated as third party. |

Two pipelines exist. Sanger Tree of Life uses `pretext-to-asm`. The VGP (Vertebrate Genome Lab, Rockefeller) uses `vgl-curation` with `gfastats`, on the command line or in Galaxy. They read the same PretextView AGP but have different rules, so they are described separately (Sanger in sections 1 to 8, VGP in section 9).

## 1. The current Sanger Tree of Life workflow

### 1.1 Workflow as documented

**[docs]** `sanger-tol/curation-resources/README.md` (2026-08-13), section "Suggested workflow":

> Manipulate the assembly in PretextView app using Edit mode (E).
> Tag unlocalised scaffolds, haplotigs, contaminats, haplotypes etc, using meta-data tag mode (M) in PretextView.
> Unlocs (linked to chromosome but no specific location found) should be placed at the start/and/or/end of a chromosome to be included when the chromosomes are painted in the subsequent step.
>
> Once the map has been rearranged and meta-data tags added paint the chromosomes using Scaffold Edit mode (S).
>
> Export the map to AGP. (Some input scaffolds won't feature in the output AGP due to PretextView resolution. These will be recovered in the next step).
>
> Run pretext-to-asm , pointing it at the original FASTA and the Pretext AGP. This will output a FASTA that mirrors the chromosomes that have been built in PretextView, and which will have the same number of basepairs as the original TPF. The script will produce stats (joins/breaks/hap-dup removals).
>
> Produce a new Pretext map from the curated fasta file to check it.

The maps a curator starts from come from `sanger-tol/treeval` or `sanger-tol/curationpretext` (same README: "To generate the analysis data used for curation run one of the nextflow pipelines").

### 1.2 The tool: `pretext-to-asm`

**[docs]** `agp-tpf-utils/README.md`:

> Takes the AGP file output by PretextView and the input assembly (usually FASTA), and produces an output assembly in FASTA and AGP formats. The input and output file formats are determined from the extensions of the files.

**[source]** `pyproject.toml` installs five commands: `asm-format`, `find-overlaps`, `index-fasta`, `p2asm` and `pretext-to-asm` (the last two are the same entry point, `tola.assembly.scripts.pretext_to_asm:cli`).

`asm-format` **[docs]**: "Parses and reformats AGP and TPF files, converting into either format."

### 1.3 Inputs

**[source]** `src/tola/assembly/scripts/pretext_to_asm.py`, click options:

| Option | Required | Help text (quoted) |
|---|---|---|
| `-a, --assembly` | yes | "Assembly before curation, usually a FASTA file. FASTA files will be indexed, creating a '.fai' and a '.agp' file alongside the assembly if they are missing or are older than the FASTA. Supports gzip compresed '.gz' files." |
| `-p, --pretext` | yes | "Assembly file from Pretext, which is usually an AGP." |
| `-o, --output` | no | "Output file template, typically: '<ToLID>.<VERSION>.fa' ... If <VERSION> is not specified, it defaults to '1'. The output file type is determined from its extension." Without it the result is printed to STDOUT. |
| `-c, --autosome-prefix` | no | default `SUPER_` |
| `--info-yaml` / `--auto-find-yaml` | no | A Sanger YAML that points at extra haplotig, mitochondrial (`mito`) and chloroplast (`plastid`) FASTA files to append. Using it requires `gfastats` on the PATH. |
| `-k, --keep-map-order` | no | "Output a single assembly in the order of input Pretext map AGP." |
| `--default-assembly-name` | no | Name for output not split by haplotype. |
| `--max-contig-length` | no | default 2,000,000,000. Longer scaffolds are broken at the gap nearest the ideal cut and get suffixes `_1`, `_2`. `--no-max-contig-length` turns this off. |
| `--min-contig-length` | no | default 1000. "Contigs shorter that this are removed from the assembly and saved in a 'shorts' file." |
| `-f`, `-l`, `-w/-W` | no | clobber, log level, log file. |

Only two inputs are needed: the PretextView AGP and the pre-curation assembly. **No TPF is needed.** The assembly may be FASTA, AGP or TPF (format chosen from the file extension; `format_from_file_extn` accepts `.agp`, `.tpf`, `.fa`, `.fasta`, optionally `.gz`). The test suite runs with a TPF as the assembly. FASTA output needs FASTA input (**[source]** `file_writers.py`: "Cannot write FASTA output file without FASTA input!").

### 1.4 Outputs

**[source]** `pretext_to_asm.py` (`name_assemblies`, `parse_output_file`) and `file_writers.py`. For `--output mVulVul1.2.fa` the root is `mVulVul1` and the version is `2`.

Single-haplotype map:

- `<root>.<version>.primary<ext>`: the curated assembly (FASTA, AGP or TPF according to the extension).
- An AGP written next to every FASTA. The code uses `output_file.with_suffix(".agp")`, which gives `<root>.<version>.primary.agp` for `.fa` and `<root>.<version>.primary.fa.agp` for `.fa.gz`. The help text says "an AGP format file ('.fa.agp') is also written", which matches only the gzip case.
- `<root>.<version>.haplotigs<ext>`: sequence tagged `Haplotig`.
- `<root>.<version>.contaminants<ext>`: sequence tagged `Contaminant` (the name is built as `asm_key.lower() + "s"`).
- `<root>.<version>.falseduplicates<ext>`: sequence tagged `FalseDuplicate`.
- `<root>.<version>.shorts<ext>`: scaffolds under `--min-contig-length`.
- `<root>.<version>.primary.chromosome.list.csv`: chromosome list, no header (section 4).
- `<root>.<version>.chr_report.csv`: per-chromosome report with a header.
- `<root>.<version>.info.yaml`: curation statistics.
- `<root>.<version>.log`: log.
- With the Sanger YAML and FASTA: `.gfastats`, `.gather_vgp_stats`, `.sum_chrs`.

Two or more haplotypes in one map: `<root>.<hapname lowercased>.<version>.primary<ext>` and `<root>.<hapname lowercased>.<version>.primary.chromosome.list.csv` per haplotype.

Real output names from `tests/data/bChlMac1_3/`:

```
bChlMac1-pretext-to-tpf.3.chr_report.csv
bChlMac1-pretext-to-tpf.3.haplotigs.tpf
bChlMac1-pretext-to-tpf.3.info.yaml
bChlMac1-pretext-to-tpf.3.log
bChlMac1-pretext-to-tpf.hap1.3.primary.chromosome.list.csv
bChlMac1-pretext-to-tpf.hap1.3.primary.tpf
bChlMac1-pretext-to-tpf.hap2.3.primary.chromosome.list.csv
bChlMac1-pretext-to-tpf.hap2.3.primary.tpf
```

`info.yaml` from `tests/data/idSyrVitr1/`:

```yaml
assemblies:
  Primary:
    manual_breaks: 33
    manual_joins: 124
manual_haplotig_removals: 1
percent_assembly_in_chromosomes: 97.5
interventions_per_gbp: 403.046
```

### 1.5 The older Sanger chain, now retired

**[docs]** The GitLab README (retired repository) describes the previous workflow: `rapid_split.pl` makes a TPF from the FASTA ("splits at all Ns"), `pretext-to-tpf` (an earlier name of the same `agp-tpf-utils` tool, taking the TPF and the Pretext AGP, default prefix shown as `RL_`) writes curated TPFs, and `rapid_join.pl -fa <fasta> -tpf <tpf> -csv <pre-csv> -out <prefix> [-hap]` turns the TPF back into FASTA.

**[source]** `curation-resources` commit `9773560` (2025-01-10, "slimmed down for v1.1.3") deleted `multi_join.py`, `rapid_join.pl`, `rapid_join.py`, `rapid_split.pl` and `rapid_split.py`. They had been added or updated in `0201fbc` (2024-10-14, "Scripts updated to python versions and multi haplotype version"). So `pretext-to-asm` with a FASTA replaced the split, convert and join steps.

**[source]** `rapid_join.pl` (GitLab copy) dies on conditions an older pipeline user could still hit: "Sequence can't begin with gap in line N", "ERROR: attempt to reuse scaffold name", and "ERROR: you are trying to run rapid_join.pl on a full curation file" if a FASTA id matches `_ctg1`. A `GAP` line with no parsable length is given 200 N.

`rapid_pretext2tpf_XL.py`: see section 10. It is referenced by the 2024 BGA training README (**[third party / training]**) with this usage, taking the FASTA and the AGP and writing `chrs.csv`, `rapid_prtxt_XL.tpf` and `haps_rapid_prtxt_XL.tpf`:

```
python rapid_pretext2tpf_XL.py ./test_data/ilThyBati1.PB.asm1.purge1.polish1.scaff1.decontaminated.fa ./test_data/ilThyBati1_precurated.pretext.agp_1
```

An even older README (commit `5a84bb8`, 2021-11-23) documents `rapid_pretext2tpf.py [-h] tpf agp` and `rapid_stats.py`.

## 2. How `pretext-to-asm` reads the PretextView AGP

### 2.1 Columns used

**[source]** `src/tola/assembly/parser.py`, `parse_agp`:

- Blank lines are skipped. Lines starting `##` are skipped ("We don't care about ## lines, do we?"). Lines starting `#` are stored as header text after stripping the leading `#` and whitespace.
- Each data line is `rstrip()`ped and split on tabs. The comment says "AGP from pretext has stray tab on end of line, but rstrip() will remove it."
- Column 1 (object): a new scaffold starts whenever this value changes from the previous line.
- Column 5: `U` or `N` makes the row a gap, using column 6 as length and column 7 as gap type. Anything else makes it a sequence row.
- Sequence rows use column 6 (component name), column 7 (start, `int`), column 8 (end, `int`), column 9 (strand, looked up in `{"?": 0, "+": 1, "-": -1}`; any other value raises `KeyError`).
- Columns 10 onwards become the tag tuple: `tags=tuple(fields[9:])`.
- **Columns 2, 3 and 4 (object start, object end, part number) are never read.**

**[source]** `build_assembly.py`, `find_assembly_overlaps`: the loop is `for prtxt_frag in prtxt_scffld.fragments()`. Gap rows in the PretextView AGP are parsed and then ignored. Gaps in the output come from the input assembly, plus a default gap at each new join (section 4.4).

### 2.2 The resolution header is mandatory

**[source]** `assembly.py`, `bp_per_texel`: the header lines are searched with

```python
re.match(r"HiC MAP RESOLUTION: ([\d\.]+) bp/texel", txt)
```

**[source]** `pretext_to_asm.py`: if no value is found the program exits with

```
No bp_per_texel value in the PretextView AGP file '<file>'
(Are the -a/--assembly and -p/--pretext arguments the right way around?)
```

So the AGP must contain a single-`#` comment line of the form `# HiC MAP RESOLUTION: 11889.944305 bp/texel`. A `##` line would be skipped and would not count.

The tolerance used everywhere below is **[source]** `error_length = 1 + math.floor(self.bp_per_texel)`, described in the docstring as "Expected maximum resolution from bp_per_texel as an integer which is guaranteed to be larger than the smallest length from Pretext ... i.e. 2300.000000 becomes 2301".

### 2.3 Building the input assembly from FASTA

**[source]** `src/tola/fasta/parse.py`: each FASTA record becomes a scaffold. Runs matching `[ACGTacgt]+` are contigs; "Treat any non-ACGT character as an "N" (i.e. gap)". Each gap is stored as `Gap(length, "scaffold")` with its true length. The sequence name is the first whitespace-delimited token after `>`. Two records with the same name raise "More than one sequence named ...".

### 2.4 Mapping AGP rows onto real contigs

**[source]** `build_assembly.py` and `indexed_assembly.py`. For each sequence row of the AGP (the "bait"):

1. The component name (column 6) must be a sequence name in the input assembly. Otherwise `scaffold_by_name` raises `ValueError`: "No such Scaffold '<name>' in Assembly '<asm>'".
2. If that component name appears on **exactly one** row in the whole AGP, the coordinates are ignored and the whole input scaffold is taken (`whole_fragment_overlap`: "Returns the whole fragment matched by name only").
3. Otherwise `find_overlaps` returns every contig and gap of the input scaffold that overlaps `[start, end]`, with leading and trailing gaps dropped. If nothing overlaps, it logs `No overlaps found for: <fragment>` and skips the row.
4. `trim_large_overhangs(err_length)` then drops a terminal contig when the result overhangs the bait by more than `error_length` at that end **and** the bait covers less than `error_length` of that contig. This is the snap to a gap: a row that ends within one texel past a gap does not claim the next contig.
5. A contig can still be claimed by two rows. `discard_overhanging_fragments` runs an `OverhangResolver` repeatedly. Its rules:
   - Two claimants that both overlap the contig by less than `error_length`: the contig is removed from the one with the shorter overlap. Comment: "To prevent cuts being made which result in Fragments smaller than a Pretext pixel".
   - Otherwise the removal that most reduces the absolute overhang is applied, only if it improves that claimant and would worsen the next best, and only if the leftover overhang stays above `-3 * err_length`. Comment: "Guard against removing fragments which would produce a large negative overhang - they should be cut instead."
   - A contig that is the only row of a result is never removed, and a contig is only removed where it is present in more than one result ("or we would be removing sequence data from the assembly").
6. Contigs still shared after that are **cut inside the contig** (`cut_remaining_overhangs`, `cut_fragments`, `OverlapResult.trim_fragment`). The cut positions are the AGP coordinates. The first piece keeps the contig's true start and the last piece keeps its true end. Each piece gets the tag `Cut` plus the bait's tags other than `Painted`.
7. `qc_sub_fragments` then checks that the pieces abut with no overlap and no loss. If not it raises `ValueError` with one or more of:
   - "Sum of fragment lengths N does not match orginal fragment length M"
   - "Expecting 0 but got N overlaps in new sub fragments"
   - "Expecting N abutting sub fragments but got M"
   - "Gap of length N (P pixels) between: ..."
8. `add_missing_scaffolds_from_input` adds back every input contig that no AGP row claimed, under its input scaffold name, as an unplaced scaffold. This recovers sequences too small to appear in the map.
9. A row with strand `-` has its matched block reversed (`OverlapResult.to_scaffold`).

So, when a cut does not land on a gap: within about one texel of a gap it is moved to the gap, and anywhere else the contig itself is cut at the AGP coordinate and the event is logged. Real log from `tests/data/nxCaeSini1/` (resolution 2,326 bp per texel):

```
Contig:
        3,034,203  SCAFFOLD_1:22307438-25341640(+)
cut into:
          223,325  SCAFFOLD_1:22307438-22530762(+) Cut
           23,261  SCAFFOLD_1:22530763-22554023(+) Cut Haplotig
        2,787,617  SCAFFOLD_1:22554024-25341640(+) Cut
```

The summary line distinguishes the two kinds: "Curation made 0 cuts in contigs, 33 breaks at gaps and 124 joins" (`tests/data/idSyrVitr1/*.log`).

### 2.5 What the coordinates in a real PretextView AGP look like

From `tests/data/idSyrVitr1/idSyrVitr1-pretext.agp` (PretextView 0.2.5). Column 6 is the **input scaffold name** and columns 7 and 8 are positions in that scaffold, rounded to texels. The pieces of `scaffold_1` tile exactly (`1-12103963`, then `12103964-48059154`, then `48059155-...`):

```
##agp-version	2.1
# DESCRIPTION: Generated by PretextView Version 0.2.5
# HiC MAP RESOLUTION: 11889.944305 bp/texel
Scaffold_1	1	12103963	1	W	scaffold_1	1	12103963	+	Painted	
Scaffold_1	12103964	12104063	2	U	100	scaffold	yes	proximity_ligation
Scaffold_1	12104064	12246742	3	W	scaffold_55	1	142679	+	Painted	
Scaffold_1	12246743	12246842	4	U	100	scaffold	yes	proximity_ligation
Scaffold_1	12246843	48202033	5	W	scaffold_1	12103964	48059154	+	Painted	
```

Sequence rows end with a trailing tab. Gap rows are `U`, length 100, `scaffold`, `yes`, `proximity_ligation`. Headers seen across the 14 fixtures: `##agp-version	2.1` (9 files) or `##agp-version	<NA>` (5 files); `# DESCRIPTION: Generated by PretextView Version 0.2.5` (10 files), `PretextViewAI Version 1.0.0` (2) or `PretextViewAI Version 1.0.4` (2); and in 5 files a fourth line `# WARNING: Non-standard AGP, singletons may be reverse-complemented`.

## 3. Tag vocabulary

### 3.1 The list in the README

**[docs]** `agp-tpf-utils/README.md`, "Tags": "Single words appended in tab-delimted columns beyond column 9, they can contain:"

> - `Contaminant` or `Target`
> - `FalseDuplicate`
> - `Haplotig` for haplotype-specific contigs.
> - Haplotypes: `Hap1`, `Hap2`...
> - `Painted` where fragment has HiC contacts.
> - `Primary` for tagging the only curated haplotype in a multi-haplotype PretextView map.
> - `Singleton` to flag chromosomes which were not found in any other haplotypes.
> - `Unloc` are fragments attached to chromosomes but unlocalised within them.
> - Sex Chromosomes: `U`, `V`, `W` or `W1`, `W2`..., `X` or `X1`, `X2`..., `Y` or `Y1`, `Y2`..., `Z` or `Z1`, `Z2`...
> - B Chromosomes: `B1`, `B2`, `B3`...

### 3.2 How the code classifies a tag

**[source]** `naming_utils.py`, `ScaffoldNamer.make_scaffold_name`. Tags are compared as exact, case-sensitive strings, in this order:

1. `Painted`: the PretextView scaffold is a curated chromosome.
2. `Target`: switches on target mode (below).
3. `Primary`: marks the curated haplotype (section 5).
4. Anything matching `re.fullmatch(r"([A-Z]\d*[A-Z]?|[IVX_]+|\d+[A-Z]+)", tag)` is a **chromosome name**. Comment: "This tag looks like a chromosome name, e.g. "X1", "I_II", "2RL"".
5. Members of `OTHER_KNOWN_TAGS = {"Contaminant", "Cut", "FalseDuplicate", "Haplotig", "Singleton", "Unloc"}` are handled elsewhere.
6. **Any other string is taken as a haplotype name.** Comment: "Any tag that doesn't look like a chromosome name is assumed to be a haplotype, and we only expect to find one within each Pretext Scaffold".

Rule 6 is the one an exporter must respect. A tag spelled `haplotig`, `contaminant`, `unlocalised`, `Sex` or `sex chromosome` is none of the known strings, so it would be read as a haplotype called by that name and the output would be split into a file per such "haplotype".

Scope **[source]**: `Painted`, `Target`, `Primary`, chromosome names and haplotype names apply to the whole PretextView scaffold (the code takes the union of tags over all rows of the AGP object, `Scaffold.fragment_tags`). `Contaminant`, `FalseDuplicate`, `Haplotig` and `Unloc` apply to the individual row that carries them (`label_scaffold` tests `fragment.tags`).

### 3.3 What each tag does

| Tag (exact) | Effect | Source |
|---|---|---|
| `Painted` | The AGP object becomes a chromosome. Without a chromosome-name tag it is an autosome (rank 1) and is renamed by size. | **[source]** `make_scaffold_name`: `rank = 1  # Rank for autosomes` |
| chromosome name, e.g. `X`, `Y`, `Z`, `W`, `X1`, `B1`, `U`, `V`, `I`, `II`, `I_II`, `2RL` | The scaffold is a named chromosome (rank 2), called `<prefix><tag>`, e.g. `SUPER_X`. Two different name tags in one PretextView scaffold raise `TaggingError`. | **[source]**; **[docs]** help epilog: "Upper case letters followed by zero or more digits are assumed to be chromosome names. e.g. 'X', 'W', 'B1'" |
| `Haplotig` | Row goes to the separate haplotigs file, named `H_1` to `H_n`. | **[docs]** help: "Haplotig taggged scaffolds are saved in a separate 'Haplotigs' file. The haplotig scaffolds receive names 'H_1' to 'H_n', sorted and numbered from longest to shortest." **[source]** `haplotig_name`, `rename_haplotigs_by_size` |
| `Unloc` | Row becomes its own scaffold named `<chr>_unloc_<n>`, attached to its chromosome. Must be inside a painted scaffold. | **[docs]** help: "Unloc tagged scaffolds receive names 'CHR_unloc_1' to 'CHR_unloc_n', added to the end of their chromosome and sorted and numbered from longest to shortest." **[source]** `unloc_name`; error: "Unloc in unpainted scaffold '<name>': <fragment>" |
| `Contaminant` | Row goes to the separate contaminants file under its input name. | **[docs]** help: "Contaminant tagged scaffolds are saved in a separate 'Contaminants' file." |
| `Target` | Inverts contaminant marking. | **[docs]** help: "Target tags can insted be used to label the non-contaminant scaffolds ... Any un-tagged scaffolds will then be treated as if they were tagged with Contaminant. (Any contaminants occurring before the first Target tag in the PretextView AGP must still be individually tagged with Contaminant.)" |
| `FalseDuplicate` | Row goes to a separate file, named `False_Duplicate_<n>`. | **[docs]** help: "for tagging duplicated regions in multi-haplotype Pretext maps which should be removed, not moved to another haplotype." **[source]** `false_duplicate_name` |
| `Primary` | In a combined map where one haplotype is curated, marks that haplotype. | **[docs]** help: "is used to tag the first 'Painted' chromosome in the curated haplotype." **[source]**: "Subsequent "Primary" tags after the first move the scaffold into the primary haplotype." |
| `Singleton` | Used when grouping chromosomes across haplotypes. | **[docs]** help: "is used to flag autosomes which were not found in any other haplotype." |
| `Cut` | Added by the tool to contig pieces it cut, and written into its output AGP. It is in `OTHER_KNOWN_TAGS`, so it is tolerated on input. | **[source]** `overlap_result.py`, `trim_fragment` |
| any other word, e.g. `Hap1`, `HAP2` | Haplotype name (section 5). | **[source]** |

Tags counted in the real fixtures (`tests/data/*/*-pretext*.agp`): `Painted`, `Haplotig`, `Unloc`, `Contaminant`, `Target`, `FalseDuplicate`, `Primary`, `Hap1`, `Hap2`, `HAP1`, `HAP2`, `X`, `Y`, `Z`, `W`, `X1`, `X2`, `I`, `II`, `III`, `IV`, `V`, `I_II`, `II_I`. `Singleton` and `Cut` appear in code and docs but in no fixture AGP.

A row can carry several tags, each in its own column, in any order. Real examples:

```
Scaffold_3	110902690	111711205	105	W	scaffold_3	36680479	37488994	+	Painted	Haplotig	
Scaffold_4	4423259	5243664	5	W	scaffold_6	4375500	5195905	+	Painted	X	
Scaffold_7	4513390	84624265	3	W	HAP2_SCAFFOLD_240	1	80110876	-	Painted	Z	HAP1		
Scaffold_75	1	4622481	1	W	HAP2_SCAFFOLD_240	80110877	84733357	+	Haplotig	
Scaffold_80	1	281960	1	W	SCAFFOLD_64	1	281960	+	Contaminant	
Scaffold_1	1	35521779	1	W	SCAFFOLD_1	1	35521779	+	Painted	Target	
Scaffold_23	147780594	148235302	3	W	HAP1_SCAFFOLD_3	205225424	205680132	+	Painted	FalseDuplicate
```

The chromosome-name tag sits on one row of the painted scaffold, not on every row (in `idSyrVitr1` exactly one row has `X`).

## 4. Naming and ordering of the output

### 4.1 Chromosome names and order

**[source]** `naming_utils.py` (`ChrNamer`) and `assembly.py` (`smart_sort_scaffolds`).

- Autosomes (painted, no name tag) are grouped per PretextView scaffold, sorted by sequence length of the first haplotype with gaps excluded, largest first, and named `<prefix><n>` from 1: `self.groups.sort(key=lambda x: x.length_of_first_haplotype(), reverse=True)`. The default prefix is `SUPER_`.
- Named chromosomes are `<prefix><tag>`: `SUPER_X`, `SUPER_Y`, `SUPER_W`, `SUPER_Z`, `SUPER_X1`. They are not ranked by size.
- Output order is by rank, then natural name order. Ranks from the code: 1 autosomes, 2 named, 3 organelles, 4 unplaced. Result: `SUPER_1 ... SUPER_n`, then named chromosomes, then organelles, then unplaced scaffolds.
- Nematode names are supported: `I`, `II`, `III`, `IV` sort as 1 to 4 (`NEMATODE_CHR_INT`).
- If several painted scaffolds of one haplotype fall in one cross-haplotype group they get letter suffixes. Docstring example: `"Scaffold_10" > "SUPER_9A"`, `"Scaffold_11" > "SUPER_9B"`.
- Unplaced, unpainted scaffolds keep their input names ("Unpainted scaffolds keep the name they have in the input assembly").
- Pieces excised from one input scaffold that would otherwise share a name get `_x1`, `_x2` ("so that they are unique in the FASTA file").

### 4.2 Unlocalised scaffolds

**[source]** Name `<chromosome>_unloc_<n>`, numbered within each chromosome from longest to shortest, written straight after their chromosome. Real names: `SUPER_9_Hap1_unloc_1`, `SUPER_9_Hap1_unloc_2`. For a sex chromosome the code gives `SUPER_X_unloc_1` (derived from `unloc_name` plus `add_chr_prefix`; no fixture output shows this exact case).

### 4.3 Chromosome list file

**[source]** `file_writers.py`: "Writes (optionally gzip-compressed) `.chromosome.list.csv` files, required for our submissions to the ENA. These CSV files do not contain a header!" Columns from `assembly_stats.py`, `chromosome_name_csv`: sequence name, chromosome name, then `yes` if localised or `no` for an unloc.

`tests/data/idSyrVitr1/idSyrVitr1-pretext-to-tpf.1.primary.chromosome.list.csv`, complete:

```
SUPER_1,1,yes
SUPER_2,2,yes
SUPER_3,3,yes
SUPER_X,X,yes
SUPER_Y,Y,yes
```

With unlocs and haplotypes (`bChlMac1_3`, excerpt):

```
SUPER_9_Hap1,9,yes
SUPER_9_Hap1_unloc_1,9,no
SUPER_9_Hap1_unloc_2,9,no
SUPER_10_Hap1,10,yes
...
SUPER_W_Hap1,W,yes
SUPER_Z_Hap1,Z,yes
```

`chr_report.csv` (has a header, values quoted):

```
"assembly","seq_name","chromosome","localised","pretext_scaffold","length","length_minus_gaps"
"Primary","SUPER_1","1","true","Scaffold_1",148792233,148767433
```

### 4.4 Gaps

- **[docs]** README: "The default length in the specification for `U` gaps is 100 base pairs, but we use 200 bp gaps, as produced by yahs". Column 7 "has `scaffold`", column 8 "has `yes`".
- **[source]** `build_assembly.py`: `self.default_gap = Gap(200, "scaffold")`. This gap is inserted between consecutive matched blocks when a chromosome is assembled (`scaffolds_fused_by_name`). Gaps inside a matched block keep the length they have in the input FASTA.
- **[source]** `format.py`, `format_agp`, writes every gap row as `U`, `<length>`, `<gap_type>`, `yes`, `proximity_ligation`. Sequence rows are `W` with strand `+`, `-` or `?`, followed by any tags.
- The 100 bp `U` gaps in the PretextView AGP are ignored (section 2.1), so the output has 200 bp at new joins whatever the input AGP says.
- In FASTA output each gap is written as `N` repeated to the gap length (`fasta/index.py`, `get_gap_iter`).

## 5. Two or more haplotypes in one map

All **[source]** `naming_utils.py` unless marked.

- **[docs]** help: "Any other tags are assumed to be the name of a haplotype, and their assemblies are placed in separate files. Unplaced scaffolds for each haplotype are identified by their names beginning with the haplotype's name followed by an underscore. i.e. 'Hap2_' for 'Hap2'".
- The haplotype of a PretextView scaffold comes from its haplotype tag. With no tag, it comes from the **name of the first component**, using `Fragment.haplotype_from_name`: `^SUPER_[^_]+_([^_]+)` or `^([^_]+)_.+_\d+$`. `HAP1_SCAFFOLD_326` gives `HAP1`.
- Case: "The first occurance of a haplotype tag sets its case. i.e. "Hap1" will be used if it is seen before "HAP1"." Lookups are case-insensitive. The `bChlMac1_3` fixture mixes `Hap1` tags with `HAP1_` name prefixes on purpose (**[docs]** `tests/data/README.md`: "Tests case insesitivity of keeping unplaced scaffolds with names beginning `HAP1_` or `HAP2_` with their haplotypes.").
- Output names: chromosomes get the haplotype as a suffix, `SUPER_1_Hap1`, `SUPER_W_Hap1`, `SUPER_X1_HAP1`. Unplaced scaffolds moved into another haplotype get it as a prefix: real output line `?	HAP2_SCAFFOLD_256:1-1129066	Hap1_HAP2_SCAFFOLD_256	PLUS`.
- Homologous chromosomes are matched by **order in the AGP**. `ChrNamer.build_groups` starts a new group when a haplotype that already has a member in the current group appears again. Each group is numbered by the size of its first-haplotype member, so both haplotypes of a pair share a number. The painted scaffolds therefore need to alternate haplotypes down the map.
- Errors: "Found both '<hap>' and '<tag>', when only one' is expected, in scaffold"; "Haplotype tag missing from Painted scaffolds: ... Haplotypes: [...]" when some painted scaffolds have a haplotype and others have none; a group with no member from the first haplotype is rendered as `<empty>` and stops the run with "Error naming autosomes". A mismatch in autosome count between haplotypes is only a warning ("Mismatch in autosome count between ...").
- `Primary` mode: the first `Primary` tag fixes the curated haplotype; if no haplotype can be worked out for that scaffold the run fails with "Failed to determine haplotype for Primary from scaffold". Output is then `<root>.<version>.primary` for the curated haplotype and the other curated haplotypes merged into `<root>.<version>.haplotigs`.
- **[third party]** `zilov/grit` `docs/examples.md` describes a wrapper check that refuses "a single-hap assembly curated in a combined map with no `primary` tag", because without it `pretext-to-asm` "would write a wrong or empty primary FASTA". That check belongs to the wrapper, not to `pretext-to-asm`.

A side effect of the name rule, inferred from the regex and not tested: an input sequence name with two or more underscores that ends in digits (for example `ptg000012l_1_2`) would yield a haplotype (`ptg000012l`) even in a single-haplotype assembly. Names such as `scaffold_12` have one underscore and do not match.

## 6. The TPF format as these tools use it

**[docs]** `agp-tpf-utils/README.md`: "Our TPF files are quite diverged from the original specification."

- "We do not necessarily include any `##` header lines".
- Sequence line, four tab-separated columns: column 1 "is always `?`"; column 2 is "`<name>:<start>-<end>` i.e. assembly coordinates"; column 3 "now contains the name of the scaffold each sequence fragment belongs to"; column 4 "holds assembly strand information, either `PLUS` or `MINUS`."
- Gap line: column 1 `GAP`; "column 2 is `TYPE-2`, which meant a gap between two clones"; "column 3 length, using our default of 200 bp."

**[source]** `parser.py`, `parse_tpf`: lines starting `#` are headers. A `GAP` line before any sequence raises "Gap line before first sequence fragment". Gap types map `TYPE-2` to `scaffold` and `TYPE-3` to `contig`. A sequence line must have exactly 4 fields ("Wrong field count N; 4 expected in line") and column 2 must match `(.+):(\d+)-(\d+)$` ("Unexpected name format"). Strand must be `PLUS` or `MINUS`. `format_tpf` writes `UNKNOWN` for strand 0, which the parser would not read back.

Orientation is per sequence line. A reversed block lists its contigs in reverse order, each marked `MINUS`.

Input, `tests/data/idSyrVitr1/idSyrVitr1-input.tpf`:

```
?	scaffold_1:1-2795873	scaffold_1	PLUS
GAP	TYPE-2	200
?	scaffold_1:2796074-5816795	scaffold_1	PLUS
GAP	TYPE-2	200
?	scaffold_1:5816996-6609255	scaffold_1	PLUS
```

Output, `idSyrVitr1-pretext-to-tpf.1.primary.tpf` (same contigs, column 3 renamed):

```
?	scaffold_1:1-2795873	SUPER_1	PLUS
GAP	TYPE-2	200
?	scaffold_1:2796074-5816795	SUPER_1	PLUS
```

Unlocs and a haplotig:

```
?	HAP1_SCAFFOLD_274:1-153243	SUPER_9_Hap1_unloc_1	MINUS
?	HAP1_SCAFFOLD_278:1-144510	SUPER_9_Hap1_unloc_2	PLUS
?	scaffold_3:36676041-37488994	H_1	PLUS
```

The last line shows the coordinate correction: the AGP row was `scaffold_3 36680479-37488994`, and the output starts at the real contig boundary 36676041.

`curation-resources` also ships `TPF_Specification_v1.9_20190225.pdf` (not read for this report).

## 7. Real example files usable as fixtures

### 7.1 `sanger-tol/agp-tpf-utils`, `tests/data/` (MIT)

https://github.com/sanger-tol/agp-tpf-utils/tree/main/tests/data

Each directory holds `<specimen>-input.tpf` (the pre-curation assembly as TPF), `<specimen>-pretext.agp` (real PretextView output) and the expected outputs. `tests/pretext_to_asm_test.py` runs `--assembly <input.tpf> --pretext <pretext.agp> --output <tmp>/<specimen>-pretext-to-tpf<version>.tpf --write-log` and diffs every file. There is no FASTA for these specimens, so the expected outputs are TPF, CSV, YAML and log.

| Directory | What it exercises (**[docs]** `tests/data/README.md`, plus tag counts measured here) | AGP lines |
|---|---|---|
| `iyExeIsch1` | "Straightforward example with no named chromosomes and no cuts." 93 `Painted`. | 177 |
| `idDilFebr1` | "7 haplotigs, an X chromosome, but no cuts." | 196 |
| `idSyrVitr1` | "Both X and Y chromosomes, and one haplotig." | 258 |
| `nxCaeSini1` | "Cuts and inversions." 2 `Haplotig`, 1 `Unloc`. | 44 |
| `ngHelPoly1` | "Cuts and a large number of edits." 62 `Unloc`, 24 `Haplotig`, `X`. | 2055 |
| `eaAstIrre1` | "44 haplotigs, 34 contaminants and a large number of cuts." | 449 |
| `csSphGirg1` | "Test of `Target` tagging." 22 `Target`. | 534 |
| `bChlMac1_3` | `Hap1`/`Hap2` tags with `HAP1_`/`HAP2_` names, `W`, `Z`, `Unloc`, `Haplotig`. | 738 |
| `ilIthSala1` | "Two haplotypes `HAP1` and `HAP2` with 38 autosomes, plus `W` and `Z`". | 2292 |
| `ilLyoCler1_2` | "Moth with a `Primary` tag set on `HAP1`." 12 `Primary`, 18 `Unloc`, 5 `Z`. | 4352 |
| `ilCycAnnu3` | 4 `FalseDuplicate`, 41 `Unloc`, `W`, `Z` (not described in the README). | 300 |
| `qqAraMarm1` | `HAP1`/`HAP2`, `X1`, `X2`, 2 `FalseDuplicate` (not described in the README). | 612 |
| `nxCaeAgri1` | "Nemtode with straight roman numeral naming: `I`, `II`, `III`, `IV`, `V` and `X`." | 26 |
| `nxCaeSpej1` | Roman numerals with recombinations: `I_II`, `II_I`. | 18 |

The small ones (`nxCaeSpej1`, `nxCaeAgri1`, `nxCaeSini1`) are a few kB each. A practical compatibility test: write an OpenPretext AGP for the same edits, run `pretext-to-asm` on it with the fixture's `-input.tpf`, and diff the TPF against the expected output.

`tests/fasta/` holds small FASTA files with `.fai` and `.agp` indexes (`test.fa`, `test_other.fa`, gzip variants) for the FASTA path.

### 7.2 `galaxyproject/tools-iuc`, `tools/vgp_processcuration/test-data/` (MIT)

https://github.com/galaxyproject/tools-iuc/tree/main/tools/vgp_processcuration/test-data

`test_input.agp`, `test_input.fasta.gz` and expected outputs `expected_corrected.agp`, `expected_hap1.agp`, `expected_hap2.agp`, `expected_hap1_unlocs_no_hapdups.agp`, `expected_hap1_haplotigs.agp`, `expected_hap1_inter_chr.tsv` and the hap2 equivalents. `test_input.agp` in full:

```
##agp-version	2.1
# DESCRIPTION: Generated by PretextViewAI Version 1.0.0
# HiC MAP RESOLUTION: 39904.841797 bp/texel
Scaffold_33	1	24741001	1	W	scaffold_16.hap1	1	24741001	+	Painted	Hap_1	
Scaffold_34	1	24461668	1	W	scaffold_17.hap2	1	24461668	+	Painted	Hap_2	
Scaffold_35	1	24461668	1	W	scaffold_17.hap1	1	24461668	+	Painted	Hap_1	
Scaffold_36	1	24581382	1	W	scaffold_16.hap2	1	24581382	+	Painted	Hap_2	
```

Expected `Hap_1/hap.unlocs.no_hapdups.agp` (the test FASTA is tiny, so lengths are corrected to 4414 and 4409) and `inter_chr.tsv`:

```
Scaffold_33	1	4414	1	W	scaffold_16.hap1	1	4414	+	Painted	Hap_1	
Scaffold_35	1	4409	1	W	scaffold_17.hap1	1	4409	+	Painted	Hap_1	

Scaffold_33	SUPER_1
Scaffold_35	SUPER_2
```

### 7.3 Other

- `galaxyproject/iwc` `Post_Curation-tests.yml` points at synthetic data: `https://zenodo.org/records/19101571/files/test_curation.agp` and `test_assembly.fasta` (copied from the test file; not downloaded, license not checked).
- GitLab `wtsi-grit/rapid-curation/test_data/` (MIT): `ilThyBati1.PB.asm1.purge1.polish1.scaff1.decontaminated.fa.gz`, `ilThyBati1_precurated.pretext`, `ilThyBati1_curated_pretext`, and the same for `ilPhaBuce1` and `iyExeIsch1`. These are FASTA and `.pretext` maps. The listing shows no AGP.
- `curation-resources` README: "Pretext maps and assembly files can be found at the Curation Resources bucket" (`https://curation_resources.cog.sanger.ac.uk/`). Contents not listed here.

## 8. What `pretext-to-asm` rejects or warns about

Fatal, all **[source]**:

1. No `# HiC MAP RESOLUTION: <number> bp/texel` header line (section 2.2).
2. A component name (column 6) that is not a sequence name in the input assembly: `ValueError` "No such Scaffold ...".
3. Strand (column 9) other than `+`, `-`, `?`: `KeyError`. Non-integer start or end: `ValueError`. Start greater than end: "start 'N' must be <= end 'M'".
4. Rows that split one contig but whose component coordinates overlap or leave space between them (the four `qc_sub_fragments` messages in section 2.4).
5. `TaggingError` ("Error in Pretext tags"): two different chromosome-name tags in one PretextView scaffold; two haplotype tags in one PretextView scaffold, which includes any pair of unrecognised tags; `Unloc` on a row of an unpainted scaffold; painted scaffolds with a haplotype mixed with painted scaffolds without one; `Primary` with no haplotype.
6. `ChrNamerError` ("Error naming chromosomes"): a homolog group with no first-haplotype member.
7. Output scaffold names that collide: `FormatAssemblyError` "More than one Scaffold named ...".
8. `LongScaffoldCuttingError` when a scaffold over `--max-contig-length` has no gap to break at.

Not fatal:

- `No overlaps found for: <fragment>` (warning; the row is skipped and its sequence comes back as unplaced).
- "Haplotig H_n (<pretext scaffold>) is N bp which is longer than the shortest chromosome".
- Sequences under 1000 bp are moved to the `shorts` file.

Things the tool does not check, so a mistake passes silently:

- Object coordinates and part numbers (columns 2 to 4) are not read.
- Gap rows in the PretextView AGP are not needed and not validated.
- An unknown or misspelled tag is not reported. It becomes a haplotype name (section 3.2).
- Object names in column 1 are free text. They only need to be the same on every row of an object and change between objects, because a new scaffold starts whenever column 1 changes from the previous line. They are reported as `pretext_scaffold` in `chr_report.csv`. For an unlabelled painted autosome the final name comes from size rank, not from this column.
- When a component name appears on only one AGP row, its coordinates are ignored and the whole input sequence is used. A row that is meant to cover part of a sequence, with the rest dropped from the AGP, would pull in the whole sequence.

Requirements this places on an AGP writer aimed at `pretext-to-asm`:

- Write the resolution header exactly as in section 2.2.
- Column 6 is the original sequence name from the FASTA (first token of the header), with columns 7 and 8 in that sequence's coordinates. A cut contig must not be renamed.
- All rows drawn from one input sequence must tile it without overlap or space between consecutive pieces.
- One tag per column from column 10, spelled exactly as in section 3.
- For each chromosome: `Painted` on every row, the sex-chromosome letter on at least one row, `Unloc` on each unlocalised row inside the painted object.

## 9. The VGP pipeline (Rockefeller Vertebrate Genome Lab)

### 9.1 Current tools

**[docs]** `vgl-hub/vgl-curation` README (v1.1, 2026-01-21): "ProcessCurated is a set of tools to process curated genome assemblies. In combination with gfastats and mashmap, tt reconciliate the AGP file manually curated in PretextView to rename, reorient, and sort the assemblies to get them ready for submission."

Commands: `split_agp -f <fasta> -a <agp> -o <dir>`, `chromosome_assignment -a ... -f ... -o ...`, `sak_generation ...`, and the wrapper `sh curation_2.0_pipe.sh -f <haplotype combined fasta> -a <PretextView generated agp> -s <Heterogametic Chromosome> -d`. Extra dependencies: "gfastats>=1.3.10", "MashMap".

The Galaxy workflow `VGP-assembly-v2/post-curation-processing` (v0.3, 2026-10-19) runs the same tools (`vgp_split_agp`, `vgp_chromosome_assignment`, `vgp_sak_generation`, version 1.1+galaxy0, with `gfastats` 1.3.11). Its required inputs include "Curated AGP file [tabular] - Generated by PretextView after manual curation (PretextView AGP v2.1 format with haplotype labels)" and "Fasta file with both haplotypes [fasta] - Generated by the pre-curation workflow, containing both haplotypes in a single file".

The earlier `Nadolina/Rapid-curation-2.0` ("TPF-less rapid curation of genomes") has the same scripts as separate files (`AGPcorrect.py`, `hap_split.py`, `unloc.py`, `chromosome_assignment.py`, `chr_submission.py`) and is unmaintained.

NOT FOUND: a Galaxy Training Network tutorial covering PretextView curation or post-curation. A code search of `galaxyproject/training-material` for "Pretext" returned only PretextMap and PretextSnapshot steps in assembly and QC tutorials.

### 9.2 Steps and how the AGP is read

**[source]** `vgl-curation/src/split_agp.py`.

1. `AGPcorrect` (the script PretextView ships, per the PretextView README: "AGP files can be corrected by the included python script AGPCorrect"). It finds, per component name, the largest end coordinate in the AGP and stretches that row to the true sequence length from the FASTA, shifting later object coordinates by the difference. Sequences missing from the AGP are appended as `Scaffold_<n>	1	<len>	1	W	<name>	1	<len>	+`. It exits with "Error with line" if a row's start is at or beyond the true length. It runs `int(line[0].split("_")[-1])` on **every** non-comment line, so every object name must end in `_<integer>` (PretextView writes `Scaffold_<n>`) or the script crashes. Unlike `pretext-to-asm` it does not move breakpoints onto real gaps.
2. `hap_split`. A row containing the field `proximity_ligation` or `Painted` goes to haplotype 1 if any field equals `Hap_1`, to haplotype 2 if any equals `Hap_2`, otherwise to the haplotype of the most recent tagged row. Unpainted rows are sorted by component name: `H1` or `hap1` in the name for haplotype 1, `H2` or `hap2` for haplotype 2. Otherwise: "Warning: Scaffold <name> not assigned to any haplotype. It will be skipped."
3. `unloc`. Reads tags **by position**: column 10 is expected to be `Painted` and column 11 is "the tag". Rows whose column 11 is exactly `Unloc` become objects `<object>_unloc_<n>`, numbered in file order, with object coordinates reset to `1..length` and part number 1. Rows whose column 11 is exactly `Haplotig` are moved to `haplotigs.agp`. Gap rows left dangling are dropped ("Gap line removed"). If no row has 11 or more fields it prints "No metadata tags used. Are you sure there are no unlocs, haplotigs or sex chromosomes to label?" and copies the file.
4. `gfastats <fasta> --agp-to-path Hap_N/hap.unlocs.no_hapdups.agp -o ...`, then `gfastats ... --sort largest`. Here the AGP object coordinates and gap rows **are** used to build the sequence, so the 100 bp `U` gaps from PretextView end up in the assembly.
5. `chromosome_assignment`. For rows where column 10 is `Painted` or column 9 is `proximity_ligation`, column 11 equal to `X`, `Y`, `W` or `Z` marks a sex chromosome. Painted objects are renamed `SUPER_1`, `SUPER_2`, ... in the size-sorted order of the FASTA; sex chromosomes become `SUPER_X`, `SUPER_Y`, `SUPER_W`, `SUPER_Z`; unlocs become `SUPER_<n>_unloc_<m>`. Writes `inter_chr.tsv` and `hap.chr_level.fa`.
6. `chr_submission.py` prints the chromosome list: `<name>,<second "_" field>,no` when the name contains `unloc`, else `<name>,<field>,yes`.
7. `sak_generation` uses MashMap to rename and reorient haplotype 2 to match haplotype 1. It stops with "Verify that the names are consistants and all painted scaffolds have the tags Hap_1 or Hap_2" if names do not line up.

### 9.3 VGP conventions an exporter would need

- **[docs]** Input sequence names: "Scaffolds must follow the naming pattern before curation: Haplotype 1: H1.scaffold_X, Haplotype 2: H2.scaffold_X". The code also accepts `hap1` or `hap2` anywhere in the name, as in the Galaxy fixture (`scaffold_16.hap1`).
- **[docs]** Haplotype tags are `Hap_1` and `Hap_2`, with an underscore. These differ from the Sanger fixtures' `Hap1`/`HAP1`. "For each chromosome, assign the appropriate haplotype tag to the left most scaffold".
- **[docs]** "Tag the sex chromosomes as per usual. The current VGP standard is to have a representant of each chromosome in Hap_1. So if the genome is heterogametic (XY or ZW), make sure that any sex chromosomes is tagged with `Hap_1`."
- **[docs]** "Tag any unlocalized sequences as "unloc". Place any unloc sequences at the end (right most side) of their chromosomal assignment. These unlocs need to be painted with the chromosome they belong too." The README writes `unloc` in lower case but the code compares with `'Unloc'`.
- **[docs]** "Once done, paint all the scaffolds (from both haplotypes) into chromosomes. The homologs will need to alternate for proper identification."
- **[source]** Only `X`, `Y`, `W`, `Z`, `Unloc` and `Haplotig` are recognised, and only in column 11. `Contaminant`, `FalseDuplicate`, `Target`, `Primary`, `Singleton` and numbered sex chromosomes are not handled.
- **[source]** Because of the positional read, a row tagged both `Hap_1` and `Unloc` has `Unloc` recognised only if it sits in column 11. In `chromosome_assignment`, `line[10]` is read on gap rows too (which have 9 fields in real PretextView output); whether that is caught was not traced.
- **[docs]** README wishlist, still open: "more flexibility in dealing with sex chromosomes so as to accomodate variable sex chromosome systems (i.e./XY1Y2, etc.)", "Better way to parse multiple tags", "More flexibility in placement of unlocs".

## 10. NOT FOUND

- **`rapid_pretext2tpf_XL.py` source.** Not in the current tree of GitLab `wtsi-grit/rapid-curation` or of `sanger-tol/curation-resources`, and `git log -S"rapid_pretext2tpf_XL"` over the full `curation-resources` history returns nothing. Only its usage was found, in the BGA 2024 training README and in two unrelated user repositories via `gh search code`. Its tag handling is therefore not documented here. An older `rapid_pretext2tpf.py` and `rapid_stats.py` are mentioned in a 2021 README but their files are not in the history either.
- **GRIT / Tree of Life written training material.** `https://curation.tol.sanger.ac.uk/` and `/intro-series` returned only the title "Curation." to a text fetch (the site appears to need JavaScript). `RAPID_CURATION_TRAINING_MANUAL.pdf` was deleted from `curation-resources` on 2025-01-10 (the README still links it) and remains on GitLab; `PretextView-Tutorial.pdf` and `Interpreting_HiC_Maps_guide.pdf` are in `curation-resources`. None of the PDFs were read.
- **A Galaxy Training Network curation tutorial** (section 9.1).
- **Darwin Tree of Life or ERGA post-PretextView documents separate from the Sanger repositories above.** Not searched beyond these repositories.
- **Output file lists of `curationpretext` and `treeval`.** Only inputs were read. `curationpretext` 1.6.1 takes `--input` (assembly `.fasta`/`.fa`), `--cram` (directory of unmapped Hi-C CRAM with `.crai`), `--reads` (directory of long-read `.fasta.gz`), `--read_type`, `--sample`, `--teloseq`. `treeval` 1.4.8 takes a YAML via `--input` whose `reference_file` is the assembly FASTA.
- **An expected FASTA or AGP output of `pretext-to-asm`.** The fixtures hold TPF outputs only. The output AGP layout in section 4.4 is from `format.py`.
- **A fixture using `Singleton`,** or an example output for an unloc on a sex chromosome.
- **Licenses** of `Nadolina/Rapid-curation-2.0` and `zilov/grit` (GitHub reports none); of `curationpretext` and `treeval` (GitHub reports `NOASSERTION`; LICENSE files not opened); of the Zenodo record 19101571.
- **Whether `pretext-to-asm` behaves as read.** Not run. Sections 2, 3.2, 5 and 8 are from reading v1.4.1 source.
