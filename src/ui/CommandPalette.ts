/**
 * CommandPalette — fuzzy command search and execution overlay.
 *
 * Module-local state: commandPaletteVisible, selectedCommandIndex.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { SelectionManager } from '../curation/SelectionManager';
import { loadExampleDataset, loadDemoData, loadSpecimen } from './FileLoading';
import { loadSpecimenCatalog, getTutorialSpecimens } from '../data/SpecimenCatalog';
import { performUndo, performRedo, invertSelectedContigs, cutAtCursorPosition, joinSelectedContigs, toggleContigExclusion } from './CurationActions';
import { exportAGP, exportBEDFile, exportFASTAFile, takeScreenshot, saveSession } from './ExportSession';
import { cycleColorMap } from './ColorMapControls';
import { toggleComparisonMode } from './ComparisonMode';
import { toggleScriptConsole } from './ScriptConsole';
import { toggleShortcutsModal } from './ShortcutsModal';
import { runBatchSelectByPattern, runBatchSelectBySize, runBatchCut, runBatchJoin, runBatchInvert, runSortByLength, runAutoSort, runAutoCut, undoLastBatch } from './BatchActions';
import { togglePatternGallery } from './PatternGallery';
import { toggleAIAssist } from './AIAssistPanel';

import type { SpecimenEntry } from '../data/SpecimenCatalog';

let cachedSpecimens: SpecimenEntry[] | null = null;

async function ensureSpecimens(): Promise<SpecimenEntry[]> {
  if (cachedSpecimens) return cachedSpecimens;
  try {
    const catalog = await loadSpecimenCatalog();
    cachedSpecimens = getTutorialSpecimens(catalog);
  } catch {
    cachedSpecimens = [];
  }
  return cachedSpecimens;
}

let commandPaletteVisible = false;
let selectedCommandIndex = 0;

export function isCommandPaletteVisible(): boolean {
  return commandPaletteVisible;
}

export function toggleCommandPalette(ctx: AppContext): void {
  commandPaletteVisible = !commandPaletteVisible;
  const el = document.getElementById('command-palette')!;
  el.classList.toggle('visible', commandPaletteVisible);
  if (commandPaletteVisible) {
    const input = document.getElementById('command-input') as HTMLInputElement;
    input.value = '';
    input.focus();
    updateCommandResults(ctx, '');
  }
}

function getCommands(ctx: AppContext) {
  const specimenCommands = (cachedSpecimens ?? []).map(s => ({
    name: `Load specimen: ${s.commonName} (${s.sizeMB} MB)`,
    shortcut: '',
    action: () => loadSpecimen(ctx, s),
  }));

  return [
    { name: 'Open file', shortcut: '\u2318O', action: () => document.getElementById('file-input')?.click() },
    { name: 'Load example dataset (Koala)', shortcut: '', action: () => loadExampleDataset(ctx) },
    ...specimenCommands,
    { name: 'Load synthetic demo', shortcut: '', action: () => loadDemoData(ctx) },
    { name: 'Navigate mode', shortcut: 'Esc', action: () => ctx.setMode('navigate') },
    { name: 'Edit mode', shortcut: 'E', action: () => ctx.setMode('edit') },
    { name: 'Scaffold mode', shortcut: 'S', action: () => ctx.setMode('scaffold') },
    { name: 'Waypoint mode', shortcut: 'W', action: () => ctx.setMode('waypoint') },
    { name: 'Toggle grid', shortcut: 'L', action: () => state.update({ showGrid: !state.get().showGrid }) },
    { name: 'Toggle sidebar', shortcut: 'I', action: () => { document.getElementById('sidebar')?.classList.toggle('visible'); ctx.updateSidebarContigList(); } },
    { name: 'Cycle color map', shortcut: '\u2191/\u2193', action: () => cycleColorMap(ctx) },
    { name: 'Toggle minimap', shortcut: 'M', action: () => ctx.minimap.toggle() },
    { name: 'Reset view', shortcut: 'Home', action: () => ctx.camera.resetView() },
    { name: 'Jump to diagonal', shortcut: 'J', action: () => ctx.camera.jumpToDiagonal() },
    { name: 'Undo', shortcut: '\u2318Z', action: () => performUndo(ctx) },
    { name: 'Redo', shortcut: '\u2318\u21e7Z', action: () => performRedo(ctx) },
    { name: 'Invert selected', shortcut: 'F', action: () => invertSelectedContigs(ctx) },
    { name: 'Cut contig at cursor', shortcut: 'C', action: () => cutAtCursorPosition(ctx) },
    { name: 'Join selected contigs', shortcut: 'J', action: () => joinSelectedContigs(ctx) },
    { name: 'Export AGP', shortcut: '\u2318G', action: () => exportAGP(ctx) },
    { name: 'Screenshot', shortcut: '\u2318S', action: () => takeScreenshot(ctx) },
    { name: 'Select all contigs', shortcut: '\u2318A', action: () => { SelectionManager.selectAll(); ctx.updateSidebarContigList(); } },
    { name: 'Clear selection', shortcut: 'Esc', action: () => { SelectionManager.clearSelection(); ctx.updateSidebarContigList(); } },
    { name: 'Toggle tracks', shortcut: 'X', action: () => { ctx.tracksVisible = !ctx.tracksVisible; ctx.showToast(`Tracks: ${ctx.tracksVisible ? 'visible' : 'hidden'}`); } },
    { name: 'New scaffold', shortcut: 'N', action: () => { const id = ctx.scaffoldManager.createScaffold(); ctx.scaffoldManager.setActiveScaffoldId(id); ctx.updateSidebarScaffoldList(); } },
    { name: 'Next waypoint', shortcut: '] or .', action: () => { const cam = ctx.camera.getState(); const wp = ctx.waypointManager.getNextWaypoint(cam.x, cam.y); if (wp) { ctx.currentWaypointId = wp.id; ctx.camera.animateTo({ x: wp.mapX, y: wp.mapY }, 250); } } },
    { name: 'Previous waypoint', shortcut: '[ or ,', action: () => { const cam = ctx.camera.getState(); const wp = ctx.waypointManager.getPrevWaypoint(cam.x, cam.y); if (wp) { ctx.currentWaypointId = wp.id; ctx.camera.animateTo({ x: wp.mapX, y: wp.mapY }, 250); } } },
    { name: 'Clear all waypoints', shortcut: 'Del', action: () => { ctx.waypointManager.clearAll(); ctx.currentWaypointId = null; ctx.showToast('All waypoints cleared'); } },
    { name: 'Save session', shortcut: '', action: () => saveSession(ctx) },
    { name: 'Load session', shortcut: '', action: () => document.getElementById('session-file-input')?.click() },
    { name: 'Script console', shortcut: '`', action: () => toggleScriptConsole() },
    { name: 'Keyboard shortcuts', shortcut: '?', action: () => toggleShortcutsModal() },
    { name: 'Generate script from log', action: () => { document.getElementById('btn-generate-from-log')?.click(); toggleScriptConsole(); } },
    { name: 'Export BED', shortcut: '', action: () => exportBEDFile(ctx) },
    { name: 'Export FASTA', shortcut: '', action: () => exportFASTAFile(ctx) },
    { name: 'Load reference FASTA', shortcut: '', action: () => document.getElementById('fasta-file-input')?.click() },
    { name: 'Load BedGraph track', shortcut: '', action: () => document.getElementById('track-file-input')?.click() },
    { name: 'Toggle contig exclusion', shortcut: 'H', action: () => toggleContigExclusion(ctx) },
    { name: 'Toggle comparison mode', shortcut: 'P', action: () => toggleComparisonMode(ctx) },
    { name: 'Batch: select by pattern', shortcut: '', action: () => runBatchSelectByPattern(ctx) },
    { name: 'Batch: select by size', shortcut: '', action: () => runBatchSelectBySize(ctx) },
    { name: 'Batch: cut large contigs', shortcut: '', action: () => runBatchCut(ctx) },
    { name: 'Batch: join selected', shortcut: '', action: () => runBatchJoin(ctx) },
    { name: 'Batch: invert selected', shortcut: '', action: () => runBatchInvert(ctx) },
    { name: 'Sort contigs by length', shortcut: '', action: () => runSortByLength(ctx) },
    { name: 'Auto sort: Union Find', shortcut: '', action: () => runAutoSort(ctx) },
    { name: 'Auto cut: detect breakpoints', shortcut: '', action: () => runAutoCut(ctx) },
    { name: 'Undo all auto-cut', shortcut: '', action: () => undoLastBatch(ctx, 'autocut') },
    { name: 'Undo all auto-sort', shortcut: '', action: () => undoLastBatch(ctx, 'autosort') },
    { name: 'Tutorial: Reading a Hi-C Contact Map', shortcut: '', action: () => ctx.tutorialManager?.startLesson(ctx, '01-reading-the-map') },
    { name: 'Tutorial: Understanding Chromosome Structure', shortcut: '', action: () => ctx.tutorialManager?.startLesson(ctx, '02-understanding-chromosomes') },
    { name: 'Tutorial: Detecting Misassembly Patterns', shortcut: '', action: () => ctx.tutorialManager?.startLesson(ctx, '03-detecting-misassembly') },
    { name: 'Tutorial: Cutting and Joining Contigs', shortcut: '', action: () => ctx.tutorialManager?.startLesson(ctx, '04-cutting-and-joining') },
    { name: 'Tutorial: Manual Scaffold Assignment', shortcut: '', action: () => ctx.tutorialManager?.startLesson(ctx, '05-scaffold-assignment') },
    { name: 'Tutorial: Full Curation Exercise', shortcut: '', action: () => ctx.tutorialManager?.startLesson(ctx, '06-full-curation-exercise') },
    { name: 'Pattern Gallery', shortcut: '', action: () => togglePatternGallery(ctx) },
    { name: 'AI: Analyze Contact Map', shortcut: '', action: () => toggleAIAssist() },
  ];
}

function updateCommandResults(ctx: AppContext, query: string): void {
  const results = document.getElementById('command-results')!;
  const commands = getCommands(ctx);
  const filtered = commands.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );

  selectedCommandIndex = 0;
  results.innerHTML = filtered.map((cmd, i) =>
    `<div class="result-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
      <span>${cmd.name}</span>
      <kbd>${cmd.shortcut ?? ''}</kbd>
    </div>`
  ).join('');

  results.querySelectorAll('.result-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      filtered[i].action();
      toggleCommandPalette(ctx);
    });
  });
}

function moveCommandSelection(delta: number): void {
  const results = document.getElementById('command-results')!;
  const items = results.querySelectorAll('.result-item');
  if (items.length === 0) return;

  items[selectedCommandIndex]?.classList.remove('selected');
  selectedCommandIndex = Math.max(0, Math.min(items.length - 1, selectedCommandIndex + delta));
  items[selectedCommandIndex]?.classList.add('selected');
  items[selectedCommandIndex]?.scrollIntoView({ block: 'nearest' });
}

function executeSelectedCommand(ctx: AppContext): void {
  const query = (document.getElementById('command-input') as HTMLInputElement).value;
  const commands = getCommands(ctx);
  const filtered = commands.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase())
  );
  if (filtered[selectedCommandIndex]) {
    filtered[selectedCommandIndex].action();
  }
  toggleCommandPalette(ctx);
}

export function setupCommandPalette(ctx: AppContext): void {
  const input = document.getElementById('command-input') as HTMLInputElement;

  // Pre-load specimen catalog for command palette commands
  ensureSpecimens();

  input.addEventListener('input', () => {
    updateCommandResults(ctx, input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleCommandPalette(ctx);
    } else if (e.key === 'Enter') {
      executeSelectedCommand(ctx);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveCommandSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveCommandSelection(-1);
    }
  });
}
