# A2. Curation Engine, Scripting/DSL, and Export Subsystems

Scope of this review: `src/curation/*`, `src/scripting/*` plus the in-app DSL/console
UI (`src/ui/DSLRunner.ts`, `ScriptConsole.ts`, `MacroRecorder.ts`), `src/export/*`,
`bench/curate.ts`, and the undo/redo core in `src/core/State.ts`. Sources consulted:
code, unit tests, `README.md`, `CHANGELOG.md`, and `guide/`. No manuscript material was read.

## 1. What these subsystems actually do today

### Curation engine (`src/curation/CurationEngine.ts`)

Four primitive operations act on a single display order (`state.contigOrder`, an array
of indices into `map.contigs`) plus per-contig orientation:

- **cut(orderIndex, pixelOffset)** splits one contig into two children. The base-pair
  split point is derived proportionally from the pixel offset. Children are appended to
  `map.contigs` (append-only) and spliced into the order in place of the parent.
- **join(orderIndex)** merges the contig at `orderIndex` with its right neighbor into a
  new appended contig spanning the combined pixel range and summed length.
- **invert(orderIndex)** toggles the `inverted` flag and reverse-complements the
  contig's sequence provenance.
- **move(fromIndex, toIndex)** relocates one contig in the order.

Cut and join do not reslice nucleotide data at edit time. Instead each derived contig
carries a `sequenceSegments` list (`SequenceSegment[]` on `ContigInfo`): display-order
slices of the originally loaded source contigs, each with its own `revComp` flag. This
provenance chain is what lets FASTA export reconstruct a correct sequence for a contig
that was cut then inverted then joined, without the original AGP. `splitDisplaySegments`
handles cutting inside an already reverse-complemented segment (the display-forward cut
maps to the opposite end of the source range); `flipSegments` reverses order and flips
each flag on invert. This is a genuinely careful piece of the design and is well tested.

Every operation records a `CurationOperation` with a `previousOrder` (or previous
inverted/segments) payload and pushes it to the undo stack, then emits `render:request`.

### Undo/redo and batching (`src/core/State.ts`)

- Undo restores from stored reverse data (exact order/flag restoration). Redo
  re-executes from stored parameters. The two paths are asymmetric by construction:
  undo is a state restore, redo is a re-derivation.
- `undoStack` is capped at `MAX_UNDO_DEPTH = 200`; on overflow the oldest entries are
  dropped from the front. See limitations, section 4.
- Batch support: `setBatchContext`/`clearBatchContext` stamp a shared `batchId` onto
  ops pushed while active; `assignBatchId(from, id)` post-hoc stamps a trailing range so
  a whole script (which may itself contain nested batch ops) undoes as one unit.
  `CurationEngine.undoBatch(batchId)` pops while the stack top carries that id.
- The four scaffold op types (`scaffold_paint/create/delete/bulk`) route undo/redo to a
  registered `ScaffoldManager`; `scaffold_bulk` stores one before/after snapshot so a
  bulk auto-assign is a single cap-immune undo entry.

### Batch operations (`src/curation/BatchOperations.ts`)

Pattern/size selection, batch cut/join/invert on the selection, `sortByLength`, and the
`autoCutContigs`/`autoSortContigs`/`scaffoldAwareAutoSort` drivers that wrap the AutoCut
and AutoSort algorithms and translate their proposals into sequences of engine calls.
Index-mutating batches (cut, join) process **right to left** (highest index first) so
lower indices stay valid as the array is spliced. This right-to-left discipline is
stated in the module header and applied consistently, including rightmost-breakpoint-first
within a single contig in `autoCutContigs`.

### Scripting / DSL (`src/scripting/`)

A line-oriented DSL parsed by `ScriptParser.ts` into a `ScriptCommand` AST and run by
`ScriptExecutor.ts`. The parser recognizes roughly **21 command types**
(`ScriptCommandType`): cut, join, invert, move to/before/after, select (single, range,
all, `where <predicate>`), deselect, assert, scaffold create/paint/unpaint/delete, zoom,
zoom reset, goto, echo, autocut, autosort. Contigs are referenced by name (exact then
case-insensitive, ambiguity rejected) or by 0-based order index (`#N`). `select where`
supports `length <op> <value>` with bp/kb/Mb/Gb units and boolean predicates
(`inverted`, `scaffolded`, `unscaffolded`, `misassembled`, `excluded`). `assert
<metric> <op> <value>` checks contigs/scaffolds/n50/length/misassemblies and returns a
pass/fail `ScriptResult`, which is what turns a script into a self-checking protocol.

The executor is deliberately DOM-free. Its dependencies arrive through a `ScriptContext`
of small interfaces (`CurationEngineAPI`, `SelectionAPI`, `ScaffoldAPI`, `StateAPI`,
`BatchAPI`, `NavAPI`, `QueryAPI`). Navigation and query are optional so the same
executor runs in the browser, in unit tests, and headless. `DSLRunner.ts` is the single
in-app execution site (the memory notes an earlier consolidation of two exec sites);
`MacroRecorder.ts` records UI actions into replayable DSL; `ScriptReplay.ts` converts an
operation history back into a script (see section 2 for the two-mode caveat).

### Headless curation-as-code (`bench/curate.ts`)

Loads a native `.pretext` in Node, resets the shared singletons, applies a DSL script
through the same `executeScript` surface the browser uses, and emits AGP plus a
before/after metrics summary. `applyCurationScript()` is factored to be filesystem-free
and unit tested. It exits non-zero on any parse or execution failure, so a curation
script with `assert` lines becomes a pass/fail CI check. This is the concrete artifact
behind the "curation as code" claim.

### Export (`src/export/`)

- **FASTA** (`FASTAWriter.ts`): iterates the included curated order
  (`contigExclusion.getIncludedOrder`), resolves each contig's sequence via
  `resolveContigSequence` (segments if present, else name lookup + revComp on
  `inverted`), reverse-complements correctly, wraps at 80 cols. Missing source sequence
  yields a `WARNING:sequence_not_found` header rather than silent corruption.
- **AGP 2.1** (`AGPWriter.ts`): groups by scaffold, emits W lines with orientation and N
  gap lines (default 200 bp, `proximity_ligation` evidence) between intra-scaffold
  contigs. Unscaffolded contigs each become their own object.
- **BED6** (`BEDWriter.ts`): reuses AGP grouping, strand from `inverted`.
- **Curation log** (`CurationLog.ts`): structured JSON with per-op before/after
  snapshots, plus `replayLog` that re-applies and validates each step against its
  recorded `after` snapshot. Explicit reproducibility contract.
- **Snapshot** (`SnapshotExporter.ts`) and analysis exports (`AnalysisExport.ts`) round
  out the set.

All three sequence/coordinate exporters honor the curated order, orientation, and the
exclusion set. FASTA and AGP agree with each other on orientation and order.

## 2. Maturity

### Test coverage (relevant suites)

| Suite | Tests |
|---|---|
| `curation.test.ts` | 82 |
| `scripting.test.ts` | 140 |
| `fasta.test.ts` | 42 |
| `export.test.ts` | 37 |
| `replay.test.ts` | 36 |
| `ui-script-console.test.ts` | 33 |
| `ui-undo-history.test.ts` | 16 |
| `state-select.test.ts` | 15 |
| `bed-export.test.ts` | 14 |
| `curation-progress.test.ts` | 11 |
| `dsl-runner.test.ts` | 10 |
| `agp-parser.test.ts` | 8 |
| `curate-cli.test.ts` | present (headless path) |
| `macro-recorder.test.ts` | 7 |
| `dsl-reference.test.ts` | 5 |

Coverage of these subsystems is strong and behavioral, not just smoke. The DSL is the
most heavily tested surface in the codebase. The headless CLI core has its own suite, so
the curation-as-code path is exercised in CI, not just documented.

### Correctness invariants and reversibility

Within the undo window, cut/join/invert/move are exactly reversible: undo restores the
stored `previousOrder` or previous flag/segments verbatim, and there are dedicated tests
for round trips. The sequence-provenance model means export reflects curated state
including reverse complement on inverted (and cut-then-inverted, and joined) contigs,
which is the correctness bar the project sets for itself and it meets it for the tested
cases. `replayLog` gives an explicit determinism check: same initial state plus same log
must reproduce the same snapshots.

Two honest qualifications on "provably reversible":

1. Reversibility is exact only within the 200-op cap. Large batch operations overflow it
   (section 4).
2. The `map.contigs` array is append-only. Undoing a cut or join removes the derived
   contigs from the *order* but leaves them in the contigs array. This is a memory-growth
   and provenance-noise property, not an incorrectness, but it means the contigs array is
   not a faithful census of the live assembly after undo.

### Reproducibility asymmetry in replay

`ScriptReplay.operationsToScript` (live undo stack) is deterministic: it has each op's
full `data`, so it emits exact commands. `logEntriesToScript` (a re-imported session)
is best-effort: it regex-parses the human-readable `description` strings, and
`scaffold_paint` cannot recover which contigs were painted, so it emits a manual-reapply
comment. "Reproducible from the log" is fully true for the in-memory stack and lossy for
a session round-tripped through a file.

## 3. Novelty ranking (vs Sanger PretextView and the wider landscape)

The reference point is PretextView: a desktop, GPU, manual point-and-click curator with
no scripting surface and no headless mode. Against that baseline, differentiators ranked
most to least defensible for a publication claim:

1. **Headless, assertion-driven, CI-runnable curation protocol.** The DOM-free executor
   runs the identical command surface in the browser and in `bench/curate.ts`: load a
   native `.pretext`, apply a DSL script, `assert` on N50/contig/scaffold/misassembly
   metrics, emit AGP, exit non-zero on failure. A curation procedure becomes a versioned,
   testable text artifact that a CI system can gate on. This is absent from PretextView
   and is the strongest, most concrete claim. Frame it narrowly: scriptable, self-checking
   curation run directly against the native Hi-C contact map, with one execution surface
   shared by GUI and CI. Programmatic AGP/order manipulation exists in other tooling, so
   the defensible novelty is the unified surface plus in-loop assertions on the contact
   map, not "no one else can script assembly edits."

2. **A DSL with full parity to the interactive tool, plus replay from history.** Every UI
   curation action has a script equivalent; the macro recorder turns clicks into DSL; the
   undo history can be exported as a deterministic replay script. Curation stops being an
   irreproducible sequence of mouse gestures.

3. **Undo stack as a single source of truth with script-as-one-undo batching.** A whole
   script (including nested auto-operations) collapses into one undoable unit via
   post-hoc `batchId` stamping. This is solid engineering that enables the reproducibility
   story above, though on its own it is a familiar pattern.

4. **Self-contained sequence-provenance export.** The `SequenceSegment` model lets FASTA
   export produce correct reverse-complemented sequence for arbitrarily cut/joined/
   inverted contigs without consulting an external AGP. It is a clean solution to a real
   correctness trap, and worth describing, but it is an implementation-quality point more
   than a headline scientific novelty.

5. **Browser-based, cross-platform, zero-install, trackpad-friendly.** Real adoption
   value (this is what lowers the barrier for the DToL/VGP/EBP audience) but it is a
   delivery-and-engineering differentiator, not a scientific-method one.

## 4. Honest limitations and frailty

- **Undo cap breaks exact reversibility for large batch operations.** `MAX_UNDO_DEPTH =
  200`. `autoSortContigs` and `autoCutContigs` push one op per move/invert/cut under a
  shared `batchId`. On a fragmented genome a single autosort can emit thousands of ops;
  the cap keeps only the last 200 (all the same `batchId`), so `undoBatch` pops 200 and
  stops with the stack empty. The assembly cannot be returned to its pre-batch state. The
  scaffold bulk path was made cap-immune with a single-snapshot op for exactly this
  reason; the autosort and autocut paths were not. This directly qualifies any "provably
  reversible" claim: reversibility is exact only inside a 200-op window.

- **AGP/BED lose curator-assigned scaffold names.** `groupContigsByScaffold` names each
  object `scaffold_<numericId>`, ignoring the `.name` a curator set on the scaffold in
  `ScaffoldManager`. Order and orientation are faithful; the object identifier is not.
  Unscaffolded contigs become `unplaced_<n>` / their own objects. An interoperability
  nuance for downstream tools that key on scaffold names, not a data-integrity bug.

- **Join naming and gap semantics.** A joined contig exports with a synthetic
  `componentId` of the form `a+b`, which is not a real source accession, and join inserts
  no gap, whereas scaffold placement inserts a 200 bp N-run between the same contigs.
  FASTA and AGP agree with each other; the difference is join (literal concatenation)
  versus scaffold (gapped placement), which is defensible but should be stated.

- **Session-log replay is lossy** (section 2): description-string parsing, and
  scaffold-paint contig indices are unrecoverable from a re-imported session.

- **AutoCut multi-breakpoint handling is convoluted, though not shown to be wrong.** In
  `autoCutContigs` the `adjustedIdx` line is effectively dead code (its ternary evaluates
  to 0 either way, and the actual cut uses `orderIdx`); it survives only in a bounds
  check that does not fire spuriously. Tracing the coordinate frame, cuts use an offset
  relative to the contig's own `pixelStart`, the left child retains that `pixelStart` and
  its `orderIdx`, and breakpoints are applied rightmost-offset-first, so a subsequent
  smaller offset remains valid against the left child. I did not find a breakpoint-dropping
  bug. The real weaknesses here are: no test pins the multiple-breakpoints-in-one-contig
  case, and AutoCut is already flagged for a separate dedicated investigation (it returned
  zero breakpoints on 64x64 overview-resolution DToL maps). Treat AutoCut as out of scope
  for the reversibility/export claims and do not build a publication argument on it.

- **Append-only contigs array** (section 2): undo does not reclaim derived contigs, so
  the array grows across an editing session and is not a live census of the assembly.

- **Documentation inconsistency in the command count.** The README says "13-command,"
  the CHANGELOG says "18-command," and the parser actually defines ~21 command types.
  Worth reconciling before any figure or table cites a number.
