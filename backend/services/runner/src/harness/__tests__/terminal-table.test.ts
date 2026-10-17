/**
 * Pins the stop cause of every way a turn ends (`../terminal-table.ts`):
 * each arm that stops a turn names the one structured cause the session's
 * status reads (`RunStatus.stop_cause`), the waiting arm names none (a
 * turn waits only on an approval; file review never holds one),
 * and applying an arm writes the cause and reports where its rows landed,
 * so the session event emitter never writes them as harness notes.
 *
 * The walk is checked against the module's exports, so an arm added
 * without a line here fails the coverage arm.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { StallTimeoutError } from "../../shared/stall-watchdog.js";
import { WorkspaceLockTimeoutError } from "../../shared/workspace/workspace-lock.js";
import * as table from "../terminal-table.js";
import type { StopCause, TerminalArm } from "../terminal-table.js";
import { MessageType } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const ARMS: ReadonlyArray<{ readonly name: string; readonly arm: TerminalArm; readonly cause: StopCause | null }> = [
  { name: "stallArm", arm: table.stallArm(new StallTimeoutError(1_000)), cause: "timeout" },
  { name: "evalScaffoldFailedArm", arm: table.evalScaffoldFailedArm("scaffold failed"), cause: "eval_stopped" },
  { name: "mockAbortArm", arm: table.mockAbortArm({ server: "s", tool: "t", reason: "r" }), cause: "eval_stopped" },
  { name: "costCapArm", arm: table.costCapArm(1, 2), cause: "budget_reached" },
  { name: "toolCallLimitArm", arm: table.toolCallLimitArm(), cause: "budget_reached" },
  { name: "workerShutdownArm", arm: table.workerShutdownArm(), cause: "infrastructure" },
  { name: "orchestratorStopArm", arm: table.orchestratorStopArm(), cause: "user" },
  { name: "infrastructureCancelArm", arm: table.infrastructureCancelArm(), cause: "infrastructure" },
  { name: "awaitingApprovalArm", arm: table.awaitingApprovalArm(), cause: null },
  { name: "platformStopArm", arm: table.platformStopArm(), cause: "platform_stop" },
  {
    name: "workspaceLockTimeoutArm",
    arm: table.workspaceLockTimeoutArm(new WorkspaceLockTimeoutError("/w", 1_000)),
    cause: "timeout",
  },
  {
    name: "fileReviewResolvedArm",
    arm: table.fileReviewResolvedArm({ failed: false, failureDetail: "", discardedPaths: [] }),
    cause: "review_resolved",
  },
  { name: "failedArm", arm: table.failedArm("the model refused", "engine"), cause: "model_error" },
  { name: "unexpectedErrorArm", arm: table.unexpectedErrorArm("TypeError", "boom"), cause: "failed" },
];

describe("the stop cause of every terminal arm", () => {
  it.each(ARMS)("$name names $cause", ({ arm, cause }) => {
    expect(arm.stopCause).toBe(cause);
  });

  it("a failure the user can act on, or the runner's own, is failed; only the engine's is model_error", () => {
    expect(table.failedArm("fix the hook", "actionable").stopCause).toBe("failed");
    expect(table.failedArm("transport broke", "internal").stopCause).toBe("failed");
  });

  it("every exported arm is walked here", () => {
    const exported = Object.keys(table).filter((key) => key.endsWith("Arm") && key !== "applyTerminalArm");
    expect(new Set(exported)).toEqual(new Set(ARMS.map((a) => a.name)));
  });
});

describe("applying an arm", () => {
  it("writes the stop cause and reports the root positions of the rows it appended", () => {
    const status = create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS });
    const turn = create(TurnRowsSchema, { messages: [{ type: MessageType.MESSAGE_AI, content: "working" }] });
    const rows = table.applyTerminalArm(status, turn, table.failedArm("boom", "internal"));
    expect(status.stopCause).toBe("failed");
    expect(rows).toEqual([1, 2]);
    expect(rows.map((index) => turn.messages[index]!.type)).toEqual([MessageType.MESSAGE_SYSTEM, MessageType.MESSAGE_SYSTEM]);
  });

  it("a waiting arm leaves the stop cause as it was and appends nothing of its own", () => {
    const status = create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS });
    expect(table.applyTerminalArm(status, create(TurnRowsSchema), table.awaitingApprovalArm())).toEqual([]);
    expect(status.stopCause).toBe("");
  });
});
