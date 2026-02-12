/**
 * AIContext — builds a structured context package from the current assembly state.
 *
 * This is sent alongside the contact map screenshot to give the AI model
 * enough metadata to produce meaningful curation suggestions.
 */

import type { AppContext } from '../ui/AppContext';
import { state } from '../core/State';
import type { CurationOperation } from '../core/State';

export interface AnalysisContext {
  filename: string;
  contigCount: number;
  contigNames: string[];
  contigLengths: number[];
  scaffoldAssignments: Array<{ contig: string; scaffold: string }>;
  qualityMetrics: { n50: number; totalLength: number; contigCount: number } | null;
  recentOps: string[];
}

export function buildAnalysisContext(ctx: AppContext): AnalysisContext {
  const s = state.get();
  const contigs = s.map?.contigs ?? [];
  const contigOrder = s.contigOrder;

  // Contig names and lengths in display order
  const contigNames: string[] = [];
  const contigLengths: number[] = [];
  for (const idx of contigOrder) {
    const c = contigs[idx];
    if (c) {
      contigNames.push(c.name);
      contigLengths.push(c.length);
    }
  }

  // Scaffold assignments
  const scaffoldAssignments: Array<{ contig: string; scaffold: string }> = [];
  const scaffolds = ctx.scaffoldManager.getAllScaffolds();
  const scaffoldMap = new Map<number, string>();
  for (const sc of scaffolds) {
    scaffoldMap.set(sc.id, sc.name);
  }
  for (const idx of contigOrder) {
    const c = contigs[idx];
    if (c?.scaffoldId != null) {
      const scName = scaffoldMap.get(c.scaffoldId);
      if (scName) {
        scaffoldAssignments.push({ contig: c.name, scaffold: scName });
      }
    }
  }

  // Quality metrics
  let qualityMetrics: AnalysisContext['qualityMetrics'] = null;
  const summary = ctx.metricsTracker.getSummary();
  if (summary) {
    qualityMetrics = {
      n50: summary.current.n50,
      totalLength: summary.current.totalLength,
      contigCount: summary.current.contigCount,
    };
  }

  // Recent operations (last 5)
  const recentOps = s.undoStack.slice(-5).map(formatOperation);

  return {
    filename: s.map?.filename ?? 'unknown',
    contigCount: contigOrder.length,
    contigNames,
    contigLengths,
    scaffoldAssignments,
    qualityMetrics,
    recentOps,
  };
}

function formatOperation(op: CurationOperation): string {
  switch (op.type) {
    case 'cut':
      return `cut at position`;
    case 'join':
      return `join contigs`;
    case 'invert':
      return `invert contig`;
    case 'move':
      return `move contig`;
    default:
      return op.type;
  }
}

export function formatContextMessage(ac: AnalysisContext): string {
  const lines: string[] = [];

  lines.push(`## Assembly: ${ac.filename}`);
  lines.push(`Contigs: ${ac.contigCount}`);

  if (ac.qualityMetrics) {
    lines.push(`N50: ${ac.qualityMetrics.n50.toLocaleString()} bp`);
    lines.push(`Total length: ${ac.qualityMetrics.totalLength.toLocaleString()} bp`);
  }

  lines.push('');
  lines.push('## Contig order (display order):');
  const maxShow = 100;
  const toShow = ac.contigNames.slice(0, maxShow);
  for (let i = 0; i < toShow.length; i++) {
    lines.push(`  #${i} ${toShow[i]} (${ac.contigLengths[i].toLocaleString()} bp)`);
  }
  if (ac.contigNames.length > maxShow) {
    lines.push(`  ... and ${ac.contigNames.length - maxShow} more contigs`);
  }

  if (ac.scaffoldAssignments.length > 0) {
    lines.push('');
    lines.push('## Scaffold assignments:');
    for (const sa of ac.scaffoldAssignments) {
      lines.push(`  ${sa.contig} -> ${sa.scaffold}`);
    }
  }

  if (ac.recentOps.length > 0) {
    lines.push('');
    lines.push('## Recent curation operations:');
    for (const op of ac.recentOps) {
      lines.push(`  - ${op}`);
    }
  }

  lines.push('');
  lines.push('Please analyze the contact map image above and suggest curation commands.');
  lines.push('Focus on the most impactful improvements: misjoins to cut, inversions to fix, and contigs to reorder.');

  return lines.join('\n');
}
