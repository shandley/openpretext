/**
 * Boot — Global error handlers and DOMContentLoaded bootstrap.
 *
 * Registers global error / unhandled-rejection listeners that surface
 * failures via the toast container, then fires `createApp()` once
 * the DOM is ready.
 */

export function boot(createApp: () => void): void {
  // Global error handler — show user-friendly messages instead of silent failures
  window.addEventListener('error', (e) => {
    console.error('Unhandled error:', e.error);
    const toast = document.getElementById('toast-container');
    if (toast) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = `Error: ${e.message || 'An unexpected error occurred'}`;
      toast.appendChild(el);
      requestAnimationFrame(() => el.classList.add('visible'));
      setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 4000);
    }
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
    const toast = document.getElementById('toast-container');
    if (toast) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = `Error: ${e.reason?.message || 'An unexpected error occurred'}`;
      toast.appendChild(el);
      requestAnimationFrame(() => el.classList.add('visible'));
      setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 4000);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    createApp();
  });
}
