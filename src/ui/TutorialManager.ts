/**
 * TutorialManager — state machine managing the lesson lifecycle.
 *
 * Coordinates lesson loading, step navigation, event-based action
 * detection, and UI updates via TutorialOverlay.
 */

import type { AppContext } from './AppContext';
import type { Lesson, LessonStep } from '../data/LessonSchema';
import { loadLesson } from '../data/LessonSchema';
import { loadSpecimenCatalog } from '../data/SpecimenCatalog';
import { loadSpecimen } from './FileLoading';
import { events } from '../core/EventBus';

export class TutorialManager {
  private currentLesson: Lesson | null = null;
  private currentStepIndex: number = 0;
  private unsubscribers: (() => void)[] = [];
  private completedLessons: Set<string>;
  private onStepChange: ((step: LessonStep | null, progress: { current: number; total: number }) => void) | null = null;
  private onLessonEnd: (() => void) | null = null;
  private onAssessment: ((lesson: Lesson) => void) | null = null;

  constructor() {
    this.completedLessons = new Set(
      JSON.parse(localStorage.getItem('openpretext-completed-lessons') || '[]'),
    );
  }

  setOnStepChange(cb: (step: LessonStep | null, progress: { current: number; total: number }) => void): void {
    this.onStepChange = cb;
  }

  setOnLessonEnd(cb: () => void): void {
    this.onLessonEnd = cb;
  }

  setOnAssessment(cb: (lesson: Lesson) => void): void {
    this.onAssessment = cb;
  }

  async startLesson(ctx: AppContext, lessonId: string): Promise<void> {
    this.cleanup();

    const lesson = await loadLesson(lessonId);
    this.currentLesson = lesson;
    this.currentStepIndex = 0;

    // Load the specimen for this lesson
    const catalog = await loadSpecimenCatalog();
    const specimen = catalog.specimens.find(s => s.id === lesson.specimenId);
    if (specimen) {
      await loadSpecimen(ctx, specimen);
    }

    events.emit('tutorial:started', { lessonId: lesson.id });
    this.setupStepListeners(ctx);
    this.emitStepChange();
  }

  nextStep(ctx: AppContext): void {
    if (!this.currentLesson) return;

    if (this.currentStepIndex < this.currentLesson.steps.length - 1) {
      this.currentStepIndex++;
      this.cleanupListeners();
      this.setupStepListeners(ctx);
      this.emitStepChange();
      events.emit('tutorial:step-advanced', {
        lessonId: this.currentLesson.id,
        stepId: this.currentLesson.steps[this.currentStepIndex].id,
      });
    } else {
      // Last step — check for assessment
      if (this.currentLesson.assessment && this.onAssessment) {
        this.onAssessment(this.currentLesson);
      } else {
        this.completeLesson();
      }
    }
  }

  previousStep(ctx: AppContext): void {
    if (!this.currentLesson || this.currentStepIndex <= 0) return;
    this.currentStepIndex--;
    this.cleanupListeners();
    this.setupStepListeners(ctx);
    this.emitStepChange();
  }

  endLesson(ctx: AppContext): void {
    this.cleanup();
    this.onLessonEnd?.();
  }

  completeLesson(): void {
    if (!this.currentLesson) return;
    const lessonId = this.currentLesson.id;
    this.completedLessons.add(lessonId);
    localStorage.setItem(
      'openpretext-completed-lessons',
      JSON.stringify([...this.completedLessons]),
    );
    events.emit('tutorial:completed', { lessonId });
    this.cleanup();
    this.onLessonEnd?.();
  }

  getCurrentStep(): LessonStep | null {
    if (!this.currentLesson) return null;
    return this.currentLesson.steps[this.currentStepIndex] ?? null;
  }

  getProgress(): { current: number; total: number } {
    if (!this.currentLesson) return { current: 0, total: 0 };
    return {
      current: this.currentStepIndex + 1,
      total: this.currentLesson.steps.length,
    };
  }

  getCurrentLesson(): Lesson | null {
    return this.currentLesson;
  }

  isLessonCompleted(lessonId: string): boolean {
    return this.completedLessons.has(lessonId);
  }

  isActive(): boolean {
    return this.currentLesson !== null;
  }

  private emitStepChange(): void {
    const step = this.getCurrentStep();
    const progress = this.getProgress();
    this.onStepChange?.(step, progress);
  }

  private setupStepListeners(ctx: AppContext): void {
    const step = this.getCurrentStep();
    if (!step?.expectedAction || !step.autoAdvance) return;

    const actionType = step.expectedAction.type;

    const eventMap: Record<string, keyof import('../core/EventBus').AppEvents> = {
      'zoom': 'camera:changed',
      'navigate': 'camera:changed',
      'cut': 'curation:cut',
      'join': 'curation:join',
      'invert': 'curation:invert',
      'select-contig': 'contig:selected',
      'mode-change': 'mode:changed',
    };

    const eventName = eventMap[actionType];
    if (eventName) {
      const unsub = events.on(eventName, () => {
        this.nextStep(ctx);
      });
      this.unsubscribers.push(unsub);
    }
  }

  private cleanupListeners(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  private cleanup(): void {
    this.cleanupListeners();
    this.currentLesson = null;
    this.currentStepIndex = 0;
  }
}
