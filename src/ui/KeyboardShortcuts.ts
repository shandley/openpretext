/**
 * KeyboardShortcuts — global keyboard shortcut bindings.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { SelectionManager } from '../curation/SelectionManager';
import { cycleColorMap, syncGammaSlider } from './ColorMapControls';
import { performUndo, performRedo, invertSelectedContigs, cutAtCursorPosition, joinSelectedContigs, toggleContigExclusion } from './CurationActions';
import { exportAGP, takeScreenshot } from './ExportSession';
import { toggleComparisonMode } from './ComparisonMode';
import { toggleScriptConsole } from './ScriptConsole';
import { toggleShortcutsModal } from './ShortcutsModal';
import { isCommandPaletteVisible, toggleCommandPalette } from './CommandPalette';
import { runAutoSort, runAutoCut } from './BatchActions';

export function setupKeyboardShortcuts(ctx: AppContext): void {
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const cmd = e.metaKey || e.ctrlKey;

    switch (e.key.toLowerCase()) {
      case 'e': ctx.setMode('edit'); break;
      case 's':
        if (cmd) { e.preventDefault(); takeScreenshot(ctx); }
        else if (e.altKey && ctx.currentMode === 'edit') { e.preventDefault(); runAutoSort(ctx); }
        else ctx.setMode('scaffold');
        break;
      case 'w': ctx.setMode('waypoint'); break;
      case 'l': state.update({ showGrid: !state.get().showGrid }); break;
      case 'i':
        document.getElementById('sidebar')?.classList.toggle('visible');
        ctx.updateSidebarContigList();
        ctx.updateStatsPanel();
        ctx.updateTrackConfigPanel();
        break;
      case 'escape':
        if (isCommandPaletteVisible()) {
          toggleCommandPalette(ctx);
        } else {
          SelectionManager.clearSelection();
          ctx.setMode('navigate');
        }
        break;

      case 'arrowup': cycleColorMap(ctx); break;
      case 'arrowdown': cycleColorMap(ctx); break;

      case 'arrowleft': {
        const newGamma = Math.max(0.1, state.get().gamma - 0.05);
        state.update({ gamma: newGamma });
        syncGammaSlider(newGamma);
        break;
      }
      case 'arrowright': {
        const newGamma = Math.min(2.0, state.get().gamma + 0.05);
        state.update({ gamma: newGamma });
        syncGammaSlider(newGamma);
        break;
      }

      case 'm':
        ctx.minimap.toggle();
        break;

      case 'k':
        if (cmd) {
          e.preventDefault();
          toggleCommandPalette(ctx);
        }
        break;

      case 'z':
        if (cmd && e.shiftKey) performRedo(ctx);
        else if (cmd) performUndo(ctx);
        break;

      case 'o':
        if (cmd) {
          e.preventDefault();
          document.getElementById('file-input')?.click();
        }
        break;

      case 'c':
        if (e.altKey && ctx.currentMode === 'edit') {
          e.preventDefault();
          runAutoCut(ctx);
        } else if (ctx.currentMode === 'edit') {
          cutAtCursorPosition(ctx);
        }
        break;

      case 'j':
        if (ctx.currentMode === 'edit') {
          joinSelectedContigs(ctx);
        } else {
          ctx.camera.jumpToDiagonal();
        }
        break;

      case 'f':
        if (ctx.currentMode === 'edit') {
          invertSelectedContigs(ctx);
        }
        break;

      case 'h':
        if (ctx.currentMode === 'edit') {
          toggleContigExclusion(ctx);
        }
        break;

      case 'p':
        toggleComparisonMode(ctx);
        break;

      case 'a':
        if (cmd && ctx.currentMode === 'edit') {
          e.preventDefault();
          SelectionManager.selectAll();
          ctx.updateSidebarContigList();
        }
        break;

      case 'u': {
        // Open sidebar and scroll to history panel
        const sidebar = document.getElementById('sidebar');
        if (sidebar && !sidebar.classList.contains('visible')) {
          sidebar.classList.add('visible');
          ctx.updateSidebarContigList();
          ctx.updateStatsPanel();
          ctx.updateTrackConfigPanel();
        }
        ctx.updateUndoHistoryPanel();
        document.getElementById('undo-history-content')?.scrollIntoView({ behavior: 'smooth' });
        break;
      }

      case 'x':
        ctx.tracksVisible = !ctx.tracksVisible;
        ctx.showToast(`Tracks: ${ctx.tracksVisible ? 'visible' : 'hidden'}`);
        break;

      case 'n':
        if (ctx.currentMode === 'scaffold') {
          const id = ctx.scaffoldManager.createScaffold();
          ctx.scaffoldManager.setActiveScaffoldId(id);
          const sc = ctx.scaffoldManager.getScaffold(id);
          ctx.showToast(`Created: ${sc?.name ?? 'Scaffold'}`);
          ctx.updateSidebarScaffoldList();
        }
        break;

      case '1': case '2': case '3': case '4': case '5':
      case '6': case '7': case '8': case '9':
        if (ctx.currentMode === 'scaffold') {
          const scaffolds = ctx.scaffoldManager.getAllScaffolds();
          const idx = parseInt(e.key) - 1;
          if (idx < scaffolds.length) {
            ctx.scaffoldManager.setActiveScaffoldId(scaffolds[idx].id);
            ctx.showToast(`Active: ${scaffolds[idx].name}`);
            ctx.updateSidebarScaffoldList();
          }
        }
        break;

      case 'delete':
      case 'backspace':
        if (ctx.currentMode === 'edit') {
          SelectionManager.clearSelection();
          ctx.updateSidebarContigList();
        }
        if (ctx.currentMode === 'waypoint') {
          ctx.waypointManager.clearAll();
          ctx.currentWaypointId = null;
          ctx.showToast('All waypoints cleared');
        }
        break;

      case 'g':
        if (cmd) {
          e.preventDefault();
          exportAGP(ctx);
        }
        break;

      case '`':
        toggleScriptConsole();
        break;

      case '?':
        toggleShortcutsModal();
        break;

      case ']':
      case '.': {
        // Next waypoint
        const cam = ctx.camera.getState();
        const nextWp = ctx.waypointManager.getNextWaypoint(cam.x, cam.y);
        if (nextWp) {
          ctx.currentWaypointId = nextWp.id;
          ctx.camera.animateTo({ x: nextWp.mapX, y: nextWp.mapY }, 250);
          ctx.showToast(`Waypoint: ${nextWp.label}`);
        }
        break;
      }
      case '[':
      case ',': {
        // Previous waypoint
        const cam = ctx.camera.getState();
        const prevWp = ctx.waypointManager.getPrevWaypoint(cam.x, cam.y);
        if (prevWp) {
          ctx.currentWaypointId = prevWp.id;
          ctx.camera.animateTo({ x: prevWp.mapX, y: prevWp.mapY }, 250);
          ctx.showToast(`Waypoint: ${prevWp.label}`);
        }
        break;
      }
    }
  });
}
