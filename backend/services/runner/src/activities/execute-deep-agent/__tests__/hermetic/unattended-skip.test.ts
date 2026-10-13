/**
 * Hermetic golden: a call the default would ask about, on a turn no one can
 * answer (a schedule, a messaging channel, a share guest: the run's
 * `status.approval_mode` is UNATTENDED), through the whole `ExecuteDeepAgent`
 * activity.
 *
 * Invariant pinned: the gate skips the call without running it and the turn
 * goes on to COMPLETED, never WAITING_FOR_APPROVAL; the model reads the skip
 * message and adapts. The call has a row from the moment the gate skips it
 * (the gate's refusal event on the custom stream, as a hook's refusal has:
 * the call never ran, so the tools channel says nothing of it), so the model's
 * next turn answers a row the status already holds; after the stream the row
 * is SKIPPED with UNATTENDED_SKIP provenance and the skip message as its
 * result, the shape Cursor's turn boundary stamps for the same skip.
 *
 * The session's log says the permission policy refused the call:
 * `evaluated_permission: "deny"` on its `agent.tool_use`, Managed Agents'
 * own word, so `@stigmer/session-log`'s fold reads it `denied`, never
 * `failed`. Its result is the skip message, an error.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { ToolMessage } from "@langchain/core/messages";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalMode,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { foldSession, turnOf, type ToolUse } from "@stigmer/session-log";

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
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { unattendedSkipMessage } from "../../../../shared/approval-policy.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { CLOSING_TURN, EXECUTE_CALL_A, GATED_OPENING_TURN } from "../../__test-utils__/hitl-script.js";
import { ApprovalPolicySource, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const USER_MESSAGE = "Run the command for me.";

describe("ExecuteDeepAgent hermetic — an unattended turn skips a call that would ask", () => {
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

  it("skips the call, completes, and writes the skip as the policy's deny", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE, approvalMode: ApprovalMode.UNATTENDED });
    const toolResultsRead: string[] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => (transcript) => {
        const answered = transcript.filter((m) => ToolMessage.isInstance(m));
        if (answered.length === 0) return GATED_OPENING_TURN;
        toolResultsRead.push(...answered.map((m) => String(m.content)));
        return CLOSING_TURN;
      },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const turn = await runDeepAgentTurn(scenario);

    // ── Assert: the turn goes on, the call never runs ────────────────────────
    expect(turn.outcome.kind).toBe("returned");
    expect((turn.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(record.persistedPhases).not.toContain(RunPhase.RUN_WAITING_FOR_APPROVAL);
    const skipMessage = unattendedSkipMessage(EXECUTE_CALL_A.name);
    expect(toolResultsRead, "the model reads the skip, not the command's output").toEqual([skipMessage]);

    const rows = record.toolCalls().filter((tc) => tc.id === EXECUTE_CALL_A.id);
    expect(rows, "the skipped call has one row").toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(row.approvalPolicySource).toBe(ApprovalPolicySource.UNATTENDED_SKIP);
    expect(row.requiresApproval, "no one was asked").toBe(false);
    expect(row.result).toBe(skipMessage);
    expect(row.error).toBe("");

    // ── Assert: the log says the policy refused it ───────────────────────────
    const uses = record.sessionEvents.flatMap((e) => (e.event.case === "agentToolUse" ? [e.event.value] : []));
    expect(uses.map((u) => [u.name, u.evaluatedPermission])).toEqual([["execute", "deny"]]);
    const results = record.sessionEvents.flatMap((e) => (e.event.case === "agentToolResult" ? [e.event.value] : []));
    expect(results.map((r) => [r.isError, r.content.map((c) => c.text).join("")])).toEqual([[true, skipMessage]]);
    const folded = turnOf(foldSession(record.sessionEvents), record.executionId)?.items.filter(
      (item): item is ToolUse => item.kind === "tool_use",
    );
    expect(folded?.map((use) => use.state), "the fold reads a refusal, never a failure").toEqual(["denied"]);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the goldens ──────────────────────────────────────────────────
    const statusJson = JSON.stringify(toJson(RunStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(statusJson).toMatchFileSnapshot("./goldens/unattended-skip.status.json");
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/unattended-skip.events.json");
  });
});
