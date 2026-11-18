/**
 * Pins that undici, and the Node floor it brings, stay inside
 * `@stigmer/outbound/dial`. No module outside `src/dial/` names `undici` or
 * a path into `src/dial/`, in any form (static, re-export, dynamic
 * `import()`); the manifest names undici only as an optional peer and a
 * devDependency; and the package's `engines` is the family floor the
 * runner states, not undici's.
 *
 * Why it matters: the runner installs this library for `/egress` and
 * `/mcp-oauth` on Node 22.13 and 23.4, below undici's floor. While undici
 * was a hard dependency, every runner install fetched it and warned that the
 * Node was too old, for an entry the runner never loads. With undici an
 * optional peer that only `/dial` loads, a process that composes `/dial`
 * declares undici itself (the root guard
 * `scripts/outbound-dial-consumers.test.mjs` holds every consumer here to
 * it), and `dial/runtime-floor.ts` states the higher floor at load. A module
 * outside `src/dial/` that reached undici would bring the crash back to the
 * runner's Nodes with nothing in the manifest to warn of it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIAL = join(SRC, "dial");
const PACKAGE_ROOT = join(SRC, "..");

interface Manifest {
  readonly engines?: { readonly node?: string };
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
  readonly devDependencies?: Record<string, string>;
}

const readManifest = (path: string): Manifest => JSON.parse(readFileSync(path, "utf8")) as Manifest;

/** Every production module under `src/`, outside the dial entry and the tests. */
function modulesOutsideDial(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" || path === DIAL ? [] : modulesOutsideDial(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** What a module asks for that would load undici: the package itself, or a module of the dial entry. */
function undiciReaches(file: string, source: string): string[] {
  const specifiers = ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName);
  return specifiers.filter(
    (specifier) =>
      specifier === "undici" ||
      specifier.startsWith("undici/") ||
      (specifier.startsWith(".") && (resolve(dirname(file), specifier) + sep).startsWith(DIAL + sep)),
  );
}

describe("undici stays inside @stigmer/outbound/dial", () => {
  const files = modulesOutsideDial(SRC);

  it("walks the modules the other entries are made of (the walk is rooted where it claims)", () => {
    expect(files.map((f) => relative(SRC, f))).toEqual(
      expect.arrayContaining(["index.ts", join("egress", "index.ts"), join("mcp-oauth", "index.ts")]),
    );
  });

  it("no module outside src/dial/ names undici or a path into src/dial/", () => {
    const offences = files.flatMap((file) => undiciReaches(file, readFileSync(file, "utf8")).map((s) => `${relative(SRC, file)} imports "${s}"`));
    expect(offences).toEqual([]);
  });

  it("catches every form a reach can take, and not a mention in a comment", () => {
    const source = [
      "// undici and ../dial/index.js named in a comment load nothing",
      'import { Agent } from "undici";',
      'export { pinnedFetch } from "../dial/index.js";',
      'const lazy = () => import("../dial/pinned-fetch.js");',
      'import "./../dial/runtime-floor.js";',
      'import type { Dispatcher } from "undici/types/dispatcher";',
      'import { checkEgress } from "./check.js";',
    ].join("\n");
    expect(undiciReaches(join(SRC, "egress", "probe.ts"), source)).toEqual([
      "undici",
      "../dial/index.js",
      "../dial/pinned-fetch.js",
      "./../dial/runtime-floor.js",
      "undici/types/dispatcher",
    ]);
  });

  it("the manifest names undici only as an optional peer and a devDependency", () => {
    const manifest = readManifest(join(PACKAGE_ROOT, "package.json"));
    expect(manifest.dependencies?.undici).toBeUndefined();
    expect(manifest.optionalDependencies?.undici).toBeUndefined();
    expect(manifest.peerDependencies?.undici).toBeDefined();
    expect(manifest.peerDependenciesMeta?.undici?.optional).toBe(true);
    expect(manifest.devDependencies?.undici).toBe(manifest.peerDependencies?.undici);
  });

  it("engines is the runner's floor, which the entries outside src/dial/ need", () => {
    const own = readManifest(join(PACKAGE_ROOT, "package.json")).engines?.node;
    const runner = readManifest(join(PACKAGE_ROOT, "..", "..", "..", "services", "runner", "package.json")).engines?.node;
    expect(runner).toBeDefined();
    expect(own).toBe(runner);
  });
});
