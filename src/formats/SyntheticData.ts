/**
 * Generate synthetic Hi-C contact map data for testing and demo.
 * 
 * Creates realistic-looking Hi-C patterns including:
 * - Strong diagonal (self-contacts)
 * - Chromosome blocks (intra-chromosomal contacts)
 * - Some inter-chromosomal signal
 * - Noise
 */

export interface SyntheticMapResult {
  data: Float32Array;
  size: number;
  contigs: { name: string; start: number; end: number }[];
}

/**
 * Generate a synthetic Hi-C contact map.
 * @param size - Texture size (power of 2, e.g., 512, 1024, 2048)
 * @param numChromosomes - Number of chromosomes to simulate
 */
export function generateSyntheticMap(size: number = 1024, numChromosomes: number = 12): SyntheticMapResult {
  const data = new Float32Array(size * size);
  
  // Generate chromosome sizes (roughly decreasing)
  const chromSizes: number[] = [];
  let totalSize = 0;
  for (let i = 0; i < numChromosomes; i++) {
    const s = Math.max(20, Math.floor(size / numChromosomes * (1.5 - i / numChromosomes) + (Math.random() - 0.5) * 30));
    chromSizes.push(s);
    totalSize += s;
  }
  
  // Normalize to fill the texture
  const scale = size / totalSize;
  const contigs: { name: string; start: number; end: number }[] = [];
  let offset = 0;
  for (let i = 0; i < numChromosomes; i++) {
    const pixelSize = Math.round(chromSizes[i] * scale);
    contigs.push({
      name: `chr${i + 1}`,
      start: offset,
      end: offset + pixelSize,
    });
    offset += pixelSize;
  }
  
  // Fill the contact matrix
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 0;
      
      // Distance from diagonal
      const dist = Math.abs(x - y);
      
      // Strong diagonal decay (power law)
      if (dist < size / 2) {
        value += Math.pow(1.0 / (1 + dist * 0.1), 1.5);
      }
      
      // Chromosome blocks
      for (const contig of contigs) {
        const inX = x >= contig.start && x < contig.end;
        const inY = y >= contig.start && y < contig.end;
        
        if (inX && inY) {
          // Intra-chromosomal: stronger signal
          const localDist = Math.abs(x - y);
          value += 0.3 * Math.pow(1.0 / (1 + localDist * 0.05), 1.2);
          
          // Sub-TAD structures (small bright squares along diagonal)
          const tadSize = 15 + Math.floor(Math.random() * 10);
          const localX = x - contig.start;
          const localY = y - contig.start;
          const tadX = Math.floor(localX / tadSize);
          const tadY = Math.floor(localY / tadSize);
          if (tadX === tadY) {
            value += 0.15;
          }
        } else if (inX || inY) {
          // Inter-chromosomal: weak signal
          value += 0.02 * Math.random();
        }
      }
      
      // Add some noise
      value += Math.random() * 0.03;
      
      // Symmetry (Hi-C matrices are symmetric)
      const idx1 = y * size + x;
      const idx2 = x * size + y;
      
      // Clamp
      value = Math.min(1.0, Math.max(0.0, value));
      
      data[idx1] = value;
      data[idx2] = value;
    }
  }
  
  return { data, size, contigs };
}

/**
 * Generate a map that simulates a misassembled genome
 * (useful for testing curation operations).
 */
export function generateMisassembledMap(size: number = 1024): SyntheticMapResult {
  // Start with a good assembly
  const result = generateSyntheticMap(size, 8);
  
  // Simulate some misassemblies:
  // 1. An inversion (a block along the diagonal is flipped)
  const invertStart = Math.floor(size * 0.3);
  const invertEnd = Math.floor(size * 0.35);
  for (let y = invertStart; y < invertEnd; y++) {
    for (let x = 0; x < size; x++) {
      const flippedY = invertEnd - (y - invertStart) - 1;
      const srcIdx = flippedY * size + x;
      const dstIdx = y * size + x;
      result.data[dstIdx] = result.data[srcIdx];
    }
  }
  
  // 2. A translocation (swap two blocks)
  const block1Start = Math.floor(size * 0.6);
  const block1End = Math.floor(size * 0.65);
  const block2Start = Math.floor(size * 0.8);
  const block2End = Math.floor(size * 0.85);
  
  for (let i = 0; i < block1End - block1Start; i++) {
    for (let x = 0; x < size; x++) {
      const temp = result.data[(block1Start + i) * size + x];
      result.data[(block1Start + i) * size + x] = result.data[(block2Start + i) * size + x];
      result.data[(block2Start + i) * size + x] = temp;
    }
  }
  
  return result;
}
