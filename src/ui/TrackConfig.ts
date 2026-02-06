/**
 * TrackConfig — track configuration panel (visibility, color, type, removal).
 */

import type { AppContext } from './AppContext';

export function updateTrackConfigPanel(ctx: AppContext): void {
  const el = document.getElementById('track-config-list');
  if (!el) return;

  const tracks = ctx.trackRenderer.getTracks();
  if (tracks.length === 0) {
    el.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px;">No tracks loaded. Press X to toggle visibility.</div>';
    return;
  }

  const html = tracks.map((track, i) =>
    `<div class="track-config-item" data-track-index="${i}">
      <label class="track-config-toggle">
        <input type="checkbox" ${track.visible ? 'checked' : ''} data-track-name="${track.name}" class="track-vis-checkbox">
        <span class="track-config-name" style="border-left: 3px solid ${track.color}; padding-left: 6px;">${track.name}</span>
      </label>
      <div class="track-config-controls">
        <input type="color" value="${track.color}" data-track-name="${track.name}" class="track-color-input" title="Track color">
        <select data-track-name="${track.name}" class="track-type-select" title="Track type">
          <option value="line" ${track.type === 'line' ? 'selected' : ''}>Line</option>
          <option value="heatmap" ${track.type === 'heatmap' ? 'selected' : ''}>Heatmap</option>
          <option value="marker" ${track.type === 'marker' ? 'selected' : ''}>Marker</option>
        </select>
        <button class="track-remove-btn" data-track-name="${track.name}" title="Remove track">&times;</button>
      </div>
    </div>`
  ).join('');

  el.innerHTML = html;

  // Wire up event listeners
  el.querySelectorAll('.track-vis-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const name = (cb as HTMLInputElement).dataset.trackName!;
      ctx.trackRenderer.setTrackVisibility(name, (cb as HTMLInputElement).checked);
    });
  });

  el.querySelectorAll('.track-color-input').forEach((input) => {
    input.addEventListener('input', () => {
      const name = (input as HTMLInputElement).dataset.trackName!;
      const track = ctx.trackRenderer.getTrack(name);
      if (track) (track as any).color = (input as HTMLInputElement).value;
    });
  });

  el.querySelectorAll('.track-type-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const name = (sel as HTMLSelectElement).dataset.trackName!;
      const track = ctx.trackRenderer.getTrack(name);
      if (track) (track as any).type = (sel as HTMLSelectElement).value;
    });
  });

  el.querySelectorAll('.track-remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = (btn as HTMLElement).dataset.trackName!;
      ctx.trackRenderer.removeTrack(name);
      ctx.updateTrackConfigPanel();
      ctx.showToast(`Removed track: ${name}`);
    });
  });
}
