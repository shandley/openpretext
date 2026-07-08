/**
 * ToastNotifications — transient notification popups.
 *
 * Pure DOM module — no AppContext dependency needed.
 */

export function showToast(message: string, duration?: number): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));

  // Scale how long the toast stays up to the message length so longer, denser
  // messages (e.g. mode help) stay readable, clamped to a sensible range. An
  // explicit duration always wins.
  const visibleMs = duration ?? Math.min(8000, Math.max(2000, Math.round(1500 + message.length * 45)));

  let hideTimer: ReturnType<typeof setTimeout>;
  const dismiss = () => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  };
  const scheduleHide = (ms: number) => { hideTimer = setTimeout(dismiss, ms); };

  // Pause the auto-dismiss while the pointer is over the toast so the reader can
  // take their time; a short linger after leaving avoids an abrupt disappearance.
  toast.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  toast.addEventListener('mouseleave', () => scheduleHide(1200));

  scheduleHide(visibleMs);
}
