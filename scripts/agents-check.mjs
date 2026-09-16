#!/usr/bin/env node

/**
 * Gate for the repo-owned agent guidance: root `AGENTS.md`, the nested
 * `<package>/AGENTS.md` guides, and `.agents/**` (README, principles, skills).
 *
 * Three invariants, all static and dependency-free so the gate is cheap,
 * offline and deterministic in CI and in a fresh worktree:
 *
 *   1. Every nested guide has a Cursor shim, and the shim is current. Cursor
 *      (measured on 3.20.17) does not attach a nested `AGENTS.md` when files
 *      in its directory are touched, but it does attach a `.cursor/rules/*.mdc`
 *      whose `globs:` match — and an `@<path>` line in that rule's body makes
 *      Cursor attach the referenced file alongside it. So the authored guide
 *      lives in the package (the cross-tool location Codex and Claude Code read
 *      natively) and `--sync` writes a four-line generated shim per guide into
 *      `.cursor/rules/agents-<slug>.mdc`. Shims are generated artifacts,
 *      committed like the stubs and generated docs, and this check fails on
 *      drift or on an orphan whose guide is gone. Never edit a shim by hand.
 *
 *   2. Every path a guidance file cites resolves. A guide is an index over the
 *      code — it points at files rather than restating them — and a pointer to
 *      a moved file is worse than none. Inline code spans and Markdown link
 *      targets that contain a `/` must exist, relative to the citing file or
 *      to the repository root (a `:line` suffix is allowed). Fenced code blocks
 *      are skipped: they show commands and examples, not citations. Bare file
 *      names, URLs, `@scope/package` names, `~` and absolute paths, globs and
 *      `<placeholders>` are not citations.
 *
 *   3. No private-record identifiers. This repository is public; its guidance
 *      must read as if the current design always existed and must cite nothing
 *      a reader of the public repo cannot open. Planning-record paths, task
 *      file names, and ruling or finding identifiers fail the gate.
 *      `--private-repo` relaxes only the record-path pattern for a repository
 *      that legitimately holds its own planning records.
 *
 * Usage:
 *   node scripts/agents-check.mjs            check (exit 1 on any finding)
 *   node scripts/agents-check.mjs --sync     write shims, remove orphans, then check
 *   node scripts/agents-check.mjs --list     print the guidance files, one per line
 *   node scripts/agents-check.mjs --private-repo [...]
 *
 * Wired as `make agents-sync` / `make agents-check` (check-prep runs both) and
 * as a step of ci.docs.yaml. Tests: scripts/agents-check.test.mjs.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_REL = "scripts/agents-check.mjs";
const SHIM_DIR = ".cursor/rules";
const SHIM_PREFIX = "agents-";
const GENERATED_MARKER = `Generated from`;

/** Directories never descended into: build output, vendored trees, and every dot-directory (which keeps a vendored skill bundle's own AGENTS.md from becoming a guide). */
const SKIPPED_DIR_NAMES = new Set(["node_modules", "dist", "out", "target", "build", "__pycache__", "coverage"]);

/**
 * Prefixes that mark an inline span as a URL, a mention, a package name, a
 * shell variable, a home path or an absolute machine path, not a repository
 * path. A span also needs a `/` to count as a citation: a bare `SKILL.md` in
 * prose is a mention of a file kind, not a pointer to one file.
 */
const NON_PATH_PREFIXES = ["http://", "https://", "mailto:", "#", "@", "~", "$", "-", "<", "/"];

/**
 * Private-record identifier patterns. The first is the planning-record tree; the
 * rest are the record-internal ids (task files `T01_`, rulings `Q-S5-2`,
 * findings `F-M2-23`) that only a holder of the records can resolve.
 */
const LEAK_PATTERNS = [
  { name: "planning-record path", re: /_projects\//, privateOk: true },
  { name: "task file id", re: /\bT0[0-9]_[0-9]/, privateOk: false },
  { name: "ruling id", re: /\bQ-[A-Z][A-Z0-9]*-[0-9]+\b/, privateOk: false },
  { name: "finding id", re: /\bF-[A-Z][A-Z0-9]*-[0-9]+\b/, privateOk: false },
];

/** Walk `root` and return repo-relative POSIX paths of every file `keep` accepts, skipping build output and dot-directories. */
function walk(root, keep, dir = root, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || SKIPPED_DIR_NAMES.has(entry.name)) continue;
      walk(root, keep, abs, acc);
    } else if (entry.isFile() && keep(entry.name, abs)) {
      acc.push(toPosix(relative(root, abs)));
    }
  }
  return acc;
}

function toPosix(p) {
  return p.split(sep).join(posix.sep);
}

/** Nested guides: every `AGENTS.md` below the root, outside dot-directories and build output. The root file is guidance but not a nested guide. */
export function discoverNestedGuides(root) {
  return walk(root, (name) => name === "AGENTS.md")
    .filter((p) => p !== "AGENTS.md")
    .sort();
}

/** Every Markdown file under `.agents/` (README, principles, SKILL.md bodies, references). Scripts and assets inside a skill are not prose and are not checked. */
export function discoverAgentsFolderDocs(root) {
  const agentsDir = join(root, ".agents");
  if (!existsSync(agentsDir)) return [];
  return walk(root, (name) => name.endsWith(".md"), agentsDir).sort();
}

/** The full set of guidance files the citation and leakage checks read. */
export function collectGuidanceFiles(root) {
  const files = [];
  if (existsSync(join(root, "AGENTS.md"))) files.push("AGENTS.md");
  return [...files, ...discoverNestedGuides(root), ...discoverAgentsFolderDocs(root)];
}

/** `backend/services/runner/AGENTS.md` -> `.cursor/rules/agents-backend-services-runner.mdc`. */
export function shimPathFor(guideRelPath) {
  const dir = posix.dirname(guideRelPath);
  return posix.join(SHIM_DIR, `${SHIM_PREFIX}${dir.replaceAll("/", "-")}.mdc`);
}

/** The exact bytes of a shim. Byte-stable on purpose: `--check` compares literally. */
export function renderShim(guideRelPath) {
  const dir = posix.dirname(guideRelPath);
  return [
    "---",
    `description: Package guide for ${dir}, attached when files there are touched. ${GENERATED_MARKER} ${guideRelPath} by ${SCRIPT_REL} --sync; do not edit.`,
    `globs: ${dir}/**`,
    "alwaysApply: false",
    "---",
    "",
    `Read and follow the package guide before working under \`${dir}/\`:`,
    "",
    `@${guideRelPath}`,
    "",
  ].join("\n");
}

/** Shims this script owns: files under `.cursor/rules/` with the prefix AND the generated marker, so a hand-written rule that happens to share the prefix is never touched. */
function ownedShims(root) {
  const dir = join(root, SHIM_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(SHIM_PREFIX) && name.endsWith(".mdc"))
    .map((name) => posix.join(SHIM_DIR, name))
    .filter((rel) => readFileSync(join(root, rel), "utf8").includes(`${GENERATED_MARKER} `))
    .sort();
}

/**
 * Compare (and with `write`, reconcile) the shims against the nested guides.
 * Returns the findings a check would report and the actions a sync took.
 */
export function syncShims(root, { write }) {
  const guides = discoverNestedGuides(root);
  const expected = new Map(guides.map((g) => [shimPathFor(g), renderShim(g)]));
  const findings = [];
  const written = [];
  const removed = [];

  for (const [shimRel, content] of expected) {
    const abs = join(root, shimRel);
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (current === content) continue;
    if (write) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      written.push(shimRel);
    } else {
      findings.push(`${shimRel}: ${current === null ? "missing" : "out of date"}; run \`make agents-sync\``);
    }
  }

  for (const shimRel of ownedShims(root)) {
    if (expected.has(shimRel)) continue;
    if (write) {
      unlinkSync(join(root, shimRel));
      removed.push(shimRel);
    } else {
      findings.push(`${shimRel}: orphan shim, its guide is gone; run \`make agents-sync\``);
    }
  }

  return { findings, written, removed };
}

/** Remove fenced code blocks so their contents are neither cited nor scanned as prose. Line numbers are preserved by keeping the newlines. */
export function stripFences(markdown) {
  return markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) => block.replace(/[^\n]/g, ""));
}

/** Decide whether an inline span or link target is a repository path citation, and normalise it (strip `:line`, trailing slash and punctuation). */
export function asPathCitation(raw) {
  let s = raw.trim();
  if (!s || /\s/.test(s)) return null;
  if (NON_PATH_PREFIXES.some((p) => s.startsWith(p))) return null;
  if (/[*?{}<>|]/.test(s) || !s.includes("/")) return null;
  s = s.replace(/:\d+(:\d+)?$/, "").replace(/[.,;:)]+$/, "");
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s || null;
}

/** Every path citation in a Markdown text with its 1-based line: inline code spans and link targets outside fenced blocks. */
export function extractCitedPaths(markdown) {
  const cited = [];
  const lines = stripFences(markdown).split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const p = asPathCitation(m[1]);
      if (p) cited.push({ path: p, line: i + 1 });
    }
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const p = asPathCitation(m[1]);
      if (p) cited.push({ path: p, line: i + 1 });
    }
  });
  return cited;
}

/** A citation resolves if it exists relative to the citing file's directory or to the repository root. */
export function checkCitations(root, files) {
  const findings = [];
  for (const rel of files) {
    const abs = join(root, rel);
    const text = readFileSync(abs, "utf8");
    for (const { path: p, line } of extractCitedPaths(text)) {
      const candidates = [resolve(dirname(abs), p), resolve(root, p)];
      if (candidates.some((c) => existsSync(c) && (statSync(c).isFile() || statSync(c).isDirectory()))) continue;
      findings.push(`${rel}:${line}: cited path does not exist: ${p}`);
    }
  }
  return findings;
}

/** Scan guidance prose for private-record identifiers. Fenced blocks are included: an id inside an example is still an id a public reader cannot follow. */
export function checkLeakage(root, files, { privateRepo }) {
  const findings = [];
  const patterns = LEAK_PATTERNS.filter((p) => !(privateRepo && p.privateOk));
  for (const rel of files) {
    const lines = readFileSync(join(root, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { name, re } of patterns) {
        const m = line.match(re);
        if (m) findings.push(`${rel}:${i + 1}: ${name} in public guidance: ${m[0]}`);
      }
    });
  }
  return findings;
}

/** Run everything against `root`; returns findings (empty means green) and, for `--sync`, what changed. */
export function runGate(root, { sync = false, privateRepo = false } = {}) {
  const shims = syncShims(root, { write: sync });
  const files = collectGuidanceFiles(root);
  const findings = [...shims.findings, ...checkCitations(root, files), ...checkLeakage(root, files, { privateRepo })];
  return { findings, written: shims.written, removed: shims.removed, files };
}

function main(argv) {
  const args = new Set(argv);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const privateRepo = args.has("--private-repo");

  if (args.has("--list")) {
    for (const f of collectGuidanceFiles(root)) console.log(f);
    return 0;
  }

  const sync = args.has("--sync");
  const { findings, written, removed, files } = runGate(root, { sync, privateRepo });
  for (const w of written) console.log(`wrote   ${w}`);
  for (const r of removed) console.log(`removed ${r}`);
  if (findings.length > 0) {
    for (const f of findings) console.error(f);
    console.error(`agents-check: ${findings.length} finding(s) across ${files.length} guidance file(s)`);
    return 1;
  }
  console.log(`agents-check: ${files.length} guidance file(s), ${discoverNestedGuides(root).length} shim(s) in sync, no findings`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
