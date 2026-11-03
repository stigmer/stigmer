#!/usr/bin/env node

/**
 * The docs snippet gate: every TypeScript, Go, Python and Java code fence
 * under `docs/` compiles against the package it shows, or says why it
 * cannot (`no-compile="<reason>"`). The YAML fences have their own gate
 * (`make check-docs-yaml`), whose three-kind shape this one follows: a whole
 * file, a fragment compiled inside a prelude, or a marked exception
 * (`scripts/lib/docs-snippets/fences.mjs`).
 *
 * A failing fence is named by page and line. A fence on a generated page is
 * fixed at its generator (the page carries the generator's marker), and the
 * report says so.
 *
 * What each compiler needs (CI's `ci.docs-snippets` lane sets all four up):
 *   - TypeScript: the workspace's built libraries (`npm run build:libs`);
 *   - Go: the toolchain `go.work` names;
 *   - Python: `--python=<interpreter>` of a virtual environment with the
 *     stubs and the SDK installed, and pyright (the root devDependency);
 *   - Java: `--java-classpath=<file>` holding the SDK's runtime classpath
 *     (`mvn dependency:build-classpath`), the SDK's classes first.
 *
 *   node scripts/check-docs-snippets.mjs [--lang=typescript,go,python,java]
 *     [--page=<path prefix>] [--python=<path>] [--java-classpath=<file>]
 *     [--summary]
 *
 * Exits 1 when any fence fails, 2 on a usage error.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { collectUnits } from "./lib/docs-snippets/collect.mjs";
import { checkGo } from "./lib/docs-snippets/go.mjs";
import { checkJava } from "./lib/docs-snippets/java.mjs";
import { checkPython } from "./lib/docs-snippets/python.mjs";
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
 * Runs the gate and returns its findings; the CLI prints them.
 * @param {{root: string, pages: string[], languages: string[], python?: string, javaClasspath?: string}} opts
 */
export function runGate({ root, pages, languages, python, javaClasspath }) {
  const { units, skipped, problems } = collectUnits(root, pages);
  const errors = [...problems];
  const counted = units.filter((u) => languages.includes(u.language));
  const of = (lang) => counted.filter((u) => u.language === lang);
  const checkers = {
    typescript: (u) => checkTypeScript(u, { repoRoot: root }),
    go: (u) => checkGo(u, { repoRoot: root }),
    python: (u) => checkPython(u, { repoRoot: root, python }),
    java: (u) => checkJava(u, { repoRoot: root, classpathFile: javaClasspath }),
  };
  for (const lang of languages) {
    const list = of(lang);
    if (list.length > 0) errors.push(...checkers[lang](list));
  }
  const byUnit = new Map(counted.map((u) => [u.id, u]));
  return {
    units: counted,
    skipped: skipped.filter((s) => languages.includes(s.language)),
    errors: errors.map((e) => ({ ...e, generated: e.id === undefined ? false : byUnit.get(e.id)?.generated === true })),
  };
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        lang: { type: "string" },
        page: { type: "string" },
        python: { type: "string" },
        "java-classpath": { type: "string" },
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
  const pages = docsPages(repoRoot).filter((p) => values.page === undefined || p.startsWith(values.page));
  const { units, skipped, errors } = runGate({
    root: repoRoot,
    pages,
    languages,
    python: values.python,
    javaClasspath: values["java-classpath"],
  });

  const failing = new Set(errors.map((e) => e.id ?? `${e.page}:${e.line}`));
  if (!values.summary) {
    for (const e of errors) {
      const where = e.generated ? " (generated page: fix its generator)" : "";
      process.stdout.write(`${e.page}:${e.line}: ${e.message.replace(/\n/g, "\n    ")}${where}\n`);
    }
  }
  const rows = languages.map((lang) => {
    const list = units.filter((u) => u.language === lang);
    const bad = list.filter((u) => failing.has(u.id));
    return `${lang}: ${list.length} compiled (${list.filter((u) => !u.generated).length} hand-written), ${bad.length} failing (${bad.filter((u) => !u.generated).length} hand-written), ${skipped.filter((s) => s.language === lang).length} marked no-compile`;
  });
  process.stdout.write(`${rows.join("\n")}\n`);
  if (errors.length > 0) {
    process.stdout.write(`✗ docs snippets: ${failing.size} fences fail to compile\n`);
    process.exit(1);
  }
  process.stdout.write(`✓ docs snippets: every fence compiles or says why it cannot\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
