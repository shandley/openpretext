/**
 * ShortcutsModal — keyboard shortcuts help overlay.
 *
 * Pure DOM module — no AppContext dependency needed.
 */

export function toggleShortcutsModal(): void {
  const modal = document.getElementById('shortcuts-modal');
  if (modal) modal.classList.toggle('visible');
}

export function setupShortcutsModal(): void {
  const modal = document.getElementById('shortcuts-modal');
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
}
