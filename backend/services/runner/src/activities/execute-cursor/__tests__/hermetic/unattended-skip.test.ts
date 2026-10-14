/**
 * Hermetic golden: a call the default would ask about, on a turn no one can
 * answer (a schedule, a messaging channel, a share guest: the run's
 * `status.approval_mode` is UNATTENDED), through the whole `ExecuteCursor`
 * activity with the REAL bash hook as the out-of-process half.
 *
 * Invariant pinned: the workspace hook answers the gated `shell` with
 * `permission: deny` and records the unattended kind in the denial ledger;
 * the run is never cancelled and never pauses, the model adapts, and the
 * turn ends COMPLETED. The turn boundary stamps the blocked row SKIPPED with
 * UNATTENDED_SKIP provenance and the skip message as its result
 * (`boundary-rows.ts` `stampUnattendedSkippedToolCalls`), the shape the native
 * gate's skip settles to.
 *
 * The session's log says the permission policy refused the call:
 * `evaluated_permission: "deny"` on its `agent.tool_use`, Managed Agents'
 * own word, so `@stigmer/session-log`'s fold reads it `denied`, never
 * `failed`. The row's tool use is held until the boundary ran (the
 * `boundaryRewritesRow` capability holds a hook-blocked row), so it is
 * written once, as the stamped row says.
 *
 * Skipped where `bash` is unavailable — reported as SKIPPED, never a silent pass.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApprovalMode,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { foldSession, turnOf, type ToolUse } from "@stigmer/session-log";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("@cursor/sdk/sqlite", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSqliteModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
  statusGolden,
  rowsGolden,
  rowsGoldenPath,
} from "../../../../__test-utils__/hermetic-activity.js";
import { unattendedSkipMessage } from "../../../../shared/approval-policy.js";
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
} from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { ApprovalPolicySource, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const AGENT_ID = "agent-hermetic-unattended-0001";
const RUN_ID = "run-hermetic-unattended-0001";
const CALL_ID = "call-hermetic-shell-0001";
const USER_MESSAGE = "Run the build and tell me if it passes.";
const COMMAND = "npm run build";
const SHELL_ARGS = { command: COMMAND };
const FINAL_TEXT = "I could not run the build here; run `npm run build` yourself to check it.";

describe.skipIf(!hasBash)("ExecuteCursor hermetic — an unattended turn skips a call that would ask", () => {
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
    const workspaceRoot = sessionWorkspaceDir(env);
    const hookDecisions: string[] = [];
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("I'll run the build now.")),
          step.event(ev.toolCall(CALL_ID, "shell", "running", SHELL_ARGS)),
          step.effect("hook (expect deny)", () => {
            hookDecisions.push(runWorkspaceHook(workspaceRoot, hookShell(COMMAND)).permission);
          }),
          step.event(ev.toolCall(CALL_ID, "shell", "error", SHELL_ARGS, "Tool call was blocked by a hook")),
          step.event(ev.assistant(FINAL_TEXT)),
          step.turnEnded({ inputTokens: 2_100, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: FINAL_TEXT, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE, approvalMode: ApprovalMode.UNATTENDED });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    // ── Act ──────────────────────────────────────────────────────────────────
    const turn = await runCursorTurn(scenario, { threadId: "", turnSeq: 0 });

    // ── Assert: the turn goes on, the call never runs ────────────────────────
    expect(hookDecisions, "the real hook denied the gated shell call").toEqual(["deny"]);
    expect(turn.outcome.kind).toBe("returned");
    expect((turn.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(record.persistedPhases).not.toContain(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(agent.runs[0]!.cancelCalls, "an unattended deny never cancels the run").toHaveLength(0);

    const rows = record.toolCalls().filter((tc) => tc.id === CALL_ID);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const skipMessage = unattendedSkipMessage("shell");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(row.approvalPolicySource).toBe(ApprovalPolicySource.UNATTENDED_SKIP);
    expect(row.requiresApproval, "no one was asked").toBe(false);
    expect(row.result).toBe(skipMessage);

    // ── Assert: the log says the policy refused it ───────────────────────────
    const uses = record.sessionEvents.flatMap((e) => (e.event.case === "agentToolUse" ? [e.event.value] : []));
    expect(uses.map((u) => [u.name, u.evaluatedPermission])).toEqual([["shell", "deny"]]);
    const results = record.sessionEvents.flatMap((e) => (e.event.case === "agentToolResult" ? [e.event.value] : []));
    expect(results.map((r) => [r.isError, r.content.map((c) => c.text).join("")])).toEqual([[true, skipMessage]]);
    const folded = turnOf(foldSession(record.sessionEvents), record.executionId)?.items.filter(
      (item): item is ToolUse => item.kind === "tool_use",
    );
    expect(folded?.map((use) => use.state), "the fold reads a refusal, never a failure").toEqual(["denied"]);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the goldens ──────────────────────────────────────────────────
    await expect(statusGolden(record.lastFullStatus!)).toMatchFileSnapshot("./goldens/unattended-skip.status.json");
    await expect(rowsGolden(record.rowsOf(record.lastFullStatus!))).toMatchFileSnapshot(rowsGoldenPath("./goldens/unattended-skip.status.json"));
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/unattended-skip.events.json");
  });
});
