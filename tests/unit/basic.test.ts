import { describe, it, expect } from 'vitest';
import { getColorMapData, getColorMapNames } from '../../src/renderer/ColorMaps';
import { generateSyntheticMap, generateMisassembledMap } from '../../src/formats/SyntheticData';

describe('ColorMaps', () => {
  it('should return 256 RGBA entries for each color map', () => {
    for (const name of getColorMapNames()) {
      const data = getColorMapData(name);
      expect(data.length).toBe(256 * 4);
    }
  });

  it('red-white should start white and end red', () => {
    const data = getColorMapData('red-white');
    // First entry (intensity 0) should be white
    expect(data[0]).toBe(255); // R
    expect(data[1]).toBe(255); // G
    expect(data[2]).toBe(255); // B
    
    // Last entry (intensity 1) should be red
    const last = 255 * 4;
    expect(data[last]).toBe(255);     // R
    expect(data[last + 1]).toBe(0);   // G
    expect(data[last + 2]).toBe(0);   // B
  });

  it('all values should be in 0-255 range', () => {
    for (const name of getColorMapNames()) {
      const data = getColorMapData(name);
      for (let i = 0; i < data.length; i++) {
        expect(data[i]).toBeGreaterThanOrEqual(0);
        expect(data[i]).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('SyntheticData', () => {
  it('should generate a square matrix of the correct size', () => {
    const result = generateSyntheticMap(512, 6);
    expect(result.data.length).toBe(512 * 512);
    expect(result.size).toBe(512);
  });

  it('should generate the requested number of chromosomes', () => {
    const result = generateSyntheticMap(1024, 8);
    expect(result.contigs.length).toBe(8);
  });

  it('should produce a symmetric matrix', () => {
    const { data, size } = generateSyntheticMap(256, 4);
    // Check several random positions
    for (let i = 0; i < 20; i++) {
      const x = Math.floor(Math.random() * size);
      const y = Math.floor(Math.random() * size);
      expect(data[y * size + x]).toBeCloseTo(data[x * size + y], 5);
    }
  });

  it('should have stronger signal on the diagonal', () => {
    const { data, size } = generateSyntheticMap(512, 6);
    let diagonalSum = 0;
    let offDiagonalSum = 0;
    let diagonalCount = 0;
    let offDiagonalCount = 0;

    for (let i = 0; i < size; i++) {
      diagonalSum += data[i * size + i];
      diagonalCount++;
      // Check a far off-diagonal pixel
      const offX = (i + size / 2) % size;
      offDiagonalSum += data[i * size + offX];
      offDiagonalCount++;
    }

    const avgDiagonal = diagonalSum / diagonalCount;
    const avgOffDiagonal = offDiagonalSum / offDiagonalCount;
    expect(avgDiagonal).toBeGreaterThan(avgOffDiagonal);
  });

  it('should generate values in [0, 1] range', () => {
    const { data } = generateSyntheticMap(256, 4);
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('should generate misassembled data', () => {
    const result = generateMisassembledMap(512);
    expect(result.data.length).toBe(512 * 512);
    expect(result.contigs.length).toBeGreaterThan(0);
  });
});
