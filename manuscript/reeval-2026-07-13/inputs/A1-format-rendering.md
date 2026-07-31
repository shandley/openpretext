# A1: Format Parsing and Rendering Subsystem

Assessment of the `.pretext` binary reader and WebGL2 rendering pipeline as a
candidate for scientific-software publication. Based only on source, tests,
README, CHANGELOG, `docs/PRETEXT_FORMAT.md`, and `guide/`.

Files reviewed:
- `src/formats/PretextParser.ts` (parser, BC4 decode, overview assembly)
- `src/formats/ParseWorker.ts`, `ParseWorkerClient.ts` (off-thread parse)
- `src/renderer/WebGLRenderer.ts` (WebGL2 map + detail-tile shaders)
- `src/renderer/TileManager.ts` (LOD selection, frustum cull, LRU cache)
- `src/renderer/TileDecoder.ts`, `TileDecodeWorker.ts`, `TileDecodeWorkerClient.ts`
- `src/renderer/Camera.ts`, `AutoContrast.ts`, `ColorMaps.ts`
- `docs/PRETEXT_FORMAT.md`
- Tests: `tile-decoder.test.ts`, `tile-decoder-integration.test.ts`,
  `tile-decode-worker-client.test.ts`, `tiles.test.ts`,
  `webgl-renderer-transform.test.ts`, `overview-mode.test.ts`,
  `parse-progress.test.ts`, and `tests/e2e/tile-streaming.spec.ts`.

There is no `src/io/` parsing module of interest; `src/io/` holds only
`SessionManager.ts` (session serialization), out of scope here.

---

## 1. What the subsystem actually does today

### Native `.pretext` parsing, fully client-side

`parsePretextFile()` reads a native Sanger `.pretext` file (magic `pstm`) from
an `ArrayBuffer` entirely in the browser, with no server, no format conversion,
and no preprocessing step. Concretely it:

- Validates the 4-byte `pstm` magic and reads the compressed/uncompressed
  header sizes.
- Decompresses the header with **raw DEFLATE** (`pako.inflateRaw()`, RFC 1951 —
  not gzip, not zlib), then parses total genome length (u64 via BigInt),
  contig count, and per-contig records: an `f32` fractional length plus a
  64-byte packed name. Absolute base-pair lengths and pixel spans are
  reconstructed by accumulating fractional lengths against
  `numberOfPixels1D = textureResolution * numberOfTextures1D`, matching how
  PretextView itself derives them (the file stores no absolute positions).
- Reads the three trailer bytes (`textureRes`, `nTextRes`, `mipMapLevels`) and
  derives texture resolution, tiles-per-dimension, pixel dimension, the
  upper-triangular block count `N*(N+1)/2`, and `bytesPerTexture`.
- Walks the texture-block section as cheap zero-copy `subarray` views, then
  inflates every tile's raw-DEFLATE payload. Inflation prefers the browser
  native `DecompressionStream('deflate-raw')` (batched, run concurrently, ~1.8x
  faster than pako per code comments) and falls back to `pako.inflateRaw` when
  unavailable. Progress is reported incrementally (this phase dominates load
  time on 30-200 MB files).
- Decodes **BC4 / RGTC1** single-channel block compression in hand-written
  TypeScript (`decodeBC4Block` / `decodeBC4Level`): the 8-byte block format,
  both interpolation-table branches (`alpha0 > alpha1` 8-value vs the 6-value +
  {0,255} branch), 3-bit index unpacking from two 24-bit halves, and
  PretextMap's column-major block iteration (outer x, inner y) and column-major
  within-block pixel packing. This is a genuine reimplementation of a GPU
  texture-compression codec on the CPU in JS.
- Parses optional `psgh` graph extensions (PretextGraph coverage/gap/telomere/
  repeat-density tracks) into `Int32Array` per-pixel values, tolerating
  trailing padding and unknown bytes.

The heavy path (`parseAndAssemble`) decodes only the **coarsest mip per tile**
and assembles a small symmetric row-major overview `Float32Array` (as small as
64x64 for real files), reflecting each upper-triangular tile across the
diagonal. This runs in a Web Worker (`ParseWorker` / `ParseWorkerClient`) so the
main thread never allocates a full-resolution `Float32Array(mapSize*mapSize)`
(mapSize up to 32768, or 65536 in high-res mode).

### Rendering

`WebGLRenderer` draws the overview as a single R8 textured quad with a
vertex-shader camera transform (pan/zoom with aspect correction) and a fragment
shader that applies a `[floor, ceil]` contrast window, gamma, and a 1-D
color-map texture lookup (six maps). Contig grid lines are drawn by binary-
searching an `R32F` boundary texture in the shader (`nearestBoundaryDist`),
which removed the old fixed 512-contig uniform cap — any contig count is now
supported. `canvasToMap` / `mapToCanvas` are exact inverses so overlays cannot
drift from the map.

`TileManager` implements the detail layer: frustum culling (map-space AABB
overlap against the visible rect), one mip level per view selected from zoom
(`selectMipLevel`), and an LRU tile cache (default 256) with GPU-texture
eviction. `TileDecoder` maps TileManager's coarse-to-fine level convention onto
the parser's fine-to-coarse levels, computes BC4 byte offsets, and handles
upper-triangular mirroring by transposing tiles read from the opposite triangle.
`TileDecodeWorker` owns the raw BC4 bytes (transferred on load), decodes
requested tiles off-thread with a generation counter for cancellation, and
transfers decoded `Float32Array`s back zero-copy. Detail tiles are drawn over
the overview in a batched pass (`beginTiles`/`drawTile`/`endTiles`); a shader
"gate" (`u_gateEnabled`/`u_gateThresh`) suppresses detail where the original-
order overview has no signal, keeping the detail layer visually consistent with
the overview across zoom (Clean vs Faithful overview modes).

`AutoContrast` derives a per-map contrast floor/ceil from the overview
histogram so dense genomes load readable instead of saturated.

---

## 2. Maturity

### Test coverage: broad on plumbing, thin on the hard codec

Unit tests that run in CI are extensive on the *coordinate/plumbing* layer:
level-convention mapping, BC4 byte-offset math, upper-triangular index formula,
transpose relationship, frustum culling, mip selection, LRU eviction, worker
cancellation/generations. `tiles.test.ts` (48 cases), `tile-decoder.test.ts`
(23), `tile-decoder-integration.test.ts` (19), plus worker-client, overview-
mode, and webgl-transform suites.

**The central maturity gap: the hard part of BC4 has no CI coverage.**

- `tile-decoder-integration.test.ts` is a *self-consistency* check. It compares
  `TileDecoder.decodeTile` against `PretextParser.tilesDecoded`, but both call
  the same `decodeBC4Level`. A bug in the BC4 decoder passes both sides
  identically. It also only runs against `test-data/bTaeGut2.mat.pretext`,
  which is **gitignored and absent in CI** (`describe.skip` when missing).
- `tile-decoder.test.ts`'s synthetic `makeConstantRawTile` sets
  `alpha0 == alpha1` with all index bits zero, so every pixel decodes to
  `alpha0`. It never exercises 3-bit index unpacking, and never the two
  interpolation-table branches producing distinct interpolated values. The one
  "asymmetric" case (`alpha0=200, alpha1=100`) still leaves all index bytes
  zero (so every pixel is `alpha0`) and asserts only the transpose relationship
  — not a single decoded pixel is checked against a known-correct value.
- There is **no external ground-truth validation** anywhere: no comparison
  against PretextView's C++ decode output, and no synthetic encode->decode
  round trip. The actually-hard, easy-to-get-wrong parts of the codec (index
  unpacking, both interpolation branches, column-major block/pixel ordering)
  are validated only against gitignored real files that skip in CI, and
  ultimately only by the developer's visual comparison to PretextView.

This is cheaply closable: a synthetic BC4 encode->decode round-trip (or a small
committed reference tile with hand-computed expected pixels) would run in CI and
pin the codec numerically. A reviewer will ask why it is not there.

The E2E rendering test (`tile-streaming.spec.ts`) does read back real GPU pixels
and prove that zoomed detail differs from the overview, but it too is gated on
the same gitignored `bTaeGut2` file and **skips in CI**.

### Invariants held (from code + CLAUDE.md correctness bar)

- Parsed matrix is ground truth; overview cells trace back to real tile values,
  reflected symmetrically.
- Truncated/short files degrade gracefully (warn + zeroed buffers) rather than
  crashing.
- Detail tiles always decode in original file order; the gate texture is kept
  in original order separately from the (possibly reordered) displayed overview,
  so curation reordering cannot misalign detail from overview.
- Empty/at-floor fragments `discard` so the overview shows through (no opaque
  white tiles); the tile V-flip matches the overview texcoord convention.

### Edge cases handled

Non-power-of-two / tiny overviews (64x64), high-res mode (2048 texture / 65536
px), missing float-linear extension, unknown trailing bytes after tiles,
extension size mismatches, worker-unavailable synchronous fallback, and a
size-capped Faithful overview to bound memory.

Overall maturity: the engineering is solid and the plumbing is well tested, but
the numeric correctness of the core decompression codec is not pinned by any
automatically-running test. For a scientific-software claim built on "faithfully
shows the underlying data," that is the weakest link.

---

## 3. Novelty ranking

The comparison set: Sanger **PretextView** (desktop C++/OpenGL, reads
`.pretext`), **HiGlass** (web, multiresolution, requires a tile server and
preprocessed tilesets), **Juicebox / Juicebox.js** (Juicebox.js is already
in-browser but reads Juicer `.hic`, not `.pretext`).

The key discipline for a novelty claim: neither "in-browser" nor "reads
`.pretext`" is individually novel. Juicebox.js is already in-browser; PretextView
already reads `.pretext`. The defensible novelty is the **union** — a native
`.pretext` reader (reverse-engineered binary, BC4 decoded in JS, raw deflate)
that needs **no server and no format conversion**, running client-side. That
combination is genuinely hard and is not met by any of the three named tools.

Ranked most to least defensible:

1. **Native client-side `.pretext` reading with no server and no conversion.**
   Strongest and most defensible. PretextView requires a desktop install;
   HiGlass requires a server and a preprocessing/tiling step; Juicebox.js reads
   a different format (`.hic`). Reading the exact file genome teams already
   produce, in a browser tab with zero infrastructure, is the real story.
   The binary format was reverse-engineered from the C++ sources
   (`docs/PRETEXT_FORMAT.md` is a substantive artifact in its own right).

2. **A pure-JS/TypeScript BC4 (RGTC1) decoder driving a zero-install pipeline.**
   Decoding a GPU texture-compression codec on the CPU in the browser, correctly
   matching PretextMap's column-major block/pixel ordering and both
   interpolation branches, is non-trivial and specific to this format. Defensible
   as a hard engineering contribution, though narrower than #1. (Its value in a
   paper is undercut by the untested state noted in section 2 — fix that first.)

3. **Memory discipline for very large maps in a browser.** Never materializing a
   full 32768x32768 (or 65536^2) matrix; decoding coarsest-mip-only for the
   overview, streaming detail tiles from worker-owned raw bytes with zero-copy
   transfer. Good engineering and necessary, but a known pattern.

4. **The tile LOD / LRU / frustum-cull rendering pipeline itself.** Least
   defensible as novelty. Multiresolution tiled rendering with a tile cache is
   exactly what HiGlass and Juicebox.js already do. It is competently built here
   (worker decode, generation-based cancellation, overview gate to kill zoom
   pop-in), but it should be framed as sound engineering, not as a new method.

**Caveat on "first/only" phrasing.** The comparative claim — "unlike
desktop-only PretextView, server-backed HiGlass, and `.hic`-only Juicebox.js,
OpenPretext reads native `.pretext` client-side" — is supportable from known
properties of those three tools. A universal "no tool does this" is an
unverifiable negative that cannot be supported from the codebase and requires a
proper tool/literature scan before it enters a manuscript. Phrase the novelty
comparatively.

---

## 4. Honest limitations and frailty

- **Codec correctness is not pinned by CI (biggest risk).** See section 2: the
  BC4 decoder's hard paths are exercised only by gitignored, skip-in-CI tests
  and by self-consistency checks that cannot catch a decoder bug. No external
  ground truth, no round-trip. This directly threatens the "faithfully shows the
  data" claim a scientific-software paper rests on.

- **The subsystem is overview-first, not full-resolution-first.** The default
  loaded view and every numerical/analysis consumer operate on the coarsest-mip
  overview (as small as 64x64). Full resolution exists only as streamed detail
  tiles at high zoom. This is a deliberate and reasonable design, but any claim
  about resolution or fidelity must be stated against the overview, not the
  32768px nominal map.

- **Shipped rendering bugs were exactly the invariant violations the project
  treats as sacred, and their only guard skips in CI.** The CHANGELOG documents
  real, fixed defects: a V-flip that mirrored the entire detail layer into an
  anti-diagonal above ~150% zoom (#42), opaque white tiles (#42), and sparse-
  contact "pop-in" on zoom. These are precisely the mirroring / white-tile /
  residual-signal artifacts CLAUDE.md names as recurring. Their regression guard
  is the E2E suite, which skips in CI when the real file is absent. The
  invariants the project holds sacred are enforced only by tests that do not run
  automatically.

- **Mip selection is coarse.** `selectMipLevel` uses `round(log2(zoom))`, one
  level for the whole viewport, with no anisotropy or per-tile refinement.
  Adequate, but not a sophisticated LOD scheme.

- **Assumptions baked into the reader.** Little-endian only (matches all real
  x86/ARM writers, but unvalidated against a hypothetical big-endian file);
  only the `psgh` extension is understood (others are skipped byte-by-byte);
  contig name decode is byte-wise ASCII via `String.fromCharCode` (non-ASCII
  names would mangle). None are likely to bite real files, but each is an
  unstated assumption.

- **R8 quantization in the display path.** Overview and tiles upload as R8
  normalized (float intensity quantized to 8 bits) for compatibility. Fine for
  visualization; worth stating explicitly since it is a lossy step between the
  decoded float values and what is shown.

**Bottom line.** The native client-side `.pretext` reader (novelty #1) is a real,
defensible, publishable contribution and the honest center of any paper on this
subsystem. Before it goes to review, close the one gap that most undercuts it:
add a CI-running numeric test that pins BC4 decode against ground truth
(synthetic round-trip or a committed reference tile). Frame the rendering
pipeline as sound engineering rather than novelty, and phrase the tool
comparison comparatively rather than as a universal first.
