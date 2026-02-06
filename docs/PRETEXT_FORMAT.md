# Pretext Binary File Format Specification

This document describes the binary format of `.pretext` files as produced by
**PretextMap** and consumed by **PretextView** and **PretextGraph**. It is
derived from direct reading of the C++ source code in the following
repositories:

- [PretextMap](https://github.com/sanger-tol/PretextMap) -- writes `.pretext` files
- [PretextView](https://github.com/sanger-tol/PretextView) -- reads `.pretext` files
- [PretextGraph](https://github.com/sanger-tol/PretextGraph) -- appends graph extensions

Source files examined:
- `PretextMap.cpp` (lines 2060--2475): texture creation and file writing
- `PretextView.cpp` (lines 5640--6370): file loading (the `LoadFile` function)
- `PretextGraph.cpp` (lines 1030--1310): header parsing and graph appending
- `utilsPretextView.cpp` (lines 28--48): `texture_id_cal` function

All multi-byte integers are stored in the **native byte order** of the
machine that wrote the file. In practice this is always **little-endian**
(x86/ARM).

---

## 1. Top-Level File Layout

```
+----------------------------------------------+
| Magic bytes (4 bytes)                        |
| Compressed header size (u32)                 |
| Uncompressed header size (u32)               |
| Compressed header data (variable)            |
+----------------------------------------------+
| Texture block 0: compressed size (u32)       |
|                  compressed data (variable)   |
| Texture block 1: compressed size (u32)       |
|                  compressed data (variable)   |
| ...                                          |
| Texture block N-1                            |
+----------------------------------------------+
| Extension 0 (optional)                       |
| Extension 1 (optional)                       |
| ...                                          |
+----------------------------------------------+
```

---

## 2. Magic Bytes

```c
u08 magic[4] = {'p', 's', 't', 'm'};  // 0x70 0x73 0x74 0x6D
```

The first 4 bytes of the file must be exactly `pstm` (ASCII). Both
PretextView and PretextGraph validate this before proceeding.

---

## 3. File Header

Immediately after the 4 magic bytes are two `u32` values:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 4 | 4 | u32 | `nBytesHeaderComp` -- size of the compressed header in bytes |
| 8 | 4 | u32 | `nBytesHeader` -- size of the uncompressed header in bytes |
| 12 | `nBytesHeaderComp` | bytes | Deflate-compressed header data |

The header is compressed using **libdeflate** (raw deflate, not gzip or zlib).
The uncompressed size is always `15 + (68 * Number_of_Contigs)` bytes.

### 3.1 Uncompressed Header Layout

After decompression, the header is a sequential byte stream parsed as follows:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 8 | u64 | Total genome length in base pairs |
| 8 | 4 | u32 | Number of contigs |
| 12 | 68 * N | -- | Per-contig records (see below) |
| 12 + 68*N | 1 | u08 | `textureRes` -- log2 of single texture resolution |
| 13 + 68*N | 1 | u08 | `nTextRes` -- log2 of number of textures per dimension |
| 14 + 68*N | 1 | u08 | `mipMapLevels` -- number of mipmap levels |

### 3.2 Per-Contig Record (68 bytes each)

Each contig record consists of:

| Offset (relative) | Size | Type | Description |
|--------------------|------|------|-------------|
| 0 | 4 | f32 | Fractional length of contig (`contig_length / total_genome_length`) |
| 4 | 64 | u32[16] | Contig name as null-terminated string packed into 16 x u32 |

The contigs are written in the order determined by PretextMap's sorting
(default: descending by length). The contig name is stored as a
null-terminated ASCII string packed into a 64-byte buffer. Any unused
bytes after the null terminator are zero-padded.

**Important**: The header does NOT store absolute base-pair lengths or pixel
positions per contig. It stores only the fractional length (as `f32`).
PretextView reconstructs pixel positions by accumulating fractional lengths
against `Number_of_Pixels_1D`:

```
Number_of_Pixels_1D = Pow2(textureRes) * Pow2(nTextRes)
```

### 3.3 Derived Constants

From the three trailer bytes, the following values are computed:

| Name | Formula | Typical value |
|------|---------|---------------|
| `Texture_Resolution` | `1 << textureRes` | 1024 (normal), 2048 (highRes) |
| `Number_of_Textures_1D` | `1 << nTextRes` | 32 (normal), 32 (highRes) |
| `Number_of_Pixels_1D` | `Texture_Resolution * Number_of_Textures_1D` | 32768 (normal), 65536 (highRes) |
| `Number_of_MipMaps` | `mipMapLevels` | 6 (normal), 7 (highRes) |
| `Number_of_Texture_Blocks` | `(Number_of_Textures_1D + 1) * (Number_of_Textures_1D / 2)` | 528 (for 32) |

PretextMap defines these from:
- Normal mode: `Max_Image_Depth = 15`, `Single_Texture_Resolution = 10`, `Min_Image_Depth = 10`
- High-res mode: `Max_Image_Depth = 16`, `Single_Texture_Resolution = 11`
- `Number_of_LODs = Max_Image_Depth - Min_Image_Depth + 1`
- `nTextResolution = Max_Image_Depth - Single_Texture_Resolution`

So:
- Normal: `textureRes = 10`, `nTextRes = 5`, `mipMapLevels = 6`
- HighRes: `textureRes = 11`, `nTextRes = 5`, `mipMapLevels = 7`

---

## 4. Texture Blocks

After the header, the remainder of the file (until any extensions) consists
of texture blocks. Each block represents one tile of the upper-triangular
contact matrix (including the diagonal), containing all mipmap levels.

### 4.1 Block Count

The total number of texture blocks is the number of tiles in the upper
triangle (including diagonal) of an `N x N` grid where
`N = Number_of_Textures_1D`:

```
Number_of_Texture_Blocks = N * (N + 1) / 2
```

Which equals `(N + 1) * (N >> 1)` in the source code, yielding 528 blocks
for `N = 32`.

### 4.2 Block Ordering

Blocks are written in upper-triangular row-major order. The write loop
in PretextMap iterates:

```c
ForLoop(Pow2(nTextResolution))        // x = 0 .. N-1
{
    ForLoop2(Pow2(nTextResolution) - index)  // y = x .. N-1
    {
        coordinate = (x << 8) | (x + index2);  // y = x + index2
    }
}
```

So the order is:
- Block 0: tile (0, 0)
- Block 1: tile (0, 1)
- Block 2: tile (0, 2)
- ...
- Block N-1: tile (0, N-1)
- Block N: tile (1, 1)
- Block N+1: tile (1, 2)
- ...

The linear index formula (from `texture_id_cal`) for tile `(x, y)` where
`x <= y` is:

```
linear_index = ((2 * N - x - 1) * x) / 2 + y
```

### 4.3 Per-Block Binary Format

Each block on disk:

| Size | Type | Description |
|------|------|-------------|
| 4 | u32 | `nCompressedBytes` -- size of the following compressed data |
| `nCompressedBytes` | bytes | Deflate-compressed texture data (libdeflate, level 12) |

### 4.4 Decompressed Texture Data

After decompression, a block contains **BC4-compressed** (also known as
RGTC1 or `GL_COMPRESSED_RED_RGTC1`) texture data for all mipmap levels of
that tile, concatenated sequentially from highest resolution to lowest.

The total decompressed size (`Bytes_Per_Texture`) is:

```
sum over mipmap levels i=0..mipMapLevels-1:
    Pow2(2 * (textureRes - i)) / 2
```

Which simplifies to (in PretextMap):
```c
u32 nBytesPerText = 0;
u32 textRes = Single_Texture_Resolution;
ForLoop(Number_of_LODs)
{
    nBytesPerText += Pow2((2 * textRes--));
}
nBytesPerText >>= 1;
```

For normal mode (`textureRes = 10`, 6 mipmap levels):
- Level 0: 1024 x 1024 pixels -> 1024 * 512 = 524288 bytes of BC4 data
- Level 1: 512 x 512 -> 512 * 256 = 131072
- Level 2: 256 x 256 -> 256 * 128 = 32768
- Level 3: 128 x 128 -> 128 * 64 = 8192
- Level 4: 64 x 64 -> 64 * 32 = 2048
- Level 5: 32 x 32 -> 32 * 16 = 512
- Total: 698880 bytes

For BC4, the byte size per mipmap level is:
```
resolution * (resolution / 2)
```
because BC4 stores 8 bytes per 4x4 block = 0.5 bytes per pixel.

### 4.5 BC4 (RGTC1) Compression Format

BC4 is a single-channel block compression format. Each 4x4 pixel block is
encoded in 8 bytes:

| Byte Offset | Size | Description |
|-------------|------|-------------|
| 0 | 1 | `alpha0` -- first reference value (u08) |
| 1 | 1 | `alpha1` -- second reference value (u08) |
| 2 | 6 | 16 x 3-bit lookup indices (48 bits, packed little-endian) |

The 3-bit indices select from an interpolation table:

If `alpha0 > alpha1`:
- 0: `alpha0`
- 1: `alpha1`
- 2: `(6*alpha0 + 1*alpha1) / 7`
- 3: `(5*alpha0 + 2*alpha1) / 7`
- 4: `(4*alpha0 + 3*alpha1) / 7`
- 5: `(3*alpha0 + 4*alpha1) / 7`
- 6: `(2*alpha0 + 5*alpha1) / 7`
- 7: `(1*alpha0 + 6*alpha1) / 7`

If `alpha0 <= alpha1`:
- 0: `alpha0`
- 1: `alpha1`
- 2: `(4*alpha0 + 1*alpha1) / 5`
- 3: `(3*alpha0 + 2*alpha1) / 5`
- 4: `(2*alpha0 + 3*alpha1) / 5`
- 5: `(1*alpha0 + 4*alpha1) / 5`
- 6: 0
- 7: 255

The pixel ordering within a 4x4 block is determined by `stb_compress_bc4_block`
from the stb_dxt library. In PretextMap, the input pixel order is column-major
within each 4x4 block (inner loop is y, outer is x).

**Important**: PretextMap uses `stb_compress_bc4_block`, NOT DXT1/BC1. The
original speculative parser's use of DXT1 decoding is incorrect.

---

## 5. Pixel Ordering Within a Tile

Within each tile at each mipmap level, pixels are written in the order
that PretextMap iterates them for BC4 compression:

```c
for (x = 0; x < texturePixelResolution; x += 4)
{
    for (y = 0; y < texturePixelResolution; y += 4)
    {
        // For each 4x4 block:
        for (dxt_x = 0; dxt_x < 4; ++dxt_x)
        {
            for (dxt_y = 0; dxt_y < 4; ++dxt_y)
            {
                pixel = image[min(px, py)][max(px, py) - min(px, py)];
            }
        }
        stb_compress_bc4_block(output, block);
    }
}
```

The image is stored as an upper-triangular matrix (`image[min][max - min]`),
so the data is symmetric across the diagonal.

---

## 6. Extensions

Extensions are appended after all texture blocks. They are optional and there
can be zero or more. Each extension starts with its own 4-byte magic.

### 6.1 Extension Detection

PretextView reads 4 bytes at a time and compares against known extension
magic bytes. Currently, only one extension type is defined:

```c
char Extension_Magic_Bytes[][4] = {
    {'p', 's', 'g', 'h'}   // graph extension (extension_graph, index 0)
};
```

### 6.2 Graph Extension Format (`psgh`)

Graph extensions are created by PretextGraph to embed bedgraph data
(coverage, repeat density, gap, telomere tracks, etc.) into a pretext file.

| Size | Type | Description |
|------|------|-------------|
| 4 | bytes | Magic: `psgh` (0x70 0x73 0x67 0x68) |
| 4 | u32 | `compSize` -- size of compressed data |
| `compSize` | bytes | Deflate-compressed graph data (libdeflate, level 12) |

The decompressed data has the following layout:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 64 | u32[16] | Graph name (null-terminated string, same format as contig names) |
| 64 | `4 * mapResolution` | s32[] | Graph values, one per pixel |

Where `mapResolution = textureResolution * numberOfTextures1D = Number_of_Pixels_1D`.

The total decompressed size is `64 + (4 * Number_of_Pixels_1D)` bytes.

In PretextView, the `s32` values are interpreted as graph heights and
normalized by dividing by the maximum value for display.

### 6.3 Multiple Extensions

Multiple graph extensions can be appended sequentially. PretextView's loading
loop continues scanning for extension magic bytes until it reaches the end of
the file. Each graph extension has its own `psgh` magic, compressed size, and
data block.

---

## 7. Summary of Data Types

| Type | Size | Description |
|------|------|-------------|
| u08 | 1 byte | Unsigned 8-bit integer |
| u16 | 2 bytes | Unsigned 16-bit integer |
| u32 | 4 bytes | Unsigned 32-bit integer |
| u64 | 8 bytes | Unsigned 64-bit integer |
| s32 | 4 bytes | Signed 32-bit integer |
| f32 | 4 bytes | IEEE 754 single-precision float |
| f64 | 8 bytes | IEEE 754 double-precision float |

---

## 8. Compression

All compression in the format uses **raw deflate** via the
[libdeflate](https://github.com/ebiggers/libdeflate) library at compression
level 12. This is NOT gzip (no gzip header/trailer) and NOT zlib (no zlib
header/checksum). It is the raw DEFLATE algorithm as defined in RFC 1951.

The JavaScript equivalent for decompression is `pako.inflateRaw()`.

---

## 9. Visual Diagram

```
Byte 0            4          8           12
+------+----------+----------+-----...-----+
| pstm | compSize | uncompSz | compressed  |
|      |  (u32)   |  (u32)   | header data |
+------+----------+----------+-----...-----+
                                            |
+-------------------------------------------+
| Texture block 0:                          |
|   u32 compressedSize                      |
|   [compressed BC4 data for all mipmaps]   |
+-------------------------------------------+
| Texture block 1:                          |
|   u32 compressedSize                      |
|   [compressed BC4 data for all mipmaps]   |
+-------------------------------------------+
| ... (repeat for all N*(N+1)/2 blocks)     |
+-------------------------------------------+
| Extension (optional):                     |
|   'p','s','g','h'  magic (4 bytes)        |
|   u32 compressedSize                      |
|   [compressed graph name + s32 values]    |
+-------------------------------------------+
| More extensions (optional) ...            |
+-------------------------------------------+
```
