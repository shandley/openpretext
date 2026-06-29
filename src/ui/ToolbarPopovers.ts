/**
 * ToolbarPopovers — lightweight click-to-open popovers/menus for the toolbar
 * (Display controls, Export menu, File menu).
 *
 * Only one is open at a time; they close on outside click, Escape, resize, or
 * toolbar scroll. Panels are positioned under their trigger with fixed
 * coordinates so they escape the toolbar's horizontal `overflow-x: auto`
 * clipping. The controls inside keep their original IDs, so existing handlers
 * (Toolbar.ts, ColorMapControls, EventWiring) bind unchanged.
 */

interface PopoverDef {
  /** Trigger button id. */
  triggerId: string;
  /** Panel element id. */
  panelId: string;
  /** Menu popovers close after any click inside (items run their own handler,
   *  then dismiss); the Display popover stays open while you adjust controls. */
  menu: boolean;
}

const POPOVERS: PopoverDef[] = [
  { triggerId: 'btn-display-menu', panelId: 'popover-display', menu: false },
  { triggerId: 'btn-export-menu', panelId: 'popover-export', menu: true },
  { triggerId: 'btn-file-menu', panelId: 'popover-file', menu: true },
];

function closeAll(): void {
  for (const { triggerId, panelId } of POPOVERS) {
    document.getElementById(panelId)?.classList.remove('open');
    document.getElementById(triggerId)?.setAttribute('aria-expanded', 'false');
  }
}

/** Position the (already-visible) panel under its trigger, clamped to viewport. */
function position(trigger: HTMLElement, panel: HTMLElement): void {
  const r = trigger.getBoundingClientRect();
  panel.style.top = `${Math.round(r.bottom + 4)}px`;
  const pw = panel.offsetWidth;
  const left = Math.min(r.left, window.innerWidth - 8 - pw);
  panel.style.left = `${Math.round(Math.max(8, left))}px`;
}

export function setupToolbarPopovers(): void {
  for (const def of POPOVERS) {
    const trigger = document.getElementById(def.triggerId);
    const panel = document.getElementById(def.panelId);
    if (!trigger || !panel) continue;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = panel.classList.contains('open');
      closeAll();
      if (!wasOpen) {
        panel.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        position(trigger, panel); // measure after it's displayed
      }
    });

    // Clicks inside don't bubble to the document close handler. Menu popovers
    // still dismiss (the item's own handler has already run at this point).
    panel.addEventListener('click', (e) => {
      e.stopPropagation();
      if (def.menu) closeAll();
    });
  }

  // Global dismissers — guarded so non-browser test environments (minimal
  // document stub, no window) don't throw.
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    });
    document.getElementById('toolbar')?.addEventListener('scroll', closeAll, { passive: true });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', closeAll);
  }
}
