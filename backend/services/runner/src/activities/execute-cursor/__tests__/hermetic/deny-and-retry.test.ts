/**
 * Hermetic golden: the DENY-AND-RETRY approval round trip through two real
 * `ExecuteCursor` invocations, with the REAL bash hook as the out-of-process
 * half.
 *
 * Invariant pinned (the Cursor pause primitive, parent §4a `pausePrimitive:
 * "deny-and-retry"`): the model proposes a gated built-in (`shell`); the
 * workspace hook the activity installed DENIES it and appends to the denial
 * ledger; the stream loop reads the ledger on the next `tool_call` event, cancels
 * the run, and the turn boundary overlays the row as WAITING_APPROVAL; the
 * activity persists WAITING_FOR_APPROVAL, parks the agent, and RETURNS a slim
 * status. The user approves (the server writes `approval_action` on the row —
 * here the record does, per field ownership). The reinvocation (`thread_id` set,
 * `turn_seq` 1) seeds its transcript from the persisted execution, derives a
 * grant from the approved row, reinstalls the gate, and the SAME hook now ALLOWS
 * the re-issued call — which the model emits under a FRESH `call_id`, and which
 * the transcript reconciles onto the committed row by canonical identity (a
 * superset, never a duplicate, never a second gate). The turn ends COMPLETED.
 *
 * Two goldens, one per invocation: `goldens/deny-and-retry.turn1.status.json`
 * (the paused transcript) and `goldens/deny-and-retry.turn2.status.json` (the
 * resumed, completed transcript). S2 must reproduce both byte for byte.
 *
 * Parent phase rows exercised beyond `tool-call`: reinvocation detection and
 * transcript seeding (Phase 3); reading approval decisions from the persisted
 * transcript (`reconstructAdjudicatedApprovals`); grants → approval state →
 * the gate (Phase 5c); the first-denial early stop in the stream loop; the
 * turn boundary's denial overlay; `enterApprovalPause` (WAITING_FOR_APPROVAL,
 * park, return); the parked-agent checkout on the resume (#215, no `Agent.resume`
 * call); the resume prompt.
 *
 * The hook is the runner's own generated bash script, found the way the SDK
 * finds it (`.cursor/hooks.json` in the workspace) and run with the SDK's real
 * preToolUse input shape (`cursor-hook-harness.ts` builders). Skipped where
 * `bash` is unavailable — reported as SKIPPED, never a silent pass.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { hasBash, hookShell } from "../../__test-utils__/cursor-hook-harness.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  runWorkspaceHook,
  sessionWorkspaceDir,
  stubRegistryFetch,
} from "../../__test-utils__/hermetic-cursor.js";

const AGENT_ID = "agent-hermetic-deny-0001";
const RUN_1 = "run-hermetic-deny-0001";
const RUN_2 = "run-hermetic-deny-0002";
const CALL_TURN_1 = "call-hermetic-shell-0001";
const CALL_TURN_2 = "call-hermetic-shell-0002";
const USER_MESSAGE = "Run the build and tell me if it passes.";
const COMMAND = "npm run build";
const SHELL_ARGS = { command: COMMAND };
const BUILD_OUTPUT = "build ok (hermetic)\n";
const FINAL_TEXT = "The build passes.";

describe.skipIf(!hasBash)("ExecuteCursor hermetic — deny-and-retry approval round trip", () => {
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

  it("pauses on the hook's deny, then completes on the approved re-issue", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const workspaceRoot = sessionWorkspaceDir(env);
    const hookDecisions: string[] = [];
    const runHook = (label: string) =>
      step.effect(label, () => {
        hookDecisions.push(runWorkspaceHook(workspaceRoot, hookShell(COMMAND)).permission);
      });

    const ev1 = sdkEvents(AGENT_ID, RUN_1);
    const ev2 = sdkEvents(AGENT_ID, RUN_2);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_1, RUN_2],
      observeStep: () => clock.tick(),
      turns: [
        // Turn 1: the SDK runs the hook before executing the gated tool; the
        // hook denies and writes the ledger; the SDK reports the call blocked.
        [
          step.event(ev1.init()),
          step.event(ev1.assistant("I'll run the build now.")),
          step.event(ev1.toolCall(CALL_TURN_1, "shell", "running", SHELL_ARGS)),
          runHook("hook: turn 1 (expect deny)"),
          step.event(ev1.toolCall(CALL_TURN_1, "shell", "error", SHELL_ARGS, "Blocked by hook")),
          // Never reached: the loop detects the denial on the event above and
          // cancels the run. Present so a regression that does NOT cancel is
          // caught by the golden, not by a missing-result throw.
          step.event(ev1.assistant("The build was blocked.")),
          step.finished({ result: "The build was blocked." }),
        ],
        // Turn 2 (resumed): the hook runs again for the re-issued call and now
        // allows it (the grant); the tool runs under a FRESH call id.
        [
          runHook("hook: turn 2 (expect allow)"),
          step.event(ev2.toolCall(CALL_TURN_2, "shell", "running", SHELL_ARGS)),
          step.event(ev2.toolCall(CALL_TURN_2, "shell", "completed", SHELL_ARGS, BUILD_OUTPUT)),
          step.event(ev2.assistant(FINAL_TEXT)),
          step.turnEnded({ inputTokens: 3_100, outputTokens: 60 }),
          step.finished({ result: FINAL_TEXT, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [agent], catalog: SDK_CATALOG },
    });

    // ── Act 1: the first invocation ──────────────────────────────────────────
    const turn1 = await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });

    // ── Assert 1: paused for approval, returned, agent parked ────────────────
    expect(hookDecisions, "the real hook denied the gated shell call").toEqual(["deny"]);
    expect(turn1.outcome.kind, "an approval pause RETURNS to the workflow").toBe("returned");
    expect((turn1.outcome as { value: Record<string, unknown> }).value.phase).toBe(
      "EXECUTION_WAITING_FOR_APPROVAL",
    );
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    ]);
    expect(agent.runs[0].cancelCalls, "the first denial cancels the run exactly once").toHaveLength(1);
    expect(agent.closeCalls, "the agent is parked for the resume, not closed").toBe(0);

    const waiting = record.waitingToolCalls();
    expect(waiting, "exactly one gate row").toHaveLength(1);
    expect(waiting[0].id).toBe(CALL_TURN_1);
    expect(waiting[0].name).toBe("shell");
    expect(waiting[0].requiresApproval).toBe(true);
    // The gate row carries what the HOOK saw (the ledger's captured tool_input:
    // command, cwd, timeout), overlaid on the stream's args — the golden pins
    // the full shape; here only the shared salient field is asserted.
    expect(waiting[0].args).toMatchObject(SHELL_ARGS);
    // The model's post-denial narration never reaches the user as fact.
    expect(record.status?.messages.some((m) => m.content === "The build was blocked.")).toBe(false);

    const turn1Json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(turn1Json).toMatchFileSnapshot("./goldens/deny-and-retry.turn1.status.json");

    // ── The user approves (the server's SubmitApproval effect on the row) ────
    clock.tick();
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, new Date().toISOString())).toBe(1);

    // ── Act 2: the reinvocation ──────────────────────────────────────────────
    const turn2 = await runCursorTurn(scenario, { threadId: AGENT_ID, turnSeq: 1 });

    // ── Assert 2: allowed, reconciled, completed ─────────────────────────────
    expect(hookDecisions, "the SAME hook allows the approved re-issue").toEqual(["deny", "allow"]);
    expect(turn2.outcome.kind).toBe("returned");
    const slim2 = (turn2.outcome as { value: Record<string, unknown> }).value;
    expect(slim2.phase).toBe("EXECUTION_COMPLETED");
    expect(slim2.final_text).toBe(FINAL_TEXT);
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);

    // #215: the resume checks the parked agent out of the session cache; the
    // SDK is asked to create once for the whole round trip and never to resume.
    expect(scenario.sdk.resolutions.map((r) => r.kind)).toEqual(["create"]);
    expect(agent.sends).toHaveLength(2);

    // Each tool gates exactly once: the committed row survives under its
    // ORIGINAL id, now COMPLETED with the tool's result; the fresh call id the
    // model emitted is reconciled onto it, never a second row.
    const rows = record.toolCalls();
    expect(rows.filter((tc) => tc.name === "shell")).toHaveLength(1);
    const shell = rows.find((tc) => tc.name === "shell")!;
    expect(shell.id).toBe(CALL_TURN_1);
    expect(shell.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(shell.result).toBe(BUILD_OUTPUT);
    expect(shell.approvalAction, "the decision survives on the row").toBe(ApprovalAction.APPROVE);
    expect(rows.some((tc) => tc.id === CALL_TURN_2)).toBe(false);
    expect(record.waitingToolCalls()).toHaveLength(0);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    const turn2Json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(turn2Json).toMatchFileSnapshot("./goldens/deny-and-retry.turn2.status.json");
  });
});
