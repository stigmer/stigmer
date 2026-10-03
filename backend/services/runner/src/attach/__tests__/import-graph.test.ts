/**
 * Pins the attach entry's import graph: a sandbox snapshot holds this process,
 * so it must stay small and load none of the runner (waiter.ts header). Walks
 * the static imports from entry.ts and main.ts through the source tree and
 * holds them to node built-ins, the attach folder, the two leaf modules it
 * needs (the secret-name list and the claim reader), and the codecs'
 * dependency-free `connection` subpath. `scripts/verify-attach-boot.mjs`
 * checks the compiled entry the same way at run time.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWED_LOCAL = new Set([
  "attach/main.ts",
  "attach/entry.ts",
  "attach/waiter.ts",
  "attach/push.ts",
  "shared/runner-credential-keys.ts",
  "client/token-claims.ts",
]);
const ALLOWED_PACKAGES = new Set(["@stigmer/temporal-codecs/connection"]);

/** Value imports only: `import type` and `export type` load nothing. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const match of text.matchAll(pattern)) specs.push(match[1]!);
  return specs;
}

function walk(): { local: Set<string>; external: Set<string> } {
  const local = new Set<string>();
  const external = new Set<string>();
  const queue = ["attach/main.ts", "attach/entry.ts"];
  while (queue.length > 0) {
    const rel = queue.pop()!;
    if (local.has(rel)) continue;
    local.add(rel);
    for (const spec of importsOf(join(SRC, rel))) {
      if (spec.startsWith(".")) {
        const target = relative(SRC, resolve(SRC, dirname(rel), spec)).replace(/\.js$/, ".ts");
        queue.push(target);
      } else {
        external.add(spec);
      }
    }
  }
  return { local, external };
}

describe("the attach entry's import graph", () => {
  it("reaches only the attach folder and its two leaf modules", () => {
    const { local } = walk();
    expect([...local].filter((f) => !ALLOWED_LOCAL.has(f))).toEqual([]);
  });

  it("loads only node built-ins and the codecs' connection subpath", () => {
    const { external } = walk();
    const unexpected = [...external].filter((s) => !s.startsWith("node:") && !ALLOWED_PACKAGES.has(s));
    expect(unexpected).toEqual([]);
  });
});
