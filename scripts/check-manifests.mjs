#!/usr/bin/env node
// Integrity check for the manifest hubs. Run after Phase 3 writes a manifest entry.
//
// A manifest entry is a promise that the path exists on `main`. An entry pointing at a
// missing file is a 404 in every consumer's project, silently, forever — this is the one
// failure worth a hard failure.
//
//   node scripts/check-manifests.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, parseManifest, isEmptyHub } from '../lib/manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_HUB_FIELDS = ['language', 'tag', 'ecosystem', 'last_updated', 'summary'];
const REQUIRED_ENTRY_FIELDS = ['Path', 'Why', 'When', 'Target Location'];

const errors = [];
const warnings = [];
let nonEmptyHubs = 0;

for (const file of readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md'))) {
  const text = readFileSync(join(ROOT, 'docs', file), 'utf8');
  const where = `docs/${file}`;

  const fm = parseFrontmatter(text);
  if (!fm) {
    errors.push(`${where}: no frontmatter`);
  } else {
    for (const key of REQUIRED_HUB_FIELDS) {
      if (!fm[key]) errors.push(`${where}: frontmatter missing "${key}"`);
    }
  }

  const entries = parseManifest(text);
  if (entries === null) {
    errors.push(`${where}: no ASSET_MANIFEST_START/END block`);
    continue;
  }
  if (entries.length) nonEmptyHubs++;
  else if (!isEmptyHub(text)) {
    errors.push(`${where}: manifest block is empty but has no "_Empty —" sentinel`);
  }

  for (const entry of entries) {
    const label = `${where} → ${entry.Path ?? '???'}`;

    for (const key of REQUIRED_ENTRY_FIELDS) {
      if (!entry[key]) errors.push(`${label}: missing "${key}"`);
    }
    // The killer check: the manifest promises a path that must exist on main.
    if (entry.Path && !existsSync(join(ROOT, entry.Path))) {
      errors.push(`${label}: Path does not exist in this repo (404 for every consumer)`);
    }
    if (entry['Target Location'] && !entry['Target Location'].startsWith('docs/')) {
      errors.push(`${label}: Target Location is outside docs/ — the only namespace`);
    }
    // Not a failure: renaming on the way in is legal, but it severs the trace from a
    // consumer's copy back to its source.
    const base = (p) => p.split('/').pop();
    if (entry.Path && entry['Target Location'] && base(entry.Path) !== base(entry['Target Location'])) {
      warnings.push(`${label}: renamed to ${entry['Target Location']} on the way in`);
    }
  }
}

if (!nonEmptyHubs) errors.push('no hub routes any asset — the library is empty');

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`FAIL  ${e}`);

if (errors.length) {
  console.error(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`ok  ${nonEmptyHubs} hub(s) route assets, ${warnings.length} warning(s)`);
