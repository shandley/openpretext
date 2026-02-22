import { describe, it, expect } from 'vitest';
import {
  reverseComplement,
  countMotifOccurrences,
  detectTelomeres,
  telomereToTrack,
} from '../../src/analysis/TelomereDetector';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a sequence of repeated telomere motifs with optional random filler. */
function telomereBlock(motif: string, repeats: number): string {
  return motif.repeat(repeats);
}

/** Generate a pseudo-random DNA sequence of given length (deterministic). */
function randomDNA(length: number, seed: number = 42): string {
  const bases = 'ACGT';
  let s = seed;
  let seq = '';
  for (let i = 0; i < length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    seq += bases[s % 4];
  }
  return seq;
}

// ---------------------------------------------------------------------------
// reverseComplement
// ---------------------------------------------------------------------------

describe('reverseComplement', () => {
  it('converts TTAGGG to CCCTAA', () => {
    expect(reverseComplement('TTAGGG')).toBe('CCCTAA');
  });

  it('converts CCCTAA to TTAGGG', () => {
    expect(reverseComplement('CCCTAA')).toBe('TTAGGG');
  });

  it('handles a longer sequence', () => {
    expect(reverseComplement('ATCGATCG')).toBe('CGATCGAT');
  });

  it('handles single nucleotide', () => {
    expect(reverseComplement('A')).toBe('T');
    expect(reverseComplement('C')).toBe('G');
  });

  it('returns empty string for empty input', () => {
    expect(reverseComplement('')).toBe('');
  });

  it('handles lowercase input by converting to uppercase', () => {
    expect(reverseComplement('ttaggg')).toBe('CCCTAA');
  });

  it('preserves unknown characters unchanged', () => {
    expect(reverseComplement('ANT')).toBe('ANT');
  });
});

// ---------------------------------------------------------------------------
// countMotifOccurrences
// ---------------------------------------------------------------------------

describe('countMotifOccurrences', () => {
  it('counts non-overlapping occurrences', () => {
    const seq = 'TTAGGGTTAGGGTTAGGG';
    expect(countMotifOccurrences(seq, 'TTAGGG')).toBe(3);
  });

  it('is case insensitive', () => {
    const seq = 'ttagggTTAGGGttaggg';
    expect(countMotifOccurrences(seq, 'TTAGGG')).toBe(3);
  });

  it('returns 0 when motif is absent', () => {
    const seq = 'AAAAAACCCCCCGGGGGG';
    expect(countMotifOccurrences(seq, 'TTAGGG')).toBe(0);
  });

  it('returns 0 for empty motif', () => {
    expect(countMotifOccurrences('TTAGGGTTAGGG', '')).toBe(0);
  });

  it('returns 0 for empty sequence', () => {
    expect(countMotifOccurrences('', 'TTAGGG')).toBe(0);
  });

  it('counts non-overlapping (does not double-count overlaps)', () => {
    // AAA contains 'AA' once (non-overlapping), not twice
    expect(countMotifOccurrences('AAA', 'AA')).toBe(1);
    expect(countMotifOccurrences('AAAA', 'AA')).toBe(2);
  });

  it('handles motif longer than sequence', () => {
    expect(countMotifOccurrences('TTA', 'TTAGGG')).toBe(0);
  });

  it('handles single occurrence', () => {
    const seq = 'AAATTAGGGCCC';
    expect(countMotifOccurrences(seq, 'TTAGGG')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// detectTelomeres — basic / edge cases
// ---------------------------------------------------------------------------

describe('detectTelomeres', () => {
  it('returns empty results for no sequences', () => {
    const result = detectTelomeres(new Map(), [], []);
    expect(result.hits).toHaveLength(0);
    expect(result.windowCount).toBe(0);
    expect(result.densityProfile).toHaveLength(0);
    expect(result.forwardMotif).toBe('TTAGGG');
    expect(result.reverseMotif).toBe('CCCTAA');
  });

  it('returns correct motifs in result', () => {
    const result = detectTelomeres(new Map(), [], [], {
      forwardMotif: 'AATCCC',
    });
    expect(result.forwardMotif).toBe('AATCCC');
    expect(result.reverseMotif).toBe(reverseComplement('AATCCC'));
  });

  // -----------------------------------------------------------------------
  // 5' end telomere detection
  // -----------------------------------------------------------------------

  it('detects telomere at 5-prime end', () => {
    // 5' end: 100 repeats of TTAGGG = 600 bp of telomere
    // followed by random sequence for the remainder
    const telomere5 = telomereBlock('TTAGGG', 100);
    const filler = randomDNA(9400);
    const seq = telomere5 + filler;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [10000], {
      windowSize: 1000,
      minDensity: 0.3,
    });

    const hit5 = result.hits.find(
      (h) => h.contigName === 'ctg1' && h.end === '5p',
    );
    expect(hit5).toBeDefined();
    expect(hit5!.density).toBeGreaterThanOrEqual(0.3);
    expect(hit5!.contigIndex).toBe(0);
    expect(hit5!.windowBp).toBe(1000);
  });

  // -----------------------------------------------------------------------
  // 3' end telomere detection
  // -----------------------------------------------------------------------

  it('detects telomere at 3-prime end', () => {
    const filler = randomDNA(9400);
    const telomere3 = telomereBlock('CCCTAA', 100); // reverse complement at 3'
    const seq = filler + telomere3;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [10000], {
      windowSize: 1000,
      minDensity: 0.3,
    });

    const hit3 = result.hits.find(
      (h) => h.contigName === 'ctg1' && h.end === '3p',
    );
    expect(hit3).toBeDefined();
    expect(hit3!.density).toBeGreaterThanOrEqual(0.3);
  });

  // -----------------------------------------------------------------------
  // Both ends
  // -----------------------------------------------------------------------

  it('detects telomere at both ends', () => {
    const telomere5 = telomereBlock('TTAGGG', 100); // 600 bp
    const telomere3 = telomereBlock('CCCTAA', 100); // 600 bp
    const filler = randomDNA(8800);
    const seq = telomere5 + filler + telomere3;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [10000], {
      windowSize: 1000,
      minDensity: 0.3,
    });

    const hit5 = result.hits.find(
      (h) => h.contigName === 'ctg1' && h.end === '5p',
    );
    const hit3 = result.hits.find(
      (h) => h.contigName === 'ctg1' && h.end === '3p',
    );
    expect(hit5).toBeDefined();
    expect(hit3).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Density below threshold
  // -----------------------------------------------------------------------

  it('does not record hit when density is below minDensity', () => {
    // Only 5 repeats of TTAGGG = 30 bp in a 10000 bp window
    // density = 30 / 10000 = 0.003 — well below 0.3 threshold
    const telomere = telomereBlock('TTAGGG', 5);
    const filler = randomDNA(9970);
    const seq = telomere + filler;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [10000]);
    expect(result.hits).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Custom params
  // -----------------------------------------------------------------------

  it('uses custom motif and parameters', () => {
    const customMotif = 'TTGGGG'; // Tetrahymena telomere
    const telomere = telomereBlock(customMotif, 80); // 480 bp
    const filler = randomDNA(520);
    const seq = telomere + filler;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [1000], {
      forwardMotif: customMotif,
      windowSize: 500,
      minDensity: 0.4,
    });

    expect(result.forwardMotif).toBe('TTGGGG');
    expect(result.reverseMotif).toBe(reverseComplement('TTGGGG'));

    const hit5 = result.hits.find((h) => h.end === '5p');
    expect(hit5).toBeDefined();
    // 480 bp of motif in 500 bp window => density = 480/500 = 0.96
    expect(hit5!.density).toBeGreaterThanOrEqual(0.4);
    expect(hit5!.windowBp).toBe(500);
  });

  it('respects lowered minDensity threshold', () => {
    // 20 repeats = 120 bp in 1000 bp window => density = 0.12
    const telomere = telomereBlock('TTAGGG', 20);
    const filler = randomDNA(880);
    const seq = telomere + filler;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [1000], {
      windowSize: 1000,
      minDensity: 0.1,
    });

    const hit5 = result.hits.find((h) => h.end === '5p');
    expect(hit5).toBeDefined();
    expect(hit5!.density).toBeGreaterThanOrEqual(0.1);
  });

  // -----------------------------------------------------------------------
  // Genome-wide density profile
  // -----------------------------------------------------------------------

  it('computes correct number of windows in density profile', () => {
    const seq = randomDNA(25000);
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [25000], {
      windowSize: 10000,
    });

    // 25000 / 10000 = 2.5 => ceil => 3 windows
    expect(result.windowCount).toBe(3);
    expect(result.densityProfile).toHaveLength(3);
  });

  it('density profile is zero for random non-telomeric sequence', () => {
    const seq = randomDNA(10000, 99);
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [10000], {
      windowSize: 5000,
    });

    // Random sequence should have near-zero telomere density
    for (let i = 0; i < result.windowCount; i++) {
      expect(result.densityProfile[i]).toBeLessThan(0.1);
    }
  });

  it('density profile is high in windows with telomere repeats', () => {
    // Build 10000 bp: first 5000 is telomere, second 5000 is random
    const telomere = telomereBlock('TTAGGG', 833); // 833*6 = 4998 bp
    const filler = randomDNA(5002);
    const seq = telomere + filler;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [10000], {
      windowSize: 5000,
    });

    expect(result.windowCount).toBe(2);
    // First window should have high density
    expect(result.densityProfile[0]).toBeGreaterThan(0.5);
    // Second window should have low density
    expect(result.densityProfile[1]).toBeLessThan(0.15);
  });

  it('density profile values are clamped to [0, 1]', () => {
    // All telomere repeats — density could sum forward + reverse > 1 before clamping
    const seq = telomereBlock('TTAGGG', 500);
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [3000], {
      windowSize: 1000,
    });

    for (let i = 0; i < result.windowCount; i++) {
      expect(result.densityProfile[i]).toBeLessThanOrEqual(1.0);
      expect(result.densityProfile[i]).toBeGreaterThanOrEqual(0.0);
    }
  });

  // -----------------------------------------------------------------------
  // Multiple contigs
  // -----------------------------------------------------------------------

  it('detects telomeres across multiple contigs', () => {
    const telomere = telomereBlock('TTAGGG', 100); // 600 bp
    const filler = randomDNA(9400);

    // ctg1: telomere at 5' only
    const seq1 = telomere + filler;
    // ctg2: telomere at 3' only
    const seq2 = filler + telomere;
    // ctg3: no telomere
    const seq3 = randomDNA(10000, 77);

    const seqs = new Map([
      ['ctg1', seq1],
      ['ctg2', seq2],
      ['ctg3', seq3],
    ]);
    const names = ['ctg1', 'ctg2', 'ctg3'];
    const lengths = [10000, 10000, 10000];

    const result = detectTelomeres(seqs, names, lengths, {
      windowSize: 1000,
      minDensity: 0.3,
    });

    const ctg1Hits = result.hits.filter((h) => h.contigName === 'ctg1');
    const ctg2Hits = result.hits.filter((h) => h.contigName === 'ctg2');
    const ctg3Hits = result.hits.filter((h) => h.contigName === 'ctg3');

    expect(ctg1Hits.some((h) => h.end === '5p')).toBe(true);
    expect(ctg2Hits.some((h) => h.end === '3p')).toBe(true);
    expect(ctg3Hits).toHaveLength(0);
  });

  it('assigns correct contigIndex to hits across multiple contigs', () => {
    const telomere = telomereBlock('TTAGGG', 100);
    const filler = randomDNA(9400);
    const seq = telomere + filler;

    const seqs = new Map([
      ['alpha', seq],
      ['beta', seq],
    ]);

    const result = detectTelomeres(seqs, ['alpha', 'beta'], [10000, 10000], {
      windowSize: 1000,
      minDensity: 0.3,
    });

    const alphaHit = result.hits.find((h) => h.contigName === 'alpha');
    const betaHit = result.hits.find((h) => h.contigName === 'beta');
    expect(alphaHit!.contigIndex).toBe(0);
    expect(betaHit!.contigIndex).toBe(1);
  });

  it('density profile spans all contigs', () => {
    const seqs = new Map([
      ['ctg1', randomDNA(10000, 1)],
      ['ctg2', randomDNA(10000, 2)],
    ]);

    const result = detectTelomeres(seqs, ['ctg1', 'ctg2'], [10000, 10000], {
      windowSize: 10000,
    });

    // Total 20000 bp / 10000 window = 2 windows
    expect(result.windowCount).toBe(2);
    expect(result.densityProfile).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Missing sequence for a contig (skip gracefully)
  // -----------------------------------------------------------------------

  it('skips contigs with missing sequences gracefully', () => {
    const telomere = telomereBlock('TTAGGG', 100);
    const filler = randomDNA(9400);
    const seq = telomere + filler;

    // Only ctg1 has a sequence; ctg2 is missing from the map
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(
      seqs,
      ['ctg1', 'ctg2'],
      [10000, 10000],
      { windowSize: 1000, minDensity: 0.3 },
    );

    // Should still detect ctg1 telomere
    const ctg1Hit = result.hits.find((h) => h.contigName === 'ctg1');
    expect(ctg1Hit).toBeDefined();

    // No hits for ctg2
    const ctg2Hits = result.hits.filter((h) => h.contigName === 'ctg2');
    expect(ctg2Hits).toHaveLength(0);

    // Density profile should still have correct window count for total genome
    // Total: 20000 bp / 1000 = 20 windows
    expect(result.windowCount).toBe(20);
  });

  // -----------------------------------------------------------------------
  // Contig shorter than window size
  // -----------------------------------------------------------------------

  it('handles contig shorter than windowSize', () => {
    // Contig is only 100 bp with 10 repeats of TTAGGG = 60 bp
    // density = 60 / 100 = 0.6
    const seq = telomereBlock('TTAGGG', 10) + randomDNA(40);
    const seqs = new Map([['tiny', seq]]);

    const result = detectTelomeres(seqs, ['tiny'], [100], {
      windowSize: 10000,
      minDensity: 0.3,
    });

    // 5' and 3' windows both cover the entire contig
    const hit5 = result.hits.find((h) => h.end === '5p');
    expect(hit5).toBeDefined();
    expect(hit5!.windowBp).toBe(100);
  });

  // -----------------------------------------------------------------------
  // Forward vs reverse detection
  // -----------------------------------------------------------------------

  it('detects reverse complement motif at 5-prime end', () => {
    // Use CCCTAA (reverse of TTAGGG) at the 5' end
    const revTelomere = telomereBlock('CCCTAA', 100);
    const filler = randomDNA(9400);
    const seq = revTelomere + filler;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [10000], {
      windowSize: 1000,
      minDensity: 0.3,
    });

    const hit5 = result.hits.find((h) => h.end === '5p');
    expect(hit5).toBeDefined();
    expect(hit5!.density).toBeGreaterThanOrEqual(0.3);
  });

  it('uses the higher density of forward and reverse motif', () => {
    // Mix forward and reverse at 5' end — both should be tested
    const fwdPart = telomereBlock('TTAGGG', 30); // 180 bp
    const revPart = telomereBlock('CCCTAA', 80); // 480 bp
    const filler = randomDNA(340);
    const seq = fwdPart + revPart + filler;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [1000], {
      windowSize: 1000,
      minDensity: 0.3,
    });

    const hit5 = result.hits.find((h) => h.end === '5p');
    expect(hit5).toBeDefined();
    // Reverse motif has higher count: 80 occurrences * 6 / 1000 = 0.48
    // Forward motif: 30 * 6 / 1000 = 0.18
    // Should use max = 0.48
    expect(hit5!.density).toBeGreaterThanOrEqual(0.4);
  });
});

// ---------------------------------------------------------------------------
// telomereToTrack
// ---------------------------------------------------------------------------

describe('telomereToTrack', () => {
  it('produces track with correct name, type, color, and height', () => {
    const result = detectTelomeres(new Map(), [], []);
    const track = telomereToTrack(result, 100);

    expect(track.name).toBe('Telomere Repeats');
    expect(track.type).toBe('line');
    expect(track.color).toBe('#00e676');
    expect(track.height).toBe(30);
    expect(track.visible).toBe(true);
  });

  it('produces data array of correct length matching totalPixels', () => {
    const telomere = telomereBlock('TTAGGG', 100);
    const filler = randomDNA(9400);
    const seq = telomere + filler;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [10000], {
      windowSize: 5000,
    });

    const track = telomereToTrack(result, 256);
    expect(track.data).toHaveLength(256);
  });

  it('maps density profile values into track data', () => {
    // Create a known density profile: window 0 high, window 1 low
    const telomere = telomereBlock('TTAGGG', 500); // 3000 bp all telomere
    const filler = randomDNA(3000, 55);
    const seq = telomere + filler;
    const seqs = new Map([['ctg1', seq]]);

    const result = detectTelomeres(seqs, ['ctg1'], [6000], {
      windowSize: 3000,
    });

    expect(result.windowCount).toBe(2);

    const track = telomereToTrack(result, 100);

    // First half of pixels should map to window 0 (high density)
    // Second half should map to window 1 (low density)
    const firstHalf = track.data.slice(0, 50);
    const secondHalf = track.data.slice(50, 100);

    const firstAvg =
      firstHalf.reduce((a: number, b: number) => a + b, 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((a: number, b: number) => a + b, 0) /
      secondHalf.length;

    expect(firstAvg).toBeGreaterThan(secondAvg);
    expect(firstAvg).toBeGreaterThan(0.3);
  });

  it('handles zero windows (empty profile)', () => {
    const result = detectTelomeres(new Map(), [], []);
    expect(result.windowCount).toBe(0);

    const track = telomereToTrack(result, 50);
    expect(track.data).toHaveLength(50);

    // All values should be 0
    for (let i = 0; i < 50; i++) {
      expect(track.data[i]).toBe(0);
    }
  });

  it('handles single window profile mapped to many pixels', () => {
    const telomere = telomereBlock('TTAGGG', 100);
    const seqs = new Map([['ctg1', telomere]]);

    const result = detectTelomeres(seqs, ['ctg1'], [600], {
      windowSize: 10000,
    });

    // 600 bp / 10000 = 0.06 => ceil => 1 window
    expect(result.windowCount).toBe(1);

    const track = telomereToTrack(result, 200);
    // All pixels should have the same value (the single window's density)
    const val = track.data[0];
    for (let i = 1; i < 200; i++) {
      expect(track.data[i]).toBe(val);
    }
    expect(val).toBeGreaterThan(0);
  });

  it('handles totalPixels = 1', () => {
    const seq = randomDNA(5000);
    const seqs = new Map([['ctg1', seq]]);
    const result = detectTelomeres(seqs, ['ctg1'], [5000]);

    const track = telomereToTrack(result, 1);
    expect(track.data).toHaveLength(1);
  });
});
