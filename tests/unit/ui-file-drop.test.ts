import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('../../src/core/State', () => ({
  state: { get: vi.fn(() => ({})), update: vi.fn() },
}));
vi.mock('../../src/core/EventBus', () => ({
  events: { emit: vi.fn(), on: vi.fn() },
}));
vi.mock('../../src/formats/PretextParser', () => ({
  parsePretextFile: vi.fn(),
  isPretextFile: vi.fn(() => true),
  tileLinearIndex: vi.fn(),
}));
vi.mock('../../src/formats/SyntheticData', () => ({
  generateSyntheticMap: vi.fn(),
}));
vi.mock('../../src/formats/SyntheticTracks', () => ({
  generateDemoTracks: vi.fn(),
}));
vi.mock('../../src/renderer/TileManager', () => ({
  TileManager: vi.fn(),
}));
vi.mock('../../src/ui/LoadingOverlay', () => ({
  showLoading: vi.fn(),
  updateLoading: vi.fn(),
  hideLoading: vi.fn(),
}));
vi.mock('../../src/ui/ExportSession', () => ({
  loadSession: vi.fn(),
  loadReferenceFasta: vi.fn(),
  loadBedGraphTrack: vi.fn(),
}));

import { setupFileDrop } from '../../src/ui/FileLoading';
import { loadSession, loadReferenceFasta, loadBedGraphTrack } from '../../src/ui/ExportSession';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let capturedDropHandler: ((e: any) => Promise<void>) | null = null;

function createMockCtx(): any {
  return {
    showToast: vi.fn(),
    renderer: { uploadContactMap: vi.fn() },
    minimap: { updateThumbnail: vi.fn() },
    contigBoundaries: [],
    cancelTileDecode: null,
    tileManager: null,
    trackRenderer: null,
  } as any;
}

describe('setupFileDrop file routing', () => {
  let ctx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedDropHandler = null;
    ctx = createMockCtx();

    const mockOverlay = { classList: { add: vi.fn(), remove: vi.fn() } };

    (globalThis as any).window = {
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === 'drop') capturedDropHandler = handler;
      }),
    };
    (globalThis as any).document = {
      getElementById: vi.fn((id: string) => {
        if (id === 'drop-overlay') return mockOverlay;
        return { textContent: '', style: { display: '' } };
      }),
    };

    setupFileDrop(ctx);
  });

  afterEach(() => {
    (globalThis as any).window = undefined;
    (globalThis as any).document = undefined;
  });

  function dropFile(name: string) {
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [{ name, arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(0))) }] },
    };
    return capturedDropHandler!(event);
  }

  it('should route .fasta files to loadReferenceFasta', async () => {
    await dropFile('reference.fasta');
    expect(loadReferenceFasta).toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('should route .fa files to loadReferenceFasta', async () => {
    await dropFile('ref.fa');
    expect(loadReferenceFasta).toHaveBeenCalled();
  });

  it('should route .fna files to loadReferenceFasta', async () => {
    await dropFile('genome.fna');
    expect(loadReferenceFasta).toHaveBeenCalled();
  });

  it('should route .bedgraph files to loadBedGraphTrack', async () => {
    await dropFile('signal.bedgraph');
    expect(loadBedGraphTrack).toHaveBeenCalled();
  });

  it('should route .bg files to loadBedGraphTrack', async () => {
    await dropFile('track.bg');
    expect(loadBedGraphTrack).toHaveBeenCalled();
  });

  it('should route .json files to loadSession', async () => {
    await dropFile('session.json');
    expect(loadSession).toHaveBeenCalled();
  });

  it('should route .pretext files to default handler (not FASTA/BedGraph/session)', async () => {
    await dropFile('assembly.pretext');
    expect(loadReferenceFasta).not.toHaveBeenCalled();
    expect(loadBedGraphTrack).not.toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('should handle no file gracefully', async () => {
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [] },
    };
    await capturedDropHandler!(event);
    expect(loadReferenceFasta).not.toHaveBeenCalled();
    expect(loadBedGraphTrack).not.toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();
  });
});
