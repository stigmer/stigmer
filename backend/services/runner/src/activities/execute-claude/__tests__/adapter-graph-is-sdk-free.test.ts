/**
 * Pins that the Claude adapter's lifecycle module loads no engine: nothing
 * on `adapter.ts`'s STATIC graph (the module and every relative module it
 * loads at import time, transitively) names
 * `@anthropic-ai/claude-agent-sdk` or `@temporalio/*`.
 *
 * Why it matters: the composition roots import the harness table
 * (`src/harness-adapters.ts`) before they boot it, and that table must stay
 * connect- and SDK-free (`harness-adapters.ts` states the rule). It matters
 * twice here: a runner without the engine must still load the table and
 * boot, refusing only Claude turns (`adapter.ts`), which a static import of
 * the engine would make impossible. The boot order in a real process is
 * `src/__tests__/harness-boot-order.test.ts`'s.
 *
 * Read off the syntax tree (`__test-utils__/module-specifiers.ts`): an
 * `import type` is erased and the dynamic `import()` runs only inside
 * `boot`, so neither is on the static graph.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readSource, staticRuntimeSpecifiers } from "../../../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ADAPTER = join(SRC_ROOT, "activities", "execute-claude", "adapter.ts");
const FORBIDDEN = ["@anthropic-ai/claude-agent-sdk", "@temporalio/"] as const;

/** Every file on the static graph rooted at `entry`, and every package the graph names. */
function walkStaticGraph(entry: string): { files: string[]; packages: string[] } {
  const files: string[] = [];
  const packages: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    files.push(file);
    for (const specifier of staticRuntimeSpecifiers(file, readSource(file))) {
      if (!specifier.startsWith(".")) {
        packages.push(specifier);
        continue;
      }
      const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
      if (existsSync(target)) visit(target);
    }
  };
  visit(entry);
  return { files, packages };
}

describe("the Claude adapter's static graph is SDK-free", () => {
  const graph = walkStaticGraph(ADAPTER);

  it("walked the lifecycle module and stayed out of the engine slice", () => {
    const walked = graph.files.map((f) => relative(SRC_ROOT, f));
    expect(walked).toContain("activities/execute-claude/adapter.ts");
    expect(walked).toContain("activities/execute-claude/claude-capabilities.ts");
    // The engine slice is reached only through the dynamic import inside `boot`.
    expect(walked).not.toContain("activities/execute-claude/turn.ts");
    expect(walked).not.toContain("activities/execute-claude/engine-options.ts");
    expect(walked).not.toContain("activities/execute-claude/translator.ts");
  });

  it("names no engine or Temporal package anywhere on the graph", () => {
    const offences = graph.packages.filter((p) => FORBIDDEN.some((root) => p === root.replace(/\/$/, "") || p.startsWith(root)));
    expect(offences, `adapter.ts's static graph must stay SDK-free; found: ${offences.join(", ")}`).toEqual([]);
  });
});
