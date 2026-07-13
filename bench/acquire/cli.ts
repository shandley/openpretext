/**
 * CLI for discovering and acquiring GenomeArk .pretext maps by curation stage.
 *
 * Usage:
 *   npx tsx bench/acquire/cli.ts --discover --species-list Phascolarctos_cinereus,Coturnix_chinensis
 *   npx tsx bench/acquire/cli.ts --discover --species Taeniopygia
 *   npx tsx bench/acquire/cli.ts --list
 *   npx tsx bench/acquire/cli.ts --download --species Phascolarctos_cinereus
 *   npx tsx bench/acquire/cli.ts --download --stage curated
 */

import { parseArgs } from 'node:util';
import { discoverSpecimens } from './discover';
import { downloadStages } from './download';
import { loadManifest, STAGE_ORDER } from './manifest';
import type { CurationStage } from './manifest';

async function main() {
  const { values } = parseArgs({
    options: {
      discover: { type: 'boolean', default: false },
      download: { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      species: { type: 'string' },
      'species-list': { type: 'string' },
      stage: { type: 'string' },
      'max-size': { type: 'string', default: '500' },
      'max-specimens': { type: 'string', default: '50' },
      'manifest-path': { type: 'string' },
    },
    strict: true,
  });

  const manifestPath = values['manifest-path'];
  const speciesList = values['species-list']?.split(',').map(s => s.trim()).filter(Boolean);

  if (values.discover) {
    await discoverSpecimens({
      speciesList,
      speciesFilter: values.species,
      maxSpecimens: parseInt(values['max-specimens']!, 10),
      maxSizeMB: parseInt(values['max-size']!, 10),
      manifestPath,
    });
    return;
  }

  if (values.download) {
    const manifest = await loadManifest(manifestPath);
    if (manifest.assemblies.length === 0) {
      console.error('No assemblies in manifest. Run --discover first.');
      process.exit(1);
    }
    await downloadStages(manifest, {
      speciesFilter: values.species,
      stage: values.stage as CurationStage | undefined,
      manifestPath,
    });
    return;
  }

  if (values.list) {
    const manifest = await loadManifest(manifestPath);
    if (manifest.assemblies.length === 0) {
      console.log('Manifest is empty. Run --discover first.');
      return;
    }
    console.log(`Manifest (${manifest.updatedAt}) — ${manifest.assemblies.length} assemblies\n`);
    for (const a of manifest.assemblies) {
      console.log(`${a.species} / ${a.tolid}${a.pairable ? '  [pairable]' : ''}`);
      for (const s of [...a.stages].sort((x, y) => STAGE_ORDER[x.stage] - STAGE_ORDER[y.stage])) {
        const mb = (s.size / 1e6).toFixed(0).padStart(4);
        const meta = [s.haplotype, s.tag, s.date].filter(Boolean).join(' · ');
        console.log(`    ${s.stage.padEnd(13)} ${mb} MB  ${meta}`);
        console.log(`      ${s.key}`);
      }
      console.log('');
    }
    return;
  }

  console.log('Usage:');
  console.log('  --discover --species-list A,B,C   Discover stages for specific species');
  console.log('  --discover --species <substr>     Discover by species-name substring');
  console.log('  --list                            Show the manifest with keys + stages');
  console.log('  --download [--species S] [--stage curated|intermediate|evaluation]');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
