/**
 * Extract ground truth contig ordering from a curated .pretext file.
 *
 * Outputs a JSON array suitable for pasting into lesson assessment data
 * (data/lessons/XX-lesson.json → assessment.groundTruthOrder).
 *
 * Usage:
 *   npx tsx bench/extract-lesson-ground-truth.ts <post-curation.pretext>
 *
 * Example:
 *   npx tsx bench/extract-lesson-ground-truth.ts bench/data/regression/Taeniopygia_guttata_post.pretext
 *
 * The output is the contig ordering array that represents the "correct"
 * arrangement of contigs after proper curation. This can be copied into
 * the lesson JSON's assessment.groundTruthOrder field.
 */

import { loadPretextFromDisk } from './loader';
import { extractGroundTruth } from './ground-truth';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx bench/extract-lesson-ground-truth.ts <post-curation.pretext>');
    console.error('');
    console.error('Extracts the ground truth contig ordering from a curated .pretext file');
    console.error('and outputs it as JSON for use in lesson assessment data.');
    process.exit(1);
  }

  console.error(`Loading: ${filePath}`);
  const assembly = await loadPretextFromDisk(filePath);
  const gt = extractGroundTruth(assembly);

  const numChroms = new Set(gt.chromosomeAssignments).size;

  console.error(`Contigs: ${assembly.contigs.length}`);
  console.error(`Contig order length: ${gt.contigOrder.length}`);
  console.error(`Chromosomes detected: ${numChroms}`);
  console.error(`Chromosome boundaries: ${gt.chromosomeBoundaries.length}`);
  console.error(`Splits detected: ${gt.splits.size}`);
  console.error('');
  console.error('Ground truth ordering (copy this into lesson JSON assessment.groundTruthOrder):');
  console.error('');

  // Output the ordering to stdout (stderr used for diagnostics above)
  console.log(JSON.stringify(gt.contigOrder));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
