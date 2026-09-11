/**
 * Hermetic golden: POISONED-HANDLE RECOVERY — a resumed agent whose run fails
 * with a transport error is replaced by a fresh agent, once, and the turn
 * completes on the replacement.
 *
 * Invariant pinned: when `run.wait()` reports `error` on an agent that was
 * RESUMED (`resolution.reason === "resumed_successfully"`) and the classifier
 * files the error as `network` or `agent-stale`, the activity closes the stale
 * handle, calls `Agent.create` for a fresh one, writes the fresh id to the
 * session's `harness_state_id`, re-runs the turn on the fresh agent through the
 * IDENTICAL stream loop and boundary, and ends COMPLETED. The retry happens at
 * most once (`alreadyRetriedWithFreshAgent`). The golden
 * (`goldens/recovery-fresh-agent.status.json`) pins what the user sees after a
 * recovered turn.
 *
 * Parent phase rows exercised beyond the earlier scenarios: `Agent.resume`
 * through `resolveAgentWithTransportRecovery` (a second execution in a session:
 * `thread_id` set, no parked agent); the `status: ERROR` stream event feeding
 * `streamErrorMessage`; `run.wait()` error mapping; the error classifier
 * (`error-classifier.ts` NETWORK_PATTERNS, the same shapes its own tests pin);
 * the fresh-agent recovery spine (`runRecoveryStream`); the second
 * `harness_state_id` write-back.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  stubRegistryFetch,
} from "../../__test-utils__/hermetic-cursor.js";

const STALE_AGENT_ID = "agent-hermetic-stale-0001";
const FRESH_AGENT_ID = "agent-hermetic-fresh-0002";
const RUN_STALE = "run-hermetic-stale-0001";
const RUN_FRESH = "run-hermetic-fresh-0001";
const USER_MESSAGE = "Summarize what changed since yesterday.";
// A real network-class failure shape (error-classifier NETWORK_PATTERNS:
// "unavailable", "econnreset", "fetch failed").
const TRANSPORT_ERROR = "UNAVAILABLE: fetch failed (ECONNRESET) while streaming the run";
const FINAL_TEXT = "Two files changed since yesterday: notes.md and README.md.";

describe("ExecuteCursor hermetic — poisoned-handle recovery on a fresh agent", () => {
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

  it("replaces the stale resumed agent once and completes on the fresh one", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const evStale = sdkEvents(STALE_AGENT_ID, RUN_STALE);
    const evFresh = sdkEvents(FRESH_AGENT_ID, RUN_FRESH);
    const stale = new ScriptedCursorAgent({
      agentId: STALE_AGENT_ID,
      runIds: [RUN_STALE],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(evStale.init()),
          step.event(evStale.assistant("Let me look at the recent changes.")),
          step.event(evStale.status("ERROR", TRANSPORT_ERROR)),
          step.errored({ result: TRANSPORT_ERROR }),
        ],
      ],
    });
    const fresh = new ScriptedCursorAgent({
      agentId: FRESH_AGENT_ID,
      runIds: [RUN_FRESH],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(evFresh.init()),
          step.event(evFresh.assistant(FINAL_TEXT)),
          step.turnEnded({ inputTokens: 2_800, outputTokens: 55 }),
          step.finished({ result: FINAL_TEXT, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      // `Agent.create` hands out `fresh`; `Agent.resume(STALE)` finds `stale`,
      // the previous turn's agent the session knows only by harness_state_id.
      sdk: { agents: [fresh], resumableAgents: [stale], catalog: SDK_CATALOG },
    });

    // ── Act: the second execution in the session resumes the stale handle ────
    const invocation = await runCursorTurn(scenario, { threadId: STALE_AGENT_ID, turnSeq: 0 });

    // ── Assert: outcome ──────────────────────────────────────────────────────
    expect(invocation.outcome.kind, "a recovered turn RETURNS like any completion").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    expect(slim.final_text).toBe(FINAL_TEXT);
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);

    // ── Assert: the recovery spine ───────────────────────────────────────────
    expect(scenario.sdk.resolutions.map((r) => [r.kind, r.agentId])).toEqual([
      ["resume", STALE_AGENT_ID],
      ["create", FRESH_AGENT_ID],
    ]);
    expect(stale.sends, "the stale handle ran exactly once").toHaveLength(1);
    expect(stale.closeCalls, "the poisoned handle is disposed").toBe(1);
    expect(fresh.sends, "the fresh agent ran the turn exactly once — no second retry").toHaveLength(1);
    expect(String(fresh.sends[0].message), "the rebuilt prompt carries the user's message").toContain(USER_MESSAGE);

    // The session now points at the fresh agent (the stale id is superseded).
    const lastSessionWrite = record.sessionUpdates.at(-1);
    expect(lastSessionWrite?.spec?.harnessStateId).toBe(FRESH_AGENT_ID);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/recovery-fresh-agent.status.json");
  });
});
