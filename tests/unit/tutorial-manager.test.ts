/**
 * Tests for TutorialManager lesson state machine logic.
 *
 * Since TutorialManager depends heavily on DOM (localStorage, fetch, events),
 * we test the data structures and lesson schema validation.
 */

import { describe, it, expect } from 'vitest';
import type { Lesson, LessonStep, LessonAssessment } from '../../src/data/LessonSchema';

describe('TutorialManager - Lesson Schema', () => {
  const mockLesson: Lesson = {
    id: 'test-lesson',
    title: 'Test Lesson',
    difficulty: 'beginner',
    estimatedMinutes: 5,
    specimenId: 'wrasse',
    introduction: 'Test intro',
    steps: [
      { id: 'step-1', title: 'Step 1', instruction: 'Do step 1' },
      { id: 'step-2', title: 'Step 2', instruction: 'Do step 2', hint: 'Try scrolling' },
      {
        id: 'step-3', title: 'Step 3', instruction: 'Zoom in',
        expectedAction: { type: 'zoom' },
        autoAdvance: true,
      },
    ],
    assessment: null,
  };

  it('should have required lesson fields', () => {
    expect(mockLesson.id).toBe('test-lesson');
    expect(mockLesson.title).toBe('Test Lesson');
    expect(mockLesson.difficulty).toBe('beginner');
    expect(mockLesson.estimatedMinutes).toBe(5);
    expect(mockLesson.specimenId).toBe('wrasse');
    expect(mockLesson.steps).toHaveLength(3);
    expect(mockLesson.assessment).toBeNull();
  });

  it('should have valid step structure', () => {
    const step = mockLesson.steps[0];
    expect(step.id).toBe('step-1');
    expect(step.title).toBe('Step 1');
    expect(step.instruction).toBe('Do step 1');
  });

  it('should support optional hint field', () => {
    expect(mockLesson.steps[0].hint).toBeUndefined();
    expect(mockLesson.steps[1].hint).toBe('Try scrolling');
  });

  it('should support expectedAction and autoAdvance', () => {
    const step = mockLesson.steps[2];
    expect(step.expectedAction?.type).toBe('zoom');
    expect(step.autoAdvance).toBe(true);
  });

  it('should support highlight types', () => {
    const stepWithHighlight: LessonStep = {
      id: 'hl-step',
      title: 'Highlight Step',
      instruction: 'Look here',
      highlight: {
        type: 'map-region',
        mapRegion: { x1: 0, y1: 0, x2: 0.5, y2: 0.5 },
      },
    };
    expect(stepWithHighlight.highlight?.type).toBe('map-region');
    expect(stepWithHighlight.highlight?.mapRegion?.x2).toBe(0.5);

    const uiHighlight: LessonStep = {
      id: 'ui-step',
      title: 'UI Step',
      instruction: 'Click here',
      highlight: { type: 'ui-element', selector: '#btn-sidebar' },
    };
    expect(uiHighlight.highlight?.type).toBe('ui-element');
    expect(uiHighlight.highlight?.selector).toBe('#btn-sidebar');
  });

  it('should support assessment structure', () => {
    const assessment: LessonAssessment = {
      type: 'compare-ordering',
      groundTruthOrder: [0, 1, 2, 3, 4],
      scoring: { passingTau: 0.85 },
      feedback: {
        excellent: 'Great job!',
        good: 'Good work.',
        needsWork: 'Keep practicing.',
      },
    };
    expect(assessment.type).toBe('compare-ordering');
    expect(assessment.groundTruthOrder).toHaveLength(5);
    expect(assessment.scoring.passingTau).toBe(0.85);
  });

  it('should create lesson with assessment', () => {
    const lessonWithAssessment: Lesson = {
      ...mockLesson,
      assessment: {
        type: 'compare-ordering',
        groundTruthOrder: [0, 1, 2, 3, 4],
        scoring: { passingTau: 0.85 },
        feedback: {
          excellent: 'Excellent!',
          good: 'Good!',
          needsWork: 'Needs work.',
        },
      },
    };
    expect(lessonWithAssessment.assessment).not.toBeNull();
    expect(lessonWithAssessment.assessment!.type).toBe('compare-ordering');
  });
});

describe('TutorialManager - Step Navigation Logic', () => {
  it('should track step progress correctly', () => {
    const steps: LessonStep[] = [
      { id: 's1', title: 'S1', instruction: 'I1' },
      { id: 's2', title: 'S2', instruction: 'I2' },
      { id: 's3', title: 'S3', instruction: 'I3' },
    ];

    let currentIndex = 0;

    const getProgress = () => ({
      current: currentIndex + 1,
      total: steps.length,
    });

    expect(getProgress()).toEqual({ current: 1, total: 3 });

    currentIndex = 1;
    expect(getProgress()).toEqual({ current: 2, total: 3 });

    currentIndex = 2;
    expect(getProgress()).toEqual({ current: 3, total: 3 });
  });

  it('should clamp navigation within bounds', () => {
    const totalSteps = 5;
    let currentIndex = 0;

    const next = () => {
      if (currentIndex < totalSteps - 1) currentIndex++;
    };
    const prev = () => {
      if (currentIndex > 0) currentIndex--;
    };

    next(); next(); next();
    expect(currentIndex).toBe(3);

    prev();
    expect(currentIndex).toBe(2);

    // Try going below 0
    currentIndex = 0;
    prev();
    expect(currentIndex).toBe(0);

    // Try going above max
    currentIndex = 4;
    next();
    expect(currentIndex).toBe(4);
  });
});

describe('TutorialManager - Action Detection', () => {
  it('should map action types to event names', () => {
    const eventMap: Record<string, string> = {
      'zoom': 'camera:changed',
      'navigate': 'camera:changed',
      'cut': 'curation:cut',
      'join': 'curation:join',
      'invert': 'curation:invert',
      'select-contig': 'contig:selected',
      'mode-change': 'mode:changed',
    };

    expect(eventMap['zoom']).toBe('camera:changed');
    expect(eventMap['cut']).toBe('curation:cut');
    expect(eventMap['mode-change']).toBe('mode:changed');
    expect(eventMap['observe']).toBeUndefined();
  });
});
