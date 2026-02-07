/**
 * CLI for acquiring benchmark data from GenomeArk S3.
 *
 * Usage:
 *   npx tsx bench/acquire/cli.ts --discover
 *   npx tsx bench/acquire/cli.ts --download
 *   npx tsx bench/acquire/cli.ts --species Homo_sapiens --max-size 200
 *   npx tsx bench/acquire/cli.ts --list
 */

import { parseArgs } from 'node:util';
import { discoverSpecimens } from './discover';
import { downloadSpecimens } from './download';
import { loadManifest } from './manifest';

async function main() {
  const { values } = parseArgs({
    options: {
      discover: { type: 'boolean', default: false },
      download: { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      species: { type: 'string' },
      'max-size': { type: 'string', default: '500' },
      'max-specimens': { type: 'string', default: '50' },
      'manifest-path': { type: 'string' },
    },
    strict: true,
  });

  const manifestPath = values['manifest-path'];

  if (values.discover) {
    await discoverSpecimens({
      maxSpecimens: parseInt(values['max-specimens']!, 10),
      speciesFilter: values.species,
      maxSizeMB: parseInt(values['max-size']!, 10),
      manifestPath,
    });
    return;
  }

  if (values.download) {
    const manifest = await loadManifest(manifestPath);
    if (manifest.specimens.length === 0) {
      console.error('No specimens in manifest. Run --discover first.');
      process.exit(1);
    }
    await downloadSpecimens(manifest, {
      speciesFilter: values.species,
      manifestPath,
    });
    return;
  }

  if (values.list) {
    const manifest = await loadManifest(manifestPath);
    if (manifest.specimens.length === 0) {
      console.log('Manifest is empty. Run --discover first.');
      return;
    }

    console.log(`Manifest (${manifest.updatedAt}):`);
    console.log(`${'Species'.padEnd(30)} ${'Pre (MB)'.padEnd(10)} ${'Post (MB)'.padEnd(10)} Downloaded`);
    console.log('-'.repeat(65));

    for (const s of manifest.specimens) {
      const preMB = s.preCurationSize ? (s.preCurationSize / 1e6).toFixed(0) : '?';
      const postMB = s.postCurationSize ? (s.postCurationSize / 1e6).toFixed(0) : '?';
      console.log(
        `${s.species.padEnd(30)} ${preMB.padEnd(10)} ${postMB.padEnd(10)} ${s.downloaded ? 'yes' : 'no'}`,
      );
    }
    return;
  }

  console.log('Usage:');
  console.log('  npx tsx bench/acquire/cli.ts --discover          Build manifest from S3');
  console.log('  npx tsx bench/acquire/cli.ts --download           Download all specimens');
  console.log('  npx tsx bench/acquire/cli.ts --list               Show manifest');
  console.log('  npx tsx bench/acquire/cli.ts --species <name>     Filter by species');
  console.log('  npx tsx bench/acquire/cli.ts --max-size <MB>      Max file size (default 500)');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
