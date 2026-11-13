import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_VERSION } from '../../src/core/Version';

it('APP_VERSION is the version in package.json', () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
  expect(APP_VERSION).toBe(pkg.version);
});
