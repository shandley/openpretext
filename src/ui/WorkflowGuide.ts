/**
 * WorkflowGuide — workflow guide modal with accessible dialog behaviour.
 *
 * Pure DOM module — no AppContext dependency needed. Opening moves focus into
 * the dialog, Tab is trapped inside it, and closing restores focus to whatever
 * opened it.
 */

let previouslyFocused: HTMLElement | null = null;

function getModal(): HTMLElement | null {
  return document.getElementById('workflow-guide');
}

function isOpen(modal: HTMLElement): boolean {
  return modal.classList.contains('visible');
}

function focusableWithin(modal: HTMLElement): HTMLElement[] {
  const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return Array.from(modal.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
}

export function openWorkflowGuide(): void {
  const modal = getModal();
  if (!modal || isOpen(modal)) return;
  previouslyFocused = document.activeElement as HTMLElement | null;
  modal.classList.add('visible');
  // Move focus into the dialog so keyboard and screen-reader users land inside.
  modal.querySelector<HTMLElement>('.workflow-close-btn')?.focus();
}

export function closeWorkflowGuide(): void {
  const modal = getModal();
  if (!modal || !isOpen(modal)) return;
  modal.classList.remove('visible');
  previouslyFocused?.focus();
  previouslyFocused = null;
}

export function toggleWorkflowGuide(): void {
  const modal = getModal();
  if (!modal) return;
  if (isOpen(modal)) closeWorkflowGuide();
  else openWorkflowGuide();
}

export function setupWorkflowGuide(): void {
  const modal = getModal();
  if (!modal) return;

  // Click backdrop to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeWorkflowGuide();
  });

  // Explicit close button
  modal.querySelector('.workflow-close-btn')?.addEventListener('click', () => closeWorkflowGuide());

  // Esc to close, and trap Tab within the dialog while open.
  window.addEventListener('keydown', (e) => {
    if (!isOpen(modal)) return;

    if (e.key === 'Escape') {
      closeWorkflowGuide();
      e.stopPropagation();
      return;
    }

    if (e.key === 'Tab') {
      const focusable = focusableWithin(modal);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !modal.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // Welcome screen link
  document.getElementById('btn-welcome-workflow')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleWorkflowGuide();
  });
}
