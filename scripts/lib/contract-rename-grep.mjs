/**
 * The string half of a contract rename: what the compilers cannot see.
 *
 * Error copy, JSON expectations, YAML fixtures, RPC paths in waivers and
 * conformance tags, doc slugs and `vi.mock` paths quote contract names as
 * text, and no compiler flags them. Two readings close that gap:
 *
 * - the residue: every line in the tree matching the rename's old tokens,
 *   minus an allow list of the literals that must stay (engine keys, frozen
 *   migration inputs, a retired-names table). A rename is done when the
 *   residue is empty. The allow list is `<path glob><TAB><line regex>` per
 *   line, so each kept literal is named where it lives, not waved through by
 *   file.
 * - the census: the count of each engine literal per file, at the base and in
 *   the tree. A rename must leave every engine literal exactly where it was,
 *   so any difference is reported.
 *
 * Both read through `git grep`, so ignored and generated output never counts
 * unless tracked, and a ref is read without checking it out.
 */

import { execFileSync } from "node:child_process";

/** `git grep -n -I -P` hits as `{ file, line, text }`, at a ref or in the tree. */
export function gitGrep({ cwd, pattern, ref, pathspecs = [] }) {
  const args = ["grep", "-n", "-I", "-P", "-e", pattern];
  if (ref) args.push(ref);
  args.push("--", ...(pathspecs.length > 0 ? pathspecs : ["."]));
  let out;
  try {
    out = execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  } catch (err) {
    if (err.status === 1) return [];
    throw err;
  }
  const hits = [];
  for (const raw of out.split("\n")) {
    if (!raw) continue;
    const body = ref && raw.startsWith(`${ref}:`) ? raw.slice(ref.length + 1) : raw;
    const m = /^(.*?):(\d+):(.*)$/.exec(body);
    if (m) hits.push({ file: m[1], line: Number(m[2]), text: m[3] });
  }
  return hits;
}

/** A glob (`*` within a segment, `**` across) as a whole-path regex. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/** Parse an allow list: `<path glob>\t<line regex>` per line; `#` comments and blanks skipped. */
export function parseAllowList(text) {
  const rules = [];
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) throw new Error(`allow list line ${i + 1}: expected <path glob><TAB><line regex>`);
    rules.push({ path: globToRegExp(line.slice(0, tab)), line: new RegExp(line.slice(tab + 1)), source: line });
  }
  return rules;
}

/** Split hits into what the allow list keeps and the residue, and name rules nothing matched. */
export function classifyResidue(hits, rules) {
  const used = new Set();
  const kept = [];
  const residue = [];
  for (const hit of hits) {
    const rule = rules.find((r) => r.path.test(hit.file) && r.line.test(hit.text));
    if (rule) {
      used.add(rule);
      kept.push(hit);
    } else {
      residue.push(hit);
    }
  }
  return { kept, residue, unused: rules.filter((r) => !used.has(r)).map((r) => r.source) };
}

/** Count hits per file. */
export function countByFile(hits) {
  const counts = new Map();
  for (const h of hits) counts.set(h.file, (counts.get(h.file) ?? 0) + 1);
  return counts;
}

/**
 * Compare per-file counts at the base and the head. `renames` maps a base
 * path to its head path (from `git diff -M --name-status`), so a moved file
 * keeps its literals without counting as a difference.
 */
export function compareCensus(baseCounts, headCounts, renames = {}) {
  const moved = new Map();
  for (const [file, n] of baseCounts) {
    const to = renames[file] ?? file;
    moved.set(to, (moved.get(to) ?? 0) + n);
  }
  const differences = [];
  for (const file of new Set([...moved.keys(), ...headCounts.keys()])) {
    const before = moved.get(file) ?? 0;
    const after = headCounts.get(file) ?? 0;
    if (before !== after) differences.push({ file, before, after });
  }
  return differences.sort((a, b) => a.file.localeCompare(b.file));
}

/** The base-to-head path renames git sees between a ref and the tree. */
export function gitRenames({ cwd, ref }) {
  const out = execFileSync("git", ["diff", "-M", "--name-status", ref], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const renames = {};
  for (const line of out.split("\n")) {
    const parts = line.split("\t");
    if (parts[0]?.startsWith("R") && parts.length === 3) renames[parts[1]] = parts[2];
  }
  return renames;
}
