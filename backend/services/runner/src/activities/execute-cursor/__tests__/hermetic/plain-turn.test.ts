/**
 * Hermetic golden: a PLAIN TURN through the whole `ExecuteCursor` activity.
 *
 * Invariant pinned: an execution with no tools, no workspace entries, no MCP
 * servers and no skills — the user asks, the agent answers — runs the full
 * setup pipeline and ends COMPLETED with exactly the transcript, usage and
 * timestamps recorded in `goldens/plain-turn.status.json`, RETURNING a slim
 * status to the workflow (never throwing). This is the baseline every other
 * scenario is a delta from, and the first proof that the activity is byte-
 * stable under the hermetic driver.
 *
 * Parent phase rows exercised (20260908.02 `T01_0_plan.md` §3a): normalize
 * input / heartbeat; artifact storage + the `persist` chokepoint; fetch
 * execution, session, agent, blueprint; resolve environment (NOT_FOUND ->
 * empty); provision workspace (per-session dir); workspace turn lock; MCP
 * resolve (none); skills (none); attachments (none); HITL gate install;
 * pricing + model id + variant params; create the engine session; write
 * `harness_state_id` back; prompt composition; usage accumulation; run the
 * turn; terminal mapping COMPLETED -> return; cleanup.
 *
 * Nothing here is a live Cursor agent: `@cursor/sdk` is the scripted double
 * (`__test-utils__/scripted-sdk.ts`) and the control plane is the in-memory
 * execution record (`__test-utils__/hermetic-activity.ts`). No network, no
 * `CURSOR_API_KEY`, no Temporal worker.
 *
 * Regenerate the golden ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// Both mocks are hoisted by vitest; they must live in this file. Each factory
// imports the reusable module and returns its mock surface.
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
import { ScriptedCursorAgent, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  stubRegistryFetch,
} from "../../__test-utils__/hermetic-cursor.js";

const AGENT_ID = "agent-hermetic-plain-0001";
const RUN_ID = "run-hermetic-plain-0001";
const USER_MESSAGE = "Say hello in five words or fewer.";
const ASSISTANT_TEXT = "Hello there, hermetic world.";

describe("ExecuteCursor hermetic — plain turn", () => {
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

  it("completes with the golden transcript and returns a slim COMPLETED status", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event({ type: "system", subtype: "init", agent_id: AGENT_ID, run_id: RUN_ID }),
          step.event({
            type: "assistant",
            agent_id: AGENT_ID,
            run_id: RUN_ID,
            message: { role: "assistant", content: [{ type: "text", text: ASSISTANT_TEXT }] },
          }),
          step.turnEnded({ inputTokens: 1_200, outputTokens: 40 }),
          step.finished({
            result: ASSISTANT_TEXT,
            model: {
              id: FIXTURE.model,
              params: [
                { id: "fast", value: "false" },
                { id: "thinking", value: "false" },
              ],
            },
          }),
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

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: the outcome the workflow sees ────────────────────────────────
    expect(invocation.outcome.kind, "a completed turn RETURNS, never throws").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    expect(slim.final_text).toBe(ASSISTANT_TEXT);
    expect(slim, "the slim return carries no transcript").not.toHaveProperty("messages");

    // ── Assert: what the control plane received, in order ────────────────────
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
    expect(record.setupProgress, "the setup pipeline's phase labels, in order").toEqual([
      "Fetching execution",
      "Resolving agent blueprint",
      "Resolving environment",
      "Provisioning workspace",
      "Resolving MCP servers",
      "Resolving skills",
      "Initializing Cursor agent",
    ]);

    // ── Assert: what the SDK was asked ───────────────────────────────────────
    expect(scenario.sdk.resolutions).toHaveLength(1);
    expect(scenario.sdk.resolutions[0].kind, "a fresh session creates, never resumes").toBe("create");
    expect(scenario.sdk.resolutions[0].options?.model).toEqual({
      id: FIXTURE.model,
      params: [
        { id: "fast", value: "false" },
        { id: "thinking", value: "false" },
      ],
    });
    expect(agent.sends).toHaveLength(1);
    expect(String(agent.sends[0].message), "the prompt carries the user's message").toContain(USER_MESSAGE);
    expect(agent.sends[0].hasOnDelta).toBe(true);

    // ── Assert: the harness_state_id write-back ─────────────────────────────
    expect(record.sessionUpdates).toHaveLength(1);
    expect(record.sessionUpdates[0].spec?.harnessStateId).toBe(AGENT_ID);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(invocation.heartbeats.length, "the whole-activity heartbeat ran").toBeGreaterThan(0);
    expect(registry.urls.every((u) => u.includes("/model-registry")), "no network beyond the registry").toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const finalStatus = record.lastFullStatus;
    expect(finalStatus).toBeDefined();
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, finalStatus!), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/plain-turn.status.json");
  });
});
