/**
 * Hermetic: a GATED built-in that runs under the execution's global bypass
 * (`spec.auto_approve_all`), through the whole `ExecuteCursor` activity.
 *
 * Invariant pinned (#1117): `requiresApproval` says whether THIS call was held
 * for a person's decision, on every harness. A shell the bypass lets run is
 * never held, so its row carries no approval fields — the same answer the
 * native harness gives, where a call that starts was authorized by
 * construction. The row still carries the provenance that explains why it
 * ran (`AUTO_APPROVE_ALL`), which is the field that answers "which policy
 * layer governed this call". Until #1117 the Cursor translator stamped the
 * policy's category verdict on the row at tool start, lease- and bypass-blind,
 * so this row read `requiresApproval: true` with an approval message nobody
 * was ever shown.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApprovalPolicySource, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
} from "../../../../__test-utils__/hermetic-activity.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
} from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";

const AGENT_ID = "agent-hermetic-bypass-0001";
const RUN_ID = "run-hermetic-bypass-0001";
const CALL_ID = "call-hermetic-shell-0001";
const USER_MESSAGE = "Run the tests.";
const SHELL_ARGS = { command: "npm test" };
const SHELL_RESULT = "ok 12 tests\n";
const ASSISTANT_TEXT = "All twelve tests pass.";

describe("ExecuteCursor hermetic — a gated built-in under the global bypass", () => {
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

  it("persists the shell it ran as not held: no approval fields, AUTO_APPROVE_ALL provenance", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Running them now.")),
          step.event(ev.toolCall(CALL_ID, "shell", "running", SHELL_ARGS)),
          step.event(ev.toolCall(CALL_ID, "shell", "completed", SHELL_ARGS, SHELL_RESULT)),
          step.event(ev.assistant(ASSISTANT_TEXT)),
          step.turnEnded({ inputTokens: 1_500, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: ASSISTANT_TEXT, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE, autoApproveAll: true });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [agent], catalog: SDK_CATALOG },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: the turn ran to completion, nothing parked ───────────────────
    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.waitingToolCalls(), "a bypassed call is never parked").toHaveLength(0);
    expect(agent.runs[0].cancelCalls, "nothing was denied, so nothing was cancelled").toHaveLength(0);

    // ── Assert: the row says it ran, and why, and that nobody was asked ───────
    const rows = record.toolCalls();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.name).toBe("shell");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.approvalPolicySource, "the layer that let it run").toBe(ApprovalPolicySource.AUTO_APPROVE_ALL);
    expect(row.requiresApproval, "never held for a decision").toBe(false);
    expect(row.approvalMessage, "no card was ever shown").toBe("");
    expect(row.approvalRequestedAt, "no approval was ever requested").toBe("");

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
  });
});
