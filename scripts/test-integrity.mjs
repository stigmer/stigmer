#!/usr/bin/env node

/**
 * Refuses the ways a test suite can go quiet without going red.
 *
 * A green run should mean the tests ran. Four shapes break that, and each has
 * happened here: a test body that returns early passes without running (the
 * golden E2E reported sixteen passes for months that way, #1300); a focused
 * `.only` silently drops every sibling; a deleted case takes its coverage with
 * it and nothing notices; a new skip hides a case behind a condition nobody
 * reviews. This script finds all four by reading the test files, statically,
 * with the TypeScript compiler's parser: no install beyond `typescript`, no
 * module is imported, and the base tree is read with `git show`, so a pull
 * request is judged in seconds against the commit it branched from.
 *
 * Rules on the tree as it is (always):
 *   - no `.only` on a test or a suite (vitest or Playwright);
 *   - no valueless `return` in a test callback's own body: `return;` there is
 *     a pass that never ran. Returning a value (`return ctx.skip(...)`, a
 *     promise) is fine, and nested functions are not the test's body;
 *   - no vitest config setting `passWithNoTests`, `retry` or `allowOnly`, and
 *     no Playwright config setting `retries`: a suite that finds no tests, or
 *     retries one into green, has not passed. A flaky case is quarantined by
 *     name instead (below).
 *
 * Rules on the change (with --base):
 *   - a deleted case. A case is keyed by its package, describe chain and
 *     title. Within one file's lineage (git's rename detection) a vanished key
 *     is paired with a key the file gained and reported as a retitle; a key
 *     that vanished from one file and appeared in another file of the same
 *     package is a move. Anything left is a deletion.
 *   - a new skip: a `skip`, `skipIf`, `runIf`, `todo` or `fixme` on a case or
 *     suite, or a runtime `.skip()` call inside a case, beyond what the file
 *     carried at the base.
 *   - a weakened RPC waiver. `test/conformance/inventory/rpc-waivers.yaml`
 *     lists the declared RPCs no conformance test tags, each a `gap` or
 *     `proven-elsewhere`; an RPC waived there that was not waived at the base
 *     (a new RPC shipped untested, or a tag given up), or a waiver moved from
 *     `proven-elsewhere` to `gap`, is refused. The file's block form is read
 *     line by line and any other shape is refused (`rpc-waivers-shape`), so an
 *     entry is never passed unread; the conformance suite's `inventory:check`
 *     holds the rest of the file. A tree without the file has no such rule.
 *
 * Three skips carry their reason by construction and are never "new": a
 * condition on a target capability (`capabilities.x`, the conformance guide's
 * idiom), on the platform (`process.platform`), or on a dependency the gate
 * provides (a `TEST_*` URL, `testDatabaseAdminUrl()`): inside the gate the
 * helper behind it throws when the dependency is missing, so that skip cannot
 * hide there. A case quarantined by name carries its reason in a comment on
 * the line above, `// quarantined: <repo>#<issue>`; with --check-issues the
 * issue must be open.
 *
 * Rule on a run (with --run-report <vitest JSON>): every case the run reports
 * as skipped, pending, todo or disabled must be explained by a skip site in its
 * file, on the case or on a suite around it, that carries its reason by
 * construction or is quarantined. The static rules judge what a file could
 * skip; this one judges what a run did skip, so a gate that provides every
 * dependency can refuse a skip nobody explained. A case whose title the
 * inventory cannot match (a computed title) is unexplained, so the rule fails
 * closed.
 *
 * Anything else is refused unless the pull request declares it, one line each
 * in its body (--pr-body-file, or the TEST_INTEGRITY_PR_BODY variable):
 *
 *   Test-removal: <case title or file path> -- <reason>
 *   Quarantine: <case title or file path> -- <repo>#<issue>
 *   Skip: <case title or file path> -- <why the case does not apply there>
 *   RPC-waiver: <Service>.<method> -- <why no conformance test pins it>
 *
 * A quarantine is a case that should run and cannot yet (flaky, blocked), so
 * it names an open issue. A skip is a case that does not apply in some place
 * it can run (a deployed endpoint with no operator credential, a smoke run
 * against a sign-in redirect), so it names its reason. An RPC waiver is part
 * of the API left without the conformance test that pins it, so it names why.
 *
 * The declarations are self-service by design: they make a removal or a skip
 * loud and put it in front of the reviewer, who reads the retitles too, since
 * a retitle is also how a real case is swapped for a trivial one.
 *
 * Usage:
 *   node scripts/test-integrity.mjs [--base <ref>] [--pr-body-file <path>]
 *       [--check-issues] [--run-report <vitest JSON>] [--json]
 * Exit: 0 clean, 1 findings, 2 the script could not judge (a usage or git
 * error, no `typescript` to parse with).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ─── What counts as a test file, a config and a registration ────────────

/** Tracked files the rules read, as git pathspecs. */
export const TEST_PATHSPECS = ["*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx", "*.test.mts", "*.spec.mts"];
export const CONFIG_PATHSPECS = [
  "vitest.config.*", "vitest.*.config.*", "**/vitest.config.*", "**/vitest.*.config.*",
  "playwright.config.*", "**/playwright.config.*",
];

/** The functions a test file registers cases and suites with. */
const TEST_ROOTS = new Set(["it", "test", "describe", "suite"]);
const SUITE_WORDS = new Set(["describe", "suite"]);
/** Members that still register a case or suite; any other member (`test.extend`, `test.step`) does not. */
const REGISTRATION_MEMBERS = new Set([
  "only", "skip", "skipIf", "runIf", "todo", "fixme", "each", "for", "concurrent",
  "sequential", "fails", "shuffle", "describe", "serial", "parallel",
]);
/** Members that make a registration a skip site. */
const SKIP_MEMBERS = new Set(["skip", "skipIf", "runIf", "todo", "fixme"]);
/** A call that asserts: `expect(...)`, `assert.equal(...)`, a helper such as `expectGrpcCode(...)`, `fail(...)`. */
const ASSERTION = /^(expect|assert|fail$)/i;
/** Vitest and Playwright options that let a suite pass without its tests having passed. */
const FORBIDDEN_CONFIG = ["passWithNoTests", "retry", "allowOnly", "retries"];

/** A skip whose condition names one of these carries its reason by construction. */
export const BY_CONSTRUCTION = [
  { reason: "target capability", pattern: /\bcapabilities\s*\.\s*\w+/ },
  { reason: "platform", pattern: /\bprocess\s*\.\s*platform\b/ },
  { reason: "gate-provided dependency", pattern: /\bTEST_[A-Z0-9_]+\b|\btestDatabaseAdminUrl\s*\(/ },
];

const QUARANTINE_COMMENT = /quarantined:\s*((?:[\w.-]+\/)?[\w.-]+)?#(\d+)/i;
const DECLARATION = /^\s*(Test-removal|Quarantine|Skip|RPC-waiver)\s*:\s*(.+?)\s+(?:--|—|–)\s+(.+?)\s*$/gim;

/** The conformance suite's RPC waivers, read by the change rule on weakened waivers. */
export const RPC_WAIVERS = "test/conformance/inventory/rpc-waivers.yaml";
const WAIVER_KINDS = new Set(["gap", "proven-elsewhere"]);

// ─── Parsing one file ───────────────────────────────────────────────────

/** Where the compiler is looked for, in order: the root, --typescript dirs, then the two services with their own lockfiles. */
export function typeScriptCandidates(root, extraDirs = []) {
  return [root, ...extraDirs, join(root, "backend/services/stigmer-server"), join(root, "backend/services/runner")];
}

/**
 * Loads the TypeScript compiler from the first place it is installed. A
 * repository whose root has no `typescript` (a service with its own lockfile)
 * names more candidate directories with --typescript.
 */
export function loadTypeScript(root, extraDirs = []) {
  for (const dir of typeScriptCandidates(root, extraDirs)) {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    try {
      return createRequire(manifest)("typescript");
    } catch {
      // Not installed under this directory; try the next.
    }
  }
  return undefined;
}

/**
 * Reads a call's callee as a chain: `it.skipIf(x)(...)` is
 * `[{name:"it"}, {name:"skipIf", args:[x]}]`. Returns undefined for anything
 * that is not rooted in a plain identifier.
 */
function calleeChain(ts, callee) {
  const chain = [];
  let node = callee;
  for (;;) {
    if (ts.isIdentifier(node)) {
      chain.unshift({ name: node.text, args: undefined });
      return chain;
    }
    if (ts.isPropertyAccessExpression(node)) {
      chain.unshift({ name: node.name.text, args: undefined });
      node = node.expression;
      continue;
    }
    if (ts.isCallExpression(node)) {
      // `it.skipIf(cond)` inside `it.skipIf(cond)(title, fn)`: the args belong
      // to the member being called.
      const inner = calleeChain(ts, node.expression);
      if (!inner) return undefined;
      inner[inner.length - 1] = { ...inner[inner.length - 1], args: node.arguments };
      return [...inner, ...chain];
    }
    return undefined;
  }
}

function isFunctionLike(ts, node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);
}

function titleOf(ts, sf, node) {
  if (!node) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.getText(sf);
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function squash(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** The quarantine comment on the lines above a statement, if any. */
function quarantineOf(ts, sf, node) {
  let statement = node;
  while (statement.parent && !ts.isSourceFile(statement.parent) && !ts.isBlock(statement.parent)) statement = statement.parent;
  const text = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? [];
  for (const range of ranges) {
    const match = QUARANTINE_COMMENT.exec(text.slice(range.pos, range.end));
    if (match) return { repo: match[1] ?? "", issue: Number(match[2]) };
  }
  return undefined;
}

/** The condition a runtime skip sits under: its own condition argument, or the `if` around it. */
function runtimeCondition(ts, sf, call) {
  const first = call.arguments[0];
  if (first && !ts.isStringLiteral(first) && !ts.isNoSubstitutionTemplateLiteral(first) && !ts.isTemplateExpression(first)) {
    return squash(first.getText(sf));
  }
  for (let node = call.parent; node && !isFunctionLike(ts, node); node = node.parent) {
    if (ts.isIfStatement(node)) return squash(node.expression.getText(sf));
  }
  return "";
}

export function byConstruction(condition) {
  return BY_CONSTRUCTION.find(({ pattern }) => pattern.test(condition))?.reason;
}

/**
 * Inventories one test file: its cases, its skip sites, and what breaks the
 * rules on the tree. Pure: the caller supplies the compiler and the text.
 */
export function inventoryFile(ts, path, text) {
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const cases = [];
  const skips = [];
  const findings = [];

  function visitCaseBody(fn, caseTitle, suite) {
    if (!fn.body || !ts.isBlock(fn.body)) return;
    // Whether the body has asserted or skipped anything yet, in source order.
    // A `return;` after that (the type-narrowing `expect(r.ok).toBe(true); if
    // (!r.ok) return;`, or Playwright's `test.skip(); return;`) is not a pass
    // that never ran; one before it is.
    let settled = false;
    const walk = (node) => {
      if (node !== fn && isFunctionLike(ts, node)) return;
      if (ts.isReturnStatement(node) && !node.expression && !settled) {
        findings.push({
          rule: "valueless-return",
          path,
          line: lineOf(sf, node),
          message: `\`return;\` before "${caseTitle}" has asserted anything passes without running; skip by name (\`return ctx.skip("why")\`, \`it.skipIf(...)\`) instead`,
        });
      }
      if (ts.isCallExpression(node)) {
        const chain = calleeChain(ts, node.expression);
        const last = chain?.[chain.length - 1]?.name;
        if (chain?.some((c) => ASSERTION.test(c.name)) || last === "skip" || last === "fixme") settled = true;
        if (chain && (last === "skip" || last === "fixme") && !(TEST_ROOTS.has(chain[0].name) && isRegistrationCall(node))) {
          const condition = runtimeCondition(ts, sf, node);
          skips.push({ kind: `runtime-${last}`, condition, line: lineOf(sf, node), title: caseTitle, suite, quarantine: quarantineOf(ts, sf, node) });
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(fn.body);
  }

  function isRegistrationCall(call) {
    const first = call.arguments[0];
    return Boolean(first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first) || ts.isTemplateExpression(first)) && call.arguments.some((a) => isFunctionLike(ts, a)))
      || (call.arguments.length === 1 && Boolean(first) && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)));
  }

  function visit(node, chainTitles) {
    if (ts.isCallExpression(node)) {
      const chain = calleeChain(ts, node.expression);
      if (chain && TEST_ROOTS.has(chain[0].name) && chain.slice(1).every((c) => REGISTRATION_MEMBERS.has(c.name)) && isRegistrationCall(node)) {
        const names = chain.map((c) => c.name);
        const isSuite = SUITE_WORDS.has(names[0]) || names.includes("describe");
        const title = titleOf(ts, sf, node.arguments[0]);
        const line = lineOf(sf, node);
        if (names.includes("only")) {
          findings.push({ rule: "only", path, line, message: `\`.only\` on "${title}" drops every other case in the run` });
        }
        for (const member of chain.slice(1)) {
          if (!SKIP_MEMBERS.has(member.name)) continue;
          const condition = member.args ? squash(member.args.map((a) => a.getText(sf)).join(", ")) : "";
          skips.push({ kind: member.name, condition, line, title, suite: chainTitles, quarantine: quarantineOf(ts, sf, node) });
        }
        const fn = [...node.arguments].reverse().find((a) => isFunctionLike(ts, a));
        if (isSuite) {
          if (fn) ts.forEachChild(fn, (child) => visit(child, [...chainTitles, title]));
          return;
        }
        cases.push({ key: [...chainTitles, title].join(" > "), title, line });
        if (fn) visitCaseBody(fn, title, chainTitles);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, chainTitles));
  }

  visit(sf, []);
  return { path, cases, skips, findings };
}

/** Finds the vitest and Playwright options that let a suite pass without passing. */
export function checkConfig(ts, path, text) {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [];
  const walk = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : undefined;
      if (name && FORBIDDEN_CONFIG.includes(name)) {
        const value = node.initializer;
        const off = value.kind === ts.SyntaxKind.FalseKeyword || (ts.isNumericLiteral(value) && Number(value.text) === 0);
        if (!off) {
          findings.push({ rule: "config", path, line: lineOf(sf, node), message: `\`${name}: ${squash(value.getText(sf))}\` lets the suite pass without its tests passing` });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return findings;
}

// ─── Comparing base and head ────────────────────────────────────────────

/** The directory of the nearest package.json above a path, from a set of known manifest directories. */
export function packageOf(path, packageDirs) {
  let dir = posix.dirname(path);
  for (;;) {
    if (packageDirs.has(dir)) return dir;
    if (dir === "." || dir === "/" || dir === "") return ".";
    dir = posix.dirname(dir);
  }
}

function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Items of `a` beyond their count in `b`, by key, keeping `a`'s later occurrences. */
function surplus(a, b, keyOf) {
  const budget = countBy(b, keyOf);
  const out = [];
  for (const item of a) {
    const key = keyOf(item);
    const left = budget.get(key) ?? 0;
    if (left > 0) budget.set(key, left - 1);
    else out.push(item);
  }
  return out;
}

/**
 * Compares the inventories of the files a change touched.
 *
 * `lineages` is one entry per changed test file: `{ base, head }`, each an
 * inventory or undefined (added, deleted), paired by git's rename detection.
 */
export function compareInventories(lineages, packageDirs) {
  const retitled = [];
  const vanishedPool = [];
  const gainedPool = [];
  const newSkips = [];

  for (const { base, head } of lineages) {
    const baseCases = base?.cases ?? [];
    const headCases = head?.cases ?? [];
    const vanished = surplus(baseCases, headCases, (c) => c.key);
    const gained = surplus(headCases, baseCases, (c) => c.key);
    const pairs = Math.min(vanished.length, gained.length);
    const path = head?.path ?? base.path;
    for (let i = 0; i < pairs; i++) retitled.push({ path, from: vanished[i].title, to: gained[i].title, line: gained[i].line });
    const pkg = packageOf(path, packageDirs);
    for (const c of vanished.slice(pairs)) vanishedPool.push({ ...c, path: base.path, pkg });
    for (const c of gained.slice(pairs)) gainedPool.push({ ...c, path, pkg });

    const headSkips = (head?.skips ?? []).filter((s) => !byConstruction(s.condition) && !s.quarantine);
    const baseSkips = (base?.skips ?? []).filter((s) => !byConstruction(s.condition) && !s.quarantine);
    for (const s of surplus(headSkips, baseSkips, (x) => `${x.kind}|${x.condition}`)) newSkips.push({ ...s, path });
  }

  const moved = [];
  const unplaced = surplus(vanishedPool, gainedPool, (c) => `${c.pkg}|${c.key}`);
  const movedAway = surplus(vanishedPool, unplaced, (c) => `${c.pkg}|${c.key}|${c.path}|${c.line}`);
  for (const c of movedAway) moved.push({ key: c.key, from: c.path });
  return { deleted: unplaced, retitled, moved, newSkips };
}

// ─── A run's skips ──────────────────────────────────────────────────────

/** The statuses vitest's JSON reporter gives a case that did not run. */
const NOT_RUN = new Set(["skipped", "pending", "todo", "disabled"]);

/** Whether a skip site covers a case: the site is the case itself, or a suite the case sits in. */
function covers(site, ancestors, title) {
  const at = [...site.suite, site.title];
  const chain = [...ancestors, title];
  return at.length <= chain.length && at.every((part, i) => part === chain[i]);
}

/**
 * Judges a vitest JSON report against the inventories of the head tree.
 *
 * `report` is the reporter's object (`testResults[].name` is the file's
 * absolute path, `assertionResults[]` its cases); `inventories` maps a
 * repository-relative path to its inventory. A case that did not run is
 * explained by a covering skip site that is by construction or quarantined;
 * every other one is a finding.
 */
export function explainRunSkips(report, inventories, root) {
  const findings = [];
  const explained = [];
  let skipped = 0;
  for (const file of report?.testResults ?? []) {
    const path = posix.normalize(relative(root, file.name ?? "").split(sep).join("/"));
    const inventory = inventories.get(path);
    for (const result of file.assertionResults ?? []) {
      if (!NOT_RUN.has(result.status)) continue;
      skipped += 1;
      const ancestors = result.ancestorTitles ?? [];
      const name = [...ancestors, result.title].join(" > ");
      const sites = (inventory?.skips ?? []).filter((s) => covers(s, ancestors, result.title));
      const site = sites.find((s) => s.quarantine) ?? sites.find((s) => byConstruction(s.condition));
      if (site) {
        explained.push({ path, line: site.line, name, reason: site.quarantine ? `quarantined on ${site.quarantine.repo}#${site.quarantine.issue}` : byConstruction(site.condition) });
        continue;
      }
      const line = sites[0]?.line ?? inventory?.cases.find((c) => c.key === name)?.line ?? 1;
      const why = inventory === undefined ? "its file is not a tracked test file" : sites.length === 0 ? "no skip site in its file covers it" : "the skip that covers it carries no reason (quarantine it on an issue, or make the case run)";
      findings.push({ rule: "unexplained-skip", path, line, message: `"${name}" was ${result.status} at run time and ${why}` });
    }
  }
  return { skipped, explained, findings };
}

// ─── RPC waivers ────────────────────────────────────────────────────────

/**
 * Reads the waiver file's `(rpc, kind)` pairs without a YAML parser. Only the
 * block form the file is written in is accepted: `waivers:` at column 0, each
 * entry opened by `  - rpc: <Service>.<method>` and carrying one
 * `    kind: gap|proven-elsewhere`. Any other list item, `kind:` or `rpc:` line,
 * any other top-level key, and an entry with no kind, is a shape problem, so
 * an entry this reader cannot see fails the change instead of passing it.
 * Comments and the entries' other fields are not its business.
 */
export function readRpcWaivers(text) {
  const entries = [];
  const problems = [];
  let entry;
  const close = () => {
    if (entry && entry.kind === undefined) problems.push({ line: entry.line, message: `the waiver for ${entry.rpc} names no \`kind:\`` });
  };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const number = i + 1;
    if (/^\s*(#|$)/.test(line)) continue;
    if (/^\S/.test(line)) {
      if (!/^waivers:\s*(\[\]\s*)?$/.test(line)) problems.push({ line: number, message: `unexpected top-level line \`${line.trim()}\`` });
      continue;
    }
    if (/^\s*-(\s|$)/.test(line)) {
      close();
      const item = /^ {2}- rpc: ([A-Za-z0-9_]+\.[A-Za-z0-9_]+)\s*$/.exec(line);
      entry = item ? { rpc: item[1], kind: undefined, line: number } : undefined;
      if (item) entries.push(entry);
      else problems.push({ line: number, message: `an entry must open with \`  - rpc: <Service>.<method>\`, not \`${line.trim()}\`` });
      continue;
    }
    if (/^\s*kind\s*:/.test(line)) {
      const kind = /^ {4}kind: (\S+)\s*$/.exec(line);
      if (!kind || !WAIVER_KINDS.has(kind[1]) || !entry || entry.kind !== undefined) problems.push({ line: number, message: `\`${line.trim()}\` is not one \`    kind: gap|proven-elsewhere\` inside an entry` });
      else entry.kind = kind[1];
      continue;
    }
    if (/^\s*rpc\s*:/.test(line)) problems.push({ line: number, message: `\`${line.trim()}\` is an \`rpc:\` outside an entry's first line` });
  }
  close();
  return { entries: entries.filter((e) => e.kind !== undefined), problems };
}

/**
 * The waivers at head that make the contract weaker than it was at the base:
 * an RPC waived that was not, or a waiver moved from `proven-elsewhere` to
 * `gap`. A removed waiver, a `gap` that found its proof, and an edit to an
 * entry's issue, proof or reason weaken nothing.
 */
export function compareRpcWaivers(base, head) {
  const was = new Map((base ?? []).map((e) => [e.rpc, e.kind]));
  const weakened = [];
  for (const e of head ?? []) {
    const before = was.get(e.rpc);
    if (before === undefined) weakened.push({ ...e, was: undefined });
    else if (before === "proven-elsewhere" && e.kind === "gap") weakened.push({ ...e, was: before });
  }
  return weakened;
}

// ─── Declarations and quarantines ───────────────────────────────────────

export function parseDeclarations(body) {
  const removals = [];
  const quarantines = [];
  const skips = [];
  const rpcWaivers = [];
  for (const match of (body ?? "").matchAll(DECLARATION)) {
    const [, kind, subject, rest] = match;
    if (kind.toLowerCase() === "test-removal") removals.push({ subject: subject.trim(), reason: rest.trim() });
    else if (kind.toLowerCase() === "skip") skips.push({ subject: subject.trim(), reason: rest.trim() });
    else if (kind.toLowerCase() === "rpc-waiver") rpcWaivers.push({ subject: subject.trim(), reason: rest.trim() });
    else {
      const issue = /((?:[\w.-]+\/)?[\w.-]+)?#(\d+)/.exec(rest);
      quarantines.push({ subject: subject.trim(), repo: issue?.[1] ?? "", issue: issue ? Number(issue[2]) : undefined });
    }
  }
  return { removals, quarantines, skips, rpcWaivers };
}

function declares(declarations, item) {
  return declarations.find((d) => d.subject === item.title || d.subject === item.path || d.subject === item.key);
}

/** Applies the pull request's declarations; returns what is still refused and what they covered. */
export function applyDeclarations(comparison, declarations) {
  const refused = [];
  const declared = [];
  for (const c of comparison.deleted) {
    const d = declares(declarations.removals, c);
    if (d) declared.push({ rule: "deleted-case", path: c.path, line: c.line, message: `"${c.key}" removed: ${d.reason}` });
    else refused.push({ rule: "deleted-case", path: c.path, line: c.line, message: `"${c.key}" was deleted; declare it with \`Test-removal: ${c.title} -- <reason>\`` });
  }
  for (const s of comparison.newSkips) {
    const q = declares(declarations.quarantines, s);
    const k = declares(declarations.skips ?? [], s);
    if (q?.issue) declared.push({ rule: "new-skip", path: s.path, line: s.line, message: `"${s.title}" quarantined on ${q.repo}#${q.issue}`, issue: { repo: q.repo, issue: q.issue } });
    else if (k) declared.push({ rule: "new-skip", path: s.path, line: s.line, message: `"${s.title}" skips${s.condition ? ` when ${s.condition}` : ""}: ${k.reason}` });
    else refused.push({ rule: "new-skip", path: s.path, line: s.line, message: `new ${s.kind}${s.condition ? ` (${s.condition})` : ""} on "${s.title}"; declare \`Skip: ${s.title} -- <why it does not apply>\`, or quarantine it (\`Quarantine: ${s.title} -- <repo>#<issue>\`)` });
  }
  for (const w of comparison.weakenedWaivers ?? []) {
    const d = (declarations.rpcWaivers ?? []).find((x) => x.subject === w.rpc);
    const what = w.was === undefined ? `${w.rpc} is waived as \`${w.kind}\` and was not waived at the base` : `${w.rpc}'s waiver moved from \`${w.was}\` to \`${w.kind}\``;
    if (d) declared.push({ rule: "new-rpc-waiver", path: RPC_WAIVERS, line: w.line, message: `${what}: ${d.reason}` });
    else refused.push({ rule: "new-rpc-waiver", path: RPC_WAIVERS, line: w.line, message: `${what}; declare it with \`RPC-waiver: ${w.rpc} -- <why no conformance test pins it>\`` });
  }
  return { refused, declared };
}

// ─── Report ─────────────────────────────────────────────────────────────

export function formatReport({ findings, comparison, declared, filesRead, base, runReport }) {
  const lines = [];
  for (const f of findings) lines.push(`✗ ${f.rule}  ${f.path}:${f.line}  ${f.message}`);
  for (const e of runReport?.explained ?? []) lines.push(`• skipped  ${e.path}:${e.line}  "${e.name}" (${e.reason})`);
  if (comparison) {
    for (const d of declared) lines.push(`• declared  ${d.path}:${d.line}  ${d.message}`);
    for (const r of comparison.retitled) lines.push(`• retitled  ${r.path}:${r.line}  "${r.from}" -> "${r.to}" (the reviewer reads these)`);
    for (const m of comparison.moved) lines.push(`• moved  "${m.key}" out of ${m.from}`);
  }
  const verdict = findings.length === 0 ? "clean" : `${findings.length} finding(s)`;
  const run = runReport ? `, ${runReport.skipped} case(s) skipped in the run` : "";
  lines.push(`test-integrity: ${filesRead} test file(s) read${base ? `, compared with ${base}` : ""}${run}; ${verdict}`);
  return lines.join("\n");
}

// ─── The command ────────────────────────────────────────────────────────

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function parseArgs(argv) {
  const opts = { base: undefined, prBodyFile: undefined, checkIssues: false, runReport: undefined, json: false, typescriptDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") opts.base = argv[++i];
    else if (arg === "--pr-body-file") opts.prBodyFile = argv[++i];
    else if (arg === "--check-issues") opts.checkIssues = true;
    else if (arg === "--run-report") opts.runReport = argv[++i];
    else if (arg === "--json") opts.json = true;
    else if (arg === "--typescript") opts.typescriptDirs.push(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

function originRepo(root) {
  const url = git(root, ["remote", "get-url", "origin"]).trim();
  const match = /[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url);
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

function issueState(root, repoRef, issue) {
  const origin = originRepo(root);
  const full = repoRef.includes("/") ? repoRef : `${origin?.owner ?? "stigmer"}/${repoRef || origin?.repo}`;
  try {
    return execFileSync("gh", ["issue", "view", String(issue), "-R", full, "--json", "state", "--jq", ".state"], { encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function main(argv) {
  const opts = parseArgs(argv);
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const ts = loadTypeScript(root, opts.typescriptDirs.map((d) => resolve(d)));
  if (!ts) {
    console.error("test-integrity: no `typescript` found to parse with; install the repository's dependencies, or pass --typescript <dir>");
    return 2;
  }

  const tracked = git(root, ["ls-files", "--", ...TEST_PATHSPECS]).split("\n").filter(Boolean).filter((p) => !p.includes("node_modules/"));
  const findings = [];
  const head = new Map();
  for (const path of tracked) {
    const inventory = inventoryFile(ts, path, readFileSync(join(root, path), "utf8"));
    head.set(path, inventory);
    findings.push(...inventory.findings);
  }
  for (const path of git(root, ["ls-files", "--", ...CONFIG_PATHSPECS]).split("\n").filter(Boolean)) {
    findings.push(...checkConfig(ts, path, readFileSync(join(root, path), "utf8")));
  }

  let comparison;
  let declared = [];
  let baseLabel;
  if (opts.base) {
    const mergeBase = git(root, ["merge-base", opts.base, "HEAD"]).trim();
    baseLabel = `${opts.base} (${mergeBase.slice(0, 9)})`;
    const isTest = (p) => TEST_PATHSPECS.some((spec) => posix.basename(p).endsWith(spec.slice(1)));
    const lineages = [];
    const status = git(root, ["diff", "-M", "--name-status", mergeBase, "--"]).split("\n").filter(Boolean);
    const readBase = (p) => inventoryFile(ts, p, git(root, ["show", `${mergeBase}:${p}`]));
    for (const row of status) {
      const [code, a, b] = row.split("\t");
      if (code.startsWith("R")) {
        if (isTest(a) || isTest(b)) lineages.push({ base: isTest(a) ? readBase(a) : undefined, head: isTest(b) ? head.get(b) : undefined });
      } else if (code === "D") {
        if (isTest(a)) lineages.push({ base: readBase(a), head: undefined });
      } else if (code === "A") {
        if (isTest(a) && head.has(a)) lineages.push({ base: undefined, head: head.get(a) });
      } else if (isTest(a)) {
        lineages.push({ base: readBase(a), head: head.get(a) });
      }
    }
    const manifests = new Set([
      ...git(root, ["ls-files", "--", "package.json", "**/package.json"]).split("\n"),
      ...git(root, ["ls-tree", "-r", "--name-only", mergeBase]).split("\n").filter((p) => posix.basename(p) === "package.json"),
    ].filter(Boolean).map((p) => posix.dirname(p)));
    comparison = compareInventories(lineages, manifests);
    const hasWaivers = existsSync(join(root, RPC_WAIVERS));
    const baseHasWaivers = git(root, ["ls-tree", "--name-only", mergeBase, "--", RPC_WAIVERS]).trim() !== "";
    if (hasWaivers || baseHasWaivers) {
      const headWaivers = hasWaivers ? readRpcWaivers(readFileSync(join(root, RPC_WAIVERS), "utf8")) : { entries: [], problems: [] };
      const baseWaivers = baseHasWaivers ? readRpcWaivers(git(root, ["show", `${mergeBase}:${RPC_WAIVERS}`])) : { entries: [], problems: [] };
      for (const p of headWaivers.problems) findings.push({ rule: "rpc-waivers-shape", path: RPC_WAIVERS, line: p.line, message: p.message });
      comparison.weakenedWaivers = compareRpcWaivers(baseWaivers.entries, headWaivers.entries);
    }
    const body = opts.prBodyFile ? readFileSync(opts.prBodyFile, "utf8") : process.env.TEST_INTEGRITY_PR_BODY ?? "";
    const applied = applyDeclarations(comparison, parseDeclarations(body));
    findings.push(...applied.refused);
    declared = applied.declared;
  }

  if (opts.checkIssues) {
    const quarantined = [];
    for (const inventory of head.values()) {
      for (const s of inventory.skips) if (s.quarantine) quarantined.push({ ...s, path: inventory.path, ref: s.quarantine });
    }
    for (const d of declared) if (d.issue) quarantined.push({ path: d.path, line: d.line, title: d.message, ref: d.issue });
    for (const q of quarantined) {
      const state = issueState(root, q.ref.repo, q.ref.issue);
      if (state !== "OPEN") {
        findings.push({ rule: "quarantine", path: q.path, line: q.line, message: `quarantined on ${q.ref.repo}#${q.ref.issue}, which is ${state.toLowerCase()}; un-skip it or quarantine it on an open issue` });
      }
    }
  }

  let runReport;
  if (opts.runReport) {
    // A report that is missing or not JSON throws: the run cannot be judged (exit 2).
    const report = JSON.parse(readFileSync(resolve(opts.runReport), "utf8"));
    // The reporter writes the path it ran from; a symlinked checkout or temp dir (macOS /tmp) must still meet `root`.
    for (const file of report.testResults ?? []) if (file.name && existsSync(file.name)) file.name = realpathSync(file.name);
    runReport = explainRunSkips(report, head, root);
    findings.push(...runReport.findings);
  }

  const result = { findings, comparison, declared, runReport, filesRead: head.size, base: baseLabel };
  console.log(opts.json ? JSON.stringify(result, null, 2) : formatReport(result));
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`test-integrity: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

