/**
 * FileChecksums — a dialog showing the loaded file's MD5 and SHA-256, and
 * comparing them with a value the user pastes.
 *
 * The .pretext format has no checksum, so the loader can only check a file's
 * structure. Comparing with the checksum published alongside the file is the
 * one test that covers every byte. Opened from the file name in the status
 * bar and from the command palette.
 */

import { state } from '../core/State';
import { checkAgainst, type FileChecksums } from '../core/Checksum';

const MODAL_ID = 'checksums-modal';

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setText(id: string, text: string): void {
  const node = el(id);
  if (node) node.textContent = text;
}

/** The sentence shown under the paste box. */
export function verdictText(pasted: string, sums: FileChecksums): { text: string; tone: 'ok' | 'bad' | 'neutral' } {
  if (pasted.trim() === '') return { text: '', tone: 'neutral' };
  const v = checkAgainst(pasted, sums);
  switch (v.result) {
    case 'match':
      return { text: `Match. The file's ${v.kind} equals the value you pasted.`, tone: 'ok' };
    case 'mismatch':
      return {
        text: `No match. The file's ${v.kind} differs from the value you pasted. ` +
          'The file is damaged, or it is not the file that value belongs to.',
        tone: 'bad',
      };
    case 'unavailable':
      return { text: 'This browser could not compute a SHA-256 for the file. Paste an MD5 instead.', tone: 'neutral' };
    default:
      return { text: 'That is not an MD5 (32 hex digits) or a SHA-256 (64 hex digits).', tone: 'neutral' };
  }
}

function refresh(): void {
  const map = state.get().map;
  const sums = map?.checksums ?? null;
  const body = el('checksums-body');
  const empty = el('checksums-empty');
  if (!body || !empty) return;

  body.hidden = !sums;
  empty.hidden = !!sums;
  if (!sums || !map) {
    empty.textContent = map
      ? 'The built-in demo map is generated in the browser, so there is no file to check.'
      : 'No file is loaded.';
    return;
  }
  setText('checksums-file', map.filename);
  setText('checksums-size', `${sums.byteLength.toLocaleString('en-US')} bytes`);
  setText('checksums-md5', sums.md5);
  setText('checksums-sha256', sums.sha256 ?? 'Not available in this browser');
  const copySha = el<HTMLButtonElement>('checksums-copy-sha256');
  if (copySha) copySha.disabled = sums.sha256 === null;
  updateVerdict();
}

function updateVerdict(): void {
  const sums = state.get().map?.checksums;
  const input = el<HTMLInputElement>('checksums-expected');
  const out = el('checksums-verdict');
  if (!sums || !input || !out) return;
  const { text, tone } = verdictText(input.value, sums);
  out.textContent = text;
  out.dataset.tone = tone;
}

export function openFileChecksums(): void {
  const modal = el(MODAL_ID);
  if (!modal) return;
  const input = el<HTMLInputElement>('checksums-expected');
  if (input) input.value = '';
  refresh();
  modal.classList.add('visible');
  input?.focus();
}

function close(): void {
  el(MODAL_ID)?.classList.remove('visible');
}

async function copy(value: string | null | undefined, button: HTMLElement): Promise<void> {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const label = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = label; }, 1200);
  } catch {
    // Clipboard access can be refused; the value is on screen and selectable.
  }
}

export function setupFileChecksums(): void {
  const modal = el(MODAL_ID);
  if (!modal) return;

  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  el('checksums-close')?.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('visible')) {
      close();
      e.stopPropagation();
    }
  }, true);

  el('checksums-expected')?.addEventListener('input', updateVerdict);
  el('checksums-copy-md5')?.addEventListener('click', (e) =>
    copy(state.get().map?.checksums?.md5, e.currentTarget as HTMLElement));
  el('checksums-copy-sha256')?.addEventListener('click', (e) =>
    copy(state.get().map?.checksums?.sha256, e.currentTarget as HTMLElement));

  // The file name in the status bar opens the dialog.
  const status = el('status-file');
  if (status) {
    status.addEventListener('click', () => { if (state.get().map) openFileChecksums(); });
    status.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && state.get().map) {
        e.preventDefault();
        openFileChecksums();
      }
    });
  }
}
