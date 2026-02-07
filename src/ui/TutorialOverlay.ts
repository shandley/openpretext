/**
 * TutorialOverlay — UI panel for guided lessons.
 *
 * Renders the current lesson step, progress bar, navigation buttons,
 * and hint toggle. Anchored to the right side of the viewport.
 */

import type { AppContext } from './AppContext';
import type { LessonStep } from '../data/LessonSchema';
import type { TutorialManager } from './TutorialManager';

export function setupTutorialOverlay(ctx: AppContext, tutorialManager: TutorialManager): void {
  const panel = document.getElementById('tutorial-panel');
  if (!panel) return;

  const titleEl = panel.querySelector('.tutorial-title') as HTMLElement;
  const progressBar = panel.querySelector('.tutorial-progress-fill') as HTMLElement;
  const progressText = panel.querySelector('.tutorial-progress-text') as HTMLElement;
  const instructionEl = panel.querySelector('.tutorial-instruction') as HTMLElement;
  const hintBtn = panel.querySelector('.tutorial-hint-btn') as HTMLElement;
  const hintText = panel.querySelector('.tutorial-hint-text') as HTMLElement;
  const prevBtn = panel.querySelector('.tutorial-prev') as HTMLElement;
  const nextBtn = panel.querySelector('.tutorial-next') as HTMLElement;
  const endBtn = panel.querySelector('.tutorial-end') as HTMLElement;

  tutorialManager.setOnStepChange((step, progress) => {
    if (!step) {
      panel.classList.remove('visible');
      removeHighlights();
      return;
    }

    panel.classList.add('visible');
    const lesson = tutorialManager.getCurrentLesson();
    titleEl.textContent = lesson?.title ?? '';
    progressText.textContent = `Step ${progress.current} of ${progress.total}`;
    const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    progressBar.style.width = `${pct}%`;
    instructionEl.innerHTML = renderMarkdown(step.instruction);

    if (step.hint) {
      hintBtn.style.display = '';
      hintText.textContent = step.hint;
      hintText.style.display = 'none';
    } else {
      hintBtn.style.display = 'none';
      hintText.style.display = 'none';
    }

    prevBtn.style.visibility = progress.current > 1 ? 'visible' : 'hidden';

    applyHighlight(step);
  });

  tutorialManager.setOnLessonEnd(() => {
    panel.classList.remove('visible');
    removeHighlights();
  });

  hintBtn?.addEventListener('click', () => {
    const isHidden = hintText.style.display === 'none';
    hintText.style.display = isHidden ? '' : 'none';
  });

  prevBtn?.addEventListener('click', () => {
    tutorialManager.previousStep(ctx);
  });

  nextBtn?.addEventListener('click', () => {
    tutorialManager.nextStep(ctx);
  });

  endBtn?.addEventListener('click', () => {
    tutorialManager.endLesson(ctx);
  });
}

function applyHighlight(step: LessonStep): void {
  removeHighlights();

  if (!step.highlight) return;

  if (step.highlight.type === 'ui-element' && step.highlight.selector) {
    const el = document.querySelector(step.highlight.selector);
    if (el) {
      el.classList.add('tutorial-highlight');
    }
  }
}

function removeHighlights(): void {
  document.querySelectorAll('.tutorial-highlight').forEach(el => {
    el.classList.remove('tutorial-highlight');
  });
}

function renderMarkdown(text: string): string {
  // Minimal markdown: **bold**, *italic*, `code`
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
