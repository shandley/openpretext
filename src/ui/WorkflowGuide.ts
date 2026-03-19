/**
 * WorkflowGuide — workflow guide modal toggle and setup.
 *
 * Pure DOM module — no AppContext dependency needed.
 */

export function toggleWorkflowGuide(): void {
  const modal = document.getElementById('workflow-guide');
  if (modal) modal.classList.toggle('visible');
}

export function setupWorkflowGuide(): void {
  const modal = document.getElementById('workflow-guide');
  if (!modal) return;
  // Click backdrop to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('visible');
  });
  // Esc to close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('visible')) {
      modal.classList.remove('visible');
      e.stopPropagation();
    }
  });
  // Welcome screen link
  document.getElementById('btn-welcome-workflow')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleWorkflowGuide();
  });
}
