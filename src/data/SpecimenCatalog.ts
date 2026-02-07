/**
 * SpecimenCatalog — types and loader for the specimen catalog JSON.
 *
 * The catalog is the single source of truth for both the benchmark
 * system and the education/tutorial system.
 */

export type CurationPattern =
  | 'clean-diagonal'
  | 'chromosome-block'
  | 'microchromosomes'
  | 'inversions'
  | 'translocations'
  | 'sparse-signal'
  | 'haplotype-switch'
  | 'misassembly'
  | 'unplaced-contigs'
  | 'compartments';

export interface SpecimenEntry {
  id: string;
  species: string;
  commonName: string;
  taxon: 'mammal' | 'bird' | 'reptile' | 'fish' | 'amphibian' | 'invertebrate';
  sizeMB: number;
  chromosomeCount: number | null;
  contigCount: number;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  patterns: CurationPattern[];
  teachingNotes: string;
  /** Filename on GitHub Releases (null = benchmark-only, not served from app). */
  releaseAsset: string | null;
  releaseTag: string;
  /** S3 keys for GenomeArk pre/post curation files (benchmark use). */
  genomeArkKeys: { pre: string; post: string } | null;
  /** Known-good baseline metrics for regression testing. */
  benchmarkBaseline: { f1: number; kendallTau: number; orientationAccuracy: number } | null;
}

export interface SpecimenCatalog {
  version: string;
  specimens: SpecimenEntry[];
}

/** Returns only specimens that have a release asset (loadable from the app). */
export function getTutorialSpecimens(catalog: SpecimenCatalog): SpecimenEntry[] {
  return catalog.specimens.filter(s => s.releaseAsset !== null);
}

/** Returns specimens by difficulty level. */
export function getSpecimensByDifficulty(
  catalog: SpecimenCatalog,
  difficulty: SpecimenEntry['difficulty'],
): SpecimenEntry[] {
  return catalog.specimens.filter(s => s.difficulty === difficulty);
}

let cachedCatalog: SpecimenCatalog | null = null;

/**
 * Load the specimen catalog JSON. Caches after first load.
 * In-browser: fetches from data/specimen-catalog.json relative to baseURI.
 */
export async function loadSpecimenCatalog(): Promise<SpecimenCatalog> {
  if (cachedCatalog) return cachedCatalog;

  const url = new URL('data/specimen-catalog.json', document.baseURI).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load specimen catalog: ${response.status}`);
  cachedCatalog = await response.json() as SpecimenCatalog;
  return cachedCatalog;
}

/** Reset cached catalog (for testing). */
export function resetCatalogCache(): void {
  cachedCatalog = null;
}
