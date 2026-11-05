/**
 * Pins that no production runner module loads undici: nothing under `src/`
 * imports `undici` or `@stigmer/outbound/dial`, in any form, dynamic
 * `import()` included.
 *
 * Why it matters: the runner's Node floors (`package.json` engines, the
 * preflight message in `preflight.ts`, the pins in `preflight.test.ts`) are
 * set by what it loads, and that is `node:sqlite`: 22.13 in the 22.x line,
 * 23.4 after it. undici needs more (22.19 / 23.8; on 23.4–23.7 it crashes at
 * load), and `@stigmer/outbound` installs it for its `/dial` entry, which
 * makes undici the process's dispatcher. The runner takes outbound's `/egress`
 * and `/mcp-oauth` entries only (`tools/url-guard.ts` says why it declines
 * `/dial`), and neither imports undici, nor does the bare `@stigmer/outbound`
 * entry, which re-exports just those two. So the floors stay true only while
 * this fence holds. A dynamic load counts: it crashes the same Nodes, only
 * later, at its call.
 */

import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import { packageImports, readSource, typeScriptFilesUnder } from "../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The packages whose load would put the runner's floors below what it needs. */
const UNDICI_LOADERS = ["undici", "@stigmer/outbound/dial"] as const;

describe("the runner never loads undici", () => {
  const files = typeScriptFilesUnder(SRC_ROOT, new Set(["__tests__", "__test-utils__"]));
  const offences = files.flatMap((file) =>
    UNDICI_LOADERS.flatMap((pkg) => packageImports(file, readSource(file), pkg)).map(
      (specifier) => `  ${relative(SRC_ROOT, file)} imports "${specifier}"`,
    ),
  );

  it("inspected the modules that do import @stigmer/outbound (the walk is rooted where it claims)", () => {
    expect(files.map((f) => relative(SRC_ROOT, f))).toEqual(
      expect.arrayContaining(["tools/url-guard.ts", "shared/mcp-oauth-detect.ts", "main.ts", "preflight.ts"]),
    );
  });

  it("finds no import of undici or @stigmer/outbound/dial in any production module", () => {
    expect(
      offences,
      "the runner must not load undici: it needs Node 22.19 / 23.8, above the runner's floors. " +
        "If the runner truly needs it, move package.json engines, the preflight message (src/preflight.ts), " +
        "its pins (src/__tests__/preflight.test.ts) and README.md to @stigmer/outbound's range together, " +
        `then retire this fence:\n${offences.join("\n")}`,
    ).toEqual([]);
  });
});
