#!/usr/bin/env node
// agentbase — install the knowledge-base skill, and inject its assets into a project.
//
// Two verbs, on purpose. `When` conditions in a manifest are free prose ("target project sets
// requires-python >= 3.12"), so no CLI can decide them — the skill judges, this plumbs. The one
// thing curl cannot do is tell you whether a file on disk is still what this repo shipped, or
// whether you edited it. That is what .agent-base/manifest.json is for.
//
//   agentbase install [--project]        copy the bundled skill, no network
//   agentbase uninstall [--project]      remove it again
//   agentbase apply <hub> [--asset …]    no --asset: print the plan. with: inject.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, parseManifest, isEmptyHub } from './manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = '.agent-base';
const STATE_FILE = 'state.json';
const SKILL_DIR = join(ROOT, 'skills', 'knowledge-base');

// ── config ──────────────────────────────────────────────────────────────────────────────────

/** Base URL from package.json, not from a regex over SKILL.md prose. */
function rawBase() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const url = pkg.repository?.url;
  if (!url) throw new Error('package.json has no repository.url — cannot resolve the asset host');
  const slug = url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/^github\.com\//, '');
  return `https://raw.githubusercontent.com/${slug}/main`;
}

const RAW = rawBase();

// ── state ───────────────────────────────────────────────────────────────────────────────────
// One sha256 per injected file, and nothing else. `main` is a moving ref, so any "changed
// since install" test would be re-derived on every run and stored dates would never be read.
// Commit this and you get a merge conflict on every apply from a second machine; recovery is
// "delete the target file, apply again".

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
// core.autocrlf rewrites LF→CRLF on checkout, so an unnormalized hash makes every file on
// Windows look permanently edited. Normalize both sides.
const normalize = (text) => text.replace(/\r\n/g, '\n');
const hashFile = (text) => sha256(normalize(text));

const statePath = (cwd) => join(cwd, STATE_DIR, STATE_FILE);

function readState(cwd) {
  try {
    return JSON.parse(readFileSync(statePath(cwd), 'utf8')).assets ?? {};
  } catch {
    return {};
  }
}

function writeState(cwd, assets) {
  mkdirSync(join(cwd, STATE_DIR), { recursive: true });
  writeFileSync(statePath(cwd), JSON.stringify({ assets }, null, 2) + '\n');
}

// ── remote ──────────────────────────────────────────────────────────────────────────────────

async function fetchText(path) {
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) throw new Error(`${res.status} fetching ${path}`);
  return res.text();
}

// ── install / uninstall ──────────────────────────────────────────────────────────────────────

/** A directory, not a flat file: Claude Code discovers <name>/SKILL.md. */
function skillDir(project) {
  const base = project ? join(process.cwd(), '.claude', 'skills') : join(process.env.HOME ?? '', '.claude', 'skills');
  return join(base, 'knowledge-base');
}

function install(args) {
  const project = args.includes('--project');
  const target = skillDir(project);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'SKILL.md'), readFileSync(join(SKILL_DIR, 'SKILL.md')));

  console.log(`installed knowledge-base skill → ${target}/SKILL.md`);
  if (!project) {
    console.log('  available in every project on this machine.');
    console.log('  use --project to install into the current repo only.');
  }
  console.log(`  skill version ${readSkillVersion()}, assets served from ${RAW}`);
}

function uninstall(args) {
  const project = args.includes('--project');
  const target = skillDir(project);
  if (!existsSync(target)) {
    console.log(`nothing to remove at ${target}`);
    return;
  }
  rmSync(target, { recursive: true });
  console.log(`removed ${target}`);

  // Injected assets are the user's files by now, not ours — deleting them is not our call.
  // The state file is left alone on purpose: deleting it would make every injected file look
  // `unmanaged`, so the next apply could no longer tell an edit from an update.
  if (existsSync(statePath(process.cwd()))) {
    console.log(`\n${STATE_DIR}/${STATE_FILE} kept — injected assets under docs/ are still tracked.`);
    console.log('  Delete it by hand if you want a clean slate; you will then have to re-apply.');
  }
}

function readSkillVersion() {
  const fm = parseFrontmatter(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8'));
  return fm?.version ?? 'unknown';
}

// ── apply ───────────────────────────────────────────────────────────────────────────────────
//
// Four states, not three. local == recorded asks "did the user edit this?"; remote ==
// recorded asks "did we change it?". The case where both are false is a merge conflict on
// prose — neither overwriting nor skipping is correct, so we stop and report.

const STATUS = {
  new: { label: 'new', note: 'not on disk yet' },
  uptodate: { label: 'up to date', note: 'local matches this repo' },
  drifted: { label: 'upstream changed', note: 'your file is untouched — safe to overwrite' },
  modified: { label: 'you edited this', note: 'upstream unchanged — leaving it alone' },
  both: { label: 'both changed', note: 'reconcile by hand; not writing' },
  unmanaged: { label: 'unmanaged', note: 'on disk with no record here — not writing' },
};

async function classify(entry, recorded, cwd) {
  const target = join(cwd, entry['Target Location']);
  if (!existsSync(target)) return 'new';

  const local = hashFile(readFileSync(target, 'utf8'));
  if (!recorded) return 'unmanaged';

  const remote = hashFile(await fetchText(entry.Path));
  if (local === recorded.sha256) return remote === recorded.sha256 ? 'uptodate' : 'drifted';
  return remote === recorded.sha256 ? 'modified' : 'both';
}

async function apply(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const hub = positional[0];
  if (!hub) throw new Error('usage: agentbase apply <hub> [--asset <path>…] [--yes] [--force]');

  const cwd = process.cwd();
  const yes = args.includes('--yes');
  const force = args.includes('--force');
  const wanted = args.flatMap((a, i) => (a === '--asset' ? [args[i + 1]] : [])).filter(Boolean);

  const hubText = await fetchText(`docs/${hub}.md`);
  const entries = parseManifest(hubText);
  if (entries === null) throw new Error(`docs/${hub}.md has no manifest block`);
  if (!entries.length) {
    const fm = parseFrontmatter(hubText);
    console.log(`${hub}: ${isEmptyHub(hubText) ? 'no assets yet' : 'manifest is empty'} — nothing to do`);
    if (fm) console.log(`  last_updated: ${fm.last_updated}`);
    return;
  }

  const state = readState(cwd);
  const selected = wanted.length
    ? entries.filter((e) => wanted.includes(e.Path) || wanted.includes(e['Target Location']))
    : entries;

  if (wanted.length && selected.length !== wanted.length) {
    const miss = wanted.filter((w) => !selected.some((e) => e.Path === w || e['Target Location'] === w));
    throw new Error(`not in docs/${hub}.md: ${miss.join(', ')}`);
  }

  const rows = [];
  for (const entry of selected) {
    rows.push({ entry, status: await classify(entry, state[entry['Target Location']], cwd) });
  }

  // Plan. Why/When are printed verbatim — deciding them is the skill's job, not this one's.
  const fm = parseFrontmatter(hubText);
  console.log(`${hub} — ${rows.length} candidate(s)${fm ? `, hub last_updated ${fm.last_updated}` : ''}\n`);
  for (const { entry, status } of rows) {
    console.log(`${STATUS[status].label}  ${entry['Target Location']}`);
    console.log(`  from     ${entry.Path}`);
    console.log(`  why      ${entry.Why}`);
    console.log(`  when     ${entry.When}`);
    console.log(`  status   ${STATUS[status].note}\n`);
  }

  if (!wanted.length) {
    console.log('plan only — nothing written. Re-run with --asset <path> to inject, after the');
    console.log('When conditions above have been judged against the target project.');
    return;
  }

  const blocking = rows.filter(({ status }) => status === 'both' || (status === 'unmanaged' && !force));
  if (blocking.length) {
    console.error('refusing to write:');
    for (const { entry, status } of blocking) {
      console.error(`  ${entry['Target Location']} — ${STATUS[status].note}`);
    }
    if (blocking.some(({ status }) => status === 'unmanaged')) {
      console.error('\n  --force adopts files this tool did not write. It does not merge them.');
    } else {
      console.error('\n  "both changed" is a merge conflict on prose: reconcile, then re-run.');
    }
    console.error('\nnothing was written.');
    process.exitCode = 1;
    return;
  }

  // Check every overwrite up front. Asking mid-loop meant a run could write two files and then
  // bail on the third, leaving the first two on disk with no state record — a partial apply the
  // user could not see the shape of.
  const overwrites = rows.filter(({ status }) => status !== 'new' && status !== 'uptodate' && status !== 'modified');
  if (overwrites.length && !yes) {
    console.error('refusing to overwrite without --yes:');
    for (const { entry, status } of overwrites) {
      console.error(`  ${entry['Target Location']} — ${STATUS[status].note}`);
    }
    console.error('\nnothing was written. Re-run with --yes to replace the ones above.');
    process.exitCode = 1;
    return;
  }

  let wrote = 0;
  let skipped = 0;
  for (const { entry, status } of rows) {
    if (status === 'uptodate' || status === 'modified') {
      skipped++;
      continue;
    }
    const target = join(cwd, entry['Target Location']);
    const body = await fetchText(entry.Path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    state[entry['Target Location']] = { source: entry.Path, sha256: hashFile(body) };
    wrote++;
    console.log(`wrote ${entry['Target Location']}  (${status === 'new' ? 'new' : 'updated'})`);
  }

  if (wrote) writeState(cwd, state);
  console.log(`\n${wrote} written, ${skipped} left alone. State in ${STATE_DIR}/${STATE_FILE} — do not commit it.`);
}

// ── argv ────────────────────────────────────────────────────────────────────────────────────

const USAGE = `agentbase — install and apply the knowledge-base asset library

  agentbase install [--project]        copy the bundled skill (no network)
  agentbase uninstall [--project]      remove it again
  agentbase apply <hub>                print the plan for a hub: candidates + status
  agentbase apply <hub> --asset <p>    inject; repeat --asset for more. --yes to overwrite,
                                       --force to adopt files this tool did not write

Assets are served from ${RAW}
`;

const [verb, ...rest] = process.argv.slice(2);
try {
  if (verb === 'install') install(rest);
  else if (verb === 'uninstall') uninstall(rest);
  else if (verb === 'apply') await apply(rest);
  else if (!verb || verb === '--help' || verb === '-h') console.log(USAGE);
  else {
    console.error(`unknown command: ${verb}\n`);
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}
