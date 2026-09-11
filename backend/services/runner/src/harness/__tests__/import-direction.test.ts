/**
 * Pins the import direction the turn runtime stands on: nothing under
 * `src/harness/` imports from `src/activities/`, and no production module
 * under `src/shared/` does either.
 *
 * Why it matters (the extraction plan, section 3): the runtime is meant to
 * be written once and call harness-specific code only through the adapter
 * contract. If `harness/` could reach into `activities/execute-cursor/`, the
 * runtime would be Cursor's orchestrator in a new directory and the "SDK
 * slice plus a registry row" promise for the next harness would be false.
 * The `shared/` half is what makes the `harness/` half hold: `harness/`
 * imports `shared/` freely, so a `shared/` module that imported
 * `activities/` would open the same door one hop away.
 *
 * The rule is read off the TypeScript syntax tree, not a regex, so a path
 * quoted in a header comment (several `shared/` modules cite
 * `activities/...` in prose) cannot trip it, and no import form can slip
 * past it: static, type-only, side-effect, re-export and dynamic `import()`
 * are all module specifiers to the parser. Ruled at the S2 gate (Q-S2-9);
 * the `shared/` half ruled at the M1 gate (Q-M1-5).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FORBIDDEN_ROOT = join(SRC_ROOT, "activities");

/** Every module specifier a file names, in source order, whatever the form. */
function moduleSpecifiers(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

/**
 * The relative specifiers in `source` that resolve to a path inside
 * `forbiddenRoot`. Package specifiers are ignored: no alias maps a package
 * name onto `src/activities/`.
 */
function forbiddenImports(
  filePath: string,
  source: string,
  forbiddenRoot: string,
): string[] {
  return moduleSpecifiers(filePath, source).filter((specifier) => {
    if (!specifier.startsWith(".")) return false;
    const target = resolve(dirname(filePath), specifier);
    return target === forbiddenRoot || target.startsWith(forbiddenRoot + sep);
  });
}

function typeScriptFilesUnder(
  dir: string,
  skipDirectories: ReadonlySet<string>,
): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirectories.has(entry.name)) {
        files.push(...typeScriptFilesUnder(path, skipDirectories));
      }
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

interface Offence {
  readonly file: string;
  readonly specifier: string;
}

interface Sweep {
  /** Files inspected, relative to `src/`; the liveness guards read this. */
  readonly visited: string[];
  readonly offences: Offence[];
}

function sweep(root: string, skipDirectories: ReadonlySet<string>): Sweep {
  const visited: string[] = [];
  const offences: Offence[] = [];
  for (const file of typeScriptFilesUnder(root, skipDirectories)) {
    const relativeFile = relative(SRC_ROOT, file);
    visited.push(relativeFile);
    for (const specifier of forbiddenImports(
      file,
      readFileSync(file, "utf-8"),
      FORBIDDEN_ROOT,
    )) {
      offences.push({ file: relativeFile, specifier });
    }
  }
  return { visited, offences };
}

function describeOffences(offences: readonly Offence[]): string {
  return offences.map((o) => `  ${o.file} imports "${o.specifier}"`).join("\n");
}

describe("forbiddenImports (the checker itself)", () => {
  const file = join(SRC_ROOT, "harness", "run-turn.ts");

  it.each([
    [
      "a static import",
      'import { a } from "../activities/execute-cursor/x.js";',
    ],
    [
      "a type-only import",
      'import type { A } from "../activities/execute-cursor/x.js";',
    ],
    ["a side-effect import", 'import "../activities/execute-cursor/x.js";'],
    ["a re-export", 'export { a } from "../activities/execute-cursor/x.js";'],
    ["a star re-export", 'export * from "../activities/x.js";'],
    [
      "a dynamic import",
      'const m = await import("../activities/execute-cursor/x.js");',
    ],
    [
      "a path that leaves and re-enters",
      'import { a } from "../shared/../activities/x.js";',
    ],
  ])("flags %s", (_label, source) => {
    expect(forbiddenImports(file, source, FORBIDDEN_ROOT)).toHaveLength(1);
  });

  it.each([
    ["a shared import", 'import { a } from "../shared/status.js";'],
    ["a sibling import", 'import { a } from "./types.js";'],
    ["a package import", 'import { create } from "@bufbuild/protobuf";'],
    ["a node builtin", 'import { join } from "node:path";'],
    [
      "a forbidden path quoted in a comment",
      '// see: import { a } from "../activities/execute-cursor/x.js"\nimport { b } from "./types.js";',
    ],
    [
      "a forbidden path in a plain string",
      'const hint = "../activities/execute-cursor/x.js";',
    ],
    [
      "a dynamic import whose specifier is not a literal",
      "const m = await import(pathFromConfig);",
    ],
  ])("does not flag %s", (_label, source) => {
    expect(forbiddenImports(file, source, FORBIDDEN_ROOT)).toEqual([]);
  });

  it("names every offending specifier when a file has several", () => {
    const source = [
      'import { a } from "../activities/a.js";',
      'import { b } from "../shared/b.js";',
      'export { c } from "../activities/c.js";',
    ].join("\n");
    expect(forbiddenImports(file, source, FORBIDDEN_ROOT)).toEqual([
      "../activities/a.js",
      "../activities/c.js",
    ]);
  });
});

describe("src/harness never imports src/activities", () => {
  const result = sweep(join(SRC_ROOT, "harness"), new Set());

  it("inspected the runtime's own files (the walk is rooted where it claims)", () => {
    expect(result.visited).toEqual(
      expect.arrayContaining([
        join("harness", "registry.ts"),
        join("harness", "types.ts"),
        join("harness", "capabilities.ts"),
      ]),
    );
  });

  it("finds no import into src/activities, tests included", () => {
    expect(
      result.offences,
      `src/harness/ must not import from src/activities/:\n${describeOffences(result.offences)}`,
    ).toEqual([]);
  });
});

describe("src/shared production modules never import src/activities", () => {
  // Tests under shared/__tests__ may legitimately import both harnesses'
  // implementations to compare them (attachment-naming.test.ts does); the
  // rule is about what production code can reach.
  const result = sweep(join(SRC_ROOT, "shared"), new Set(["__tests__"]));

  it("inspected the shared modules (the walk is rooted where it claims)", () => {
    expect(result.visited).toEqual(
      expect.arrayContaining([
        join("shared", "status.ts"),
        join("shared", "workspace", "session-provision.ts"),
      ]),
    );
    expect(
      result.visited.some((f) => f.includes(`${sep}__tests__${sep}`)),
      "the production sweep must skip __tests__ directories",
    ).toBe(false);
  });

  it("finds no import into src/activities", () => {
    expect(
      result.offences,
      `src/shared/ production code must not import from src/activities/:\n${describeOffences(result.offences)}`,
    ).toEqual([]);
  });
});
