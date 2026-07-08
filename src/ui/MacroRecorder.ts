/**
 * MacroRecorder — a live "record my curation" toggle for the Script Console.
 *
 * When recording is on, manual curation actions (cut/join/invert/move, plus any
 * scaffold paint that lands in the undo stack) are turned into DSL and written
 * into the console's `#script-input`, so a hands-on session can be replayed,
 * edited, or previewed. This is a scoped, live version of the existing "From
 * Log" button: rather than converting the whole undo stack on demand, it
 * snapshots the stack depth when recording starts and regenerates the DSL from
 * everything appended since, on every curation event.
 *
 * It reuses `operationsToScript` and does not hand-build DSL strings, so its
 * output stays identical to From Log. It never executes anything — the user
 * still clicks Run/Preview.
 *
 * Known limitations (by design):
 *  - `scaffold_paint` has no `curation:*` event, so a scaffold paint is not
 *    reflected live; it is still captured when recording stops (the stop path
 *    regenerates from the full slice). The four events below cover cut, join,
 *    invert, and move.
 *  - Undoing past the record point (below the start depth) re-anchors the start
 *    depth downward, so a pre-recording op can leak into the script if it is
 *    later redone. That is an accepted edge; the common undo/redo-within-the-
 *    recording case stays correct.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { events } from '../core/EventBus';
import { operationsToScript } from '../scripting/ScriptReplay';

/**
 * Undo-stack-changing events that should refresh the live script. The four
 * curation ops append to the stack; undo/redo grow or shrink it and are watched
 * so the live view stays in sync (and the start depth clamps when the stack
 * shrinks below the record point).
 */
const CURATION_EVENTS = [
  'curation:cut',
  'curation:join',
  'curation:invert',
  'curation:move',
  'curation:undo',
  'curation:redo',
] as const;

let recording = false;
/** Undo-stack depth captured when recording started; the recorded slice begins here. */
let startDepth = 0;
/** `#script-input` content that existed before recording started (recorded DSL is appended to it). */
let basePrefix = '';
/** Latest AppContext; refreshed on each setup so event handlers use current managers/toast. */
let ctxRef: AppContext | null = null;
/** Guard so repeated setup calls do not stack duplicate event subscriptions. */
let subscribed = false;

/** Build scaffoldId → name lookup, mirroring the From-Log handler. */
function scaffoldNameMap(ctx: AppContext): Map<number, string> {
  const names = new Map<number, string>();
  for (const sc of ctx.scaffoldManager.getAllScaffolds()) {
    names.set(sc.id, sc.name);
  }
  return names;
}

/**
 * Regenerate the DSL for the recorded slice and write it into `#script-input`,
 * preserving whatever text existed before recording began. Clamps `startDepth`
 * down if the undo stack shrank below it (e.g. undo past the record point).
 */
function regenerate(ctx: AppContext): number {
  const s = state.get();
  const stack = s.undoStack ?? [];
  if (stack.length < startDepth) startDepth = stack.length;
  const slice = stack.slice(startDepth);

  const input = document.getElementById('script-input') as HTMLTextAreaElement | null;
  if (!input) return slice.length;

  const script = operationsToScript(slice, s.map?.contigs ?? [], {
    includeTimestamps: true,
    includeHeader: true,
    scaffoldNames: scaffoldNameMap(ctx),
  });

  input.value = basePrefix ? `${basePrefix}\n${script}` : script;
  return slice.length;
}

function startRecording(ctx: AppContext): void {
  recording = true;
  startDepth = (state.get().undoStack ?? []).length;

  const input = document.getElementById('script-input') as HTMLTextAreaElement | null;
  const existing = input?.value.trim() ?? '';
  basePrefix = existing;

  const btn = document.getElementById('btn-record-macro');
  if (btn) {
    btn.classList.add('recording');
    btn.textContent = '● Recording';
  }
  ctx.showToast('Recording curation actions');
}

function stopRecording(ctx: AppContext): void {
  recording = false;
  const count = regenerate(ctx);

  const btn = document.getElementById('btn-record-macro');
  if (btn) {
    btn.classList.remove('recording');
    btn.textContent = 'Record';
  }
  ctx.showToast(`Recorded ${count} operation(s)`);

  const output = document.getElementById('script-output');
  if (output) {
    output.innerHTML = `<span class="script-output-info">Recorded ${count} operation(s). Edit and run/preview as needed.</span>`;
  }
}

/** Toggle recording on/off. Exposed for testing. */
export function toggleMacroRecording(ctx: AppContext): void {
  if (recording) stopRecording(ctx);
  else startRecording(ctx);
}

export function isMacroRecording(): boolean {
  return recording;
}

/**
 * Wire the Record button and subscribe to curation events. Safe to call more
 * than once: the subscription is installed only on the first call, and later
 * calls just refresh the AppContext reference and re-bind the button.
 */
export function setupMacroRecorder(ctx: AppContext): void {
  ctxRef = ctx;
  recording = false;

  document.getElementById('btn-record-macro')?.addEventListener('click', () => {
    if (ctxRef) toggleMacroRecording(ctxRef);
  });

  if (subscribed) return;
  subscribed = true;
  for (const ev of CURATION_EVENTS) {
    events.on(ev, () => {
      if (recording && ctxRef) regenerate(ctxRef);
    });
  }
}
