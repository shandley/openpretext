# AGP specification, validators, archive rules and comparable tools

Research date: 2026-11-13. Scope: the NCBI AGP specification, validators, ENA and GenBank submission rules, and what non-Sanger Hi-C tools read and write. Sanger PretextView and its scripts are covered in a separate file.

How to read this file:

- Text in quotation marks is copied from the source named beside it. Sources were fetched on the research date with `curl` and read as plain text or source code.
- "MUST" marks a rule the specification or a validator enforces as an error. "Convention" marks a default that tools share but the specification does not require.
- "NOT FOUND" means I looked in the named sources and the fact is not there.
- "Source reading, not run" means the claim comes from reading code. Nothing was executed. No validator was run against an OpenPretext AGP.

## 1. NCBI AGP Specification

Source: https://www.ncbi.nlm.nih.gov/genbank/genome_agp_specification/ (the older address https://www.ncbi.nlm.nih.gov/assembly/agp/AGP_Specification/ redirects there; https://www.ncbi.nlm.nih.gov/genbank/genome_agp/ returns 404).

- Version as printed in the page title and heading: "AGP Specification v2.1".
- Date as printed in the page footer: "Last updated: 2024-03-14T12:53:59Z". The page prints no separate release date for v2.1. NOT FOUND: a date on which v2.1 itself was issued.

### 1.1 Header and comment lines

> "The use of comment lines, starting with a # symbol, at the head of the file is encouraged. Useful information to include in such headers is: agp-version pragma (e.g. ##agp-version 2.1), organism name, assembly name, a description of any non-standard object identifiers"

> "Comment lines must not appear within the body of the AGP."

- MUST: no comment lines after the first data line.
- Convention: a header is "encouraged", not required. The pragma is written `##agp-version 2.1` with no space after `##`.
- NCBI's own example files on the same site still begin `##agp-version 2.0` followed by `# ORGANISM:`, `# TAX_ID:`, `# ASSEMBLY NAME:`, `# ASSEMBLY DATE:`, `# GENOME CENTER:`, `# DESCRIPTION:` lines (https://www.ncbi.nlm.nih.gov/genbank/agp/genome_agp_scaffold_from_contig_wgs/).
- The NCBI parser recognises the pragma only when the line starts with the exact string `##agp-version`, and accepts the values `1.1`, `2.0` and `2.1` (source: `x_CheckPragmaComment` in https://github.com/ncbi/ncbi-cxx-toolkit-public/blob/master/src/objtools/readers/agp_util.cpp). A line such as `## agp-version 2.1` (with a space, which RagTag writes) is treated as an ordinary comment.

### 1.2 The nine columns

> "One feature of the AGP file is that column definitions change depending on whether the line is a component line or a gap line. There is a single column definition up to column 5, then each column will have two definitions, depending on the value in column 5."

| Col | Component line | Gap line (column 5 is N or U) |
|---|---|---|
| 1 | object | object |
| 2 | object_beg | object_beg |
| 3 | object_end | object_end |
| 4 | part_number | part_number |
| 5 | component_type | component_type (N or U) |
| 6 | component_id | gap_length |
| 7 | component_beg | gap_type |
| 8 | component_end | linkage |
| 9 | orientation | linkage evidence |

Quoted definitions:

- Column 1: "This is the identifier for the object being assembled. This can be a chromosome, scaffold or contig. If an accession.version identifier is not used to describe the object the naming convention is to precede chromosome numbers with 'chr' (e.g. chr1) and linkage group numbers with 'LG' (e.g. LG3). Contigs or scaffolds may have any identifier that is unique within the assembly."
- Columns 2 and 3: "The starting coordinates of the component/gap on the object in column 1. These are the location in the object's coordinate system, not the component's." (and the same wording for the end).
- Column 4: "The line count for the components/gaps that make up the object described in column 1."
- Column 6a: "This is a unique identifier for the sequence component contributing to the object described in column 1. Ideally this will be a valid accession.version identifier as assigned by GenBank/EMBL/DDBJ. If the sequence has not been submitted to a public repository yet a local identifier should be used."
- Column 7a: "This column specifies the beginning of the part of the component sequence that contributes to the object in column 1 (in component coordinates)."
- Column 8a: "This column specifies the end of the part of the component that contributes to the object in column 1 (in component coordinates)."

Column 7a and 8a describe "the part of the component" that is used, so a component line may start at component_beg greater than 1. A contig cut into two pieces is written as two component lines with the same component_id and different spans.

### 1.3 component_type values (column 5)

> "Current acceptable values are: A Active Finishing; D Draft HTG (often phase1 and phase2 are called Draft, whether or not they have the draft keyword).; F Finished HTG (phase3); G Whole Genome Finishing; O Other sequence (typically means no HTG keyword); P Pre Draft; W WGS contig; N gap with specified size; U gap of unknown size, defaulting to 100 bases."

For a Hi-C curated assembly the relevant values are W (contigs or scaffolds from a whole-genome assembly), U (gap whose size is not known) and N (gap of a stated size). The NCBI example "Chromosome from scaffold (WGS)" uses W for scaffold components too.

### 1.4 Gap length

> "N type gaps can be of any length. A length of 100 must be used for all U type gaps."

> "Gap lengths must be positive. Negative gaps and gap lines with zero length are not valid."

> "For negative gaps, or gaps of unknown size, use U as the component_type and 100 as the gap size, since 100 is the GenBank/EMBL/DDBJ standard for gaps of unknown size."

- MUST: gap_length is a positive integer. A U gap has length 100.
- The NCBI validator reports a U gap that is not 100 as a warning, not an error: "gap length (column 6) is not 100 for a gap of unknown size (an INSDC standard)".
- The validator also has an error for the opposite mistake: "same gap_length=X in all gap lines, and component_type='N' ('U' is required for gaps of unknown size)". An AGP that writes every Hi-C gap as `N 100` or `N 200` risks this error. Source reading, not run: I did not check what triggers it (for example a minimum number of gap lines).

### 1.5 gap_type values (column 7b)

> "Accepted values: scaffold: a gap between two sequence contigs in a scaffold (superscaffold or ultra-scaffold). contig: an unspanned gap between two sequence contigs. centromere: a gap inserted for the centromere. short_arm: a gap inserted at the start of an acrocentric chromosome. heterochromatin: a gap inserted for an especially large region of heterochromatic sequence (may also include the centromere). telomere: a gap inserted for the telomere. repeat: an unresolvable repeat. contamination: a gap inserted in place of foreign sequence to maintain the coordinates."

### 1.6 linkage (column 8b) and allowed combinations

> "This column indicates if there is evidence of linkage between the adjacent lines. Values: yes, no"

From the table "Describing breaks and continuity":

| gap_type | linkage | Meaning |
|---|---|---|
| scaffold | yes | "Do not break scaffold. There is evidence linking sequence contigs on both sides of the gap." |
| repeat | yes | Do not break scaffold |
| contamination | yes | Do not break scaffold, "with linkage evidence 'unspecified'" |
| contig | no | "Break scaffold. A contig gap indicates there is no evidence to link the adjacent sequence contigs." |
| repeat | no | Break scaffold |
| centromere, short_arm, heterochromatin, telomere | no | Break scaffold |
| contig | yes | Invalid. "the gap type should be scaffold" |
| scaffold | no | Invalid. "the gap type should be contig" |
| centromere, short_arm, heterochromatin, telomere | yes | Invalid |

MUST: a Hi-C join is `scaffold` with linkage `yes`. `scaffold` with `no` is invalid.

### 1.7 linkage evidence (column 9b)

> "This specifies the type of evidence used to assert linkage (as indicated in column 8b). Accepted values:
> na: used when no linkage is being asserted (column 8b is 'no')
> paired-ends: paired sequences from the two ends of a DNA fragment, mate-pairs and molecular-barcoding.
> align_genus: alignment to a reference genome within the same genus.
> align_xgenus: alignment to a reference genome within another genus.
> align_trnscpt: alignment to a transcript from the same species.
> within_clone: sequence on both sides of the gap is derived from the same clone, but the gap is not spanned by paired-ends. The adjacent sequence contigs have unknown order and orientation.
> clone_contig: linkage is provided by a clone contig in the tiling path (TPF). For example, a gap where there is a known clone, but there is not yet sequence for that clone.
> map: linkage asserted using a non-sequence based map such as RH, linkage, fingerprint or optical.
> pcr: PCR using primers on both sides of the gap.
> proximity_ligation: ligation of segments of DNA that were brought into proximity in chromatin (Hi-C and related technologies).
> strobe: strobe sequencing.
> unspecified: used only for gaps of type contamination and when converting old AGPs that lack a field for linkage evidence into the new format."

> "If there are multiple lines of evidence to support linkage, all can be listed using a ';' delimiter (e.g. paired-ends;align_xgenus)."

- The term for Hi-C is `proximity_ligation`, with an underscore.
- MUST: `na` goes with linkage `no`. A gap with linkage `yes` needs a real evidence term.
- A related caution in the spec: "Linkage evidence of type map should only be used when the map provides evidence of linkage between adjacent sequence contigs. It should not be used when a map has been used to order and orient scaffolds on a chromosome."

### 1.8 Coordinates and part numbers

> "All coordinates given in the file are 1-based inclusive (not 0-based). i.e. the first base of an object is 1 (not 0)."

> "Coordinates of the object are all with respect to the plus strand, no matter the orientation of the component."

> "object_beg (column 2) should always be less than or equal to object_end (column 3)."

> "component_beg (column 7) should always be less than or equal to component_end (column 8)."

> "Each object must start with a part_num of 1 (column 4) and an object_beg coordinate of 1 (column 2)."

From the "Validation" section of the spec:

> "All columns of numeric data must contain positive integers"
> "All object ranges must be sequential and non-overlapping"
> "The length of the span specified for the component (in columns 7 and 8) must match the length of the span specified for the object (in columns 2 and 3)."
> "All gap lengths must be 1 base or longer."
> "All columns must have some data"
> "Columns with controlled values must only use those values"

MUST rules for a writer, each matched by a validator error in section 2:

- Coordinates are 1-based and inclusive. A reversed component still has component_beg less than or equal to component_end.
- The first line of each object has object_beg 1 and part_number 1.
- Each later line has object_beg equal to the previous object_end plus 1, and part_number equal to the previous part_number plus 1 (validator: "object_beg != previous object_end + 1", "part number (column 4) != previous part number + 1").
- For a component line, object_end minus object_beg equals component_end minus component_beg.
- For a gap line, object_end minus object_beg plus 1 equals gap_length.
- All lines of one object are together, and an object name appears once (validator: "duplicate object").

### 1.9 Orientation (column 9a)

> "Values: + plus; - minus; ? unknown; 0 (zero) unknown (deprecated); na irrelevant. By default, components with unknown orientation (?, 0 or na) are treated as if they had + orientation."

> "It is not appropriate to use an orientation of '?' in an AGP that specifies how a chromosome is assembled from components, except for any components that are not scaffolded to other components (singletons)."

MUST: in a scaffold with more than one component, use only `+` or `-`. The validator's error is "'na' or ? (formerly 0) component orientation may only be used in a singleton scaffold".

### 1.10 Gaps at the start or end of an object

> "If the object is a sequence contig or scaffold, the object should not start or end with a gap line. A chromosome will frequently start or end with one or more biological gap types (e.g. telomere or short_arm)."

> "A gap of type scaffold will usually be flanked by components and not by other gap lines. Typically, successive gap lines are not encouraged, except in the case of gaps implying some biologically defined entity (such as centromere, heterochromatin, etc.)."

This is "should not" in the spec and a warning in the validator ("gap at the beginning of object", "gap at the end of object (OK if X is the circular chromosome/plasmid)"). Two scaffold gaps in a row also draw a warning or an error ("consequtive gaps lines with the same type and linkage" is in the error list).

### 1.11 Singleton objects

> "Use an orientation of '+' for the component of any unplaced scaffold composed of a single component (a singleton scaffold)."

An unplaced contig written as its own object is one line: object_beg 1, part_number 1, type W, the whole component, orientation `+`. Related validator messages:

- Error list: "singleton object has component_beg=1 and in minus orientation".
- Warnings: "in unplaced singleton scaffold, component is not used in full", "in unplaced singleton scaffold, component orientation is not \"+\"", "object name (column 1) is the same as component_id (column 6)", "all objects are singletons with component_beg=1".

The warning about object name equal to component_id matters for OpenPretext: if an unplaced contig is exported under its own contig name as the object, NCBI warns and ENA's validator has an error for it ("Component name and object name can not be same", section 3.1).

### 1.12 Extra columns

The spec text does not say whether a tenth column is allowed. NOT FOUND in the spec page: any sentence permitting or forbidding extra columns.

The validator settles it. Its first listed error is "Incorrect number of columns: there should be 9 tab-separated columns." In the parser (`CAgpRow::FromString`, agp_util.cpp): ten columns with an empty tenth gives the warning "extra tab or space at the end of line"; any other count outside 8 to 9 gives the error "expecting 9 tab-separated columns". So a non-empty tenth column is an error for NCBI.

Source reading, not run: the same function strips a trailing `# ...` end-of-line comment when the `#` comes after at least seven tabs. A comment in the code dates this behaviour: "2026/04/10 GCOL-17016 If "#" is not after at least 8 columns / 7 tabs - then it is not a comment; it could be a part of the object name." The NCBI binary on the FTP site is dated 2025-09-16, so I cannot say which behaviour the released binary has.

### 1.13 Line endings and whitespace

> "Columns should be tab delimited. Lines end with a new line (\n). There should be no extra space around the individual tokens."

- MUST: tab delimited. The validator errors with "expecting 9 tab-separated columns, found space characters" when a space appears outside the object name.
- Line ending: the spec says `\n`. The NCBI reader splits on both carriage return and line feed (`NcbiGetline(is, m_line, "\r\n")`), so CRLF is tolerated by that parser, but write `\n`.
- The validator warns on "missing line separator at the end of file" and gives an error for "empty line". End the file with one `\n` and no blank lines.
- UTF-16 input is rejected: "UTF-16 not supported, text needs to be in ASCII encoding."

### 1.14 Identifier restrictions

From the spec: object names are free ("any identifier that is unique within the assembly"), with the `chr` and `LG` naming convention for chromosomes and linkage groups. From the validator: "space in object name" is a warning, "invalid use of \"|\" character" is an error, and a `gnl|` prefix is deprecated.

The spec gives no character set or length limit. NOT FOUND in the spec: a maximum identifier length or a list of allowed characters. The archive limits in section 3 apply in practice.

## 2. Validators

### 2.1 NCBI agp_validate

Source: https://www.ncbi.nlm.nih.gov/genbank/genome_agp_validation/ (footer "Last updated: 2024-03-22T13:55:50Z").

> "AGP file structure and content can be validated using the agp_validate program. The on-line version of agp_validate checks that the input AGP file conforms to the AGP format Specification, checks the file for internal consistency, and generates a report of component, gap, scaffold and object statistics. The command-line version of agp_validate performs all the same checks as the on-line version but also has options to perform additional checks by comparing the AGP to sequences in FASTA files"

Where to get it:

> "agp_validate is available by anonymous FTP. Copy the appropriate version for your platform, then uncompress the file, rename it to "agp_validate", and set the "execute" permission (see platform-specific details)."

The FTP directory is https://ftp.ncbi.nih.gov/toolbox/ncbi_tools/converters/by_program/agp_validate/ and lists:

```
linux64.agp_validate.gz    2025-09-16 13:35   11M
mac.agp_validate.gz        2025-09-16 14:55  8.7M
win64.agp_validate.zip     2025-09-16 17:14  6.4M
```

The `DOCUMENTATION/VERSIONS` file in that directory gives `agp_validate: 2.29.324`. The README says: "After downloading the desired command-line program, uncompress the archive and rename the resulting file to remove the platform designation." and "On a Macintosh, run /Applications/Utilities/Terminal.app and use chmod +x to allow the downloaded program to be executed."

The online form is at https://www.ncbi.nlm.nih.gov/projects/genome/assembly/agp/agp_validate.cgi.

macOS arm64: I downloaded `mac.agp_validate.gz` and inspected it without running it. `file` reports "Mach-O 64-bit executable arm64". `codesign -dv` reports an ad hoc, linker-signed signature with no team identifier. It links only system libraries (`libbz2`, `libz`, `libresolv`, `libSystem`, `libc++`). It should run natively on Apple Silicon. Not run: I did not execute it, so Gatekeeper behaviour and output format are unverified. NCBI gives no package-manager install command. I checked the bioconda recipes repository for `agp_validate`, `agp-validate` and `ncbi-agp-validate` and none exists.

How it is run (page): "usage overview: agp_validate [-options] [FASTA files...] [AGP files...]" and "Information on all the available options can be obtained by executing agp_validate with the -help option."

The usage text in the source (https://github.com/ncbi/ncbi-cxx-toolkit-public/blob/master/src/app/agp_validate/agp_validate.cpp) lists these options:

```
-g         Check that component names look like Nucleotide accessions
-out FILE  Save the AGP file, adding missing version 1 to the component accessions (need -alt),
           or adding gaps where runs of Ns longer than 10 bp are found in components (need FASTA files).
-obj       Use FASTA files to read names and lengths of objects (the default is components).
-v VER     AGP version (1 or 2). The default is to choose automatically. Version 2 is chosen
           when the linkage evidence (column 9) is not empty in the first gap line encountered.
-xml       Report results in XML format.
-sub       Treat serious warnings as errors, put summary and stats at the top.
-un        Unplaced/unlocalized scaffolds:
           any single-component scaffold must use the whole component in orientation '+'
-scaf      Scaffold from component AGP: no scaffold-breaking gaps allowed
-chr       Chromosome from scaffold AGP: ONLY scaffold-breaking gaps allowed
-list      List error and warning messages.
-limit COUNT   Print only the first COUNT messages of each type. Default=100. To print all, use: -limit 0
-skip, -only WHAT   Skip, or report only a particular error or warning.
-show WHAT     Show the warning hidden by default (w40, w45, w46, w52).
-comp      Check that the supplied object sequences (in FASTA files) match what can be
           constructed from the AGP and the component sequences (in FASTA files or in GenBank).
```

and: "If component FASTA files are given in front of AGP files, also check that: component_id from AGP is present in FASTA; component_end does not exceed sequence length. If FASTA files for objects are given (after -obj), check that: object_id from AGP is present in FASTA; object lengths in FASTA and in AGP match."

For a test script this suggests three calls: the AGP alone; the contig FASTA followed by the AGP; and `-comp` with the exported scaffold FASTA. NOT FOUND: the exit codes. The pages and usage text do not state them, and I did not run the binary.

Errors listed on the validation page:

> "Incorrect number of columns: there should be 9 tab-separated columns. Non-positive integers in the following columns: 2: object_beg, 3: object_end, 4: part_number, 6b: gap_length, 7a: component_beg, 8a: component_end. object_end is less than the object_beg. component_end is less than the component_beg. The length of the span specified for the component (in column 7a and 8a) does not match the length of the span specified for the object (in column 2 and 3). The length specified for the gap (in column 6b) does not match the length of the span specified for the object (in column 2 and 3). Linkage=yes with a gap_type other than scaffold or repeat. Object does not start with an object_beg coordinate of 1. Object has ranges that are non-sequential and/or overlapping. Object does not start with a part_number of 1. Object has non-sequential lines and/or lines mixed with other objects. Multiple objects with the same object name (column 1). Component orientation of 0 or na used for a non-singleton scaffold. Invalid terms or symbols in the following columns: 5: component_type, 7b: gap_type, 8b: linkage, 9a: orientation"

Warnings listed on the page:

> "Gap at the beginning or the end of an object. Consecutive gap lines of the same type. Overlapping spans used for a given component_id. Non-draft component_id used more than once. Non-draft component spans out of order. Extra tab character at the end of the line. Component type is not consistent with the line format. Component type is not consistent with the component_id accession."

Two of those warnings fire on normal curation output. A contig cut in PretextView or OpenPretext and placed in two scaffolds, or reordered within one, produces "Non-draft component_id used more than once" (source text: "duplicate component with non-draft type"), "component span appears out of order" and "same component_id found on different scaffolds". Overlapping spans of one component ("the span overlaps a previous span for this component") would mean the export duplicated sequence, which is a real bug.

Further messages in the source table (`CAgpErr::s_msg` in agp_util.cpp) that the page does not list: "gap shorter than 10 bp", "comments only allowed at the beginning of the file in AGP 2.0", "orientation '0' is deprecated in AGP 2.0; use '?' instead", "linkage (column 9) should be 'na' for a gap with linkage 'no' (AGP 2.0)", "missing linkage evidence (column 9) (AGP 2.0)", "linkage evidence term X appears more than once", "component_id X is a not an accession, but is used with component_type other than W", "object names appear sorted, but not in a numerical order", "final object_end (column 3) not equal to object length in FASTA file(s)", "run(s) of Ns within the component span".

### 2.2 RagTag agpcheck

Source: https://github.com/malonge/RagTag (`ragtag_agpcheck.py`, `ragtag_utilities/AGPFile.py`). Repository last pushed 2026-10-01. Release 2.1.1 on PyPI and bioconda.

Install, quoted from the README:

```
# install with conda
conda install -c bioconda ragtag
```

The bioconda recipe is `noarch: python` and depends on `minimap2`, `pysam`, `numpy`, `networkx` and `intervaltree`. NOT FOUND: a statement that every dependency has an osx-arm64 bioconda build. I did not test the install.

Usage from the source: `ragtag.py agpcheck <asm1.agp> [<asm2.agp> ... <asmN.agp>]`. It prints this disclaimer:

> "This utility performs most (but not all) checks necessary to validate an AGP v2.1 file ... Please additionally use the NCBI AGP validator for robust validation"

It raises an error (stops at the first problem) for: a comment line after the first data line ("illegal comment in AGP body"), a line without exactly nine tab-delimited fields, an empty field, an object seen again after another object ("object identifier out of order"), a first line not at coordinate 1 or part_number 1, non-sequential part numbers, gaps or overlaps in object coordinates, component and object spans of different length, an orientation outside `+ - ? 0 na`, a U gap that is not 100 ("invalid gap length for component type 'U': %d (should be 100)"), and unknown gap type, linkage or evidence terms. It splits evidence on `;`.

It is stricter than NCBI on two points: a U gap not equal to 100 is an error, and a tenth column is an error even if empty.

### 2.3 JCVI

Source: https://github.com/tanghaibao/jcvi (`src/jcvi/formats/agp.py`), last pushed 2026-11-02. Install commands quoted from the README: `pip install jcvi`, or `pip install git+https://github.com/tanghaibao/jcvi.git`.

`python -m jcvi.formats.agp validate agpfile componentfasta targetfasta` rebuilds each object from the AGP and the component FASTA and compares it with the target FASTA ("validate consistency between agpfile and targetfasta"). Loading an AGP also checks each line: orientation and component_type in the allowed lists, gap_length at least 1, object span equal to gap_length or component span, gap type and evidence terms (its list includes `"proximity_ligation",  # new in v2.1`), object starts at 1, lines contiguous. Failures are Python assertions.

NOT FOUND: a statement of macOS arm64 support for jcvi. I did not test the install. The package has compiled parts, so check before depending on it in CI.

### 2.4 ENA Webin-CLI

ENA validates AGP inside Webin-CLI (see section 3.1). It needs a Webin account even for `-validate`, so it is not usable in an unattended test without credentials.

### 2.5 Summary for a test script

- NCBI `agp_validate` is the reference and has a native arm64 macOS binary on the NCBI FTP site. Download, gunzip, rename, `chmod +x`. Not yet run here.
- `ragtag.py agpcheck` is a quick second opinion that needs only an AGP file.
- `jcvi.formats.agp validate` checks AGP plus contig FASTA against the exported scaffold FASTA, which also tests reverse complement handling.

## 3. Archive submission requirements

### 3.1 ENA

Sources: https://ena-docs.readthedocs.io/en/latest/submit/fileprep/assembly.html and https://ena-docs.readthedocs.io/en/latest/submit/assembly/genome.html.

Files for a chromosome-level submission:

> "Chromosome Assembly. Consists of the following files: 1 manifest file; 1 FASTA file OR 1 flat file; 1 chromosome list file; 0-1 unlocalised list files; 0-1 AGP files"

> "Please note that all data files must be compressed with GZIP."

AGP at ENA:

> "You may use an AGP file to describe the assembly of scaffolds from contigs, or of chromosomes from scaffolds. AGP files can be validated using the NCBI AGP validator. The AGP file can also be used to define sequences as unplaced."

> "If an AGP file is included, it is not shown in our browser as part of the final assembly, but rather is consumed in the creation of the final sequence format."

Gaps and minimum gap length:

> "A scaffold is an assemblage of contigs separated by gaps of known length. These gaps define the scaffold, and so your submission must define them in one of two ways: Explicit Gaps: Use an AGP file to describe how scaffolds are assembled from contigs in the sequence file. Implicit Gaps: Include gaps as runs of Ns in the sequence file and set the manifest file's MINGAPLENGTH value to an appropriate integer value; each run of Ns which exceeds or matches this length will result in the creation of a scaffold"

> "MINGAPLENGTH: Minimum length of consecutive Ns to be considered a gap - optional"

NOT FOUND in the ENA documentation: a required numeric minimum gap length, and any statement about which linkage evidence to give for Hi-C gaps. The validator source has `DEFAULT_MIN_GAP_LENGTH = 10` (`Entry.java` in https://github.com/enasequence/sequencetools), which I take to be the default when MINGAPLENGTH is absent. Source reading, not run.

Sequence rules:

> "Sequences must: have unique names within an assembly; be at least 20bp long; not have terminal Ns; consist of bases: 'a','c','g','t','u','b','d','h','k','m','n','r','s','v','w','y'"

> "All sequences within one genome assembly submission must be identified by a unique sequence name provided in the FASTA, AGP or flat files. It is essential that the sequence names are unique and used consistently between files."

> "Submission of single records that represent all of the unplaced scaffolds, or all of the scaffolds that belong to a particular chromosome but are not localized to a specific position on the chromosome, are not accepted."

> "Artificial constructs without biological evidence, such as artificial chromosomes consisting of unplaced contigs or scaffolds, are not permitted to be submitted."

> "Unplaced sequences (where the chromosome is entirely unknown) can be submitted the same as contigs; with no additional context. ... Any sequences that are not used to assemble chromosomes are considered unplaced."

"Not have terminal Ns" means an exported scaffold must not begin or end with a gap, which agrees with the AGP spec.

Chromosome list file, column definitions as quoted:

> "The file is a tab separated text file (USASCII7) up to four columns."

> "OBJECT_NAME (first column): The unique sequence name, matching with the sequence name in your FASTA file ('>' line) or EMBL flat file ('AC * ' line)."

> "CHROMOSOME_NAME (second column): The chromosome name. The value will appear as the /chromosome, /plasmid or /segment qualifier in the EMBL-Bank flat files. Names must: match the pattern: ^[A-Za-z0-9][A-Za-z0-9_#-.]*$; be shorter than 33 characters; be unique within an assembly; not contain any of the following as part of their name (case insensitive): 'chr', 'chrm', 'chrom', 'chromosome', 'linkage group', 'linkage-group', 'linkage_group', 'plasmid'"

> "CHROMOSOME_TYPE (third column): Allowed values: chromosome, plasmid, linkage_group, monopartite, segmented, multipartite"

> "TOPOLOGY (CHROMOSOME_TYPE modifier): Topology is not a separate column but can be specified as a modifier to the chromosome type. Options are 'linear' or 'circular', default is linear"

> "CHROMOSOME_LOCATION (optional fourth column): By default eukaryotic chromosomes will be assumed to reside in the nucleus and prokaryotic chromosomes and plasmids in the cytoplasm. Allowed values: Macronuclear, Nucleomorph, Mitochondrion, Kinetoplast, Chloroplast, Chromoplast, Plastid, Virion, Phage, Proviral, Prophage, Viroid, Cyanelle, Apicoplast, Leucoplast, Proplastid, Hydrogenosome, Chromatophore"

ENA's example (tab separated in the original):

```
chr01   1    Linear-Chromosome
chr02   2    Linear-Chromosome
chr03   3    Linear-Chromosome
chr04   4    Linear-Chromosome
chrMi   MIT  Linear-Chromosome  Mitochondrion
```

Note the split: the object name in column 1 may be `chr01`, but the chromosome name in column 2 must not contain `chr`.

Unlocalised list file:

> "This file should be provided when the submission contains chromosomes with unlocalised sequences. Unlocalised sequences are contigs or scaffolds that are associated with a specific chromosome but for which order and orientation is unknown."

> "The unlocalised list file is a tab separated text file (USASCII7) containing the following columns: OBJECT_NAME (first column): the unique sequence name matching a FASTA header or flatfile AC * line. CHROMOSOME_NAME (second column): the unique chromosome name associated with this sequence. This must match with a CHROMOSOME_NAME in the chromosome list file."

ENA's example:

```
cb25.NA_084   III
cb25.NA_093   III
cb25.NA_108   III
```

How ENA's own code validates AGP. Source reading, not run: https://github.com/enasequence/sequencetools (branch `master`, last pushed 2026-07-08), files `AGPFileReader.java` and `AGPValidationCheck.java`.

- Lines are split on any whitespace (`SCREGEX = "\\s+"`) and must have nine fields. A gap line with linkage `no` may have eight. Any other count gives "Invalid number of columns". A tenth column fails.
- Only comment lines at the head of the file are skipped by the reader loop I read.
- A U gap is always given length 100, whatever column 6 says (`UNKNOWN_GAP_LENGTH = 100L`), and then compared with the object span. A U gap written with another length fails with "gap_length ... does not match the length ... of the object_beg ... and object_end ... span".
- Allowed gap types match the spec list.
- The allowed linkage evidence array in `AGPValidationCheck.java` is: `"na", "paired-ends", "align_genus", "align_xgenus", "align_trnscpt", "within_clone", "clone_contig", "map", "strobe", "unspecified"`. It does not contain `proximity_ligation` or `pcr`. A term outside the list on a gap with linkage `yes` reports "Invalid linkage evidence for object". Elsewhere in the same repository `proximity ligation` is an accepted value for the flat-file `/linkage_evidence` qualifier (`feature-regex-groups.tsv`, `GlobalDataSets.java`), so the omission looks like an out-of-date list in the AGP check. The check is listed in `ValidationUnit.java` with the comment "exclude for master".
- There is an error "Component name and object name can not be same" and one for "All scaffolds are build from a single contig each."

I could not confirm by running Webin-CLI whether an AGP with `proximity_ligation` is rejected. This needs a test with `webin-cli -context genome -manifest manifest.txt -validate` and a real Webin account before OpenPretext documents AGP as an ENA route. A FASTA with gaps as runs of N, plus chromosome and unlocalised list files, avoids the question.

### 3.2 NCBI GenBank

Sources: https://www.ncbi.nlm.nih.gov/genbank/genomesubmit/ (footer "Last updated: 2025-07-21T18:06:19Z"), https://www.ncbi.nlm.nih.gov/genbank/wgs_gapped/ ("Last updated: 2021-12-15T16:30:12Z"), https://www.ncbi.nlm.nih.gov/genbank/wgsfaq/ ("Last updated: 2026-04-14T17:14:45Z").

The current genome submission guide describes FASTA or `.sqn` upload with gap information entered in the portal. NOT FOUND: any mention of AGP as a submission file on the genomesubmit or wgsfaq pages (searched both for "agp", case-insensitive). The only AGP reference is on the gapped-genome page, where the `-l` evidence options "correspond to the options for column 9 of an AGP file". The ENA documentation, by contrast, lists AGP as an accepted file. I did not find an NCBI statement that AGP submission has been withdrawn, only its absence from the current guide.

Gap information the portal asks for:

> "The minimum number of consecutive Ns that represents a gap (must be 10 or less). Be aware that the assembly statistics are always calculated using 10 or more Ns as a gap, regardless of the presence/absence of gaps in the final genome sequence."

> "The number of Ns that represents a gap of completely unknown length (usually 0; sometimes 100 or another value)"

> "The evidence used to assert that the sequence on either side of the gap is linked (usually paired-ends)"

From the gapped-genome page:

> "Unknown length: The gap size is not known (e.g. gap could be 50 or 50000 N's) but the order and orientation of the contigs are known. We suggest using 100 N's to represent gaps of unknown length when possible."

> "-l (lowercase 'l' as in 'linkage') : type of evidence used to assert linkage across the gaps. These are the available options (they correspond to the options for column 9 of an AGP file): paired-ends (ie, for paired ends or mate pairs, eg from Illumina or PacBio); map; proximity-ligation (ie, from Hi-C); align-genus; align-xgenus; align-trnscpt (ie, the evidence is a transcript)"

Note the spelling difference: `table2asn -l` takes `proximity-ligation` with a hyphen, while the AGP column 9 term is `proximity_ligation` with an underscore.

> "Each record must represent a sequence that occurs biologically in the organism. Do NOT manually use N's to randomly combine the contigs to create a single sequence; you must know the order and orientation of the contigs."

Sequence identifiers:

> "Each sequence has a definition line beginning with a '>' and a unique identifier (SeqID), eg contig001, contig002. The SeqIDs must: Be <50 characters. Can only include letters, digits, hyphens (-), underscores (_), periods (.), colons (:), asterisks (*), and number signs (#). Be unique within a genome"

> "Remove any Ns from the beginning or end of each sequence."

> "Contigs should be >199nt"

Chromosome names:

> "Chromosome names: Can contain only digits, dots, underscores, and ASCII characters in plain text in the standard English alphabet. Cannot include "chr" or "chromosome". However, linkage group names should include "LG" as part of the name. Are limited to 33 characters. Cannot include these words: unknown, Un, Unk, 0 (= zero as the full name). This restriction is because each unplaced sequence should be separate, not concatenated with others, and without an assignment."

Chromosome assignment in a FASTA batch submission is given in the definition line, for example `>Seq001 [organism=Puma concolor] [isolate=ABDC] [location=chromosome] [chromosome=2]` for a sequence that is the chromosome, and `[chromosome=5]` alone for sequences that belong to chromosome 5 without being the chromosome.

From the FAQ: "sequences that have been concatenated in random, unknown order are not allowed. For example, we cannot accept a single sequence of all the unplaced sequences (eg, a chromosome Un)."

### 3.3 What both archives agree on

- A gap of unknown size is 100 N.
- Hi-C evidence is proximity ligation (underscore in AGP, hyphen in table2asn, space in the flat-file qualifier).
- No sequence starts or ends with N.
- Each unplaced sequence is its own record. No concatenated "Un" object.
- Chromosome names are at most 32 or 33 characters and must not contain `chr` or `chromosome`. The sequence identifier is separate and may be `chr1`.
- Sequence identifiers: the NCBI set (letters, digits, `- _ . : * #`, under 50 characters) is the tighter published rule. Contig names from Juicebox such as `ctg1:::fragment_2` use only allowed characters, but names with `|`, spaces or `/` do not.

## 4. What comparable tools write and read

### 4.1 Summary table

| Tool | Gap line it writes | Object naming | Split components (component_beg > 1) | Extra columns on read |
|---|---|---|---|---|
| YaHS `yahs` and `juicer post` (v1.2.2) | `U 100 scaffold yes proximity_ligation` | `scaffold_N` | Written and read | Ignored |
| SALSA2 | `U 100 scaffold yes proximity_ligation` | `scaffold_N` | Not written (always 1 to length) | Does not read AGP in the code I read |
| 3D-DNA post-review | No AGP. 500 N in FASTA | `<label>_hic_scaffold_N` in the script | Not applicable | Not applicable |
| Phase Genomics `juicebox_assembly_converter.py` | `U 100 scaffold yes proximity_ligation` | `PGA_scaffold_X__Y_contigs__length_Z` | Not written. Fragments become new component names | `agp2assembly.py` reads fixed fields, ignores column 7 |
| RagTag `scaffold` | `<type> 100 scaffold yes align_genus` by default | `<ref>_RagTag` | `agp2fa` reads them | Error |
| agptools | `N 500 scaffold yes na` for new joins | User supplied | Read and written | Ignored |
| JCVI `agp` | `U 100 scaffold yes paired-ends` from `gline` | User supplied | Read | Ignored |

Details and quotes follow.

### 4.2 YaHS

Source: https://github.com/c-zhou/yahs, files `README.md`, `agp-spec.h`, `sdict.c`, `juicer.c`, `version.h` (`YAHS_VERSION "1.2.2"`).

Defaults in the source:

```
#define AGP_SPEC_VERSION 2.1
#define DEFAULT_AGP_U_GAP_SIZE 100
#define DEFAULT_AGP_N_GAP_SIZE 200
AGP_CT_t DEFAULT_AGP_SEQ_COMPONENT_TYPE = AGP_CT_W;
AGP_CT_t DEFAULT_AGP_GAP_COMPONENT_TYPE = AGP_CT_U;
AGP_GT_t DEFAULT_AGP_GAP_TYPE = AGP_GT_SCAFFOLD;
AGP_LE_t DEFAULT_AGP_LINKAGE_EVIDENCE = AGP_LE_PROXIMITY_LIGATION;
int DEFAULT_AGP_GAP_SIZE = DEFAULT_AGP_U_GAP_SIZE;
```

So the default gap line is `U 100 scaffold yes proximity_ligation`. Both `yahs` and `juicer post` take `--gap-link STR` ("AGP output gap linkage evidence") and `--gap-size INT` ("AGP output gap size between sequence component"). README: "YaHS also allows customizations of the output AGP file, such as changing the scaffold gap size, linkage evidence etc." It warns "type 'U' gap size is not 100" when a U gap has another size.

Objects are named `scaffold_%d`. Unscaffolded contigs are written as singleton objects with orientation `+` (`"scaffold_%u\t1\t%u\t1\t%s\t%s\t1\t%u\t+\n"`).

Juicebox round trip (README):

> "juicer pre -a -o out_JBAT hic-to-contigs.bin scaffolds_final.agp contigs.fa.fai" produces "out_JBAT.txt - BED format file for hic links; out_JBAT.liftover.agp - coordinate file between new and old contigs; out_JBAT.assembly - assembly annotation file for Juicebox; out_JBAT.assembly.agp - AGP file contains same information as the assembly annotation file. Not a real AGP file as there are no gaps."

> "Once completed editing, there should be a file named something like out_JBAT.review.assembly generated by Juicebox, which can be fed into juicer post command to generate AGP and FASTA files for the final genome assembly. ... juicer post -o out_JBAT out_JBAT.review.assembly out_JBAT.liftover.agp contigs.fa. This will end up with two files out_JBAT.FINAL.agp and out_JBAT.FINAL.fa."

`juicer post` writes split components. The component line uses the lifted-over start and length of each fragment (`coords[cid*3+1]` to `coords[cid*3+1] + coords[cid*3+2] - 1`), so a contig cut in Juicebox appears as two W lines with the original contig name and different spans. This is the same representation OpenPretext should use for a cut contig.

Reading: the AGP reader in `sdict.c` skips empty lines and any line starting with `#` wherever it occurs, and parses with `sscanf(line, "%s %*s %*s %*s %s %s %s %s %s", ...)`. It reads the first nine whitespace-separated fields and ignores the rest, so extra columns are tolerated. It rejects a component whose end exceeds the sequence length, and rejects orientations other than `+` and `-` unless run with `-u`. `agp_to_fasta` builds a FASTA from an AGP and the contig FASTA: "It takes two positional parameters: the AGP file and the contig FASTA file. ... If the AGP file contains sequence components of unknown orientations ('?', '0' or 'na' identifiers ...), you will need -u option".

### 4.3 SALSA2

Source: https://github.com/marbl/SALSA, files `README.md` and `get_seq.py` (branch `master`).

> "Another file which is of interest is scaffolds_FINAL.agp, which is the agp style output for the scaffolds describing the assignment, orientation and ordering of contigs along the scaffolds."

The writer:

```
line_parts = ["scaffold_" + str(c_id) + '\t' + str(start) + '\t' + str(end) + '\t' + str(local_comp) + "\tW", curr[0], '1', str(curr_len), direction + '\n']
...
curr_contig += 'N' * 100
line = "scaffold_" + str(c_id) + ... + "U\t100\tscaffold\tyes\tproximity_ligation\n"
```

Gap `U 100 scaffold yes proximity_ligation`, objects `scaffold_N`, components always `1` to the full length. When SALSA breaks a contig it renames the pieces, and an optional second AGP (`-G, --agp-orig-coords`) reports "the original names and coordinates from the input assembly before cleaning". No header line is written. NOT FOUND: any SALSA code that reads an AGP (I read only `get_seq.py` and the README).

### 4.4 Juicebox Assembly Tools and 3D-DNA

Sources: https://github.com/aidenlab/3d-dna (`README.md`, `run-asm-pipeline-post-review.sh`, `finalize/finalize-output.sh`, `utils/*.awk`) and the Genome Assembly Cookbook, http://aidenlab.org/assembly/manual_180322.pdf.

The `.assembly` format, from the Cookbook:

> ".assembly (and legacy .cprops and .asm files): Space-delimited text that encodes, in a concise manner, a set of instructions to be performed on draft sequences including splitting, changing their order, orientation and anchoring into chromosomes. (Previously the information was split between two other file formats, .cprops and .asm, now deprecated.)"

Its two parts, from the scripts: `utils/convert-assembly-to-cprops-and-asm.awk` sends lines starting with `>` to the `.cprops` file and all other lines to the `.asm` file. `utils/generate-assembly-file-from-fasta.awk` prints `">"old_id, new_id, clength` for each sequence (name, running index, length) and then one index per line. The Phase Genomics converter documents the second part as scaffolds listed "at the bottom of the file", each a list of contig indices, with a negative index meaning reverse strand (its `agp2assembly.py` writes `-1 * counter` for `-`). Cut contigs carry the suffixes `:::fragment_N` and `:::debris` ("Assuming Juicebox contig breaking convention (":::fragment_n:::debris")"). NOT FOUND: a formal specification of `.assembly` beyond the Cookbook paragraph and these scripts.

After review, from the Cookbook:

> "Use Assembly menu item "Export Assembly" to save the changes introduced during JBAT review. The changes are saved in the form of a modified .assembly file. By default, incorporating a 'review' suffix to the exported file name will be suggested"

> "./run-asm-pipeline-post-review.sh -r draft.review.assembly draft.fa merged_nodups.txt ... The script will not only generate the final fasta (labeled with a "FINAL" suffix), but also rebuild the final .hic map for quality control."

Gap size:

> "During the final fasta generation the input scaffolds identified as part of the same chromosome-length scaffold are joined, taking into account the suggested order and orientation, while adding a gap of fixed size (500bp) in between each pair of input scaffolds."

and in the script: "-g|--gap_size gap_size: Gap size to be added between scaffolded sequences in the final chromosome-length scaffolds (default is 500)."

Output naming in `finalize-output.sh`: `$0=">"label"_hic_scaffold_"counter`, with the help text "Output will appear with headers of the form ${OPTARG}_hic_scaffold_#."

3D-DNA writes no AGP. The repository file tree has no path containing "agp", and the Cookbook text contains no occurrence of "AGP". People who need an AGP from a `.review.assembly` use YaHS `juicer post` or the Phase Genomics converter.

### 4.5 Phase Genomics juicebox_scripts

Source: https://github.com/phasegenomics/juicebox_scripts (`README.md`, `juicebox_scripts/juicebox_assembly_converter.py`, `agp2assembly.py`).

> "juicebox_assembly_converter.py: Given an original .fasta file and a .assembly file which you have created by modifying and exporting from Juicebox, generate new .fasta, .agp, and .bed files describing the modified assembly. Also generates a report describing any contig breaks which were introduced via Juicebox."

AGP it writes: first line `##agp-version 2.1`. Component lines are type `W`, always `1` to the fragment length. A broken contig keeps its Juicebox fragment name as the component_id (and the FASTA of broken contigs is written to match), so it never emits component_beg greater than 1. Gap lines: `self.gap_size = 100`, `elt_type = 'U'`, `gap_type = 'scaffold'`, `has_evidence = 'yes'`, `evidence_type = 'proximity_ligation'`. Scaffold names are `PGA_scaffold_{0}__{1}_contigs__length_{2}` by default, or `Chromosome{N}` with the simple-names option. In the FASTA the gap is 100 lowercase `n`.

`agp2assembly.py` reads an AGP into `.assembly`. It skips lines starting with `#`, splits on tabs, keeps only lines whose fifth field is `W`, and writes `">{0} {1} {2}".format(fields[5], counter, fields[7])`. It uses component_end as the length and never reads component_beg. An AGP with split components (component_beg greater than 1) is therefore read wrongly by this script: the second half of a cut contig is given the wrong length and the same name as the first half. It reads fields by position, so a tenth column is ignored.

### 4.6 RagTag

Source: https://github.com/malonge/RagTag (`ragtag_scaffold.py`, `ragtag_agp2fa.py`, `ragtag_utilities/AGPFile.py`).

`ragtag.py scaffold` writes a header comment `# AGP created by RagTag <version>` and a pragma `## agp-version <version>`, names objects `<reference header>_RagTag`, and writes linked gaps with evidence `align_genus`. Gap options: `-r` "infer gap sizes. if not, all gaps are 100 bp", `-g` "minimum inferred gap size [100]". Its optional concatenated "Chr0" uses `U 100 contig no na`.

`ragtag.py agp2fa <scaffolds.agp> <components.fasta>` ("Build sequences in FASTA format from an AGP v2.1 file") fetches `comp_beg-1` to `comp_end` of each component and reverse complements it for `-`, so split components work. The component FASTA "can be uncompressed or bgzipped". Reading goes through the strict parser described in section 2.2: exactly nine tab-delimited fields, no comments in the body, U gaps exactly 100. An AGP with a tenth column fails here with the (misleadingly worded) message "detected more than 9 tab delimited fields".

### 4.7 agptools

Source: https://github.com/WarrenLab/agptools (branch `master`, last pushed 2025-06-26; PyPI name `bio-agptools`, version 0.0.3). Install, quoted: `pip install bio_agptools`.

> "agptools is a suite of scripts for performing edits to an AGP file during this manual curation stage of genome assembly."

Commands: `split`, `join`, `flip`, `assemble`, `rename`, `remove`, `transform`. `assemble`: "given an AGP file and a fasta file containing the sequences of its components (e.g., contigs), output a fasta file containing the sequences of the components assembled into objects". It slices `row.component_beg - 1` to `row.component_end`, so split components work.

New gaps from `join` default to `--gap-size` "size of new gaps to be created [500]", `--gap-type` "what to call new gaps in AGP [scaffold]", `-e, --gap-evidence` "evidence type for gaps [na]". Its documentation examples show `N 500 scaffold yes na`, which the NCBI validator would flag (linkage `yes` needs real evidence).

Reading: `line.strip().split("\t")` and fields 0 to 8 by position. Extra columns are ignored. Comment lines are passed through wherever they occur. A blank line raises `AgpFormatError`.

### 4.8 JCVI agp module

Source: https://github.com/tanghaibao/jcvi/blob/main/src/jcvi/formats/agp.py.

`python -m jcvi.formats.agp build agpfile componentfasta targetfasta` ("Build targetfasta based on info from agpfile") is the common way to apply an AGP to a FASTA. Other actions include `validate`, `bed` ("print out the tiling paths in bed/gff3 format"), `frombed` ("generate AGP file based on bed file"), `tpf`, `gaps`, `tidy`, `reindex`, `cut`, `mask`.

Its gap helper writes `U` with 100 and `"scaffold", "yes", "paired-ends"`; `frombed` and `fromcsv` default to evidence `map` and gap size 100, with `component_type = "U" if gapsize == 100 else "N"`.

Reading: `row.split("\t")` and fields by position, with the ninth field stripped. Extra columns are ignored. Lines starting with `#` are collected as header wherever they occur, and blank lines are skipped. Split components are supported (`component_beg`, `component_end` are read and used).

### 4.9 Consequences for an OpenPretext AGP

- `U 100 scaffold yes proximity_ligation` is what YaHS, SALSA2 and the Phase Genomics converter all write, and it is what the spec and both archives describe for a Hi-C join of unknown gap size. 3D-DNA's 500 N and agptools' `N 500` are outliers.
- Nine columns exactly. A tenth column is an error for NCBI agp_validate, ENA's reader and RagTag. YaHS, agptools, JCVI and the Phase Genomics script ignore extra fields.
- Split components are valid AGP and are read correctly by YaHS, RagTag `agp2fa`, agptools `assemble` and JCVI `build`. The Phase Genomics `agp2assembly.py` misreads them. NCBI warns about a component used more than once or out of order but does not reject it.
- Comments only at the top. NCBI warns and RagTag errors on a comment in the body.

## 5. BED in these workflows

No archive accepts or asks for a BED describing scaffold structure. Neither the ENA nor the NCBI pages read here mention BED for assemblies.

Among the tools, BED appears in four roles:

1. Scaffold structure in BED, written beside the AGP. The Phase Genomics `juicebox_assembly_converter.py` writes a `.bed` with the header lines `##bed file` and `# This file was generated by converting juicebox assembly format`. Contig lines are `scaffold_name, start, end, contig_name, contig_len, strand` and gap lines are `scaffold_name, start, end, pg_gap_N`, with 0-based starts. NOT FOUND: any tool that reads this file back.
2. AGP converted to BED for viewing. JCVI `agp bed` prints "the tiling paths in bed/gff3 format" with options `--gaps`, `--nogaps`, `--bed12`, and `agp frombed` goes the other way. These are generic conversions for genome browsers.
3. BED lifted through an AGP. `agptools transform`: "You may have bed files of alignments or annotations where the coordinates are given in reference to the original contigs, but you want those coordinates transformed to your new scaffolds." `agptools flip` takes a "list of segments to flip, in bed format". Here BED is input describing features or edits, and the AGP is the structure.
4. BED as Hi-C alignments or signal tracks. SALSA2 and YaHS take Hi-C alignments in BED. YaHS `out_JBAT.txt` is described as a "BED format file for hic links". 3D-DNA's `.bed` and `.wig` files are "1D-track files illustrating signals used by the misjoin detector, collapsed repeat detector, polisher and chromosome slitter". The 3D-DNA break report from the Phase Genomics script is a separate tab file (`#orig_contig, fragment, break_start, break_end, fragment_len`), not BED.

So a BED of curated scaffold structure has no fixed downstream consumer in the non-Sanger tools I read. Its practical use is as a browser track or as a human-readable contig placement table. If OpenPretext keeps a BED export, the Phase Genomics six-column layout (0-based, half-open, contig name, length, strand) is the only precedent found, and a breakpoint table like its break report is the closer precedent for reporting cuts. Whether PretextView or Sanger scripts consume BED is covered in the companion file.

## 6. NOT FOUND list

- A release date for AGP v2.1 itself (only the page's "Last updated: 2024-03-14").
- A sentence in the AGP spec about extra columns, identifier length or identifier characters. The validator source answers the column question.
- Exit codes of `agp_validate`.
- A package-manager install for `agp_validate` (no bioconda recipe under three likely names; NCBI documents only the FTP download).
- Confirmation that `agp_validate`, RagTag or JCVI install and run on macOS arm64. The NCBI mac binary is arm64 by inspection but was not executed.
- An ENA documentation statement of a required minimum gap length or of the linkage evidence to use for Hi-C.
- Confirmation by running Webin-CLI that ENA accepts or rejects `proximity_ligation` in an AGP. The validator source omits it from the AGP evidence list.
- Any mention of AGP as a submission file in the current NCBI genome submission guide or WGS FAQ.
- A formal specification of the Juicebox `.assembly` format beyond the Cookbook paragraph and the 3D-DNA and Phase Genomics scripts.
- SALSA2 code that reads AGP.
- A tool that reads a BED of curated scaffold structure.

## 7. Source list

- AGP Specification v2.1: https://www.ncbi.nlm.nih.gov/genbank/genome_agp_specification/
- AGP Validation: https://www.ncbi.nlm.nih.gov/genbank/genome_agp_validation/
- NCBI AGP examples: https://www.ncbi.nlm.nih.gov/genbank/agp/genome_agp_scaffold_from_contig_wgs/ and https://www.ncbi.nlm.nih.gov/genbank/agp/genome_agp_chr_from_scaffold_wgs/
- agp_validate downloads: https://ftp.ncbi.nih.gov/toolbox/ncbi_tools/converters/by_program/agp_validate/
- agp_validate source: https://github.com/ncbi/ncbi-cxx-toolkit-public (`src/app/agp_validate/agp_validate.cpp`, `src/objtools/readers/agp_util.cpp`)
- NCBI genome submission guide: https://www.ncbi.nlm.nih.gov/genbank/genomesubmit/
- NCBI gapped genome format: https://www.ncbi.nlm.nih.gov/genbank/wgs_gapped/
- NCBI WGS FAQ: https://www.ncbi.nlm.nih.gov/genbank/wgsfaq/
- ENA accepted assembly formats: https://ena-docs.readthedocs.io/en/latest/submit/fileprep/assembly.html
- ENA genome assembly submission: https://ena-docs.readthedocs.io/en/latest/submit/assembly/genome.html
- ENA validator source: https://github.com/enasequence/sequencetools
- YaHS: https://github.com/c-zhou/yahs
- SALSA2: https://github.com/marbl/SALSA
- 3D-DNA: https://github.com/aidenlab/3d-dna and http://aidenlab.org/assembly/manual_180322.pdf
- Phase Genomics juicebox_scripts: https://github.com/phasegenomics/juicebox_scripts
- RagTag: https://github.com/malonge/RagTag
- agptools: https://github.com/WarrenLab/agptools
- JCVI: https://github.com/tanghaibao/jcvi
