/**
 * The docs snippet gate's list of known failures, which may only shrink.
 *
 * `test/docs-snippets-known-failing.json` names the fences allowed to fail
 * today: each entry is a page, a language, the first 12 hex digits of the
 * SHA-256 of the fence's text, and how many identical fences on that page
 * fail. It is a multiset, so two identical failing fences on one page are
 * two failures, never one. The fence's text is the key, so a fence that
 * changes, by hand or by its generator, leaves the list and must compile:
 * an edit cannot carry a failure forward.
 *
 * The gate refuses a failing fence the list does not hold, and a listed one
 * that now compiles or is gone (`--prune` rewrites the list without those,
 * and never adds). Against the base branch's list it refuses any entry, or
 * any count, the base does not hold; a list absent on the base is the
 * bootstrap. Everything here is pure: the CLI reads the files.
 */

import { createHash } from "node:crypto";

/** Where the list lives, from the repository root. */
export const KNOWN_FAILING_FILE = "test/docs-snippets-known-failing.json";

/** What the list file says about itself, for a reader who opens it. */
const ABOUT =
  "Docs code fences allowed to fail the snippet gate (make check-docs-snippets), keyed by page, language and the SHA-256 of the fence's text. It may only shrink: fix a fence and run the gate with --prune; never add an entry (test/README.md, rule 5).";

/** The 12-hex digest of a fence's text, its identity on the list. */
export function fenceDigest(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** One entry's key in a multiset. */
export function entryKey({ page, language, sha }) {
  return `${page}\u0000${language}\u0000${sha}`;
}

function parseKey(key) {
  const [page, language, sha] = key.split("\u0000");
  return { page, language, sha };
}

/**
 * The failing fences as a multiset: key to how many identical fences fail.
 * @param {{id: number, page: string, language: string, text: string}[]} units
 * @param {Set<number>} failingIds
 * @returns {Map<string, number>}
 */
export function failingMultiset(units, failingIds) {
  const counts = new Map();
  for (const u of units) {
    if (!failingIds.has(u.id)) continue;
    const key = entryKey({ page: u.page, language: u.language, sha: fenceDigest(u.text) });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The list file's text as a multiset. Throws on a malformed list, or one
 * whose total disagrees with its entries.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function parseList(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.fences)) throw new Error(`${KNOWN_FAILING_FILE}: "fences" must be an array`);
  const counts = new Map();
  let total = 0;
  for (const entry of data.fences) {
    const { page, language, sha, count } = entry;
    if (typeof page !== "string" || typeof language !== "string" || !/^[0-9a-f]{12}$/.test(sha) || !Number.isInteger(count) || count < 1) {
      throw new Error(`${KNOWN_FAILING_FILE}: malformed entry ${JSON.stringify(entry)}`);
    }
    const key = entryKey(entry);
    if (counts.has(key)) throw new Error(`${KNOWN_FAILING_FILE}: ${page} ${language} ${sha} is listed twice; give it one entry with its count`);
    counts.set(key, count);
    total += count;
  }
  if (data.total !== total) throw new Error(`${KNOWN_FAILING_FILE}: total says ${data.total}, the entries hold ${total}`);
  return counts;
}

/**
 * The list file's text for a multiset: sorted by page, language and digest,
 * the total first, so a change to it reads as lines added and removed.
 * @param {Map<string, number>} counts
 */
export function formatList(counts) {
  const fences = [...counts]
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ ...parseKey(key), count }))
    .sort((a, b) => a.page.localeCompare(b.page) || a.language.localeCompare(b.language) || a.sha.localeCompare(b.sha));
  const total = fences.reduce((sum, f) => sum + f.count, 0);
  const lines = fences.map((f) => `    ${JSON.stringify(f)}`);
  return `{\n  "about": ${JSON.stringify(ABOUT)},\n  "total": ${total},\n  "fences": [\n${lines.join(",\n")}${lines.length > 0 ? "\n" : ""}  ]\n}\n`;
}

/**
 * How the failing fences meet the list: `unlisted` failures the list does
 * not cover (each with how many beyond it), `stale` entries that no longer
 * fail as often as listed (each with how many too many).
 * @param {Map<string, number>} failing
 * @param {Map<string, number>} listed
 */
export function compareToList(failing, listed) {
  const unlisted = [];
  const stale = [];
  for (const [key, count] of failing) {
    const allowed = listed.get(key) ?? 0;
    if (count > allowed) unlisted.push({ ...parseKey(key), extra: count - allowed });
  }
  for (const [key, count] of listed) {
    const fails = failing.get(key) ?? 0;
    if (count > fails) stale.push({ ...parseKey(key), extra: count - fails });
  }
  return { unlisted, stale };
}

/**
 * The entries of `listed` the base's list does not allow: a key it lacks, or
 * a count above its own. A null base (no list there) is the bootstrap and
 * allows everything.
 * @param {Map<string, number>} listed
 * @param {Map<string, number> | null} base
 */
export function growthAgainstBase(listed, base) {
  if (base === null) return [];
  const grown = [];
  for (const [key, count] of listed) {
    const allowed = base.get(key) ?? 0;
    if (count > allowed) grown.push({ ...parseKey(key), extra: count - allowed });
  }
  return grown;
}

/**
 * The list with every entry that no longer fails as often removed or cut
 * down; it never adds an entry or raises a count.
 * @param {Map<string, number>} listed
 * @param {Map<string, number>} failing
 */
export function prune(listed, failing) {
  const kept = new Map();
  for (const [key, count] of listed) {
    const keep = Math.min(count, failing.get(key) ?? 0);
    if (keep > 0) kept.set(key, keep);
  }
  return kept;
}

/**
 * The part of a multiset the gate checked this run: the pages and
 * languages it read, so a `--page` or `--lang` run does not call the rest
 * of the list stale.
 * @param {Map<string, number>} counts
 * @param {Set<string>} pages
 * @param {Set<string>} languages
 */
export function within(counts, pages, languages) {
  const out = new Map();
  for (const [key, count] of counts) {
    const { page, language } = parseKey(key);
    if (pages.has(page) && languages.has(language)) out.set(key, count);
  }
  return out;
}
