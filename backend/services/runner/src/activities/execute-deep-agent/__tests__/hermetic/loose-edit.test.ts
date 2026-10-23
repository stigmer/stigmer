/**
 * Hermetic scenario: an edit the model quoted loosely lands through the whole
 * `ExecuteDeepAgent` activity, on the real graph with the scripted model.
 *
 * The file is a Windows-ended note with curly quotes; the model quotes it
 * with straight quotes and "\n" line endings, as a model reading `read_file`
 * output usually does. Before the loose-edit path (`loose-edit.ts`) this edit
 * failed with "String not found in file".
 *
 * Two arms:
 *  - Unattended, on a git workspace with file review on: the edit flows, its
 *    result is deepagents' own success line, the file keeps CRLF and the
 *    curly quotes of the line the model did not change, and file review holds
 *    one change whose after-bytes are exactly that file.
 *  - Gated, on a workspace nothing can capture (no git, no artifact store),
 *    where a built-in edit waits for a person: the card's arguments are the
 *    model's own call, the repair happens after approval inside the approved
 *    edit, and the edit is applied once.
 *
 * Structure and side effects only; no golden, since the transcript shape is
 * the file-review and HITL scenarios' and is pinned there.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { FileChangeKind, RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { initGitWorkspace, localPathEntry } from "../../../../__test-utils__/git-workspace-fixture.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedToolCall } from "../../__test-utils__/scripted-model.js";
import { ApprovalAction, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const FILE = "notes.md";
const BEFORE = "# It’s the “plan”\r\nstatus: draft\r\n";
const AFTER = "# It’s the “plan”\r\nstatus: final\r\n";
const EDIT: ScriptedToolCall = {
  id: "call-hermetic-loose-edit-0001",
  name: "edit_file",
  args: { file_path: `/${FILE}`, old_string: '# It\'s the "plan"\nstatus: draft', new_string: '# It\'s the "plan"\nstatus: final' },
};
const SUCCESS = `Successfully replaced 1 occurrence(s) in '/${FILE}'`;

describe("ExecuteDeepAgent hermetic — an edit quoted loosely", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("lands unattended, keeps the file's bytes, and file review holds one change", async () => {
    clock.reset();
    const repo = join(env.workspaceRootDir, "repos", "loose-unattended");
    initGitWorkspace(repo, { [FILE]: BEFORE });
    const record = deepAgentExecutionRecord({
      message: "Mark the plan final.",
      resources: [localPathEntry("notes", repo)],
      fileReview: true,
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          { text: "Marking it final.", toolCalls: [EDIT], usage: { inputTokens: 1_300, outputTokens: 60 } },
          { text: "Done.", usage: { inputTokens: 1_500, outputTokens: 10 } },
        ],
      }),
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(readFileSync(join(repo, FILE), "utf-8")).toBe(AFTER);
    const rows = record.toolCalls();
    expect(rows.map((tc) => [tc.id, tc.status, tc.result])).toEqual([[EDIT.id, ToolCallStatus.TOOL_CALL_COMPLETED, SUCCESS]]);
    expect(rows[0].args, "the row keeps the model's own call").toEqual(EDIT.args);

    const events = record.rowsOf(record.lastFullStatus!).fileReviewEventStream?.events ?? [];
    const candidate = events.find((e) => e.payload.case === "candidateCaptured")?.payload;
    if (candidate?.case !== "candidateCaptured") throw new Error("file review captured no candidate");
    expect(candidate.value.changes).toHaveLength(1);
    const change = candidate.value.changes[0];
    expect(change.kind).toBe(FileChangeKind.MODIFY);
    expect(change.before?.body.case === "inline" ? change.before.body.value : undefined).toBe(BEFORE);
    expect(change.after?.body.case === "inline" ? change.after.body.value : undefined).toBe(AFTER);
  });

  it("waits for approval on the model's own call, then applies the repaired edit once", async () => {
    clock.reset();
    // Nothing can capture this workspace (no git, no store), so a built-in edit waits for a person.
    const savedStorage = process.env.ARTIFACT_STORAGE_TYPE;
    process.env.ARTIFACT_STORAGE_TYPE = "none";
    try {
      const dir = join(env.workspaceRootDir, "plain", "loose-gated");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, FILE), BEFORE);
      const record = deepAgentExecutionRecord({
        message: "Mark the plan final.",
        resources: [localPathEntry("notes", dir)],
        fileReview: true,
      });
      const toolResultsRead: string[] = [];
      const scenario = beginDeepAgentScenario({
        env,
        clock,
        record,
        checkpointer: "sqlite",
        script: () => (transcript) => {
          const answered = transcript.filter((m) => ToolMessage.isInstance(m));
          if (answered.length === 0) {
            return { text: "Marking it final.", toolCalls: [EDIT], usage: { inputTokens: 1_300, outputTokens: 60 } };
          }
          toolResultsRead.push(...answered.map((m) => String(m.content)));
          return { text: "Done.", usage: { inputTokens: 1_500, outputTokens: 10 } };
        },
      });

      const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0 });

      expect((turn1.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_WAITING_FOR_APPROVAL");
      const waiting = record.waitingToolCalls();
      expect(waiting.map((tc) => [tc.id, tc.name, tc.requiresApproval])).toEqual([[EDIT.id, "edit_file", true]]);
      expect(waiting[0].args, "the card shows the model's own call").toEqual(EDIT.args);
      expect(readFileSync(join(dir, FILE), "utf-8"), "nothing applied before the decision").toBe(BEFORE);

      expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, "2026-01-01T00:00:30.000Z", undefined, "")).toBe(1);
      const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1 });

      expect((turn2.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
      expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
      expect(readFileSync(join(dir, FILE), "utf-8")).toBe(AFTER);
      expect(toolResultsRead, "the edit ran once, and the model reads deepagents' success line").toEqual([SUCCESS]);
      const rows = record.rowsOf(record.lastFullStatus!).messages.flatMap((m) => m.toolCalls).filter((tc) => tc.id === EDIT.id);
      expect(rows.map((tc) => [tc.status, tc.approvalAction, tc.result])).toEqual([
        [ToolCallStatus.TOOL_CALL_COMPLETED, ApprovalAction.APPROVE, SUCCESS],
      ]);
    } finally {
      process.env.ARTIFACT_STORAGE_TYPE = savedStorage;
    }
  });
});
