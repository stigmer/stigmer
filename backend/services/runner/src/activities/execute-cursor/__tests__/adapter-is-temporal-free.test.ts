/**
 * Pins that the Cursor adapter is an SDK slice and nothing more: no
 * production module under `activities/execute-cursor/` imports
 * `@temporalio/*`.
 *
 * Why it matters: every Temporal fact a turn needs — the heartbeat, the
 * cancellation, the throw the workflow sees — is the turn runtime's
 * (`harness/run-turn.ts`) and reaches the adapter through the sink. The
 * contract kit runs an adapter OUTSIDE any activity context
 * (`__test-utils__/harness-contract/`), so a `Context.current()` anywhere
 * in the adapter would throw there; and an adapter that threw a
 * `CancelledFailure` would be deciding pause-vs-shutdown, which is the
 * runtime's table. A static fence names the file in seconds where the kit
 * would name it after a stack trace.
 *
 * Read off the syntax tree with the same primitive the import-direction
 * fence uses (`__test-utils__/module-specifiers.ts`), so a package name in a
 * comment cannot trip it and no import form can slip past it.
 */

import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { packageImports, readSource, typeScriptFilesUnder } from "../../../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ADAPTER_ROOT = join(SRC_ROOT, "activities", "execute-cursor");

describe("the Cursor adapter never imports @temporalio", () => {
  const files = typeScriptFilesUnder(ADAPTER_ROOT, new Set(["__tests__", "__test-utils__"]));
  const offences = files.flatMap((file) =>
    packageImports(file, readSource(file), "@temporalio").map((specifier) => `  ${relative(SRC_ROOT, file)} imports "${specifier}"`),
  );

  it("inspected the adapter's own files (the walk is rooted where it claims)", () => {
    expect(files.map((f) => relative(ADAPTER_ROOT, f))).toEqual(
      expect.arrayContaining(["adapter.ts", "turn.ts", "turn-setup.ts", "turn-stream.ts", "turn-settle.ts"]),
    );
  });

  it("finds no @temporalio import in any production module", () => {
    expect(offences, `the Cursor adapter must not import @temporalio/*:\n${offences.join("\n")}`).toEqual([]);
  });
});
