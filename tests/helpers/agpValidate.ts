/**
 * A checker for the rules of the AGP 2.1 specification that a writer can get
 * wrong, for tests. It is written from the specification
 * (https://www.ncbi.nlm.nih.gov/assembly/agp/AGP_Specification/, summarised in
 * research/export-compat-2026-11/agp-spec-and-validators.md), not from our
 * writer, so the two can disagree.
 *
 * It is not NCBI's validator. It covers: comments only at the head; nine
 * columns (more only if allowed); each object starting at 1 with part 1;
 * consecutive lines contiguous and parts sequential; component span equal to
 * object span; allowed component types, orientations, gap types and linkage
 * evidence; type U gaps of length 100; no object beginning or ending with a
 * gap, and no two gaps in a row.
 */

const GAP_TYPES = [
  'scaffold', 'contig', 'centromere', 'short_arm', 'heterochromatin', 'telomere', 'repeat', 'contamination',
];
const EVIDENCE = [
  'na', 'paired-ends', 'align_genus', 'align_xgenus', 'align_trnscpt', 'within_clone', 'clone_contig', 'map',
  'pcr', 'proximity_ligation', 'strobe', 'unspecified',
];

export interface AGPValidateOptions {
  /** Refuse more than this many columns. Unset: extra columns after the ninth are allowed. */
  maxColumns?: number;
}

/** Returns one message per problem; an empty list means the text passed. */
export function validateAGP(text: string, options: AGPValidateOptions = {}): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  let seenData = false;
  let object: string | null = null;
  let expectedBeg = 1;
  let expectedPart = 1;
  let lastWasGap = false;
  const finished = new Set<string>();

  const closeObject = (n: number) => {
    if (object !== null && lastWasGap) problems.push(`line ${n}: object ${object} ends with a gap`);
  };

  lines.forEach((line, idx) => {
    const n = idx + 1;
    if (line.startsWith('#')) {
      if (seenData) problems.push(`line ${n}: comment after the first data line`);
      return;
    }
    if (line.trim() === '') { problems.push(`line ${n}: blank line`); return; }
    if (/[ \t]$/.test(line)) problems.push(`line ${n}: trailing whitespace`);
    seenData = true;
    const c = line.split('\t');
    if (c.length < 9) { problems.push(`line ${n}: ${c.length} columns`); return; }
    if (options.maxColumns !== undefined && c.length > options.maxColumns) {
      problems.push(`line ${n}: ${c.length} columns, at most ${options.maxColumns} allowed`);
    }
    const [obj, begS, endS, partS, type] = c;
    const beg = Number(begS);
    const end = Number(endS);
    const part = Number(partS);
    if (![beg, end, part].every((v) => Number.isInteger(v) && v >= 1)) {
      problems.push(`line ${n}: object_beg, object_end and part_number must be positive integers`);
      return;
    }

    if (obj !== object) {
      closeObject(n - 1);
      if (finished.has(obj)) problems.push(`line ${n}: object ${obj} appears in two places`);
      if (object !== null) finished.add(object);
      object = obj;
      expectedBeg = 1;
      expectedPart = 1;
      lastWasGap = false;
      if (type === 'N' || type === 'U') problems.push(`line ${n}: object ${obj} begins with a gap`);
    }
    if (beg !== expectedBeg) problems.push(`line ${n}: object_beg is ${beg}, expected ${expectedBeg}`);
    if (part !== expectedPart) problems.push(`line ${n}: part_number is ${part}, expected ${expectedPart}`);
    if (end < beg) problems.push(`line ${n}: object_end before object_beg`);
    expectedBeg = end + 1;
    expectedPart = part + 1;

    if (type === 'N' || type === 'U') {
      if (lastWasGap) problems.push(`line ${n}: two gaps in a row`);
      lastWasGap = true;
      const len = Number(c[5]);
      if (!Number.isInteger(len) || len < 1) problems.push(`line ${n}: gap_length ${c[5]}`);
      if (len !== end - beg + 1) problems.push(`line ${n}: gap_length ${len} does not match the object span`);
      if (type === 'U' && len !== 100) problems.push(`line ${n}: a type U gap must be 100 long`);
      if (!GAP_TYPES.includes(c[6])) problems.push(`line ${n}: gap_type ${c[6]}`);
      if (c[7] !== 'yes' && c[7] !== 'no') problems.push(`line ${n}: linkage ${c[7]}`);
      for (const e of c[8].split(';')) if (!EVIDENCE.includes(e)) problems.push(`line ${n}: linkage_evidence ${e}`);
      if (c[7] === 'yes' && c[8] === 'na') problems.push(`line ${n}: linked gap with no evidence`);
      if (c.length > 9) problems.push(`line ${n}: extra columns on a gap line`);
      return;
    }

    lastWasGap = false;
    if (!['A', 'D', 'F', 'G', 'O', 'P', 'W'].includes(type)) problems.push(`line ${n}: component_type ${type}`);
    const cBeg = Number(c[6]);
    const cEnd = Number(c[7]);
    if (!Number.isInteger(cBeg) || !Number.isInteger(cEnd) || cBeg < 1 || cEnd < cBeg) {
      problems.push(`line ${n}: component_beg/component_end ${c[6]}/${c[7]}`);
    } else if (cEnd - cBeg !== end - beg) {
      problems.push(`line ${n}: component span ${cEnd - cBeg + 1} differs from object span ${end - beg + 1}`);
    }
    if (c[5] === '') problems.push(`line ${n}: empty component_id`);
    if (!['+', '-', '?', '0', 'na'].includes(c[8])) problems.push(`line ${n}: orientation ${c[8]}`);
    for (const extra of c.slice(9)) if (extra === '') problems.push(`line ${n}: empty extra column`);
  });
  closeObject(lines.length);
  return problems;
}
