/**
 * Pins that the native adapter's lifecycle module loads no engine: nothing
 * on `adapter.ts`'s STATIC graph — the module and every relative module it
 * loads at import time, transitively — names `deepagents`, `@langchain/*`
 * or `@temporalio/*`.
 *
 * Why it matters: the composition roots import the harness table
 * (`src/harness-adapters.ts`) BEFORE they boot it, and that table must stay
 * connect- and SDK-free (the Cursor adapter's boot patches `node:http2`
 * before anything dials the control plane; `harness-adapters.ts` states the
 * rule). An adapter that imported its SDK at the top of its module would
 * defeat it: this adapter's row is the table's second (#1096, 2026-09-13).
 * This fence is THE proof that the engine is not on the static graph — it
 * walks every relative module transitively and records every package the
 * graph names; the boot ORDER (native's `boot` runs after the Cursor patch)
 * is proven in a real process by `src/__tests__/harness-boot-order.test.ts`,
 * which boots both rows.
 *
 * Read off the syntax tree (`__test-utils__/module-specifiers.ts`): a
 * `import type` is erased and a dynamic `import()` runs only inside `boot`,
 * so neither is on the static graph; a package name in a header comment
 * cannot trip it.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readSource, staticRuntimeSpecifiers } from "../../../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ADAPTER = join(SRC_ROOT, "activities", "execute-deep-agent", "adapter.ts");
const FORBIDDEN = ["deepagents", "@langchain/", "@temporalio/"] as const;

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
      // `.js` specifiers name `.ts` sources (NodeNext); a directory specifier is not used here.
      const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
      if (existsSync(target)) visit(target);
    }
  };
  visit(entry);
  return { files, packages };
}

describe("the native adapter's static graph is SDK-free", () => {
  const graph = walkStaticGraph(ADAPTER);

  it("walked the lifecycle module and stayed out of the engine slice", () => {
    const walked = graph.files.map((f) => relative(SRC_ROOT, f));
    expect(walked).toContain("activities/execute-deep-agent/adapter.ts");
    expect(walked).toContain("activities/execute-deep-agent/deep-agent-capabilities.ts");
    // The engine slice is reached only through the dynamic import inside `boot`.
    expect(walked).not.toContain("activities/execute-deep-agent/turn.ts");
    expect(walked).not.toContain("activities/execute-deep-agent/turn-setup.ts");
    expect(walked).not.toContain("activities/execute-deep-agent/deepagents-profiles.ts");
  });

  it("names no engine or Temporal package anywhere on the graph", () => {
    const offences = graph.packages.filter((p) => FORBIDDEN.some((root) => p === root.replace(/\/$/, "") || p.startsWith(root)));
    expect(offences, `adapter.ts's static graph must stay SDK-free; found: ${offences.join(", ")}`).toEqual([]);
  });
});
