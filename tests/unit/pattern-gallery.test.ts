import { describe, it, expect } from 'vitest';
import { resolvePatternAction } from '../../src/ui/PatternGallery';
import type { SpecimenEntry } from '../../src/data/SpecimenCatalog';

const koala: SpecimenEntry = {
  id: 'koala',
  species: 'Phascolarctos_cinereus',
  commonName: 'Koala',
  taxon: 'mammal',
  sizeMB: 30,
  chromosomeCount: 8,
  contigCount: 100,
  difficulty: 'beginner',
  patterns: [],
  teachingNotes: '',
  releaseAsset: 'Phascolarctos_cinereus.pretext',
  releaseTag: 'v1',
  genomeArkKeys: null,
  benchmarkBaseline: null,
};

describe('resolvePatternAction', () => {
  it('loads the specimen when nothing is loaded (the welcome-screen case)', () => {
    // Regression: previously this path navigated an empty map, so clicking a
    // pattern card from the landing page did nothing visible.
    const action = resolvePatternAction(koala, null, 0);
    expect(action).toEqual({ kind: 'load', specimen: koala });
  });

  it('navigates directly when the pattern specimen is already loaded', () => {
    const action = resolvePatternAction(koala, 'Phascolarctos_cinereus.pretext', 0);
    expect(action).toEqual({ kind: 'navigate' });
  });

  it('loads the right specimen when a different, un-curated file is loaded', () => {
    const action = resolvePatternAction(koala, 'Other_species.pretext', 0);
    expect(action).toEqual({ kind: 'load', specimen: koala });
  });

  it('refuses to discard an in-progress curation session on a different file', () => {
    const action = resolvePatternAction(koala, 'Other_species.pretext', 3);
    expect(action.kind).toBe('toast');
    if (action.kind === 'toast') expect(action.message).toContain('Koala');
  });

  it('does not block reloading the same specimen even mid-curation', () => {
    // Same file loaded with undo history — navigating in place is non-destructive.
    const action = resolvePatternAction(koala, 'Phascolarctos_cinereus.pretext', 5);
    expect(action).toEqual({ kind: 'navigate' });
  });

  it('guides the user when the specimen is unknown and nothing is loaded', () => {
    const action = resolvePatternAction(null, null, 0);
    expect(action).toEqual({ kind: 'toast', message: 'Load a specimen to see this pattern' });
  });

  it('navigates on the loaded map when the specimen is unknown but a file is open', () => {
    const action = resolvePatternAction(null, 'Anything.pretext', 0);
    expect(action).toEqual({ kind: 'navigate' });
  });
});
