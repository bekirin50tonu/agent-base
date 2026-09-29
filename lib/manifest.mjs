// Manifest parsing. Shared by the CLI and scripts/check-manifests.mjs so the two can never
// disagree about what a hub says — the self-check validates exactly what `apply` reads.
//
// Manifest format (see docs/<tech>.md). Between the two markers, four fixed sections; each
// entry carries exactly four fields:
//
//   - **Path**: `rules/python/foo.md`
//     - **Why**: free prose, wrapped across lines
//     - **When**: free prose, wrapped across lines
//     - **Target Location**: `docs/rules/foo.md`
//
// Empty sections are an italic `_Empty — …_` sentence, not a structure.

const unquote = (s) => s.trim().replace(/^`|`$/g, '');

/** Frontmatter is a `---` block at the top of the file. */
export function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*"?([^"]*)"?$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

/** Manifest entries of a hub, in document order. `null` if the hub has no manifest block. */
export function parseManifest(text) {
  const block = text.match(
    /<!-- ASSET_MANIFEST_START -->([\s\S]*?)<!-- ASSET_MANIFEST_END -->/,
  );
  if (!block) return null;

  const entries = [];
  let cur = null;
  let key = null;

  for (const raw of block[1].split('\n')) {
    const top = raw.match(/^- \*\*(\w[\w ]*)\*\*:\s*`([^`]+)`\s*$/);
    if (top) {
      cur = { Path: top[2] };
      entries.push(cur);
      key = null;
      continue;
    }
    const sub = raw.match(/^ {2}- \*\*(\w[\w ]*)\*\*:\s*(.*)$/);
    if (sub && cur) {
      key = sub[1];
      cur[key] = unquote(sub[2]);
      continue;
    }
    if (key && /^\s{4}\S/.test(raw)) {
      // Wrapped prose belongs to the field above it. Only Why/When wrap; Path and Target
      // Location sit on one line.
      cur[key] = (cur[key] + ' ' + raw.trim()).trim();
    }
  }
  return entries;
}

/** The `_Empty — …` sentinel marks a hub or section that routes nothing. */
export const isEmptyHub = (text) => /_Empty\b/.test(text);
