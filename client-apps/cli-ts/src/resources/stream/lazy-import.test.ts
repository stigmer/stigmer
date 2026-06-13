// DD-001 boundary guard: React/Ink must load lazily so non-streaming commands
// and `--help` never pay for them. This codifies the boundary structurally so a
// regression (a stray static import) fails CI instead of silently slowing every
// command. The one allowed static importer is ink.tsx, which is itself only ever
// reached through a dynamic import().

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const INK_MODULE = join(SRC_ROOT, "resources/stream/ink.tsx");
const STATIC_HEAVY_IMPORT = /^\s*import\s+[^;]*?from\s+["'](?:react|ink|@stigmer\/ink)["']/m;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("lazy-import boundary (DD-001)", () => {
  it("only ink.tsx statically imports react/ink/@stigmer/ink", () => {
    const offenders = walk(SRC_ROOT)
      .filter((path) => path !== INK_MODULE)
      .filter((path) => STATIC_HEAVY_IMPORT.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("ink.tsx is reached only through dynamic import()", () => {
    const staticImporters = walk(SRC_ROOT).filter((path) => {
      if (path === INK_MODULE) return false;
      const src = readFileSync(path, "utf8");
      return /^\s*import\s+[^;]*?from\s+["'][^"']*stream\/ink(?:\.js)?["']/m.test(src);
    });
    expect(staticImporters).toEqual([]);
  });

  // The workflow run stream renders over a CLI-local plaintext/NDJSON renderer
  // (no Ink WorkflowView this round), so it must stay out of the React/Ink graph.
  it("workflow-stream.ts has no static react/ink imports", () => {
    const src = readFileSync(join(SRC_ROOT, "resources/run/workflow-stream.ts"), "utf8");
    expect(STATIC_HEAVY_IMPORT.test(src)).toBe(false);
  });

  // `connect` renders plaintext only; its command + resources stay Ink-free.
  it("connect command and resources have no static react/ink imports", () => {
    for (const rel of ["commands/connect.ts", "resources/connect/connect.ts", "resources/connect/display.ts"]) {
      const src = readFileSync(join(SRC_ROOT, rel), "utf8");
      expect(STATIC_HEAVY_IMPORT.test(src)).toBe(false);
    }
  });
});
