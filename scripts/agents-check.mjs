#!/usr/bin/env node

/**
 * Gate for the repo-owned agent guidance: root `AGENTS.md`, the nested
 * `<package>/AGENTS.md` guides, and `.agents/**` (README, principles, skills).
 *
 * Six invariants, all static and dependency-free so the gate is cheap,
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
 *      gate. `--private-repo` relaxes the two patterns that locate a record
 *      (its path and its `YYYYMMDD.NN` folder id, which every record path
 *      contains) for a repository that legitimately holds its own planning
 *      records; the record-internal ids stay findings there too, so private
 *      guidance still points at code and durable homes rather than at a
 *      ruling only the record's author can follow.
 *
 *   4. Guides stay within a word budget. The root guide is injected into every
 *      conversation in the window and a nested guide into every conversation
 *      that touches its package, so every word is paid for repeatedly. A guide
 *      is an index over headers and READMEs, and the budget is what keeps it
 *      one: a guide that needs more room is restating something it should be
 *      pointing at. Words are counted because they are the unit closest to the
 *      cost; line counts change with Prettier's wrapping and say nothing.
 *
 *   5. `.cursor/rules/` holds nothing but the generated shims. Authored
 *      doctrine lives in a package guide (binding laws, attached by path) or
 *      a skill (procedures and long form, loaded on demand), where every tool
 *      reads it and this gate checks it. A hand-written rule file is a third
 *      home that only one tool sees, so any file there without the generated
 *      marker is a finding. This keeps the migration from rules to guides and
 *      skills a permanent state rather than a one-time sweep.
 *
 *   6. Every skill under `.agents/skills/<name>/SKILL.md` has well-formed
 *      frontmatter: `name` equal to its folder (lowercase, digits, hyphens),
 *      a `description` within a word budget (it is listed in every
 *      conversation, so it is paid for like the root guide), `paths:` entries
 *      whose fixed prefix resolves (a skill scoped to a moved directory would
 *      never surface again and nobody would notice), and a body under the
 *      length Cursor recommends. The frontmatter is read by a small parser
 *      for the subset of YAML these files use — scalar values, folded plain
 *      scalars, and lists — so the gate stays dependency-free; because that
 *      reader is lenient, a second pass reports what real YAML rejects in an
 *      unquoted value (`: ` and ` #`). Measured on Cursor 3.20.17: a skill
 *      whose frontmatter does not parse is listed by path with no description
 *      and none of its flags honoured, so `paths:` no longer defers it and
 *      `disable-model-invocation` no longer hides it.
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
 * tree (its path, and a record's `YYYYMMDD.NN` folder id) and are the ones a
 * private repository may cite (`privateOk`), because a record path carries its
 * id and the cited-path check then proves the record exists; the rest are the
 * record-internal ids (task files `T01_`, decisions `DD-012`, rulings `Q-AB-1`,
 * findings `F-CD-2`) that only a holder of the records can resolve, and stay
 * findings everywhere. The shapes are illustrative; none of these examples
 * names a real record.
 */
const LEAK_PATTERNS = [
  { name: "planning-record path", re: /_projects\//, privateOk: true },
  { name: "planning-record id", re: /\b20[0-9]{6}\.[0-9]{2}\b/, privateOk: true },
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

/**
 * Skill limits. The description is injected into every conversation in the
 * window at launch (Cursor lists skills by name and description and loads the
 * body on demand), so it is budgeted like always-on text; sixty words is room
 * for what the skill does and when to use it, which is all a trigger needs.
 * The body ceiling is Cursor's own guidance for `SKILL.md`; detail beyond it
 * belongs in a `references/` file the skill points at.
 */
export const SKILL_LIMITS = { descriptionWords: 60, bodyLines: 500, nameLength: 64 };
const SKILLS_DIR = ".agents/skills";
const SKILL_FILE = "SKILL.md";
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

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

/**
 * Every file under `.cursor/rules/` that is not a shim this script owns. The
 * directory is walked, not listed: the old hand-written rules lived in
 * subdirectories (`backend/`, `client-apps/web/`), and a rule filed there
 * would otherwise slip past a flat listing.
 */
export function checkRulesDir(root) {
  const dir = join(root, SHIM_DIR);
  if (!existsSync(dir)) return [];
  const owned = new Set(ownedShims(root));
  return walk(root, () => true, dir)
    .filter((rel) => !owned.has(rel))
    .sort()
    .map((rel) => `${rel}: authored rule in ${SHIM_DIR}/; binding laws belong in the package's AGENTS.md, procedures and long-form doctrine in a skill under ${SKILLS_DIR}/`);
}

/** Skill folders: every direct child of `.agents/skills/` that holds a `SKILL.md`, as repo-relative paths to that file. */
export function discoverSkills(root) {
  const dir = join(root, SKILLS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, SKILL_FILE)))
    .map((e) => posix.join(SKILLS_DIR, e.name, SKILL_FILE))
    .sort();
}

/**
 * Split a Markdown file into its YAML frontmatter and body. Returns `null`
 * when the file does not open with a `---` fence: a skill without frontmatter
 * has no name or description and is reported as such by the caller.
 */
export function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { frontmatter: m[1], body: m[2] } : null;
}

/**
 * Read the YAML subset skill frontmatter uses: `key: scalar`, a scalar that
 * continues on more-indented lines (how Prettier folds a long description),
 * `key:` followed by `- item` lines, and inline `[a, b]` lists. Quotes around
 * a scalar are stripped. Anything else is left as the raw string, which the
 * checks then report in their own terms. Deliberately not a YAML library: the
 * gate has no dependencies, and these files have no reason to use more.
 */
export function parseFrontmatter(yaml) {
  const out = {};
  const lines = yaml.split(/\r?\n/);
  let key = null;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const top = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (top) {
      key = top[1];
      const raw = top[2].trim();
      // An empty value or a block-scalar marker (`>-`, `|`) starts a value the following indented lines complete.
      if (raw === "" || /^[>|][+-]?$/.test(raw)) out[key] = "";
      else if (raw.startsWith("[") && raw.endsWith("]")) out[key] = raw.slice(1, -1).split(",").map(unquote).filter(Boolean);
      else out[key] = unquote(raw);
      continue;
    }
    if (key === null) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item) {
      if (!Array.isArray(out[key])) out[key] = [];
      out[key].push(unquote(item[1]));
    } else if (/^\s+\S/.test(line) && !Array.isArray(out[key])) {
      out[key] = out[key] ? `${out[key]} ${line.trim()}` : line.trim();
    }
  }
  return out;
}

function unquote(s) {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
}

/**
 * Text that YAML does not allow inside an unquoted (plain) scalar: a colon
 * followed by a space reads as a nested mapping, and a space followed by `#`
 * starts a comment. A real YAML parser rejects or truncates the value; the
 * lenient reader above does not, so this scan reports what the reader would
 * otherwise silently accept. Measured on Cursor 3.20.17: a skill whose
 * frontmatter fails to parse is listed by path with no description and none
 * of its flags honoured, which is worse than not being listed at all.
 * Quoted scalars and block scalars (`>-`, `|`) are exempt, as in YAML.
 */
export function plainScalarHazards(yaml) {
  const findings = [];
  let key = null;
  let plain = false;
  for (const [i, line] of yaml.split(/\r?\n/).entries()) {
    const top = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    let value;
    if (top) {
      key = top[1];
      const raw = top[2].trim();
      // An empty value continues as a plain scalar on the next lines; a quote, a bracket or a block marker starts something else.
      plain = raw === "" || !/^["'[>|]/.test(raw);
      value = raw;
    } else if (key !== null && /^\s+\S/.test(line) && !/^\s+-\s/.test(line)) {
      value = line.trim();
    } else {
      continue;
    }
    if (!plain || !value) continue;
    if (/: |:$/.test(value)) findings.push(`line ${i + 1}: \`${key}\` contains ": " (or ends with ":") in an unquoted value; YAML reads it as a nested mapping. Rephrase without the colon or quote the whole value`);
    if (/\s#/.test(value)) findings.push(`line ${i + 1}: \`${key}\` contains " #" in an unquoted value; YAML reads the rest of the line as a comment. Rephrase or quote the whole value`);
  }
  return findings;
}

/** The part of a glob before its first wildcard, as a directory or file the repository must contain. `backend/services/runner/**` -> `backend/services/runner`. */
export function globPrefix(glob) {
  const cut = glob.search(/[*?{[]/);
  const prefix = cut === -1 ? glob : glob.slice(0, cut);
  return prefix.replace(/\/+$/, "");
}

/**
 * Validate one skill's frontmatter and body against `SKILL_LIMITS`. Returns
 * findings, each prefixed with the skill file so a reader can open it.
 */
export function checkSkill(root, rel) {
  const findings = [];
  const say = (msg) => findings.push(`${rel}: ${msg}`);
  const folder = posix.basename(posix.dirname(rel));
  const parts = splitFrontmatter(readFileSync(join(root, rel), "utf8"));
  if (!parts) {
    say("no frontmatter; a skill opens with a `---` block carrying `name` and `description`");
    return findings;
  }
  const fm = parseFrontmatter(parts.frontmatter);
  for (const hazard of plainScalarHazards(parts.frontmatter)) say(`frontmatter ${hazard}`);

  if (typeof fm.name !== "string" || fm.name === "") say("frontmatter has no `name`");
  else if (fm.name !== folder) say(`\`name: ${fm.name}\` does not match its folder \`${folder}\`; Cursor addresses the skill by name and the tree by folder, and the two must agree`);
  else if (!SKILL_NAME_RE.test(fm.name) || fm.name.length > SKILL_LIMITS.nameLength) say(`\`name\` must be lowercase letters, digits and hyphens, at most ${SKILL_LIMITS.nameLength} characters`);

  if (typeof fm.description !== "string" || fm.description.trim() === "") say("frontmatter has no `description`; the description is the trigger Cursor matches a task against");
  else {
    const words = countWords(fm.description);
    if (words > SKILL_LIMITS.descriptionWords) say(`description is ${words} words, over the ${SKILL_LIMITS.descriptionWords}-word budget; it is listed in every conversation, so say what the skill does and when to use it and stop`);
  }

  if (fm.paths !== undefined) {
    const paths = Array.isArray(fm.paths) ? fm.paths : [fm.paths];
    if (paths.length === 0) say("`paths:` is present but empty; drop it or list the globs the skill is scoped to");
    for (const g of paths) {
      const prefix = globPrefix(g);
      if (prefix === "") say(`\`paths\` entry \`${g}\` has no fixed prefix; scope a skill to a directory, not to every file`);
      else if (!existsSync(join(root, prefix))) say(`\`paths\` entry \`${g}\` points at \`${prefix}\`, which does not exist; the skill would never surface`);
    }
  }

  if (fm["disable-model-invocation"] !== undefined && fm["disable-model-invocation"] !== "true" && fm["disable-model-invocation"] !== "false") {
    say(`\`disable-model-invocation\` must be true or false, not \`${fm["disable-model-invocation"]}\``);
  }

  const bodyLines = parts.body.split("\n").length;
  if (bodyLines > SKILL_LIMITS.bodyLines) say(`body is ${bodyLines} lines, over the ${SKILL_LIMITS.bodyLines}-line ceiling; move detail into a references/ file beside SKILL.md and point at it`);

  return findings;
}

/** Validate every skill; returns the findings and the skill files measured, for the summary line. */
export function checkSkills(root) {
  const skills = discoverSkills(root);
  return { findings: skills.flatMap((rel) => checkSkill(root, rel)), skills };
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
  const skills = checkSkills(root);
  const findings = [
    ...shims.findings,
    ...checkCitations(root, files),
    ...checkLeakage(root, files, { privateRepo }),
    ...budgets.findings,
    ...checkRulesDir(root),
    ...skills.findings,
  ];
  return { findings, written: shims.written, removed: shims.removed, files, measured: budgets.measured, skills: skills.skills };
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
  const { findings, written, removed, files, measured, skills } = runGate(root, { sync, privateRepo });
  for (const w of written) console.log(`wrote   ${w}`);
  for (const r of removed) console.log(`removed ${r}`);
  if (findings.length > 0) {
    for (const f of findings) console.error(f);
    console.error(`agents-check: ${findings.length} finding(s) across ${files.length} guidance file(s)`);
    return 1;
  }
  const budgets = describeBudgets(measured);
  console.log(
    `agents-check: ${files.length} guidance file(s), ${discoverNestedGuides(root).length} shim(s) in sync, ${skills.length} skill(s)` +
      (budgets ? `, words ${budgets}` : "") +
      `, no findings`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
