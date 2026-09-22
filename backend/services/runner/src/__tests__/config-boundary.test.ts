/**
 * Pins the environment boundary of the runner's configuration: `loadConfig`
 * is bound by `main.ts` and by no other production module.
 *
 * Why it matters (config.ts header): `loadConfig()` reads the environment and
 * returns a `Config` whose credential ref holds the BOOT capture. The two
 * roots turn that value into the one live ref the process rotates (a pool
 * claim, a sandbox-token renewal, a host refresh) and hand every activity a
 * `Config` carrying it. An activity that called `loadConfig()` itself would
 * hold a second `Config` with a second ref that no rotation ever writes —
 * the shape that kept a claimed pool member presenting its pool credential
 * to the checkpoint proxy — and a module-level client built from it would
 * freeze the boot credential for the process's life. Four activity modules
 * did exactly that until their factories took the injected `Config`; this
 * fence is what keeps a fifth from appearing.
 *
 * The rule is read off the TypeScript syntax tree
 * (`__test-utils__/module-specifiers.ts`), so a `loadConfig` in a comment
 * cannot trip it and no static import form slips past it: a named import,
 * an aliased one, a type-only one and a namespace import of `config.js`
 * (which binds every export at once) are all offences. A dynamic
 * `import("../config.js")` is refused too: nothing but `main.ts` may load
 * that module at all, so the fence need not read what is destructured from
 * it. Tests and test utilities are outside the sweep — a test may exercise
 * `loadConfig` directly (`config.test.ts` does).
 */

import { describe, it, expect } from "vitest";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  importedBindings,
  moduleSpecifiers,
  readSource,
  typeScriptFilesUnder,
} from "../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONFIG_MODULE = "config.js";
const THE_ONE_CALLER = "main.ts";
const OUTSIDE_THE_SWEEP = new Set(["__tests__", "__test-utils__"]);

interface Offence {
  readonly file: string;
  readonly how: string;
}

/** Whether `specifier` resolves to `src/config.ts` from anywhere under `src/`. */
function namesConfigModule(specifier: string): boolean {
  return specifier.startsWith(".") && basename(specifier) === CONFIG_MODULE;
}

/** The offences in one file: a `loadConfig` binding, a namespace import of config, or a dynamic import of it. */
function offencesIn(filePath: string, source: string): string[] {
  const how: string[] = [];
  for (const binding of importedBindings(filePath, source)) {
    if (!namesConfigModule(binding.specifier)) continue;
    if (binding.name === "loadConfig") how.push("imports loadConfig");
    if (binding.name === "*") how.push("imports config.js as a namespace");
  }
  const declared = new Set(importedBindings(filePath, source).map((b) => b.specifier));
  for (const specifier of moduleSpecifiers(filePath, source)) {
    if (namesConfigModule(specifier) && !declared.has(specifier)) {
      how.push("loads config.js dynamically");
    }
  }
  return how;
}

describe("offencesIn (the checker itself)", () => {
  const file = join(SRC_ROOT, "activities", "some-activity.ts");

  it.each([
    ["a named import", 'import { loadConfig } from "../config.js";'],
    ["an aliased import", 'import { loadConfig as boot } from "../config.js";'],
    ["a type-only import", 'import type { loadConfig } from "../config.js";'],
    ["a namespace import", 'import * as cfg from "../config.js";'],
    ["a dynamic import", 'const { loadConfig } = await import("../config.js");'],
  ])("flags %s", (_label, source) => {
    expect(offencesIn(file, source)).toHaveLength(1);
  });

  it.each([
    ["the Config type", 'import type { Config } from "../config.js";'],
    ["a constant beside it", 'import { DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS, type Config } from "../config.js";'],
    ["the name in a comment", '// loadConfig() is main.ts\'s\nimport type { Config } from "../config.js";'],
    ["the name in a string", 'const hint = "loadConfig";'],
    ["a loadConfig from another module", 'import { loadConfig } from "@stigmer/server";'],
  ])("does not flag %s", (_label, source) => {
    expect(offencesIn(file, source)).toEqual([]);
  });
});

describe("loadConfig is bound by main.ts alone", () => {
  const visited: string[] = [];
  const offences: Offence[] = [];
  for (const file of typeScriptFilesUnder(SRC_ROOT, OUTSIDE_THE_SWEEP)) {
    const relativeFile = relative(SRC_ROOT, file);
    visited.push(relativeFile);
    if (relativeFile === THE_ONE_CALLER) continue;
    for (const how of offencesIn(file, readSource(file))) {
      offences.push({ file: relativeFile, how });
    }
  }

  it("inspected the production tree (the walk is rooted where it claims)", () => {
    expect(visited).toEqual(
      expect.arrayContaining([
        "main.ts",
        "runner.ts",
        "runner-manager.ts",
        join("activities", "promote-task-output.ts"),
        join("activities", "call-agent.ts"),
        join("shared", "checkpointer", "factory.ts"),
      ]),
    );
    expect(visited.some((f) => f.includes("__tests__"))).toBe(false);
  });

  it("main.ts does bind it (the fence guards a caller that exists)", () => {
    expect(offencesIn(join(SRC_ROOT, THE_ONE_CALLER), readSource(join(SRC_ROOT, THE_ONE_CALLER)))).toEqual([
      "imports loadConfig",
    ]);
  });

  it("no other production module binds or loads it", () => {
    expect(
      offences,
      `loadConfig() is the environment boundary and main.ts's alone; an activity takes the runner's injected Config (config.ts header):\n${offences
        .map((o) => `  ${o.file} ${o.how}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
