/**
 * Sidebar — contig list, scaffold list, search, and formatBp utility.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { SelectionManager } from '../curation/SelectionManager';
import { contigExclusion } from '../curation/ContigExclusion';
import { misassemblyFlags } from '../curation/MisassemblyFlags';
import { move } from '../curation/CurationEngine';

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
    return `<div class="contig-item ${isSelected ? 'selected' : ''}" data-order-index="${orderIdx}"${draggable}>
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

export function updateSidebarScaffoldList(ctx: AppContext): void {
  const listEl = document.getElementById('scaffold-list');
  if (!listEl) return;

  const scaffolds = ctx.scaffoldManager.getAllScaffolds();
  const activeId = ctx.scaffoldManager.getActiveScaffoldId();

  if (scaffolds.length === 0) {
    listEl.innerHTML = '<div style="color: var(--text-secondary); font-size: 12px;">No scaffolds. Press N in scaffold mode to create one.</div>';
    return;
  }

  const html = scaffolds.map(sc => {
    const isActive = sc.id === activeId;
    const count = ctx.scaffoldManager.getContigsInScaffold(sc.id).length;
    return `<div class="contig-item ${isActive ? 'selected' : ''}" data-scaffold-id="${sc.id}">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${sc.color};margin-right:6px;flex-shrink:0;"></span>
      <span class="contig-name">${sc.name}</span>
      <span class="contig-meta">${count} contigs</span>
    </div>`;
  }).join('');

  listEl.innerHTML = html;

  listEl.querySelectorAll('.contig-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt((el as HTMLElement).dataset.scaffoldId ?? '-1', 10);
      if (id >= 0) {
        ctx.scaffoldManager.setActiveScaffoldId(id);
        ctx.updateSidebarScaffoldList();
        const sc = ctx.scaffoldManager.getScaffold(id);
        ctx.showToast(`Active scaffold: ${sc?.name ?? ''}`);
      }
    });
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
}
