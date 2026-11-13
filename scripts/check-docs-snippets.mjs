#!/usr/bin/env node

/**
 * The docs snippet gate: every TypeScript, Go, Python and Java code fence
 * under `docs/` compiles against the package it shows, or says why it
 * cannot (`no-compile="<reason>"`). The YAML fences have their own gate
 * (`make check-docs-yaml`), whose shape this one follows.
 *
 * A fence is a whole file, a fragment, a page's `prelude`, or marked
 * `no-compile` (scripts/lib/docs-snippets/fences.mjs). A fragment compiles
 * with the gate's convention (the client in scope, preludes.mjs), the page's
 * prelude and its own hidden setup (the lines above its `---cut---` marker,
 * which the site never shows). `docs/STYLE.md`, "Code examples", is the
 * author's guide.
 *
 * A failing fence is named by page and line. A fence on a generated page is
 * fixed at its generator (the page carries the generator's marker), and the
 * report says so. The fences allowed to fail today are listed in
 * test/docs-snippets-known-failing.json, which may only shrink
 * (scripts/lib/docs-snippets/ratchet.mjs): a listed fence that now compiles
 * fails the gate until `--prune` drops it, and with `--base` the list may not
 * grow against the base branch's.
 *
 * What each compiler needs (CI's `ci.docs-snippets` lane sets all four up):
 *   - TypeScript: the workspace's built libraries (`npm run build:libs`);
 *   - Go: the toolchain `go.work` names;
 *   - Python: `--python=<interpreter>` of a virtual environment with the
 *     stubs and the SDK installed, and pyright (the root devDependency);
 *   - Java: `--java-classpath=<file>` holding the SDK's runtime classpath
 *     (`mvn dependency:build-classpath`), the SDK's jar built in sdk/java.
 *
 *   node scripts/check-docs-snippets.mjs [--lang=typescript,go,python,java]
 *     [--page=<path prefix>] [--python=<path>] [--java-classpath=<file>]
 *     [--base=<git ref>] [--prune] [--init-list] [--docs-root=<dir>] [--summary]
 *
 * The theme playground's code (`site/src/lib/theme-snippet.mjs`) is compiled
 * too, for every look it offers, and so is the code the console hands a
 * builder for their app (`sdk/typescript/src/app-handover.ts`), for every
 * stack, each when the tree has it and the run is not narrowed to other pages.
 *
 * `--docs-root` reads the pages (and the list) from another checkout, with
 * this checkout's compilers and libraries. `--init-list` writes the list
 * from today's failures, only where none exists. Exits 1 when the gate
 * refuses, 2 on a usage error.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { collectUnits } from "./lib/docs-snippets/collect.mjs";
import { checkGo } from "./lib/docs-snippets/go.mjs";
import { checkJava } from "./lib/docs-snippets/java.mjs";
import { checkPython } from "./lib/docs-snippets/python.mjs";
import {
  compareToList,
  entryKey,
  failingMultiset,
  fenceDigest,
  formatList,
  growthAgainstBase,
  KNOWN_FAILING_FILE,
  parseList,
  prune,
  within,
} from "./lib/docs-snippets/ratchet.mjs";
import { HANDOVER_FILE, handoverSnippetUnits } from "./lib/docs-snippets/handover-snippets.mjs";
import { THEME_SNIPPET_FILE, themeSnippetUnits } from "./lib/docs-snippets/theme-snippets.mjs";
import { checkTypeScript } from "./lib/docs-snippets/typescript.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export const ALL_LANGUAGES = ["typescript", "go", "python", "java"];

/** The markdown pages under docs/ the repository tracks. */
export function docsPages(root) {
  return execFileSync("git", ["ls-files", "docs/"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((p) => /\.mdx?$/.test(p) && !p.startsWith("docs/_archive/"));
}

/**
 * Compiles the pages' fences, with `withTheme` the theme playground's code
 * for every look it offers (lib/docs-snippets/theme-snippets.mjs), and with
 * `withHandover` the code the console hands a builder for their app
 * (lib/docs-snippets/handover-snippets.mjs), and returns what it found; the
 * CLI weighs it against the list.
 * @param {{root: string, docsRoot?: string, pages: string[], languages: string[], python?: string, javaClasspath?: string, withTheme?: boolean, withHandover?: boolean}} opts
 */
export async function runGate({ root, docsRoot = root, pages, languages, python, javaClasspath, withTheme = false, withHandover = false }) {
  const { units: fenceUnits, skipped, problems } = collectUnits(docsRoot, pages);
  const theme = withTheme && languages.includes("typescript") ? await themeSnippetUnits(docsRoot, fenceUnits.length) : [];
  const handover = withHandover ? await handoverSnippetUnits(docsRoot, fenceUnits.length + theme.length) : [];
  const units = [...fenceUnits, ...theme, ...handover];
  const counted = units.filter((u) => languages.includes(u.language));
  const errors = [];
  const checkers = {
    typescript: (u) => checkTypeScript(u, { repoRoot: root }),
    go: (u) => checkGo(u, { repoRoot: root }),
    python: (u) => checkPython(u, { repoRoot: root, python }),
    java: (u) => checkJava(u, { repoRoot: root, classpathFile: javaClasspath }),
  };
  for (const lang of languages) {
    const list = counted.filter((u) => u.language === lang);
    if (list.length > 0) errors.push(...checkers[lang](list));
  }
  const byUnit = new Map(counted.map((u) => [u.id, u]));
  return {
    units: counted,
    skipped: skipped.filter((s) => languages.includes(s.language)),
    problems,
    errors: dedupe(
      errors.map((e) => {
        const unit = byUnit.get(e.id);
        // Generated code has no page line: name what was written and its line.
        const where = unit?.variant === undefined ? e : { ...e, line: 1, message: `in the code written for ${unit.variant}, its line ${e.line}: ${e.message}` };
        return { ...where, generated: unit?.generated === true };
      }),
    ),
  };
}

// A prelude's error is found once per fragment it compiles through; it is
// reported once per line and message.
function dedupe(errors) {
  const seen = new Set();
  return errors.filter((e) => {
    const key = `${e.page}:${e.line}:${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The pages a run answers for on the list: the pages it read, the theme
 * playground's and the handover's writers when it compiled their code, and,
 * in a full run, every page the list names, so an entry for a page no longer
 * in the tree is stale. The writers are the exception: a tree without one has
 * no such units to judge.
 * @param {{pages: string[], units: {page: string}[], listed: Map<string, number>, full: boolean}} opts
 * @returns {Set<string>}
 */
export function scopeOf({ pages, units, listed, full }) {
  const scope = new Set(pages);
  for (const writer of [THEME_SNIPPET_FILE, HANDOVER_FILE]) {
    if (units.some((u) => u.page === writer)) scope.add(writer);
  }
  if (full) {
    for (const key of listed.keys()) {
      const page = key.split("\u0000")[0];
      if (page !== THEME_SNIPPET_FILE && page !== HANDOVER_FILE) scope.add(page);
    }
  }
  return scope;
}

/**
 * The gate's verdict over one run: which failures the list covers, which it
 * does not, the stale entries and the growth against the base.
 * @param {{units: object[], errors: object[]}} run
 * @param {{listed: Map<string, number>, base: Map<string, number> | null, scope: Set<string>, languages: string[]}} list
 */
export function judge(run, { listed, base, scope, languages }) {
  const failingIds = new Set(run.errors.map((e) => e.id));
  const failing = failingMultiset(run.units, failingIds);
  const scoped = within(listed, scope, new Set(languages));
  const { unlisted, stale } = compareToList(failing, scoped);
  const unlistedKeys = new Set(unlisted.map(entryKey));
  return { failing, unlisted, stale, grown: growthAgainstBase(listed, base), unlistedKeys };
}

function readBaseList(docsRoot, ref) {
  try {
    const text = execFileSync("git", ["show", `${ref}:${KNOWN_FAILING_FILE}`], { cwd: docsRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return parseList(text);
  } catch (err) {
    const stderr = String(err.stderr ?? "");
    if (/does not exist|exists on disk, but not in/.test(stderr)) return null;
    throw new Error(`cannot read ${KNOWN_FAILING_FILE} at ${ref}: ${stderr.trim() || err.message}`);
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        lang: { type: "string" },
        page: { type: "string" },
        python: { type: "string" },
        "java-classpath": { type: "string" },
        base: { type: "string" },
        prune: { type: "boolean", default: false },
        "init-list": { type: "boolean", default: false },
        "docs-root": { type: "string" },
        summary: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
  const languages = values.lang === undefined ? ALL_LANGUAGES : values.lang.split(",");
  const unknown = languages.filter((l) => !ALL_LANGUAGES.includes(l));
  if (unknown.length > 0) {
    process.stderr.write(`unknown --lang ${unknown.join(", ")} (known: ${ALL_LANGUAGES.join(", ")})\n`);
    process.exit(2);
  }
  const docsRoot = values["docs-root"] === undefined ? repoRoot : resolve(values["docs-root"]);
  const listFile = join(docsRoot, KNOWN_FAILING_FILE);
  if (values["init-list"] && existsSync(listFile)) {
    process.stderr.write(`${KNOWN_FAILING_FILE} exists; --init-list only writes the first one (the list may only shrink: --prune)\n`);
    process.exit(2);
  }
  const pages = docsPages(docsRoot).filter((p) => values.page === undefined || p.startsWith(values.page));
  const withTheme = values.page === undefined || THEME_SNIPPET_FILE.startsWith(values.page);
  const withHandover = values.page === undefined || HANDOVER_FILE.startsWith(values.page);
  const run = await runGate({ root: repoRoot, docsRoot, pages, languages, python: values.python, javaClasspath: values["java-classpath"], withTheme, withHandover });

  if (values["init-list"]) {
    const failing = failingMultiset(run.units, new Set(run.errors.map((e) => e.id)));
    writeFileSync(listFile, formatList(failing));
    process.stdout.write(`wrote ${KNOWN_FAILING_FILE}: ${[...failing.values()].reduce((a, b) => a + b, 0)} failing fences\n`);
    return;
  }

  const listed = existsSync(listFile) ? parseList(readFileSync(listFile, "utf8")) : new Map();
  const base = values.base === undefined ? null : readBaseList(docsRoot, values.base);
  const scope = scopeOf({ pages, units: run.units, listed, full: values.page === undefined });
  const verdict = judge(run, { listed, base, scope, languages });

  if (values.prune) {
    const inRun = within(listed, scope, new Set(languages));
    const kept = prune(inRun, verdict.failing);
    // Entries outside this run's pages and languages are kept as they are.
    for (const [key, count] of listed) if (!inRun.has(key)) kept.set(key, count);
    writeFileSync(listFile, formatList(kept));
    process.stdout.write(`pruned ${KNOWN_FAILING_FILE}: ${[...kept.values()].reduce((a, b) => a + b, 0)} listed\n`);
    verdict.stale = [];
  }

  const failingUnits = new Set(run.errors.map((e) => e.id));
  const unitById = new Map(run.units.map((u) => [u.id, u]));
  const shown = run.errors.filter((e) => {
    const u = unitById.get(e.id);
    return u !== undefined && verdict.unlistedKeys.has(entryKey({ page: u.page, language: u.language, sha: fenceDigest(u.text) }));
  });
  if (!values.summary) {
    for (const p of run.problems) process.stdout.write(`${p.page}:${p.line}: ${p.message}\n`);
    for (const e of shown) {
      const where = e.generated ? " (generated page: fix its generator)" : "";
      process.stdout.write(`${e.page}:${e.line}: ${e.message.replace(/\n/g, "\n    ")}${where}\n`);
    }
    for (const s of verdict.stale) {
      process.stdout.write(`${s.page}: a listed ${s.language} fence (${s.sha}) now compiles or is gone; run the gate with --prune to drop it from ${KNOWN_FAILING_FILE}\n`);
    }
    for (const g of verdict.grown) {
      process.stdout.write(`${KNOWN_FAILING_FILE}: ${g.page} ${g.language} ${g.sha} is not on ${values.base}'s list; the list may only shrink, so fix the fence instead\n`);
    }
  }
  const listedCount = [...verdict.failing.values()].reduce((a, b) => a + b, 0) - verdict.unlisted.reduce((a, u) => a + u.extra, 0);
  const rows = languages.map((lang) => {
    const list = run.units.filter((u) => u.language === lang);
    const bad = list.filter((u) => failingUnits.has(u.id));
    return `${lang}: ${list.length} compiled (${list.filter((u) => !u.generated).length} hand-written), ${bad.length} failing (${bad.filter((u) => !u.generated).length} hand-written), ${run.skipped.filter((s) => s.language === lang).length} marked no-compile`;
  });
  process.stdout.write(`${rows.join("\n")}\n`);
  const refused = run.problems.length + verdict.unlisted.length + verdict.stale.length + verdict.grown.length;
  if (refused > 0) {
    const unlisted = verdict.unlisted.reduce((a, u) => a + u.extra, 0);
    process.stdout.write(
      `✗ docs snippets: ${unlisted} failing fences not on the list, ${verdict.stale.length} stale entries, ${verdict.grown.length} entries the base does not hold, ${run.problems.length} malformed fences (${listedCount} listed failures allowed)\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`✓ docs snippets: every fence compiles or says why it cannot (${listedCount} listed failures allowed, ${KNOWN_FAILING_FILE})\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
