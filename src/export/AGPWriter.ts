/**
 * AGP (A Golden Path) file writer.
 *
 * Exports the current assembly state as an AGP 2.1 file.
 * The AGP format is a tab-separated specification defined by NCBI:
 *   https://www.ncbi.nlm.nih.gov/assembly/agp/AGP_Specification/
 *
 * Columns:
 *   1. object          - scaffold/chromosome name
 *   2. object_beg      - start position in the object (1-based)
 *   3. object_end      - end position in the object (1-based, inclusive)
 *   4. part_number     - sequential part number within the object
 *   5. component_type  - 'W' for WGS contig, 'N' for gap
 *   6. component_id (contigs) / gap_length (gaps)
 *   7. component_beg (contigs) / gap_type (gaps)
 *   8. component_end (contigs) / linkage (gaps)
 *   9. orientation (contigs) / linkage_evidence (gaps)
 */

import type { AppState, ContigInfo } from '../core/State';

/** Configuration for AGP export. */
export interface AGPExportOptions {
  /** Default gap size between contigs within a scaffold (bp). Defaults to 200. */
  gapSize?: number;
  /** Gap type for intra-scaffold gaps. Defaults to 'scaffold'. */
  gapType?: string;
  /** Linkage evidence type. Defaults to 'proximity_ligation' (Hi-C). */
  linkageEvidence?: string;
  /** Whether to include the AGP version comment header. Defaults to true. */
  includeHeader?: boolean;
  /** Prefix for unnamed scaffolds. Defaults to 'scaffold_'. */
  scaffoldPrefix?: string;
}

const DEFAULT_OPTIONS: Required<AGPExportOptions> = {
  gapSize: 200,
  gapType: 'scaffold',
  linkageEvidence: 'proximity_ligation',
  includeHeader: true,
  scaffoldPrefix: 'scaffold_',
};

/**
 * Represents a single component line in the AGP file (either contig or gap).
 */
export interface AGPLine {
  object: string;
  objectBeg: number;
  objectEnd: number;
  partNumber: number;
  componentType: 'W' | 'N';
  // For W (contig) lines
  componentId?: string;
  componentBeg?: number;
  componentEnd?: number;
  orientation?: '+' | '-';
  // For N (gap) lines
  gapLength?: number;
  gapType?: string;
  linkage?: 'yes' | 'no';
  linkageEvidence?: string;
}

/**
 * Groups contigs by scaffold ID. Contigs without a scaffoldId are each
 * placed into their own single-contig scaffold group.
 */
export function groupContigsByScaffold(
  contigs: ContigInfo[],
  contigOrder: number[]
): Map<string, ContigInfo[]> {
  const scaffolds = new Map<string, ContigInfo[]>();
  let unscaffoldedCounter = 0;

  for (const idx of contigOrder) {
    const contig = contigs[idx];
    if (!contig) continue;

    let scaffoldName: string;
    if (contig.scaffoldId !== null && contig.scaffoldId !== undefined) {
      scaffoldName = `scaffold_${contig.scaffoldId}`;
    } else {
      // Each unscaffolded contig becomes its own object
      scaffoldName = `unplaced_${unscaffoldedCounter++}`;
    }

    if (!scaffolds.has(scaffoldName)) {
      scaffolds.set(scaffoldName, []);
    }
    scaffolds.get(scaffoldName)!.push(contig);
  }

  return scaffolds;
}

/**
 * Builds AGP lines for a single scaffold (a group of contigs).
 */
export function buildScaffoldAGPLines(
  scaffoldName: string,
  contigs: ContigInfo[],
  options: Required<AGPExportOptions>
): AGPLine[] {
  const lines: AGPLine[] = [];
  let objectPos = 1; // 1-based position within the scaffold object
  let partNumber = 1;

  for (let i = 0; i < contigs.length; i++) {
    const contig = contigs[i];

    // Insert gap before this contig (except before the first one)
    if (i > 0 && options.gapSize > 0) {
      const gapEnd = objectPos + options.gapSize - 1;
      lines.push({
        object: scaffoldName,
        objectBeg: objectPos,
        objectEnd: gapEnd,
        partNumber,
        componentType: 'N',
        gapLength: options.gapSize,
        gapType: options.gapType,
        linkage: 'yes',
        linkageEvidence: options.linkageEvidence,
      });
      objectPos = gapEnd + 1;
      partNumber++;
    }

    // Contig component line
    const contigLength = contig.length;
    const contigEnd = objectPos + contigLength - 1;

    lines.push({
      object: scaffoldName,
      objectBeg: objectPos,
      objectEnd: contigEnd,
      partNumber,
      componentType: 'W',
      componentId: contig.name,
      componentBeg: 1,
      componentEnd: contigLength,
      orientation: contig.inverted ? '-' : '+',
    });

    objectPos = contigEnd + 1;
    partNumber++;
  }

  return lines;
}

/**
 * Formats an AGPLine into a tab-separated string.
 */
export function formatAGPLine(line: AGPLine): string {
  if (line.componentType === 'W') {
    return [
      line.object,
      line.objectBeg,
      line.objectEnd,
      line.partNumber,
      line.componentType,
      line.componentId,
      line.componentBeg,
      line.componentEnd,
      line.orientation,
    ].join('\t');
  } else {
    // Gap line (N type)
    return [
      line.object,
      line.objectBeg,
      line.objectEnd,
      line.partNumber,
      line.componentType,
      line.gapLength,
      line.gapType,
      line.linkage,
      line.linkageEvidence,
    ].join('\t');
  }
}

/**
 * Generates the complete AGP header comment block.
 */
export function generateAGPHeader(): string {
  const lines = [
    '##agp-version\t2.1',
    `# Generated by OpenPretext on ${new Date().toISOString()}`,
    '# Curation performed using Hi-C contact map data',
  ];
  return lines.join('\n');
}

/**
 * Export the current assembly state as an AGP format string.
 *
 * @param appState - The current application state
 * @param options  - Export configuration options
 * @returns The full AGP file content as a string
 */
export function exportAGP(
  appState: AppState,
  options: AGPExportOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!appState.map || appState.map.contigs.length === 0) {
    throw new Error('Cannot export AGP: no map data loaded');
  }

  const contigs = appState.map.contigs;
  const contigOrder = appState.contigOrder;

  if (contigOrder.length === 0) {
    throw new Error('Cannot export AGP: contig order is empty');
  }

  // Group contigs into scaffolds
  const scaffolds = groupContigsByScaffold(contigs, contigOrder);

  // Build all AGP lines
  const allLines: AGPLine[] = [];
  for (const [scaffoldName, scaffoldContigs] of scaffolds) {
    const lines = buildScaffoldAGPLines(scaffoldName, scaffoldContigs, opts);
    allLines.push(...lines);
  }

  // Assemble the output
  const parts: string[] = [];

  if (opts.includeHeader) {
    parts.push(generateAGPHeader());
  }

  for (const line of allLines) {
    parts.push(formatAGPLine(line));
  }

  return parts.join('\n') + '\n';
}

/**
 * Trigger a browser download of the AGP file.
 */
export function downloadAGP(
  appState: AppState,
  filename?: string,
  options?: AGPExportOptions
): void {
  const content = exportAGP(appState, options);
  const defaultFilename = appState.map?.filename
    ? appState.map.filename.replace(/\.pretext$/i, '.agp')
    : 'assembly.agp';

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? defaultFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
