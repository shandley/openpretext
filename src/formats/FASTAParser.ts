/**
 * FASTA format parser.
 *
 * Parses FASTA formatted text into an array of sequence records.
 * Handles multi-line sequences, comment lines (starting with ;),
 * and blank lines.
 *
 * FASTA format reference:
 *   https://en.wikipedia.org/wiki/FASTA_format
 *
 * Header lines start with '>' followed by the sequence name (first
 * whitespace-delimited word) and an optional description (the rest).
 */

/** A single parsed FASTA sequence record. */
export interface FASTARecord {
  /** Sequence name (first whitespace-delimited word after '>'). */
  name: string;
  /** Everything after the name on the header line. */
  description: string;
  /** Concatenated sequence lines (no whitespace). */
  sequence: string;
}

/**
 * Parse FASTA formatted text into sequence records.
 *
 * @param text - The raw FASTA file content
 * @returns An array of parsed FASTA records
 */
export function parseFASTA(text: string): FASTARecord[] {
  const records: FASTARecord[] = [];
  let currentRecord: FASTARecord | null = null;
  const sequenceChunks: string[] = [];

  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip blank lines
    if (line.length === 0) {
      continue;
    }

    // Skip comment lines
    if (line.startsWith(';')) {
      continue;
    }

    // Header line
    if (line.startsWith('>')) {
      // Finalize the previous record
      if (currentRecord !== null) {
        currentRecord.sequence = sequenceChunks.join('');
        records.push(currentRecord);
        sequenceChunks.length = 0;
      }

      // Parse header: everything after '>' up to the first whitespace is the name
      const headerContent = line.substring(1).trim();
      const firstSpace = headerContent.search(/\s/);

      let name: string;
      let description: string;

      if (firstSpace === -1) {
        name = headerContent;
        description = '';
      } else {
        name = headerContent.substring(0, firstSpace);
        description = headerContent.substring(firstSpace).trim();
      }

      currentRecord = { name, description, sequence: '' };
    } else {
      // Sequence line - accumulate (strip any internal whitespace)
      if (currentRecord !== null) {
        sequenceChunks.push(line.replace(/\s/g, ''));
      }
    }
  }

  // Finalize the last record
  if (currentRecord !== null) {
    currentRecord.sequence = sequenceChunks.join('');
    records.push(currentRecord);
  }

  return records;
}

/**
 * Stream-parse FASTA from a ReadableStream<string>.
 *
 * Processes data chunk-by-chunk without loading the full file into memory.
 * Use this for large FASTA files where file.text() would exceed V8's string
 * length limit (~1GB) or exhaust available RAM.
 *
 * @param stream - A ReadableStream of decoded text chunks
 * @returns An array of parsed FASTA records
 */
export async function parseFASTAStream(stream: ReadableStream<string>): Promise<FASTARecord[]> {
  const records: FASTARecord[] = [];
  let currentName = '';
  let currentDescription = '';
  let seqChunks: string[] = [];
  let inRecord = false;
  let leftover = '';

  function finalizeCurrent(): void {
    if (inRecord && currentName) {
      records.push({ name: currentName, description: currentDescription, sequence: seqChunks.join('') });
      seqChunks = [];
    }
  }

  function processLine(raw: string): void {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith(';')) return;

    if (line.startsWith('>')) {
      finalizeCurrent();
      inRecord = true;
      const header = line.substring(1).trim();
      const ws = header.search(/\s/);
      currentName = ws === -1 ? header : header.substring(0, ws);
      currentDescription = ws === -1 ? '' : header.substring(ws).trim();
      seqChunks = [];
    } else if (inRecord) {
      seqChunks.push(line.replace(/\s/g, ''));
    }
  }

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const text = leftover + (value ?? '');
      const lines = text.split(/\r?\n/);
      // Keep the last (potentially incomplete) line in leftover unless stream ended
      leftover = done ? '' : (lines.pop() ?? '');
      for (const line of lines) processLine(line);
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  if (leftover) processLine(leftover);
  finalizeCurrent();

  return records;
}
