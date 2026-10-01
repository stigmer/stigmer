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
 * Rules on where a test lives and what its name says (always; the standard
 * they enforce is test/README.md, "The test standard"). A name that says
 * something false is a quiet failure too: a file named for a service the gate
 * provides that never reaches it, or one that reaches a service its name
 * hides, misleads the reader and the run alike, and a test outside the place
 * its layer lives is one no reader finds.
 *   - a retired word (`integration`, `e2e`, `contract`, `smoke`, `measure`,
 *     `a11y`, `layout`) as the last word of a test file's name, or right
 *     before its service and layer words (`a11y` or `layout` before `browser`
 *     is an audit's topic);
 *   - a layer word where its layer does not live: `conformance` outside
 *     test/conformance/src/suites*, `browser` in a package no vitest config
 *     names `*.browser.test.*` in an `include`, `load` in a package with no
 *     vitest.load.config. A config counts for its own package only, the one
 *     with the nearest package.json, so a test at the repository root needs a
 *     config at the root;
 *   - in a package with a vitest.load.config, another vitest config that does
 *     not exclude `*.load.test.*`: a default run would collect the load class;
 *   - a service the file reaches that its name does not carry, and a service
 *     word on a file that never reaches it. Reaching is a value use of the
 *     service's entry point (a call of `testDatabaseAdminUrl` or
 *     `createTestDatabase`, a `gateDependency` call for its variable, a
 *     `createLocal()` or `createTimeSkipping()` that starts a Temporal test
 *     server), in the file or in a test helper it
 *     imports, followed through relative imports; a type-only import or a
 *     mention in a string reaches nothing. Reaching is judged per module, not
 *     per imported name: importing anything from a helper that reaches a
 *     service reaches it, so a helper that mixes the two is split, not named
 *     around. A `composed`, `conformance`, `load`
 *     or `live` file, and the suites' own trees, may use any service without
 *     naming it, but not name one it never reaches;
 *   - a TypeScript test outside a `__tests__` directory (the suites' own trees
 *     excepted), a `*.spec.ts` outside test/e2e/tests and site/e2e, and an
 *     import in test/support of anything but `node:*` or its own `.ts` files.
 * Files that do not follow the standard yet are listed in
 * scripts/test-layout-baseline.txt, one `<rule> <path> [<detail>]` per line
 * (the detail is the word, service or specifier a finding is about): a listed
 * finding is counted, not refused; a line whose finding is gone is refused as
 * stale; and with --base, a line the base's list did not carry is refused, so
 * the list only shrinks. A line that follows its file through a rename (git's
 * rename detection, the same rule and detail) is the base's line. A base
 * without the list (the change that introduces it) has nothing to compare
 * with.
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

/** The services a gate provides: a file's name carries one exactly when the file reaches it. */
export const SERVICE_WORDS = ["openfga", "postgres", "temporal", "vault"];
/** The layers a name may carry; each goes only where its layer lives. */
export const LAYER_WORDS = ["browser", "composed", "conformance", "live", "load"];
/** Words that meant different things in different places, refused as a name's last word. */
export const RETIRED_WORDS = ["a11y", "contract", "e2e", "integration", "layout", "measure", "smoke"];
/** Layers whose files may use any service without naming it (but name none they never reach). */
const ANY_SERVICE = new Set(["composed", "conformance", "live", "load"]);
/** The suites' own trees, placed by their suite rather than by `__tests__`. */
const SUITE_TREES = ["test/conformance/src/suites", "test/e2e/tests/"];
/** Where a Playwright spec may live: the console's journeys and the site's. */
const SPEC_HOMES = ["test/e2e/tests/", "site/e2e/"];
/** The trees whose tests may use any service: the contract suite and the console's journeys. */
const ANY_SERVICE_TREES = ["test/conformance/", "test/e2e/"];
/** The machinery two or more suites share, which imports only `node:*` and its own files. */
export const SUPPORT_TREE = "test/support/";
/** Today's layout violations, one `<rule> <path> [<detail>]` per line; the list may only shrink. */
export const LAYOUT_BASELINE = "scripts/test-layout-baseline.txt";
/** A test's helpers: reaching a service is followed through these and no further. */
const HELPER = /(^|\/)(__tests__|__test-utils__|__fixtures__)\/|^test\//;
/** The variables a `gateDependency(variable, ...)` call names, by the service behind them. */
const GATE_VARIABLES = new Map([
  ["TEST_DATABASE_URL", "postgres"],
  ["CLOUD_SCHEMA_TEST_DATABASE_URL", "postgres"],
  ["TEST_FGA_API_URL", "openfga"],
  ["TEST_VAULT_ADDR", "vault"],
]);
/** The calls that reach the Postgres a gate provides (backend/services/stigmer-server's store test support). */
const POSTGRES_CALLS = new Set(["testDatabaseAdminUrl", "createTestDatabase"]);
/**
 * The calls that start a Temporal test server: these methods of
 * `TestWorkflowEnvironment` (`@temporalio/testing`), under that name or an
 * alias bound to it. The package itself is not the service: its
 * `MockActivityEnvironment` runs an activity in the test process.
 */
const TEMPORAL_CALLS = new Set(["createLocal", "createTimeSkipping"]);
const TEMPORAL_ENVIRONMENT = "TestWorkflowEnvironment";
const TEMPORAL_TESTING = "@temporalio/testing";

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

// ─── Layout: where a test lives and what its name says ──────────────────

/**
 * A test file's name words: the last dotted segment before `.test` or `.spec`,
 * and the service and layer words before it, with the segment just before
 * those words (`before`). The first segment is the topic and is never a word
 * (`postgres-kinds.postgres.test.ts` carries one).
 */
export function nameWords(path) {
  const match = /^(.*)\.(?:test|spec)\.[cm]?[jt]sx?$/.exec(posix.basename(path));
  if (!match) return { words: [], last: undefined, before: undefined };
  const segments = match[1].split(".");
  const reserved = new Set([...SERVICE_WORDS, ...LAYER_WORDS]);
  const words = [];
  let i = segments.length - 1;
  for (; i >= 1 && reserved.has(segments[i]); i--) words.unshift(segments[i]);
  return {
    words,
    last: segments.length > 1 ? segments[segments.length - 1] : undefined,
    before: words.length > 0 && i >= 1 ? segments[i] : undefined,
  };
}

/** Whether an import declaration brings in a value, not only types. */
function isValueImport(ts, node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.length === 0 || bindings.elements.some((e) => !e.isTypeOnly);
}

/**
 * What one module does with services and imports: the services its own code
 * reaches, the relative specifiers it imports values from, and every
 * specifier it names at all (the support tree's import rule reads these).
 */
export function scanModule(ts, path, text) {
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const services = new Set();
  const valueImports = [];
  const specifiers = [];
  // Local names bound to an entry point: `import { createTestDatabase as make }`,
  // `const { TestWorkflowEnvironment: TWE } = await import("@temporalio/testing")`.
  const local = new Map([...POSTGRES_CALLS, "gateDependency", TEMPORAL_ENVIRONMENT].map((name) => [name, name]));
  // Names bound to the package itself: `import * as testing from "@temporalio/testing"`,
  // `import testing from "@temporalio/testing"`, `const testing = await import("@temporalio/testing")`.
  // A test file is a module (it imports its runner), so a top-level `await (...)` parses as an await.
  const temporalPackage = new Set();
  const isTemporalImport = (expr) => {
    let e = expr;
    while (e && (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e))) e = e.expression;
    const arg = e && ts.isCallExpression(e) && e.expression.kind === ts.SyntaxKind.ImportKeyword ? e.arguments[0] : undefined;
    return Boolean(arg && ts.isStringLiteral(arg) && arg.text === TEMPORAL_TESTING);
  };
  const bindAliases = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === TEMPORAL_TESTING) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) temporalPackage.add(bindings.name.text);
      // A default import of the CommonJS package is the package too.
      if (node.importClause?.name && !node.importClause.isTypeOnly) temporalPackage.add(node.importClause.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isTemporalImport(node.initializer)) temporalPackage.add(node.name.text);
    if (ts.isImportSpecifier(node) && node.propertyName && local.has(node.propertyName.text)) local.set(node.name.text, node.propertyName.text);
    if (ts.isBindingElement(node) && node.propertyName && ts.isIdentifier(node.propertyName) && ts.isIdentifier(node.name) && local.has(node.propertyName.text)) {
      local.set(node.name.text, node.propertyName.text);
    }
    ts.forEachChild(node, bindAliases);
  };
  bindAliases(sf);
  const note = (spec, value, node) => {
    specifiers.push({ spec, line: lineOf(sf, node) });
    if (value && spec.startsWith(".")) valueImports.push(spec);
  };
  const walk = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      note(node.moduleSpecifier.text, isValueImport(ts, node), node);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      note(node.moduleSpecifier.text, !node.isTypeOnly, node);
    } else if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      const literal = first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : undefined;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (literal !== undefined) note(literal, true, node);
      } else {
        const named = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
        const callee = named && ts.isIdentifier(node.expression) ? local.get(named) ?? named : named;
        if (callee && POSTGRES_CALLS.has(callee)) services.add("postgres");
        // The receiver is a name bound to TestWorkflowEnvironment, or a member of
        // that name (`testing.TestWorkflowEnvironment`, `(await import(...)).TestWorkflowEnvironment`).
        // A member counts only on the package itself: a namespace bound to it, or an inline import of it.
        const object = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : undefined;
        const member = object && ts.isPropertyAccessExpression(object) && object.name.text === TEMPORAL_ENVIRONMENT
          && ((ts.isIdentifier(object.expression) && temporalPackage.has(object.expression.text)) || isTemporalImport(object.expression));
        const receiver = object && ts.isIdentifier(object) ? local.get(object.text) : member ? TEMPORAL_ENVIRONMENT : undefined;
        if (callee && TEMPORAL_CALLS.has(callee) && receiver === TEMPORAL_ENVIRONMENT) services.add("temporal");
        if (callee === "gateDependency" && literal !== undefined && GATE_VARIABLES.has(literal)) services.add(GATE_VARIABLES.get(literal));
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return { services, valueImports, specifiers };
}

/** The tracked module a relative specifier names, trying TypeScript's extensions for a `.js` or bare one. */
export function resolveRelative(from, spec, files) {
  const target = posix.normalize(posix.join(posix.dirname(from), spec));
  const bare = target.replace(/\.(?:m?js|jsx)$/, "");
  for (const candidate of [target, `${bare}.ts`, `${bare}.tsx`, `${bare}.mts`, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The services a module reaches, itself or through the test helpers it
 * value-imports, transitively. `read(path)` returns a tracked module's text.
 */
export function makeReach(ts, files, read) {
  const scans = new Map();
  const scan = (path) => {
    if (!scans.has(path)) scans.set(path, scanModule(ts, path, read(path)));
    return scans.get(path);
  };
  // A walk over the helper graph from each file, not a memo per module: a
  // module first met inside a cycle would otherwise keep a partial answer.
  const reach = (path) => {
    const out = new Set();
    const seen = new Set();
    const pending = [path];
    while (pending.length > 0) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      const { services, valueImports } = scan(current);
      for (const service of services) out.add(service);
      for (const spec of valueImports) {
        const target = resolveRelative(current, spec, files);
        if (target && HELPER.test(target) && !seen.has(target)) pending.push(target);
      }
    }
    return out;
  };
  return { reach, scan };
}

/**
 * The globs a config's `include` arrays name, written inline or through a
 * module-level `const` array (`include: BROWSER_GLOBS`); an `exclude` or a
 * comment collects nothing.
 */
export function configIncludes(ts, path, text) {
  return configGlobs(ts, path, text, "include");
}

/** The globs a config's `exclude` arrays name, read the way `configIncludes` reads `include`. */
export function configExcludes(ts, path, text) {
  return configGlobs(ts, path, text, "exclude");
}

function configGlobs(ts, path, text, key) {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const constants = new Map();
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const d of statement.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && ts.isArrayLiteralExpression(d.initializer)) constants.set(d.name.text, d.initializer);
    }
  }
  const globs = [];
  const walk = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === key) {
      const value = ts.isIdentifier(node.initializer) ? constants.get(node.initializer.text) : node.initializer;
      if (value && ts.isArrayLiteralExpression(value)) {
        for (const e of value.elements) if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) globs.push(e.text);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return globs;
}

/**
 * The layout rules over the tree (see the header). `tests` are the tracked
 * test files, `files` every tracked TypeScript module, `read` a module's text,
 * `packageDirs` the directories holding a package.json, and `configs` the
 * tracked vitest configs as `{ path, text }`.
 */
export function checkLayout(ts, { tests, files, read, packageDirs, configs }) {
  const findings = [];
  const { reach, scan } = makeReach(ts, files, read);
  // A config collects for its own package: the nearest package.json above it, not a parent's.
  // So a test at the repository root needs a config at the root.
  const configsIn = (pkg) => configs.filter((c) => packageOf(c.path, packageDirs) === pkg);
  // `detail` (the word, the service, the specifier) keys a baseline line with the rule and the path,
  // so one listed finding never covers a second of the same rule in the same file.
  const find = (rule, path, line, message, detail) => findings.push({ rule, path, line, message, ...(detail ? { detail } : {}) });

  for (const path of tests) {
    const { words, last, before } = nameWords(path);
    const spec = /\.spec\.[cm]?[jt]sx?$/.test(path);
    // A retired word is refused as the last word, and right before the words
    // (`x.integration.postgres`), except an audit's topic before `browser`.
    const topicBeforeBrowser = words[0] === "browser" && (before === "a11y" || before === "layout");
    const retired = [last, before].find((w) => w && RETIRED_WORDS.includes(w) && !(w === before && topicBeforeBrowser));
    if (retired) {
      find("layout-retired-word", path, 1, `"${retired}" is a retired name word: name the file for its layer or its service (test/README.md, "Names")`, retired);
    }
    if (words.includes("conformance") && !path.startsWith("test/conformance/src/suites")) {
      find("layout-word-place", path, 1, "a `conformance` file lives in test/conformance/src/suites*", "conformance");
    }
    const pkg = packageOf(path, packageDirs);
    if (words.includes("browser") && !configsIn(pkg).some((c) => configIncludes(ts, c.path, c.text).some((g) => g.includes(".browser.test")))) {
      find("layout-word-place", path, 1, `no vitest config in ${pkg} collects \`*.browser.test.*\`, so nothing runs this file in a browser`, "browser");
    }
    if (words.includes("load") && !configsIn(pkg).some((c) => /^vitest\.load\.config\./.test(posix.basename(c.path)))) {
      find("layout-word-place", path, 1, `${pkg} has no vitest.load.config, the one config that runs the load class`, "load");
    }
    {
      // A layer or a tree that may use any service still may not name one it never reaches.
      const anyService = words.some((w) => ANY_SERVICE.has(w)) || ANY_SERVICE_TREES.some((t) => path.startsWith(t));
      const reached = reach(path);
      for (const service of SERVICE_WORDS) {
        if (!anyService && reached.has(service) && !words.includes(service)) {
          find("layout-service-unnamed", path, 1, `reaches ${service}, which its name does not say: add \`.${service}\` before \`.test\``, service);
        }
        if (words.includes(service) && !reached.has(service)) {
          find("layout-service-unreached", path, 1, `is named for ${service} but never reaches it: drop \`.${service}\` from the name`, service);
        }
      }
    }
    if (spec) {
      if (!SPEC_HOMES.some((home) => path.startsWith(home))) find("layout-placement", path, 1, "a `*.spec.ts` lives under test/e2e/tests/ or site/e2e/");
    } else if (!path.includes("/__tests__/") && !SUITE_TREES.some((tree) => path.startsWith(tree))) {
      find("layout-placement", path, 1, "a TypeScript test lives in a `__tests__` directory beside the module it tests");
    }
  }

  // The load class runs on its own cadence: in a package with a load config, every other vitest
  // config excludes `*.load.test.*`, so a default run never collects a measurement.
  for (const config of configs) {
    const name = posix.basename(config.path);
    if (!/^vitest(\..+)?\.config\./.test(name) || /^vitest\.load\.config\./.test(name)) continue;
    const pkg = packageOf(config.path, packageDirs);
    if (!configsIn(pkg).some((c) => /^vitest\.load\.config\./.test(posix.basename(c.path)))) continue;
    if (!configExcludes(ts, config.path, config.text).some((g) => g.includes(".load.test"))) {
      find("layout-load-collected", config.path, 1, "the package has a vitest.load.config, so this config excludes `**/*.load.test.ts`; without it a default run collects the load class");
    }
  }

  for (const path of [...files].filter((p) => p.startsWith(SUPPORT_TREE) && !p.includes("/__tests__/")).sort()) {
    for (const { spec, line } of scan(path).specifiers) {
      const own = spec.startsWith(".") && /\.tsx?$/.test(spec) && posix.normalize(posix.join(posix.dirname(path), spec)).startsWith(SUPPORT_TREE);
      if (spec.startsWith("node:") || own) continue;
      find("layout-support-import", path, line, `imports \`${spec}\`; test/support imports only \`node:*\` and its own files by their \`.ts\` path, so bare node loads it`, spec);
    }
  }
  return findings;
}

/** A layout finding's baseline key: its rule, its path, and its detail when it has one. */
export function layoutKey(finding) {
  return [finding.rule, finding.path, finding.detail].filter(Boolean).join(" ");
}

/** Reads the layout baseline: `<rule> <path> [<detail>]` per line; blank lines and `#` comments are skipped. */
export function readLayoutBaseline(text) {
  const entries = [];
  const problems = [];
  const seen = new Set();
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const match = /^(layout-[a-z-]+)\s+(\S+)(?:\s+(\S+))?$/.exec(line);
    if (!match) {
      problems.push({ line: i + 1, message: `\`${line}\` is not \`<rule> <path> [<detail>]\`` });
      return;
    }
    const key = layoutKey({ rule: match[1], path: match[2], detail: match[3] });
    if (seen.has(key)) problems.push({ line: i + 1, message: `\`${key}\` is listed twice` });
    seen.add(key);
    entries.push({ rule: match[1], path: match[2], detail: match[3], line: i + 1, key });
  });
  return { entries, problems };
}

/**
 * Splits the layout findings by the baseline. `head` is the list's entries in
 * the tree, `base` the base's (undefined when there is no base to compare
 * with, or the base had no list), and `renamed` maps a file's head path to its
 * base path for the files the change renamed. Returns what is refused, how
 * many findings the list covers, and the list's own refusals: a stale line, a
 * grown one. A line that follows its file through a rename, with the same rule
 * and detail, is the base's line, not a new one.
 */
export function applyLayoutBaseline(findings, head, base, renamed = new Map()) {
  const listed = new Set((head ?? []).map((e) => e.key));
  const refused = findings.filter((f) => !listed.has(layoutKey(f)));
  const baselined = findings.length - refused.length;
  const found = new Set(findings.map(layoutKey));
  const was = base ? new Set(base.map((e) => e.key)) : undefined;
  for (const e of head ?? []) {
    if (!found.has(e.key)) {
      refused.push({ rule: "layout-baseline-stale", path: LAYOUT_BASELINE, line: e.line, message: `\`${e.key}\` no longer applies; remove the line` });
    } else if (was && !was.has(e.key) && !(renamed.has(e.path) && was.has(layoutKey({ rule: e.rule, path: renamed.get(e.path), detail: e.detail })))) {
      refused.push({ rule: "layout-baseline-grown", path: LAYOUT_BASELINE, line: e.line, message: `\`${e.key}\` was added; the list only shrinks, so make the file follow the standard instead` });
    }
  }
  return { refused, baselined };
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

export function formatReport({ findings, comparison, declared, filesRead, base, runReport, layoutBaselined = 0 }) {
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
  const listed = layoutBaselined > 0 ? `, ${layoutBaselined} layout finding(s) listed in ${LAYOUT_BASELINE}` : "";
  lines.push(`test-integrity: ${filesRead} test file(s) read${base ? `, compared with ${base}` : ""}${run}${listed}; ${verdict}`);
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
  const texts = new Map();
  const read = (path) => {
    if (!texts.has(path)) texts.set(path, readFileSync(join(root, path), "utf8"));
    return texts.get(path);
  };
  const findings = [];
  const head = new Map();
  for (const path of tracked) {
    const inventory = inventoryFile(ts, path, read(path));
    head.set(path, inventory);
    findings.push(...inventory.findings);
  }
  const configs = git(root, ["ls-files", "--", ...CONFIG_PATHSPECS]).split("\n").filter(Boolean).map((path) => ({ path, text: read(path) }));
  for (const { path, text } of configs) findings.push(...checkConfig(ts, path, text));

  const modules = new Set(git(root, ["ls-files", "--", "*.ts", "*.tsx", "*.mts"]).split("\n").filter((p) => p && !p.includes("node_modules/")));
  const headManifests = git(root, ["ls-files", "--", "package.json", "**/package.json"]).split("\n").filter(Boolean).map((p) => posix.dirname(p));
  const layout = checkLayout(ts, { tests: tracked, files: modules, read, packageDirs: new Set(headManifests), configs });
  const headBaseline = existsSync(join(root, LAYOUT_BASELINE)) ? readLayoutBaseline(read(LAYOUT_BASELINE)) : undefined;
  for (const p of headBaseline?.problems ?? []) findings.push({ rule: "layout-baseline-shape", path: LAYOUT_BASELINE, line: p.line, message: p.message });
  let baseBaseline;
  const renamed = new Map();

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
        renamed.set(b, a);
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
    if (git(root, ["ls-tree", "--name-only", mergeBase, "--", LAYOUT_BASELINE]).trim() !== "") {
      baseBaseline = readLayoutBaseline(git(root, ["show", `${mergeBase}:${LAYOUT_BASELINE}`]));
    }
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

  const appliedLayout = applyLayoutBaseline(layout, headBaseline?.entries, baseBaseline?.entries, renamed);
  findings.push(...appliedLayout.refused);

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

  const result = { findings, comparison, declared, runReport, filesRead: head.size, base: baseLabel, layoutBaselined: appliedLayout.baselined };
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

