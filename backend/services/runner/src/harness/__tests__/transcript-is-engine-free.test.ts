/**
 * Pins that the transcript builder knows no engine: every file under
 * `src/harness/transcript/`, tests included, names only the packages on a
 * short allow-list — the proto runtime and the generated protos, Node's
 * builtins, and `vitest` inside `__tests__/`.
 *
 * Why it matters (S4's one disposition rule): the builder folds
 * facts into the status proto; every fact about an engine — a LangGraph
 * namespace, a Cursor `SDKMessage`, a LangChain `ToolMessage` envelope —
 * reaches it as a translator's output, never as an import. A Claude or Codex
 * adapter is then a translator and nothing else. `@temporalio/*` is refused
 * for the same reason the adapters refuse it: the builder runs under the
 * contract kit outside any activity, and it moved out from under the native
 * adapter's Temporal-free fence when it moved into `harness/` (the runtime
 * itself is not Temporal-free — `run-turn.ts` heartbeats).
 *
 * An ALLOW-list, not a deny-list: an SDK that does not exist yet is refused
 * on the day this file was written, and admitting a new package is a visible
 * edit here with a reason, not an absence someone forgot to extend. Tests are
 * swept too, on the direction fence's precedent (`import-direction.test.ts`):
 * a test that imported `@langchain/core` to build a fixture would be exactly
 * the coupling that keeps the builder's own tests in the native adapter's
 * folder until S4 M2 re-keys them to the canonical union (Q-M1-2).
 *
 * Ruled at the S4 M1 gate (Q-M1-5), landed the day the folder was created.
 */

import { describe, it, expect } from "vitest";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { packageNames, readSource, typeScriptFilesUnder } from "../../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TRANSCRIPT_ROOT = join(SRC_ROOT, "harness", "transcript");

/** What a production module under `harness/transcript/` may name. */
const ALLOWED = new Set(["@bufbuild/protobuf", "@stigmer/protos"]);
/** What a test under `harness/transcript/__tests__/` may name in addition. */
const ALLOWED_IN_TESTS = new Set([...ALLOWED, "vitest"]);

function isTestFile(file: string): boolean {
  return file.includes(`${sep}__tests__${sep}`);
}

describe("packageNames (the checker itself)", () => {
  const file = join(TRANSCRIPT_ROOT, "builder.ts");

  it("reduces a specifier to its package and drops relatives and builtins", () => {
    const source = [
      'import { create } from "@bufbuild/protobuf";',
      'import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";',
      'import { join } from "node:path";',
      'import { a } from "./events.js";',
      'import { b } from "../../shared/status.js";',
      'import ts from "typescript";',
      'const m = await import("@langchain/core/messages");',
    ].join("\n");
    expect(packageNames(file, source)).toEqual(["@bufbuild/protobuf", "@stigmer/protos", "typescript", "@langchain/core"]);
  });
});

describe("src/harness/transcript names no engine, no SDK, no Temporal", () => {
  const files = typeScriptFilesUnder(TRANSCRIPT_ROOT, new Set());
  const offences = files.flatMap((file) => {
    const allowed = isTestFile(file) ? ALLOWED_IN_TESTS : ALLOWED;
    return packageNames(file, readSource(file))
      .filter((pkg) => !allowed.has(pkg))
      .map((pkg) => `  ${relative(SRC_ROOT, file)} names "${pkg}"`);
  });

  it("inspected the builder's own files, tests included (the walk is rooted where it claims)", () => {
    const walked = files.map((f) => relative(TRANSCRIPT_ROOT, f));
    expect(walked).toEqual(expect.arrayContaining(["builder.ts", "events.ts", "state.ts", join("__tests__", "state.test.ts")]));
  });

  it("finds no package outside the allow-list", () => {
    expect(
      offences,
      `src/harness/transcript/ may name only ${[...ALLOWED_IN_TESTS].join(", ")} (vitest in tests only):\n${offences.join("\n")}`,
    ).toEqual([]);
  });
});
