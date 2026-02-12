/**
 * AIFeedbackUI — attaches thumbs-up/down feedback buttons to AI code blocks.
 *
 * This module creates a feedback row alongside the existing "Run" button
 * in each .ai-code-block wrapper. It stores ratings via the AIFeedback
 * module and visually marks the selected button.
 *
 * Integration: call attachFeedbackButtons() from AIAssistPanel.renderResults()
 * after creating each code block wrapper. Example:
 *
 *   import { attachFeedbackButtons } from './AIFeedbackUI';
 *
 *   // Inside renderResults, after creating wrapper and appending the Run button:
 *   attachFeedbackButtons(wrapper, strategyId, block.content);
 */

import { saveFeedback } from '../ai/AIFeedback';

/**
 * Modifies a .ai-code-block wrapper to add feedback buttons alongside
 * the existing Run button. Creates a flex row with [Run] [up] [down].
 *
 * The existing Run button (with class .ai-run-btn) is moved into a
 * flex row container. Two feedback buttons are appended after it.
 */
export function attachFeedbackButtons(
  wrapper: HTMLElement,
  strategyId: string,
  dslContent: string,
): void {
  // Find the existing Run button
  const runBtn = wrapper.querySelector('.ai-run-btn') as HTMLButtonElement | null;
  if (!runBtn) return;

  // Track whether the user clicked Run
  let executed = false;
  runBtn.addEventListener('click', () => {
    executed = true;
  });

  // Create the flex row container
  const row = document.createElement('div');
  row.className = 'ai-feedback-row';

  // Move the Run button into the row
  wrapper.removeChild(runBtn);
  row.appendChild(runBtn);

  // Create thumbs-up button
  const upBtn = document.createElement('button');
  upBtn.className = 'ai-feedback-btn';
  upBtn.textContent = '\u{1F44D}';
  upBtn.title = 'Helpful suggestion';

  // Create thumbs-down button
  const downBtn = document.createElement('button');
  downBtn.className = 'ai-feedback-btn';
  downBtn.textContent = '\u{1F44E}';
  downBtn.title = 'Unhelpful suggestion';

  const rate = (rating: 'up' | 'down') => {
    saveFeedback({
      strategyId,
      timestamp: Date.now(),
      rating,
      executed,
    });
    // Visually mark the clicked button and disable both
    if (rating === 'up') {
      upBtn.classList.add('rated');
      downBtn.classList.remove('rated');
    } else {
      downBtn.classList.add('rated');
      upBtn.classList.remove('rated');
    }
    upBtn.disabled = true;
    downBtn.disabled = true;
  };

  upBtn.addEventListener('click', () => rate('up'));
  downBtn.addEventListener('click', () => rate('down'));

  row.appendChild(upBtn);
  row.appendChild(downBtn);
  wrapper.appendChild(row);
}
