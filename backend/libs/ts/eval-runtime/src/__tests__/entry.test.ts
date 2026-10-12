/**
 * Pins the package's root entry as safe for a browser bundle: neither it nor
 * any module it reaches through relative imports loads a `node:*` module.
 * `@stigmer/plugin-package`'s main entry imports this root and promises a
 * browser can run it (its README), and the console bundles that entry. The
 * AI judge's rule set hashes with `node:crypto`, so it lives behind its own
 * subpath, `@stigmer/eval-runtime/judge`, which the root never re-exports.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every module `entry` reaches through relative imports, with the specifiers each imports. */
function reachable(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    const source = readFileSync(file, "utf8");
    const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    seen.set(file, specifiers);
    for (const specifier of specifiers.filter((s) => s.startsWith("."))) {
      visit(join(dirname(file), specifier.replace(/\.js$/, ".ts")));
    }
  };
  visit(entry);
  return seen;
}

describe("the root entry", () => {
  it("reaches no node:* module, so a browser bundle can load it", () => {
    const offending = [...reachable(join(SRC, "index.ts"))]
      .flatMap(([file, specifiers]) => specifiers.filter((s) => s.startsWith("node:")).map((s) => `${file}: ${s}`));
    expect(offending).toEqual([]);
  });
});
