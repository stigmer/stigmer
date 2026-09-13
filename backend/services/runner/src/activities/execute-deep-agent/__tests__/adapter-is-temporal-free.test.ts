/**
 * Pins that the native adapter is an engine slice and nothing more: no
 * production module under `activities/execute-deep-agent/` imports
 * `@temporalio/*` — with ONE tolerated exception until M2b, named below.
 *
 * Why it matters: every Temporal fact a turn needs — the heartbeat, the
 * cancellation, the throw the workflow sees — is the turn runtime's
 * (`harness/run-turn.ts`) and reaches the adapter through the sink. The
 * contract kit runs an adapter OUTSIDE any activity context
 * (`__test-utils__/harness-contract/`), so a `Context.current()` anywhere
 * in the adapter would throw there; and an adapter that threw a
 * `CancelledFailure` would be deciding pause-vs-shutdown, which is the
 * runtime's table. The Cursor adapter's fence
 * (`execute-cursor/__tests__/adapter-is-temporal-free.test.ts`) is the
 * precedent; this is its native twin.
 *
 * The exception: `index.ts` is the orchestrator the adapter replaces. It
 * still serves production until M2b switches the composition roots and
 * deletes it (S3 M2a, 2026-09-13); until then it is the one module here
 * allowed to import `@temporalio/activity`, and the day it is gone this
 * list is empty. Any OTHER module importing Temporal fails here.
 */

import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { packageImports, readSource, typeScriptFilesUnder } from "../../../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ADAPTER_ROOT = join(SRC_ROOT, "activities", "execute-deep-agent");

/** The orchestrator, deleted at M2b; the only module tolerated on the Temporal import until then. */
const TOLERATED_UNTIL_M2B = new Set(["index.ts"]);

describe("the native adapter never imports @temporalio", () => {
  const files = typeScriptFilesUnder(ADAPTER_ROOT, new Set(["__tests__", "__test-utils__"]));
  const offences = files
    .filter((file) => !TOLERATED_UNTIL_M2B.has(relative(ADAPTER_ROOT, file)))
    .flatMap((file) =>
      packageImports(file, readSource(file), "@temporalio").map((specifier) => `  ${relative(SRC_ROOT, file)} imports "${specifier}"`),
    );

  it("inspected the adapter's own files (the walk is rooted where it claims)", () => {
    expect(files.map((f) => relative(ADAPTER_ROOT, f))).toEqual(
      expect.arrayContaining(["adapter.ts", "turn.ts", "turn-setup.ts", "turn-stream.ts", "turn-settle.ts", "deep-agent-capabilities.ts"]),
    );
  });

  it("finds no @temporalio import in any production module but the tolerated orchestrator", () => {
    expect(offences, `the native adapter must not import @temporalio/*:\n${offences.join("\n")}`).toEqual([]);
  });

  it("the tolerance is still needed (delete it with index.ts at M2b)", () => {
    const stillPresent = files.some((f) => TOLERATED_UNTIL_M2B.has(relative(ADAPTER_ROOT, f)));
    expect(stillPresent, "index.ts is gone: remove TOLERATED_UNTIL_M2B and this arm").toBe(true);
  });
});
