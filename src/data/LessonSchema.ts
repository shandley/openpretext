/**
 * LessonSchema — types for tutorial lesson JSON files.
 *
 * Lessons are JSON data (data/lessons/*.json) that reference specimens
 * from the specimen catalog and define step-by-step instructions.
 */

export interface Lesson {
  id: string;
  title: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  specimenId: string;
  introduction: string;
  steps: LessonStep[];
  assessment: LessonAssessment | null;
}

export interface LessonStep {
  id: string;
  title: string;
  instruction: string;
  highlight?: {
    type: 'map-region' | 'ui-element' | 'contig';
    mapRegion?: { x1: number; y1: number; x2: number; y2: number };
    selector?: string;
    contigPattern?: string;
  };
  expectedAction?: {
    type: 'zoom' | 'select-contig' | 'cut' | 'join' | 'invert' |
          'navigate' | 'mode-change' | 'auto-sort' | 'auto-cut' | 'observe';
  };
  hint?: string;
  autoAdvance?: boolean;
}

export interface LessonAssessment {
  type: 'compare-ordering';
  groundTruthOrder: number[];
  scoring: { passingTau: number };
  feedback: { excellent: string; good: string; needsWork: string };
}

let lessonCache = new Map<string, Lesson>();

/** Load a lesson JSON file by ID. Caches after first load. */
export async function loadLesson(lessonId: string): Promise<Lesson> {
  const cached = lessonCache.get(lessonId);
  if (cached) return cached;

  const url = new URL(`data/lessons/${lessonId}.json`, document.baseURI).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load lesson ${lessonId}: ${response.status}`);
  const lesson = await response.json() as Lesson;
  lessonCache.set(lessonId, lesson);
  return lesson;
}

/** Reset lesson cache (for testing). */
export function resetLessonCache(): void {
  lessonCache = new Map();
}
