/**
 * Publication-ready table formatting in markdown, TSV, LaTeX, and CSV.
 */

import type { SpecimenResult, AggregateStats } from '../metrics/summary';

export type TableFormat = 'markdown' | 'tsv' | 'latex' | 'csv';

interface TableRow {
  species: string;
  n: number;
  precision: string;
  recall: string;
  f1: string;
  tau: string;
  ari: string;
  orient: string;
  purity: string;
  completeness: string;
  timeMs: string;
}

function formatNum(value: number, decimals: number = 2): string {
  return value.toFixed(decimals);
}

function resultToRow(r: SpecimenResult): TableRow {
  return {
    species: r.species,
    n: r.numContigs,
    precision: formatNum(r.breakpointMetrics.precision),
    recall: formatNum(r.breakpointMetrics.recall),
    f1: formatNum(r.breakpointMetrics.f1),
    tau: formatNum(r.sortMetrics.kendallTau),
    ari: formatNum(r.sortMetrics.adjustedRandIndex),
    orient: formatNum(r.sortMetrics.orientationAccuracy),
    purity: formatNum(r.sortMetrics.chainPurity),
    completeness: formatNum(r.chromosomeCompleteness.macroAverage),
    timeMs: formatNum(r.timingMs.total, 0),
  };
}

function aggregateToRow(agg: AggregateStats): TableRow {
  return {
    species: `Mean (n=${agg.numSpecimens})`,
    n: 0,
    precision: formatNum(agg.meanPrecision),
    recall: formatNum(agg.meanRecall),
    f1: formatNum(agg.meanF1),
    tau: formatNum(agg.meanKendallTau),
    ari: formatNum(agg.meanARI),
    orient: formatNum(agg.meanOrientationAccuracy),
    purity: formatNum(agg.meanChainPurity),
    completeness: formatNum(agg.meanMacroCompleteness),
    timeMs: formatNum(agg.meanTotalTimeMs, 0),
  };
}

const HEADERS = ['Species', 'n', 'P', 'R', 'F1', 'Tau', 'ARI', 'Orient', 'Purity', 'Compl', 'Time(ms)'];

/**
 * Format results as a markdown table.
 */
function formatMarkdown(rows: TableRow[], aggregate?: TableRow): string {
  const lines: string[] = [];
  const vals = (r: TableRow) => [r.species, String(r.n), r.precision, r.recall, r.f1, r.tau, r.ari, r.orient, r.purity, r.completeness, r.timeMs];

  // Compute column widths
  const allRows = [...rows.map(vals)];
  if (aggregate) allRows.push(vals(aggregate));
  const widths = HEADERS.map((h, i) => Math.max(h.length, ...allRows.map(r => r[i].length)));

  const pad = (s: string, w: number) => s.padEnd(w);
  const headerLine = '| ' + HEADERS.map((h, i) => pad(h, widths[i])).join(' | ') + ' |';
  const sepLine = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';

  lines.push(headerLine, sepLine);
  for (const row of rows) {
    const v = vals(row);
    lines.push('| ' + v.map((s, i) => pad(s, widths[i])).join(' | ') + ' |');
  }

  if (aggregate) {
    lines.push(sepLine);
    const v = vals(aggregate);
    lines.push('| ' + v.map((s, i) => pad(s, widths[i])).join(' | ') + ' |');
  }

  return lines.join('\n') + '\n';
}

/**
 * Format results as TSV.
 */
function formatTSV(rows: TableRow[], aggregate?: TableRow): string {
  const lines: string[] = [];
  const vals = (r: TableRow) => [r.species, String(r.n), r.precision, r.recall, r.f1, r.tau, r.ari, r.orient, r.purity, r.completeness, r.timeMs];

  lines.push(HEADERS.join('\t'));
  for (const row of rows) {
    lines.push(vals(row).join('\t'));
  }
  if (aggregate) {
    lines.push(vals(aggregate).join('\t'));
  }

  return lines.join('\n') + '\n';
}

/**
 * Format results as CSV.
 */
function formatCSV(rows: TableRow[], aggregate?: TableRow): string {
  const lines: string[] = [];
  const vals = (r: TableRow) => [r.species, String(r.n), r.precision, r.recall, r.f1, r.tau, r.ari, r.orient, r.purity, r.completeness, r.timeMs];
  const csvEscape = (s: string) => s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;

  lines.push(HEADERS.join(','));
  for (const row of rows) {
    lines.push(vals(row).map(csvEscape).join(','));
  }
  if (aggregate) {
    lines.push(vals(aggregate).map(csvEscape).join(','));
  }

  return lines.join('\n') + '\n';
}

/**
 * Format results as LaTeX tabular.
 */
function formatLaTeX(rows: TableRow[], aggregate?: TableRow): string {
  const lines: string[] = [];
  const vals = (r: TableRow) => [r.species, String(r.n), r.precision, r.recall, r.f1, r.tau, r.ari, r.orient, r.purity, r.completeness, r.timeMs];

  const colSpec = 'l' + 'r'.repeat(HEADERS.length - 1);
  lines.push(`\\begin{tabular}{${colSpec}}`);
  lines.push('\\toprule');
  lines.push(HEADERS.join(' & ') + ' \\\\');
  lines.push('\\midrule');

  for (const row of rows) {
    lines.push(vals(row).join(' & ') + ' \\\\');
  }

  if (aggregate) {
    lines.push('\\midrule');
    lines.push(vals(aggregate).join(' & ') + ' \\\\');
  }

  lines.push('\\bottomrule');
  lines.push('\\end{tabular}');

  return lines.join('\n') + '\n';
}

/**
 * Format benchmark results as a publication-ready table.
 */
export function formatTable(
  results: SpecimenResult[],
  aggregate: AggregateStats | undefined,
  format: TableFormat = 'markdown',
): string {
  const rows = results.map(resultToRow);
  const aggRow = aggregate ? aggregateToRow(aggregate) : undefined;

  switch (format) {
    case 'markdown': return formatMarkdown(rows, aggRow);
    case 'tsv': return formatTSV(rows, aggRow);
    case 'csv': return formatCSV(rows, aggRow);
    case 'latex': return formatLaTeX(rows, aggRow);
  }
}
