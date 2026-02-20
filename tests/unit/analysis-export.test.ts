import { describe, it, expect } from 'vitest';
import type { AppState, ContigInfo } from '../../src/core/State';
import type { InsulationResult } from '../../src/analysis/InsulationScore';
import type { ContactDecayResult } from '../../src/analysis/ContactDecay';
import type { CompartmentResult } from '../../src/analysis/CompartmentAnalysis';
import {
  buildPixelToContigMap,
  exportInsulationBedGraph,
  exportCompartmentBedGraph,
  exportDecayTSV,
} from '../../src/export/AnalysisExport';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeContig(
  name: string,
  index: number,
  length: number,
  pixelStart: number,
  pixelEnd: number,
): ContigInfo {
  return {
    name,
    originalIndex: index,
    length,
    pixelStart,
    pixelEnd,
    inverted: false,
    scaffoldId: null,
  };
}

function makeAppState(contigs: ContigInfo[], contigOrder: number[], textureSize = 100): AppState {
  return {
    map: {
      filename: 'test.pretext',
      textureSize,
      numMipMaps: 1,
      tileResolution: 256,
      tilesPerDimension: 1,
      contigs,
      contactMap: null,
      rawTiles: null,
      parsedHeader: null,
      extensions: new Map(),
    },
    contigOrder,
    mode: 'navigate',
    showGrid: true,
    showTooltip: true,
    showIdBar: false,
    visibleTracks: new Set(),
    colorMapName: 'red-white',
    gamma: 0.35,
    selectedContigs: new Set(),
    camera: { x: 0, y: 0, zoom: 1 },
    undoStack: [],
    redoStack: [],
  } as AppState;
}

// ---------------------------------------------------------------------------
// buildPixelToContigMap
// ---------------------------------------------------------------------------

describe('buildPixelToContigMap', () => {
  it('maps pixels to a single contig', () => {
    const contigs = [makeContig('ctg1', 0, 10000, 0, 100)];
    const state = makeAppState(contigs, [0], 100);
    const map = buildPixelToContigMap(state, 10);

    expect(map).toHaveLength(10);
    for (const entry of map) {
      expect(entry.contigName).toBe('ctg1');
      expect(entry.bpStart).toBeGreaterThanOrEqual(0);
      expect(entry.bpEnd).toBeLessThanOrEqual(10000);
      expect(entry.bpEnd).toBeGreaterThan(entry.bpStart);
    }
    // First pixel starts at 0, last pixel ends at 10000
    expect(map[0].bpStart).toBe(0);
    expect(map[9].bpEnd).toBe(10000);
  });

  it('maps pixels across two contigs', () => {
    const contigs = [
      makeContig('ctg1', 0, 5000, 0, 50),
      makeContig('ctg2', 1, 8000, 50, 100),
    ];
    const state = makeAppState(contigs, [0, 1], 100);
    const map = buildPixelToContigMap(state, 10);

    expect(map).toHaveLength(10);
    // First 5 pixels should be ctg1, last 5 should be ctg2
    for (let i = 0; i < 5; i++) {
      expect(map[i].contigName).toBe('ctg1');
    }
    for (let i = 5; i < 10; i++) {
      expect(map[i].contigName).toBe('ctg2');
    }
  });

  it('respects contig order', () => {
    const contigs = [
      makeContig('ctg1', 0, 5000, 0, 50),
      makeContig('ctg2', 1, 8000, 50, 100),
    ];
    // Reversed order
    const state = makeAppState(contigs, [1, 0], 100);
    const map = buildPixelToContigMap(state, 10);

    // ctg2 should come first in reversed order
    expect(map[0].contigName).toBe('ctg2');
    expect(map[9].contigName).toBe('ctg1');
  });

  it('returns empty array when no map loaded', () => {
    const state = { map: null, contigOrder: [] } as unknown as AppState;
    const map = buildPixelToContigMap(state, 10);
    expect(map).toHaveLength(0);
  });

  it('handles three contigs of unequal size', () => {
    // 20 + 30 + 50 = 100 texture pixels
    const contigs = [
      makeContig('small', 0, 2000, 0, 20),
      makeContig('medium', 1, 3000, 20, 50),
      makeContig('large', 2, 5000, 50, 100),
    ];
    const state = makeAppState(contigs, [0, 1, 2], 100);
    const map = buildPixelToContigMap(state, 20);

    expect(map).toHaveLength(20);
    // First ~4 pixels map to 'small' (20% of 100 tex pixels)
    const smallCount = map.filter(m => m.contigName === 'small').length;
    const medCount = map.filter(m => m.contigName === 'medium').length;
    const largeCount = map.filter(m => m.contigName === 'large').length;
    expect(smallCount).toBe(4);
    expect(medCount).toBe(6);
    expect(largeCount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// exportInsulationBedGraph
// ---------------------------------------------------------------------------

describe('exportInsulationBedGraph', () => {
  const contigs = [
    makeContig('chr1', 0, 10000, 0, 50),
    makeContig('chr2', 1, 10000, 50, 100),
  ];
  const state = makeAppState(contigs, [0, 1], 100);
  const overviewSize = 10;

  const result: InsulationResult = {
    rawScores: new Float64Array([0.5, 0.6, 0.7, 0.8, 0.9, 0.4, 0.3, 0.2, 0.1, 0.05]),
    normalizedScores: new Float32Array(10),
    boundaries: [4],
    boundaryStrengths: [0.5],
  };

  it('produces valid BedGraph header', () => {
    const output = exportInsulationBedGraph(result, state, overviewSize);
    const lines = output.trim().split('\n');
    expect(lines[0]).toBe('track type=bedGraph name="Insulation Score"');
  });

  it('outputs correct number of data lines', () => {
    const output = exportInsulationBedGraph(result, state, overviewSize);
    const lines = output.trim().split('\n');
    // 1 header + 10 data lines
    expect(lines.length).toBe(11);
  });

  it('uses raw scores as values', () => {
    const output = exportInsulationBedGraph(result, state, overviewSize);
    const lines = output.trim().split('\n');
    const firstData = lines[1].split('\t');
    expect(firstData).toHaveLength(4);
    expect(parseFloat(firstData[3])).toBeCloseTo(0.5, 4);
  });

  it('maps to correct contigs', () => {
    const output = exportInsulationBedGraph(result, state, overviewSize);
    const lines = output.trim().split('\n').slice(1);
    // First 5 should be chr1, last 5 chr2
    for (let i = 0; i < 5; i++) {
      expect(lines[i].startsWith('chr1\t')).toBe(true);
    }
    for (let i = 5; i < 10; i++) {
      expect(lines[i].startsWith('chr2\t')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// exportCompartmentBedGraph
// ---------------------------------------------------------------------------

describe('exportCompartmentBedGraph', () => {
  const contigs = [makeContig('chr1', 0, 10000, 0, 100)];
  const state = makeAppState(contigs, [0], 100);
  const overviewSize = 5;

  const result: CompartmentResult = {
    eigenvector: new Float32Array([0.5, -0.3, 0.1, -0.8, 0.4]),
    normalizedEigenvector: new Float32Array(5),
    iterations: 50,
    eigenvalue: 3.2,
  };

  it('produces valid BedGraph with signed eigenvector values', () => {
    const output = exportCompartmentBedGraph(result, state, overviewSize);
    const lines = output.trim().split('\n');
    expect(lines[0]).toContain('A/B Compartment Eigenvector');

    // Check for negative values (B compartment)
    const values = lines.slice(1).map(l => parseFloat(l.split('\t')[3]));
    expect(values.some(v => v < 0)).toBe(true);
    expect(values.some(v => v > 0)).toBe(true);
  });

  it('outputs one line per pixel', () => {
    const output = exportCompartmentBedGraph(result, state, overviewSize);
    const lines = output.trim().split('\n');
    expect(lines.length).toBe(6); // 1 header + 5 data
  });
});

// ---------------------------------------------------------------------------
// exportDecayTSV
// ---------------------------------------------------------------------------

describe('exportDecayTSV', () => {
  const result: ContactDecayResult = {
    distances: new Float64Array([1, 2, 3, 4, 5]),
    meanContacts: new Float64Array([1.0, 0.5, 0.333, 0.25, 0.2]),
    logDistances: new Float64Array([0, 0.301, 0.477, 0.602, 0.699]),
    logContacts: new Float64Array([0, -0.301, -0.477, -0.602, -0.699]),
    decayExponent: -1.0,
    rSquared: 0.999,
    maxDistance: 5,
  };

  it('includes comment header with stats', () => {
    const output = exportDecayTSV(result);
    expect(output).toContain('# Decay exponent: -1.0000');
    expect(output).toContain('# R-squared: 0.9990');
    expect(output).toContain('# Distance range: 1-5 px');
  });

  it('has correct column header', () => {
    const output = exportDecayTSV(result);
    const lines = output.trim().split('\n');
    const headerLine = lines.find(l => !l.startsWith('#'))!;
    expect(headerLine).toBe('distance\tmean_contacts\tlog10_distance\tlog10_contacts');
  });

  it('outputs correct number of data rows', () => {
    const output = exportDecayTSV(result);
    const lines = output.trim().split('\n');
    const dataLines = lines.filter(l => !l.startsWith('#') && !l.startsWith('distance'));
    expect(dataLines).toHaveLength(5);
  });

  it('tab-separates four columns', () => {
    const output = exportDecayTSV(result);
    const lines = output.trim().split('\n');
    const dataLines = lines.filter(l => !l.startsWith('#') && !l.startsWith('distance'));
    for (const line of dataLines) {
      expect(line.split('\t')).toHaveLength(4);
    }
  });

  it('has parseable numeric values', () => {
    const output = exportDecayTSV(result);
    const lines = output.trim().split('\n');
    const firstData = lines.find(l => !l.startsWith('#') && !l.startsWith('distance'))!;
    const cols = firstData.split('\t').map(Number);
    expect(cols[0]).toBe(1);
    expect(cols[1]).toBeCloseTo(1.0, 4);
    expect(cols[2]).toBeCloseTo(0, 4);
    expect(cols[3]).toBeCloseTo(0, 4);
  });

  it('handles empty result', () => {
    const empty: ContactDecayResult = {
      distances: new Float64Array(0),
      meanContacts: new Float64Array(0),
      logDistances: new Float64Array(0),
      logContacts: new Float64Array(0),
      decayExponent: 0,
      rSquared: 0,
      maxDistance: 0,
    };
    const output = exportDecayTSV(empty);
    const lines = output.trim().split('\n');
    const dataLines = lines.filter(l => !l.startsWith('#') && !l.startsWith('distance'));
    expect(dataLines).toHaveLength(0);
  });
});
