/**
 * Diagnostic script for AutoCut false positives.
 * Examines the 3 failing specimens to understand why breakpoints are detected.
 */

import { loadPretextFromDisk } from './loader';
import { autoCut, computeDiagonalDensity, detectBreakpoints } from '../src/curation/AutoCut';

const FAILING_SPECIMENS = [
  { species: 'Anilios_waitii', path: 'bench/data/Anilios_waitii/post.pretext' },
  { species: 'Atractosteus_spatula', path: 'bench/data/Atractosteus_spatula/post.pretext' },
  { species: 'Scaphiopus_couchii', path: 'bench/data/Scaphiopus_couchii/post.pretext' },
];

async function diagnose() {
  for (const specimen of FAILING_SPECIMENS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`SPECIMEN: ${specimen.species}`);
    console.log(`${'='.repeat(70)}`);

    const assembly = await loadPretextFromDisk(specimen.path);
    const { contactMap, overviewSize: size, contigs, contigOrder, textureSize } = assembly;

    console.log(`  Overview size: ${size}, Texture size: ${textureSize}`);
    console.log(`  Contigs: ${contigs.length}, Order length: ${contigOrder.length}`);

    // Run autoCut with default params
    const result = autoCut(contactMap, size, contigs, contigOrder, textureSize);
    console.log(`  Total breakpoints: ${result.totalBreakpoints}`);

    // For each breakpoint, dig into the details
    let overviewAccumulated = 0;
    for (let orderIdx = 0; orderIdx < contigOrder.length; orderIdx++) {
      const contigId = contigOrder[orderIdx];
      const contig = contigs[contigId];
      const contigPixelLength = contig.pixelEnd - contig.pixelStart;

      const overviewStart = Math.round((overviewAccumulated / textureSize) * size);
      overviewAccumulated += contigPixelLength;
      const overviewEnd = Math.round((overviewAccumulated / textureSize) * size);
      const overviewLength = overviewEnd - overviewStart;

      const bps = result.breakpoints.get(orderIdx);
      if (!bps || bps.length === 0) continue;

      console.log(`\n  CONTIG: ${contig.name} (orderIdx=${orderIdx}, id=${contigId})`);
      console.log(`    Pixel range: ${contig.pixelStart}-${contig.pixelEnd} (len=${contigPixelLength})`);
      console.log(`    Overview range: ${overviewStart}-${overviewEnd} (len=${overviewLength})`);
      console.log(`    BP length: ${contig.length}`);

      // Compute density for this contig
      const density = computeDiagonalDensity(contactMap, size, overviewStart, overviewEnd, 8);

      // Compute local baseline
      const len = density.length;
      const baselineWindow = 32; // 4 * windowSize
      const localBaseline = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        let sum = 0, count = 0;
        const lo = Math.max(0, i - baselineWindow);
        const hi = Math.min(len, i + baselineWindow + 1);
        for (let j = lo; j < hi; j++) {
          if (density[j] > 0) { sum += density[j]; count++; }
        }
        localBaseline[i] = count > 0 ? sum / count : 0;
      }

      // Print density stats
      const densityArr = Array.from(density);
      const nonZero = densityArr.filter(v => v > 0);
      const minDensity = Math.min(...nonZero.length ? nonZero : [0]);
      const maxDensity = Math.max(...densityArr);
      const meanDensity = nonZero.length > 0 ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
      console.log(`    Density: min=${minDensity.toFixed(4)}, max=${maxDensity.toFixed(4)}, mean=${meanDensity.toFixed(4)}, zeros=${densityArr.length - nonZero.length}/${densityArr.length}`);

      for (const bp of bps) {
        // Map texture offset back to overview position for analysis
        const scale = overviewLength / contigPixelLength;
        const approxOverviewPos = Math.round(bp.offset * scale);

        console.log(`\n    BREAKPOINT: textureOffset=${bp.offset}, confidence=${bp.confidence.toFixed(4)}`);
        console.log(`      Approx overview pos: ${approxOverviewPos} (of ${overviewLength})`);

        // Print density profile around the breakpoint
        const windowRadius = 15;
        const lo = Math.max(0, approxOverviewPos - windowRadius);
        const hi = Math.min(len, approxOverviewPos + windowRadius + 1);
        console.log(`      Density profile [${lo}..${hi}):`);
        let profileLine = '        ';
        for (let i = lo; i < hi; i++) {
          const drop = localBaseline[i] > 0 ? (localBaseline[i] - density[i]) / localBaseline[i] : 0;
          const marker = i === approxOverviewPos ? '*' : ' ';
          profileLine += `${marker}${density[i].toFixed(3)}(${(drop * 100).toFixed(0)}%)`;
          if (i < hi - 1) profileLine += ', ';
        }
        console.log(profileLine);

        // Print baseline around the breakpoint
        let baselineLine = '        ';
        for (let i = lo; i < hi; i++) {
          const marker = i === approxOverviewPos ? '*' : ' ';
          baselineLine += `${marker}bl=${localBaseline[i].toFixed(3)}`;
          if (i < hi - 1) baselineLine += ', ';
        }
        console.log(`      Baseline profile:`);
        console.log(baselineLine);

        // Count how many positions have drop > 30% in the region
        let lowCount = 0;
        for (let i = lo; i < hi; i++) {
          const drop = localBaseline[i] > 0 ? (localBaseline[i] - density[i]) / localBaseline[i] : 0;
          if (drop > 0.30) lowCount++;
        }
        console.log(`      Positions with >30% drop in window: ${lowCount}/${hi - lo}`);
      }
    }
  }
}

diagnose().catch(console.error);
