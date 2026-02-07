/**
 * AssessmentPanel — self-assessment score card for tutorial lessons.
 *
 * Compares the user's contig ordering against the lesson's ground truth
 * using kendallTau from the shared OrderingMetrics module.
 */

import type { AppContext } from './AppContext';
import type { Lesson } from '../data/LessonSchema';
import type { TutorialManager } from './TutorialManager';
import { state } from '../core/State';
import { kendallTau } from '../curation/OrderingMetrics';

export function setupAssessmentPanel(ctx: AppContext, tutorialManager: TutorialManager): void {
  const panel = document.getElementById('assessment-panel');
  if (!panel) return;

  const scoreEl = panel.querySelector('.assessment-score') as HTMLElement;
  const barFill = panel.querySelector('.assessment-bar-fill') as HTMLElement;
  const feedbackEl = panel.querySelector('.assessment-feedback') as HTMLElement;
  const legendEl = panel.querySelector('.assessment-legend') as HTMLElement;
  const retryBtn = panel.querySelector('.assessment-retry') as HTMLElement;
  const doneBtn = panel.querySelector('.assessment-done') as HTMLElement;

  tutorialManager.setOnAssessment((lesson: Lesson) => {
    if (!lesson.assessment || lesson.assessment.type !== 'compare-ordering') return;

    const currentOrder = state.get().contigOrder;
    const groundTruth = lesson.assessment.groundTruthOrder;

    if (groundTruth.length < 2 || groundTruth.length < currentOrder.length * 0.5) {
      scoreEl.textContent = 'Assessment not available (ground truth data incomplete)';
      barFill.style.width = '0%';
      feedbackEl.textContent = 'The ground truth ordering for this lesson has not been configured yet.';
      legendEl.innerHTML = '';
      panel.classList.add('visible');
      return;
    }

    const tau = kendallTau(currentOrder, groundTruth);
    const pct = Math.max(0, Math.min(100, tau * 100));

    scoreEl.textContent = `Ordering accuracy: ${(pct).toFixed(1)}%`;

    barFill.style.width = `${pct}%`;
    if (tau >= 0.95) {
      barFill.style.background = '#4ade80';
    } else if (tau >= lesson.assessment.scoring.passingTau) {
      barFill.style.background = '#fbbf24';
    } else {
      barFill.style.background = '#f87171';
    }

    const fb = lesson.assessment.feedback;
    if (tau >= 0.95) {
      feedbackEl.textContent = fb.excellent;
    } else if (tau >= lesson.assessment.scoring.passingTau) {
      feedbackEl.textContent = fb.good;
    } else {
      feedbackEl.textContent = fb.needsWork;
    }

    legendEl.innerHTML =
      `tau >= 0.95 &rarr; Excellent<br>` +
      `tau >= ${lesson.assessment.scoring.passingTau} &rarr; Good` +
      (tau < 0.95 && tau >= lesson.assessment.scoring.passingTau ? ' &larr; You' : '') +
      `<br>tau < ${lesson.assessment.scoring.passingTau} &rarr; Needs practice` +
      (tau < lesson.assessment.scoring.passingTau ? ' &larr; You' : '') +
      (tau >= 0.95 ? '<br>(Excellent &larr; You)' : '');

    panel.classList.add('visible');
  });

  retryBtn?.addEventListener('click', () => {
    panel.classList.remove('visible');
    const lesson = tutorialManager.getCurrentLesson();
    if (lesson) {
      tutorialManager.startLesson(ctx, lesson.id);
    }
  });

  doneBtn?.addEventListener('click', () => {
    panel.classList.remove('visible');
    tutorialManager.completeLesson();
  });
}
