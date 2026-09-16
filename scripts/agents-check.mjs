#!/usr/bin/env node

/**
 * Gate for the repo-owned agent guidance: root `AGENTS.md`, the nested
 * `<package>/AGENTS.md` guides, and `.agents/**` (README, principles, skills).
 *
 * Four invariants, all static and dependency-free so the gate is cheap,
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
 *      a reader of the public repo cannot open. Planning-record paths and ids,
 *      task file names, and decision, ruling or finding identifiers fail the
 *      gate. `--private-repo` relaxes only the record-path pattern for a
 *      repository that legitimately holds its own planning records.
 *
 *   4. Guides stay within a word budget. The root guide is injected into every
 *      conversation in the window and a nested guide into every conversation
 *      that touches its package, so every word is paid for repeatedly. A guide
 *      is an index over headers and READMEs, and the budget is what keeps it
 *      one: a guide that needs more room is restating something it should be
 *      pointing at. Words are counted because they are the unit closest to the
 *      cost; line counts change with Prettier's wrapping and say nothing.
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
 * Private-record identifier patterns. The first two locate the planning-record
 * tree (its path, and a record's `YYYYMMDD.NN` folder id); the rest are the
 * record-internal ids (task files `T01_`, decisions `DD-012`, rulings `Q-AB-1`,
 * findings `F-CD-2`) that only a holder of the records can resolve. The shapes
 * are illustrative; none of these examples names a real record.
 */
const LEAK_PATTERNS = [
  { name: "planning-record path", re: /_projects\//, privateOk: true },
  { name: "planning-record id", re: /\b20[0-9]{6}\.[0-9]{2}\b/, privateOk: false },
  { name: "task file id", re: /\bT0[0-9]_[0-9]/, privateOk: false },
  { name: "decision id", re: /\bDD-[0-9]{3}\b/, privateOk: false },
  { name: "ruling id", re: /\bQ-[A-Z][A-Z0-9]*-[0-9]+\b/, privateOk: false },
  { name: "finding id", re: /\bF-[A-Z][A-Z0-9]*-[0-9]+\b/, privateOk: false },
];

/**
 * Word budgets per guide kind. The root is paid in every conversation; a nested
 * guide in every conversation that touches its package. Half the root for a
 * package guide is the ceiling, not the target: the shortest index that still
 * names every header and law wins.
 */
export const WORD_BUDGETS = { root: 1200, nested: 600 };

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

/** Whitespace-separated tokens, code spans and fences included: everything in the file is loaded, so everything counts. */
export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Measure the root guide and every nested guide against `WORD_BUDGETS`.
 * Returns the findings plus a per-file measurement so the summary line can
 * show how much headroom remains. `.agents/**` docs are not guides and carry
 * no budget: they load only when a reader opens them.
 */
export function checkBudgets(root) {
  const guides = [
    ...(existsSync(join(root, "AGENTS.md")) ? [{ rel: "AGENTS.md", kind: "root" }] : []),
    ...discoverNestedGuides(root).map((rel) => ({ rel, kind: "nested" })),
  ];
  const measured = guides.map(({ rel, kind }) => ({
    rel,
    kind,
    words: countWords(readFileSync(join(root, rel), "utf8")),
    budget: WORD_BUDGETS[kind],
  }));
  const findings = measured
    .filter((m) => m.words > m.budget)
    .map((m) => `${m.rel}: ${m.words} words exceeds the ${m.budget}-word budget for a ${m.kind} guide; point at a header or README instead of restating it`);
  return { findings, measured };
}

/** One clause per guide kind for the summary line: `root 1114/1200, nested max 540/600 (docs/AGENTS.md)`. */
function describeBudgets(measured) {
  const parts = [];
  const rootGuide = measured.find((m) => m.kind === "root");
  if (rootGuide) parts.push(`root ${rootGuide.words}/${rootGuide.budget}`);
  const nested = measured.filter((m) => m.kind === "nested");
  if (nested.length > 0) {
    const largest = nested.reduce((a, b) => (b.words > a.words ? b : a));
    parts.push(`nested max ${largest.words}/${largest.budget} (${largest.rel})`);
  }
  return parts.join(", ");
}

/** Run everything against `root`; returns findings (empty means green) and, for `--sync`, what changed. */
export function runGate(root, { sync = false, privateRepo = false } = {}) {
  const shims = syncShims(root, { write: sync });
  const files = collectGuidanceFiles(root);
  const budgets = checkBudgets(root);
  const findings = [
    ...shims.findings,
    ...checkCitations(root, files),
    ...checkLeakage(root, files, { privateRepo }),
    ...budgets.findings,
  ];
  return { findings, written: shims.written, removed: shims.removed, files, measured: budgets.measured };
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
  const { findings, written, removed, files, measured } = runGate(root, { sync, privateRepo });
  for (const w of written) console.log(`wrote   ${w}`);
  for (const r of removed) console.log(`removed ${r}`);
  if (findings.length > 0) {
    for (const f of findings) console.error(f);
    console.error(`agents-check: ${findings.length} finding(s) across ${files.length} guidance file(s)`);
    return 1;
  }
  const budgets = describeBudgets(measured);
  console.log(
    `agents-check: ${files.length} guidance file(s), ${discoverNestedGuides(root).length} shim(s) in sync` +
      (budgets ? `, words ${budgets}` : "") +
      `, no findings`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
