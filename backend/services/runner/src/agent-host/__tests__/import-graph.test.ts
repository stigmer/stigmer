/**
 * Pins the agent host's static import graph: no module the runner's entry
 * (`main.ts`, whose static imports load before its mode dispatch) or the
 * host's own entry (`entry.ts`) loads statically may reach Temporal's native
 * worker. The locked host (`fence.ts`) runs this same entry under Node's
 * permission model, where loading a native addon fails with
 * ERR_DLOPEN_DISABLED; `main.ts` therefore loads `runner.js` and
 * `runner-manager.js` with dynamic imports inside the modes that need them.
 *
 * This is the fast twin of the check that cannot drift from what ships:
 * `scripts/verify-agent-host-boot.mjs --fenced` boots the compiled and the
 * bundled entry under the lock and boots the Stigmer harness there. This
 * one names the cause in `npm test`, before a build exists. Only direct
 * specifiers are walked: a package that loads the worker itself is the boot
 * check's to catch.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The packages that load Temporal's native addon. */
const NATIVE_TEMPORAL = ["@temporalio/worker", "@temporalio/core-bridge"];

/** Value imports only: `import type` and `export type` load nothing, and `import(...)` is not static. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const match of text.matchAll(pattern)) specs.push(match[1]!);
  return specs;
}

function sourceOf(rel: string): string | undefined {
  for (const candidate of [rel.replace(/\.js$/, ".ts"), rel.replace(/\.js$/, ".tsx"), rel]) {
    if (existsSync(join(SRC, candidate)) && candidate.endsWith(".ts")) return candidate;
  }
  return undefined;
}

/** Every local module and every package specifier reached statically from `roots`, each package with the module that names it. */
function walk(roots: readonly string[]): { local: Set<string>; external: Map<string, string> } {
  const local = new Set<string>();
  const external = new Map<string, string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const rel = queue.pop()!;
    if (local.has(rel)) continue;
    local.add(rel);
    for (const spec of importsOf(join(SRC, rel))) {
      if (spec.startsWith(".")) {
        const target = sourceOf(relative(SRC, resolve(SRC, dirname(rel), spec)));
        if (target !== undefined) queue.push(target);
      } else if (!external.has(spec)) {
        external.set(spec, rel);
      }
    }
  }
  return { local, external };
}

describe("the agent host's import graph", () => {
  it("reaches no module that loads Temporal's native worker", () => {
    const { local, external } = walk(["main.ts", "agent-host/entry.ts"]);
    expect(local.has("agent-host/host.ts"), "the walk reaches the host").toBe(true);
    const native = [...external].filter(([spec]) => NATIVE_TEMPORAL.some((name) => spec === name || spec.startsWith(`${name}/`)));
    expect(native.map(([spec, from]) => `${spec} (imported by ${from})`)).toEqual([]);
  });

  it("loads the runner's Temporal side only from the modes that need it", () => {
    const { local } = walk(["main.ts", "agent-host/entry.ts"]);
    expect(local.has("runner.ts")).toBe(false);
    expect(local.has("runner-manager.ts")).toBe(false);
  });
});
