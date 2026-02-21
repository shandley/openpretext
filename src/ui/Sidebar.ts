/**
 * Sidebar — contig list, scaffold list, search, and formatBp utility.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { SelectionManager } from '../curation/SelectionManager';
import { contigExclusion } from '../curation/ContigExclusion';
import { misassemblyFlags } from '../curation/MisassemblyFlags';
import { move } from '../curation/CurationEngine';
import { detectChromosomeBlocks } from '../analysis/ScaffoldDetection';
import { recomputeScaffoldDecay } from './AnalysisPanel';

/** Current contig color metric for sidebar stripe. */
let contigColorMetric: 'none' | 'length' | 'scaffold' | 'misassembly' = 'none';

export function getContigColorMetric(): string { return contigColorMetric; }

export function formatBp(bp: number): string {
  if (bp >= 1_000_000_000) return `${(bp / 1_000_000_000).toFixed(1)} Gb`;
  if (bp >= 1_000_000) return `${(bp / 1_000_000).toFixed(1)} Mb`;
  if (bp >= 1_000) return `${(bp / 1_000).toFixed(1)} kb`;
  return `${bp} bp`;
}

export function updateSidebarContigList(ctx: AppContext): void {
  const listEl = document.getElementById('contig-list');
  if (!listEl) return;

  const s = state.get();
  if (!s.map) {
    listEl.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px;">No data loaded</div>';
    return;
  }

  const searchInput = document.getElementById('contig-search') as HTMLInputElement;
  const filter = (searchInput?.value ?? '').toLowerCase().trim();

  const selected = s.selectedContigs;

  // Compute per-contig metric colors for sidebar stripe
  let metricColors: Map<number, string> | null = null;
  if (contigColorMetric === 'length') {
    const lengths = s.contigOrder.map(id => s.map!.contigs[id].length);
    const minLen = Math.min(...lengths);
    const maxLen = Math.max(...lengths);
    metricColors = new Map();
    for (let i = 0; i < s.contigOrder.length; i++) {
      const t = maxLen > minLen
        ? (s.map!.contigs[s.contigOrder[i]].length - minLen) / (maxLen - minLen)
        : 0.5;
      const r = Math.round(100 - t * 60);
      const g = Math.round(150 - t * 80);
      const b = Math.round(255 - t * 55);
      metricColors.set(i, `rgb(${r},${g},${b})`);
    }
  } else if (contigColorMetric === 'scaffold') {
    metricColors = new Map();
    const scaffolds = ctx.scaffoldManager.getAllScaffolds();
    const colorMap = new Map<number, string>();
    for (const sc of scaffolds) colorMap.set(sc.id, sc.color);
    for (let i = 0; i < s.contigOrder.length; i++) {
      const sid = s.map!.contigs[s.contigOrder[i]].scaffoldId;
      if (sid !== null && colorMap.has(sid)) {
        metricColors.set(i, colorMap.get(sid)!);
      }
    }
  } else if (contigColorMetric === 'misassembly') {
    metricColors = new Map();
    for (let i = 0; i < s.contigOrder.length; i++) {
      if (misassemblyFlags.isFlagged(i)) {
        metricColors.set(i, '#e74c3c');
      }
    }
  }

  const html = s.contigOrder.map((contigId, orderIdx) => {
    const contig = s.map!.contigs[contigId];
    if (!contig) return '';
    if (filter && !contig.name.toLowerCase().includes(filter)) return '';
    const isSelected = selected.has(orderIdx);
    const lengthStr = formatBp(contig.length);
    const invertedBadge = contig.inverted ? '<span class="contig-badge inverted">INV</span>' : '';
    const excludedBadge = contigExclusion.isExcluded(orderIdx) ? '<span class="contig-badge excluded">EXC</span>' : '';
    const misassemblyBadge = misassemblyFlags.isFlagged(orderIdx) ? '<span class="contig-badge misassembly">MIS</span>' : '';
    const scaffoldBadge = contig.scaffoldId !== null
      ? `<span class="contig-badge scaffold">S${contig.scaffoldId}</span>`
      : '';

    const draggable = ctx.currentMode === 'edit' ? ' draggable="true"' : '';
    const metricStyle = metricColors?.has(orderIdx)
      ? ` style="border-left:3px solid ${metricColors.get(orderIdx)}"`
      : '';
    return `<div class="contig-item ${isSelected ? 'selected' : ''}" data-order-index="${orderIdx}"${draggable}${metricStyle}>
      <span class="contig-name">${contig.name}</span>
      <span class="contig-meta">${lengthStr} ${invertedBadge}${excludedBadge}${misassemblyBadge}${scaffoldBadge}</span>
    </div>`;
  }).join('');

  listEl.innerHTML = html;

  listEl.querySelectorAll('.contig-item').forEach((el) => {
    const htmlEl = el as HTMLElement;

    el.addEventListener('click', (e) => {
      const idx = parseInt(htmlEl.dataset.orderIndex ?? '-1', 10);
      if (idx < 0) return;

      if ((e as MouseEvent).shiftKey) {
        SelectionManager.selectRange(idx);
      } else if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) {
        SelectionManager.selectToggle(idx);
      } else {
        SelectionManager.selectSingle(idx);
      }
      ctx.updateSidebarContigList();
    });

    el.addEventListener('dblclick', () => {
      const idx = parseInt(htmlEl.dataset.orderIndex ?? '-1', 10);
      if (idx < 0 || idx >= ctx.contigBoundaries.length) return;
      const start = idx === 0 ? 0 : ctx.contigBoundaries[idx - 1];
      const end = ctx.contigBoundaries[idx];
      ctx.camera.zoomToRegion(start, start, end, end);
    });

    // Drag-and-drop reordering (edit mode only)
    if (ctx.currentMode === 'edit') {
      htmlEl.addEventListener('dragstart', (e) => {
        const idx = htmlEl.dataset.orderIndex ?? '';
        e.dataTransfer!.setData('text/plain', idx);
        e.dataTransfer!.effectAllowed = 'move';
        htmlEl.classList.add('dragging');
      });

      htmlEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        htmlEl.classList.add('drag-over');
      });

      htmlEl.addEventListener('dragleave', () => {
        htmlEl.classList.remove('drag-over');
      });

      htmlEl.addEventListener('drop', (e) => {
        e.preventDefault();
        htmlEl.classList.remove('drag-over');
        const fromIdx = parseInt(e.dataTransfer!.getData('text/plain'), 10);
        const toIdx = parseInt(htmlEl.dataset.orderIndex ?? '-1', 10);
        if (isNaN(fromIdx) || toIdx < 0 || fromIdx === toIdx) return;
        move(fromIdx, toIdx);
        ctx.refreshAfterCuration();
        ctx.showToast('Contig moved');
      });

      htmlEl.addEventListener('dragend', () => {
        htmlEl.classList.remove('dragging');
        // Clean up any lingering drag-over classes on other items
        listEl.querySelectorAll('.drag-over').forEach(
          (el) => (el as HTMLElement).classList.remove('drag-over')
        );
      });
    }
  });
}

export function autoAssignScaffolds(ctx: AppContext): void {
  const s = state.get();
  if (!s.map?.contactMap) return;

  const overviewSize = Math.round(Math.sqrt(s.map.contactMap.length));
  const result = detectChromosomeBlocks(
    s.map.contactMap, overviewSize,
    s.map.contigs, s.contigOrder, s.map.textureSize,
  );

  if (result.blocks.length === 0) {
    ctx.showToast('No chromosome blocks detected');
    return;
  }

  // Clear existing scaffolds
  for (const sc of ctx.scaffoldManager.getAllScaffolds()) {
    ctx.scaffoldManager.deleteScaffold(sc.id);
  }

  // Sort blocks by total pixel span (largest first) for naming
  const sorted = [...result.blocks].sort((a, b) => {
    let spanA = 0;
    for (let j = a.startIndex; j <= a.endIndex; j++) {
      const c = s.map!.contigs[s.contigOrder[j]];
      spanA += c.pixelEnd - c.pixelStart;
    }
    let spanB = 0;
    for (let j = b.startIndex; j <= b.endIndex; j++) {
      const c = s.map!.contigs[s.contigOrder[j]];
      spanB += c.pixelEnd - c.pixelStart;
    }
    return spanB - spanA;
  });

  // Create scaffolds and paint contigs
  for (let i = 0; i < sorted.length; i++) {
    const block = sorted[i];
    const name = `Chr${i + 1}`;
    const id = ctx.scaffoldManager.createScaffold(name);
    const orderIndices: number[] = [];
    for (let j = block.startIndex; j <= block.endIndex; j++) {
      orderIndices.push(j);
    }
    ctx.scaffoldManager.paintContigs(orderIndices, id);
  }

  ctx.updateSidebarScaffoldList();
  ctx.updateSidebarContigList();
  ctx.showToast(`Auto-assigned ${sorted.length} scaffolds`);

  // Recompute per-scaffold P(s) decay from cached genome-wide decay
  recomputeScaffoldDecay(ctx);
}

export function updateSidebarScaffoldList(ctx: AppContext): void {
  const listEl = document.getElementById('scaffold-list');
  if (!listEl) return;

  const scaffolds = ctx.scaffoldManager.getAllScaffolds();
  const activeId = ctx.scaffoldManager.getActiveScaffoldId();

  if (scaffolds.length === 0) {
    listEl.innerHTML = `
      <div style="color: var(--text-secondary); font-size: 12px;">No scaffolds assigned.</div>
      <button class="analysis-btn" id="btn-auto-scaffold" style="width:100%;margin:4px 0;">Auto-assign Scaffolds</button>
    `;
    document.getElementById('btn-auto-scaffold')?.addEventListener('click', () => {
      autoAssignScaffolds(ctx);
    });
    return;
  }

  let html = scaffolds.map(sc => {
    const isActive = sc.id === activeId;
    const count = ctx.scaffoldManager.getContigsInScaffold(sc.id).length;
    return `<div class="contig-item ${isActive ? 'selected' : ''}" data-scaffold-id="${sc.id}">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${sc.color};margin-right:6px;flex-shrink:0;"></span>
      <span class="contig-name">${sc.name}</span>
      <span class="contig-meta">${count} contigs</span>
    </div>`;
  }).join('');
  html += `<div class="scaffold-drop-zone" id="scaffold-drop-unassign"><span style="color:var(--text-secondary);font-size:10px;">Drop here to unassign</span></div>`;
  html += `<button class="analysis-btn" id="btn-redetect-scaffold" style="width:100%;margin:4px 0;font-size:11px;">Re-detect Scaffolds</button>`;

  listEl.innerHTML = html;

  // Helper: handle drop on a scaffold row or unassign zone
  function handleScaffoldDrop(target: HTMLElement, scaffoldId: number | null) {
    return (e: DragEvent) => {
      e.preventDefault();
      target.classList.remove('drag-over-scaffold');
      const fromIdx = parseInt(e.dataTransfer!.getData('text/plain'), 10);
      if (isNaN(fromIdx)) return;
      const s = state.get();
      const indices = s.selectedContigs.has(fromIdx)
        ? [...s.selectedContigs]
        : [fromIdx];
      ctx.scaffoldManager.paintContigs(indices, scaffoldId);
      ctx.updateSidebarContigList();
      ctx.updateSidebarScaffoldList();
      if (scaffoldId !== null) {
        const sc = ctx.scaffoldManager.getScaffold(scaffoldId);
        ctx.showToast(`Assigned ${indices.length} contig(s) to ${sc?.name ?? 'scaffold'}`);
      } else {
        ctx.showToast(`Unassigned ${indices.length} contig(s)`);
      }
    };
  }

  listEl.querySelectorAll('.contig-item').forEach(el => {
    const htmlEl = el as HTMLElement;
    el.addEventListener('click', () => {
      const id = parseInt(htmlEl.dataset.scaffoldId ?? '-1', 10);
      if (id >= 0) {
        ctx.scaffoldManager.setActiveScaffoldId(id);
        ctx.updateSidebarScaffoldList();
        const sc = ctx.scaffoldManager.getScaffold(id);
        ctx.showToast(`Active scaffold: ${sc?.name ?? ''}`);
      }
    });

    // Drag-drop: accept contig drops to reassign scaffold
    htmlEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'link';
      htmlEl.classList.add('drag-over-scaffold');
    });
    htmlEl.addEventListener('dragleave', () => {
      htmlEl.classList.remove('drag-over-scaffold');
    });
    const scaffoldId = parseInt(htmlEl.dataset.scaffoldId ?? '-1', 10);
    if (scaffoldId >= 0) {
      htmlEl.addEventListener('drop', handleScaffoldDrop(htmlEl, scaffoldId) as EventListener);
    }
  });

  // Unassign drop zone
  const unassignZone = document.getElementById('scaffold-drop-unassign');
  if (unassignZone) {
    unassignZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      (e as DragEvent).dataTransfer!.dropEffect = 'link';
      unassignZone.classList.add('drag-over-scaffold');
    });
    unassignZone.addEventListener('dragleave', () => {
      unassignZone.classList.remove('drag-over-scaffold');
    });
    unassignZone.addEventListener('drop', handleScaffoldDrop(unassignZone, null) as EventListener);
  }

  document.getElementById('btn-redetect-scaffold')?.addEventListener('click', () => {
    autoAssignScaffolds(ctx);
  });
}

export function setupContigSearch(ctx: AppContext): void {
  const searchInput = document.getElementById('contig-search') as HTMLInputElement;
  if (!searchInput) return;
  searchInput.addEventListener('input', () => {
    ctx.updateSidebarContigList();
  });
  // Prevent keyboard shortcuts from firing while typing in search
  searchInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
  });

  // Wire contig color metric dropdown
  const metricSelect = document.getElementById('contig-color-metric') as HTMLSelectElement | null;
  metricSelect?.addEventListener('change', () => {
    contigColorMetric = metricSelect.value as typeof contigColorMetric;
    ctx.updateSidebarContigList();
  });
}
