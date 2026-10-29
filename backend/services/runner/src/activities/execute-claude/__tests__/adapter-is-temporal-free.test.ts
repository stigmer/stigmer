/**
 * Pins that the Claude adapter is an engine slice and nothing more: no
 * production module under `activities/execute-claude/` imports
 * `@temporalio/*`.
 *
 * Why it matters: every Temporal fact a turn needs (the heartbeat, the
 * cancellation, the throw the workflow sees) is the turn runtime's
 * (`harness/run-turn.ts`) and reaches the adapter through the sink. The
 * contract kit runs an adapter outside any activity context
 * (`__test-utils__/harness-contract/`), and the agent host runs it in a
 * process with no worker at all (`agent-host/host.ts`), so a
 * `Context.current()` anywhere in the adapter would throw there. The Stigmer harness's
 * fence is the precedent; this is its Claude twin.
 */

import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { packageImports, readSource, typeScriptFilesUnder } from "../../../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ADAPTER_ROOT = join(SRC_ROOT, "activities", "execute-claude");

describe("the Claude adapter never imports @temporalio", () => {
  const files = typeScriptFilesUnder(ADAPTER_ROOT, new Set(["__tests__", "__test-utils__"]));
  const offences = files.flatMap((file) =>
    packageImports(file, readSource(file), "@temporalio").map((specifier) => `  ${relative(SRC_ROOT, file)} imports "${specifier}"`),
  );

  it("inspected the adapter's own files (the walk is rooted where it claims)", () => {
    expect(files.map((f) => relative(ADAPTER_ROOT, f))).toEqual(
      expect.arrayContaining(["adapter.ts", "turn.ts", "gate.ts", "translator.ts", "session-store.ts", "claude-capabilities.ts"]),
    );
  });

  it("finds no @temporalio import in any production module", () => {
    expect(offences, `the Claude adapter must not import @temporalio/*:\n${offences.join("\n")}`).toEqual([]);
  });
});
