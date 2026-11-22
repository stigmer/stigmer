/**
 * The runtime's branches for a conversation without a computer, each
 * pinned where it decides:
 *  - its turns are serialized on a lock keyed by the conversation
 *    (`turn-context.ts` `acquireConversationTurnLock`): a turn held behind
 *    another settles as a workspace wait does, never beside it;
 *  - the shell is out of every graph's scope (`withoutShell`), the main
 *    agent's and a saved subagent's alike, whatever their lists say;
 *  - an eval try's setup writes nothing (`prepareEvalCaseWithoutDisk`): its
 *    reference folders are listed under `inputs/` and handed to the reader,
 *    and a case with a scaffold does not run.
 */
import { create } from "@bufbuild/protobuf";
import { EvalCaseContextSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/eval_case_pb";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { STIGMER_TOOL_COVERS } from "@stigmer/tool-vocabulary";
import { afterAll, describe, expect, it } from "vitest";

import { createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { caseArchiveOf } from "../../shared/eval-case/case-archive.js";
import { prepareEvalCaseWithoutDisk, SCAFFOLD_NEEDS_A_COMPUTER } from "../../shared/eval-case/prepare-case.js";
import { ToolScope } from "../../shared/tool-lists.js";
import { acquireDirectoryLock } from "../../shared/workspace/workspace-lock.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { acquireConversationTurnLock, withoutShell, type ResolutionDeps } from "../turn-context.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const env = createHermeticEnvironment();
afterAll(() => env.dispose());

/** Below the lock's 1 s poll interval: the first contended attempt times out, with no sleep. */
const LOCK_TIMEOUT_MS = 250;

function deps(sessionId: string): ResolutionDeps {
  const status = create(RunStatusSchema, {});
  const rows = create(TurnRowsSchema);
  return {
    input: { executionId: `run_${sessionId}`, threadId: "", turnSeq: 0 },
    client: mockStigmerClient(),
    config: testConfig({ workspaceRootDir: env.workspaceRootDir, workspaceLockTimeoutMs: LOCK_TIMEOUT_MS }),
    status,
    rows,
    transcript: new TranscriptBuilder(`run_${sessionId}`, rows, status),
    artifactStorage: undefined,
    timing: new TimingRecorder(),
    signal: new AbortController().signal,
    heartbeat: () => {},
    enterPhase: () => {},
    reportProgress: async () => {},
    identifyRun: () => {},
    recordReconciled: async () => {},
  };
}


describe("a conversation without a computer", () => {
  it("serializes its turns on a lock keyed by the conversation", async () => {
    const sessionId = "ses_computerless_lock";
    const held = await acquireDirectoryLock(`stigmer-conversation:${sessionId}`);
    try {
      const outcome = await acquireConversationTurnLock(deps(sessionId), sessionId);
      expect(outcome.kind, "the second turn waits behind the first and settles as a workspace wait does").toBe("settled");
    } finally {
      await held();
    }
    const free = await acquireConversationTurnLock(deps(sessionId), sessionId);
    expect(free.kind).toBe("acquired");
    if (free.kind === "acquired") await free.release?.();
    const other = await acquireConversationTurnLock(deps("ses_other_conversation"), "ses_other_conversation");
    expect(other.kind, "another conversation is never held behind it").toBe("acquired");
    if (other.kind === "acquired") await other.release?.();
  });

  it("takes the shell out of every scope, whatever its lists say", () => {
    const listed = ToolScope.of('Agent "ops"', { tools: ["Bash", "Read"], disallowedTools: [] });
    for (const scope of [ToolScope.unrestricted(), listed]) {
      expect(scope.allowsClaudeTool("Bash")).toBe(true);
      const without = withoutShell(scope);
      expect(without.allowsClaudeTool("Bash")).toBe(false);
      expect(without.allowsEngineTool("execute", STIGMER_TOOL_COVERS)).toBe(false);
      expect(without.allowsEngineTool("read_file", STIGMER_TOOL_COVERS)).toBe(true);
    }
  });

  it("prepares an eval try without writing: references for the reader, and no scaffold", () => {
    const enc = (text: string) => new TextEncoder().encode(text);
    const archive = caseArchiveOf([
      { path: "evals/c1/fixtures/a.txt", content: enc("alpha") },
      { path: "evals/c1/fixtures/sub/b.txt", content: enc("beta") },
    ]);
    const context = create(EvalCaseContextSchema, { caseDir: "evals/c1", addDirs: ["fixtures"], env: { EVAL_X: "1" } });
    const ready = prepareEvalCaseWithoutDisk({ context, archive });
    expect(ready.kind).toBe("ready");
    if (ready.kind !== "ready") return;
    expect(ready.prepared.referenceInputs.map((file) => file.relativePath)).toEqual([".stigmer/inputs/fixtures/a.txt", ".stigmer/inputs/fixtures/sub/b.txt"]);
    expect([...(ready.referenceFiles ?? new Map()).keys()]).toEqual(["fixtures/a.txt", "fixtures/sub/b.txt"]);
    expect(ready.prepared.env).toEqual({ EVAL_X: "1" });

    const scaffolded = prepareEvalCaseWithoutDisk({ context: create(EvalCaseContextSchema, { caseDir: "evals/c1", scaffoldScript: "setup.sh" }), archive });
    expect(scaffolded).toEqual({ kind: "scaffold-failed", detail: SCAFFOLD_NEEDS_A_COMPUTER });
  });
});
