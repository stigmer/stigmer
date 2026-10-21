/**
 * Pins the stop cause of every way a turn ends (`../terminal-table.ts`):
 * each arm that stops a turn names the one structured cause the session's
 * status reads (`RunStatus.stop_cause`), the waiting arm names none (a
 * turn waits only on an approval; file review never holds one), nor does
 * an arm whose turn the workflow continues (it has not stopped),
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
import { OperationLimitError } from "../open-operations.js";
import { WorkspaceLockTimeoutError } from "../../shared/workspace/workspace-lock.js";
import * as table from "../terminal-table.js";
import type { StopCause, TerminalArm } from "../terminal-table.js";
import { MessageType } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const ARMS: ReadonlyArray<{ readonly name: string; readonly arm: TerminalArm; readonly cause: StopCause | null }> = [
  { name: "stallArm", arm: table.stallArm(new StallTimeoutError(1_000)), cause: "timeout" },
  { name: "operationLimitArm", arm: table.operationLimitArm(new OperationLimitError("task", 3_600_000)), cause: "timeout" },
  { name: "evalScaffoldFailedArm", arm: table.evalScaffoldFailedArm("scaffold failed"), cause: "eval_stopped" },
  { name: "mockAbortArm", arm: table.mockAbortArm({ server: "s", tool: "t", reason: "r" }), cause: "eval_stopped" },
  { name: "costCapArm", arm: table.costCapArm(1, 2), cause: "budget_reached" },
  { name: "toolCallLimitArm", arm: table.toolCallLimitArm(), cause: "budget_reached" },
  { name: "workerShutdownArm", arm: table.workerShutdownArm(), cause: null },
  { name: "continueArm", arm: table.continueArm("drain"), cause: null },
  { name: "modelStallArm", arm: table.modelStallArm(new StallTimeoutError(1_000)), cause: null },
  { name: "streamCutArm", arm: table.streamCutArm("the vendor ended its connection"), cause: null },
  { name: "orchestratorStopArm", arm: table.orchestratorStopArm(), cause: "user" },
  { name: "infrastructureCancelArm", arm: table.infrastructureCancelArm(), cause: null },
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

  it("a continuing arm writes no ending and appends its note, which it does not report as a stop's row", () => {
    const status = create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS });
    const turn = create(TurnRowsSchema, { messages: [{ type: MessageType.MESSAGE_AI, content: "working" }] });
    const arm = table.continueArm("drain");
    expect(table.applyTerminalArm(status, turn, arm)).toEqual([]);
    expect([status.phase, status.error, status.completedAt, status.stopCause]).toEqual([RunPhase.RUN_PHASE_UNSPECIFIED, "", "", ""]);
    expect(turn.messages.map((m) => [m.type, m.content])).toEqual([
      [MessageType.MESSAGE_AI, "working"],
      [MessageType.MESSAGE_SYSTEM, table.TERMINAL_COPY.continuation.notes.drain],
    ]);
    expect(arm.disposition).toEqual({ kind: "continue", cause: "drain" });
  });

  it("pins the continuing turn's failure type, which the invoke workflow matches by name", () => {
    expect(table.TURN_CONTINUES_FAILURE_TYPE).toBe("StigmerTurnContinues");
  });

  it("the arms the workflow continues write no ending; the drain's says why the turn moved", () => {
    for (const arm of [table.workerShutdownArm(), table.infrastructureCancelArm(), table.continueArm("drain")]) {
      expect([arm.phase, arm.error, arm.completes, arm.stopCause, arm.rows]).toEqual([RunPhase.RUN_PHASE_UNSPECIFIED, undefined, false, null, []]);
    }
    expect(table.workerShutdownArm().note).toBe(table.TERMINAL_COPY.continuation.notes.drain);
    expect(table.infrastructureCancelArm().note).toBeUndefined();
  });

  it("a stall owed by the model continues: no ending, its note, and the stall's own copy for the workflow if it gives up", () => {
    const error = new StallTimeoutError(180_000, "last tool: read");
    const arm = table.modelStallArm(error);
    expect([arm.phase, arm.error, arm.completes, arm.stopCause, arm.rows]).toEqual([RunPhase.RUN_PHASE_UNSPECIFIED, undefined, false, null, []]);
    expect(arm.note).toBe(table.TERMINAL_COPY.continuation.notes["model-stall"]);
    expect(arm.disposition).toEqual({ kind: "continue", cause: "model-stall", message: table.stallArm(error).error });
    expect(table.continueArm("drain").disposition, "a drain names no message: the shared copy").toEqual({ kind: "continue", cause: "drain" });
    expect(table.isContinuationNote(table.TERMINAL_COPY.continuation.notes["model-stall"])).toBe(true);
  });

  it("a connection the vendor ended continues: no ending, its fixed note, and the adapter's words for the workflow if it gives up", () => {
    const arm = table.streamCutArm("the vendor ended its connection");
    expect([arm.phase, arm.error, arm.completes, arm.stopCause, arm.rows]).toEqual([RunPhase.RUN_PHASE_UNSPECIFIED, undefined, false, null, []]);
    expect(arm.note).toBe("Cursor ended its connection; this turn continues from where it was.");
    expect(arm.disposition).toEqual({ kind: "continue", cause: "stream-cut", message: "the vendor ended its connection" });
    expect(table.isContinuationNote(table.TERMINAL_COPY.continuation.notes["stream-cut"])).toBe(true);
  });

  it("a waiting arm leaves the stop cause as it was and appends nothing of its own", () => {
    const status = create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS });
    expect(table.applyTerminalArm(status, create(TurnRowsSchema), table.awaitingApprovalArm())).toEqual([]);
    expect(status.stopCause).toBe("");
  });
});

describe("the operation limit's copy", () => {
  it("says the operation ran past its limit and was stopped, never that the agent made no progress", () => {
    const arm = table.operationLimitArm(new OperationLimitError("task", 3_600_000));
    expect(arm.phase).toBe(RunPhase.RUN_FAILED);
    expect(arm.disposition).toEqual({ kind: "return" });
    expect(arm.error).toBe("[OperationLimitError] `task` ran for more than 60 minutes without finishing. Retry or resume.");
    expect(arm.rows).toEqual(["Execution failed: `task` ran for more than 60 minutes without finishing and was stopped. You can retry or resume."]);
  });

  it("names a limit under a minute in seconds, and one minute in the singular", () => {
    expect(new OperationLimitError("shell", 2_000).message).toBe("`shell` ran for more than 2 seconds without finishing");
    expect(new OperationLimitError("shell", 60_000).message).toBe("`shell` ran for more than 1 minute without finishing");
    expect(new OperationLimitError("shell", 1_000).message).toBe("`shell` ran for more than 1 second without finishing");
  });
});
