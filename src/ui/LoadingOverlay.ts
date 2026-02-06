/**
 * LoadingOverlay — full-screen loading progress indicator.
 *
 * Pure DOM module — no AppContext dependency needed.
 */

export function showLoading(title: string, detail: string = ''): void {
  const overlay = document.getElementById('loading-overlay');
  const titleEl = document.getElementById('loading-title');
  const detailEl = document.getElementById('loading-detail');
  const barEl = document.getElementById('loading-bar');
  const percentEl = document.getElementById('loading-percent');
  if (overlay) overlay.classList.add('visible');
  if (titleEl) titleEl.textContent = title;
  if (detailEl) detailEl.textContent = detail;
  if (barEl) barEl.style.width = '0%';
  if (percentEl) percentEl.textContent = '0%';
}

export function updateLoading(detail: string, progress: number): void {
  const detailEl = document.getElementById('loading-detail');
  const barEl = document.getElementById('loading-bar');
  const percentEl = document.getElementById('loading-percent');
  const pct = Math.round(Math.min(100, Math.max(0, progress)));
  if (detailEl) detailEl.textContent = detail;
  if (barEl) barEl.style.width = `${pct}%`;
  if (percentEl) percentEl.textContent = `${pct}%`;
}

export function hideLoading(): void {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('visible');
}
