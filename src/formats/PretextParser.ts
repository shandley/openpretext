/**
 * Parser for the .pretext binary file format.
 * 
 * The .pretext format stores Hi-C contact maps as DXT1-compressed texture blocks:
 * 
 * File layout:
 * 1. Magic header + version info
 * 2. Contig metadata (names, lengths, ordering)
 * 3. Texture resolution and mipmap count
 * 4. For each mipmap level:
 *    - Deflate-compressed DXT1 texture blocks
 * 5. Optional extension data (bedgraph tracks)
 * 
 * This parser reads the binary format and produces:
 * - Contig information
 * - Decoded texture data as Float32Array per mipmap level
 * - Extension track data
 */

import pako from 'pako';

export interface PretextContig {
  name: string;
  length: number;       // Original length in base pairs
  pixelStart: number;   // Start position in the texture (pixels)
  pixelEnd: number;     // End position in the texture (pixels)
}

export interface PretextExtension {
  name: string;
  data: Float32Array;
}

export interface PretextFile {
  version: number;
  textureSize: number;
  numMipMaps: number;
  contigs: PretextContig[];
  textures: Float32Array[];  // One per mipmap level
  extensions: PretextExtension[];
}

/**
 * Decode a DXT1 (BC1) compressed block into RGBA pixels.
 * DXT1 encodes a 4×4 pixel block into 8 bytes:
 * - 2 bytes: color0 (RGB565)
 * - 2 bytes: color1 (RGB565)  
 * - 4 bytes: lookup table (2 bits per pixel, 16 pixels)
 */
function decodeDXT1Block(block: DataView, offset: number): Uint8Array {
  // Read the two reference colors (RGB565)
  const c0 = block.getUint16(offset, true);
  const c1 = block.getUint16(offset + 2, true);
  
  // Convert RGB565 to RGB888
  const r0 = ((c0 >> 11) & 0x1F) * 255 / 31;
  const g0 = ((c0 >> 5) & 0x3F) * 255 / 63;
  const b0 = (c0 & 0x1F) * 255 / 31;
  
  const r1 = ((c1 >> 11) & 0x1F) * 255 / 31;
  const g1 = ((c1 >> 5) & 0x3F) * 255 / 63;
  const b1 = (c1 & 0x1F) * 255 / 31;
  
  // Build color table
  const colors: number[][] = [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 255],
  ];
  
  if (c0 > c1) {
    // 4-color mode: interpolate
    colors[2] = [(2*r0 + r1)/3, (2*g0 + g1)/3, (2*b0 + b1)/3, 255];
    colors[3] = [(r0 + 2*r1)/3, (g0 + 2*g1)/3, (b0 + 2*b1)/3, 255];
  } else {
    // 3-color + transparent mode
    colors[2] = [(r0 + r1)/2, (g0 + g1)/2, (b0 + b1)/2, 255];
    colors[3] = [0, 0, 0, 0]; // Transparent
  }
  
  // Read the 4-byte lookup table
  const lookup = block.getUint32(offset + 4, true);
  
  // Decode 4×4 pixels
  const pixels = new Uint8Array(4 * 4 * 4); // 16 pixels × 4 channels
  for (let i = 0; i < 16; i++) {
    const idx = (lookup >> (i * 2)) & 0x3;
    const color = colors[idx];
    pixels[i * 4 + 0] = color[0];
    pixels[i * 4 + 1] = color[1];
    pixels[i * 4 + 2] = color[2];
    pixels[i * 4 + 3] = color[3];
  }
  
  return pixels;
}

/**
 * Decode a full DXT1-compressed texture into an RGBA Float32Array (single channel intensity).
 * For Hi-C data, we only need the luminance/intensity.
 */
function decodeDXT1Texture(compressedData: Uint8Array, width: number, height: number): Float32Array {
  const output = new Float32Array(width * height);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const view = new DataView(compressedData.buffer, compressedData.byteOffset, compressedData.byteLength);
  
  let blockOffset = 0;
  
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      if (blockOffset + 8 > compressedData.length) break;
      
      const pixels = decodeDXT1Block(view, blockOffset);
      blockOffset += 8; // 8 bytes per DXT1 block
      
      // Write decoded pixels to output
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          
          const srcIdx = (py * 4 + px) * 4;
          // Convert to intensity (simple luminance)
          const r = pixels[srcIdx] / 255;
          const g = pixels[srcIdx + 1] / 255;
          const b = pixels[srcIdx + 2] / 255;
          output[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * b;
        }
      }
    }
  }
  
  return output;
}

/**
 * Parse a .pretext file from an ArrayBuffer.
 * 
 * NOTE: The exact binary layout is reverse-engineered from the PretextMap and
 * PretextView source code. This parser handles the known format but may need
 * updates for newer versions.
 */
export async function parsePretextFile(buffer: ArrayBuffer): Promise<PretextFile> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  
  // Helper to read a null-terminated string
  function readString(): string {
    let str = '';
    while (offset < bytes.length && bytes[offset] !== 0) {
      str += String.fromCharCode(bytes[offset]);
      offset++;
    }
    offset++; // skip null terminator
    return str;
  }
  
  function readU32(): number {
    const val = view.getUint32(offset, true);
    offset += 4;
    return val;
  }
  
  function readU16(): number {
    const val = view.getUint16(offset, true);
    offset += 2;
    return val;
  }
  
  function readU8(): number {
    return bytes[offset++];
  }
  
  function readF32(): number {
    const val = view.getFloat32(offset, true);
    offset += 4;
    return val;
  }
  
  // Read magic and version
  // The pretext format starts with identifying bytes
  // Format may vary by version - this is a best-effort parser
  
  const magic = readString();
  if (!magic.startsWith('pretext')) {
    throw new Error(`Invalid pretext file: unexpected magic "${magic}"`);
  }
  
  const version = readU32();
  const textureSize = readU32();
  const numMipMaps = readU32();
  const numContigs = readU32();
  
  // Read contig metadata
  const contigs: PretextContig[] = [];
  for (let i = 0; i < numContigs; i++) {
    const name = readString();
    const length = readU32();
    const pixelStart = readU32();
    const pixelEnd = readU32();
    contigs.push({ name, length, pixelStart, pixelEnd });
  }
  
  // Read texture data for each mipmap level
  const textures: Float32Array[] = [];
  for (let level = 0; level < numMipMaps; level++) {
    const levelSize = textureSize >> level;
    const compressedSize = readU32();
    
    // Read compressed data
    const compressedData = bytes.slice(offset, offset + compressedSize);
    offset += compressedSize;
    
    // Decompress with deflate (raw, not gzip)
    let decompressed: Uint8Array;
    try {
      decompressed = pako.inflateRaw(compressedData);
    } catch (e) {
      console.warn(`Failed to decompress mipmap level ${level}, trying inflate:`, e);
      try {
        decompressed = pako.inflate(compressedData);
      } catch (e2) {
        console.error(`Failed to decompress mipmap level ${level}:`, e2);
        // Create empty texture for this level
        textures.push(new Float32Array(levelSize * levelSize));
        continue;
      }
    }
    
    // Decode DXT1 to float intensity
    const decoded = decodeDXT1Texture(decompressed, levelSize, levelSize);
    textures.push(decoded);
  }
  
  // Read extension data (if present)
  const extensions: PretextExtension[] = [];
  while (offset < bytes.length - 4) {
    try {
      const extNameLength = readU32();
      if (extNameLength === 0 || extNameLength > 256) break;
      
      let extName = '';
      for (let i = 0; i < extNameLength; i++) {
        extName += String.fromCharCode(readU8());
      }
      
      const extDataSize = readU32();
      const compressedExtData = bytes.slice(offset, offset + extDataSize);
      offset += extDataSize;
      
      const decompressedExt = pako.inflateRaw(compressedExtData);
      const extData = new Float32Array(decompressedExt.buffer);
      
      extensions.push({ name: extName, data: extData });
    } catch {
      break; // End of extensions
    }
  }
  
  return {
    version,
    textureSize,
    numMipMaps,
    contigs,
    textures,
    extensions,
  };
}

/**
 * Quick validation: is this likely a pretext file?
 */
export function isPretextFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(20, buffer.byteLength));
  const header = String.fromCharCode(...bytes.slice(0, 7));
  return header.startsWith('pretext');
}
