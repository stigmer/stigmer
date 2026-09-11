/**
 * Hermetic goldens: the `run.wait()` ARMS — every case of the terminal
 * `switch (result.status)` other than `finished`, on a CREATED agent.
 *
 * Phase 13 of the activity maps what the SDK's `run.wait()` resolves into a
 * terminal phase, and the `error` case is where the error classifier decides
 * whether the runner tries again on its own. The three scenarios here pin the
 * three outcomes of that decision table that the S0 net did not cover (the
 * poisoned-handle recovery on a RESUMED agent is `recovery-fresh-agent.test.ts`):
 *
 *  1. A NON-RETRYABLE error (auth class): the classifier files it as
 *     `auth`, neither recovery spine fires, the turn RETURNS EXECUTION_FAILED
 *     with the classified error verbatim, and the agent is PARKED (Phase 13's
 *     terminal parks the handle whatever the phase — a bad key is not a bad
 *     handle). Golden `goldens/run-error-non-retryable.status.json`.
 *
 *  2. A NETWORK error on a created agent — the TRANSPORT-TIMEOUT recovery:
 *     the classifier files it as `network` + retryable, the activity closes
 *     the handle, resets the proxy sessions, `Agent.create`s a fresh agent,
 *     re-binds `harness_state_id`, RE-SENDS THE SAME PROMPT (not a rebuilt
 *     one — the created agent had no conversation to recover) through the
 *     identical stream loop, and ends COMPLETED on the replacement. At most
 *     once (`alreadyRetriedWithFreshAgent`). Golden
 *     `goldens/recovery-transport-timeout.status.json`.
 *
 *  3. An SDK-SIDE CANCEL: the run is cancelled from outside the runner (no
 *     runner flag set — not a pause, stall, cost cap or denial), the stream
 *     ends, the boundary passes, and `run.wait()` answers `cancelled`. The turn
 *     RETURNS EXECUTION_CANCELLED with no error and no system message, and the
 *     agent is parked. Golden `goldens/run-cancelled.status.json`.
 *
 * All three are RETURN arms: a Temporal retry would re-run the identical
 * prompt against the same key, the same network, or the same cancelled run.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
import { _parkedAgentCountForTests } from "../../agent-session-cache.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  stubRegistryFetch,
} from "../../__test-utils__/hermetic-cursor.js";

const USER_MESSAGE = "List the open pull requests.";
const NEVER_SEEN = "This text must never reach the transcript.";
// An auth-class failure shape (error-classifier AUTH_PATTERNS: "unauthenticated",
// "invalid api key"). Terminal: retrying cannot mint a valid key.
const AUTH_ERROR = "UNAUTHENTICATED: invalid api key";
// A network-class failure shape (NETWORK_PATTERNS: "unavailable", "fetch failed",
// "econnreset"). Retryable: a fresh connection may succeed.
const TRANSPORT_ERROR = "UNAVAILABLE: fetch failed (ECONNRESET) while streaming the run";
const FINAL_TEXT = "There are three open pull requests: #12, #15 and #18.";

function systemMessages(status: { messages: { type: MessageType; content: string }[] }): string[] {
  return status.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
}

describe("ExecuteCursor hermetic — the run.wait() arms on a created agent", () => {
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

  it("a non-retryable error fails the turn with the classified error and parks the agent", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset(); // every golden in this file reads from :00
    const agentId = "agent-hermetic-autherr-0001";
    const runId = "run-hermetic-autherr-0001";
    const ev = sdkEvents(agentId, runId);
    const agent = new ScriptedCursorAgent({
      agentId,
      runIds: [runId],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Checking the repository.")),
          step.errored({ result: AUTH_ERROR }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind, "a classified failure RETURNS").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_FAILED");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_FAILED,
    ]);
    const final = record.lastFullStatus!;
    expect(final.error).toBe(`${AUTH_ERROR} [category=auth, source=sdk, retryable=false]`);
    expect(final.completedAt).not.toBe("");
    expect(systemMessages(final), "the classified arm appends no system message").toEqual([]);

    // ── Assert: no recovery fired ────────────────────────────────────────────
    expect(scenario.sdk.resolutions.map((r) => r.kind), "one create, no fresh agent").toEqual(["create"]);
    expect(agent.sends).toHaveLength(1);
    expect(agent.closeCalls, "a bad key is not a bad handle").toBe(0);
    expect(_parkedAgentCountForTests(), "Phase 13 parks on every phase").toBe(1);
    expect(record.sessionUpdates, "the one harness_state_id bind").toHaveLength(1);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    expect(invocation.heartbeats.length).toBeGreaterThan(0);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/run-error-non-retryable.status.json");
  });

  it("a network error on a created agent retries once on a fresh agent with the same prompt and completes", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    const staleId = "agent-hermetic-transport-stale-0001";
    const freshId = "agent-hermetic-transport-fresh-0002";
    const evStale = sdkEvents(staleId, "run-hermetic-transport-stale-0001");
    const evFresh = sdkEvents(freshId, "run-hermetic-transport-fresh-0001");
    const stale = new ScriptedCursorAgent({
      agentId: staleId,
      runIds: ["run-hermetic-transport-stale-0001"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(evStale.init()),
          step.event(evStale.status("ERROR", TRANSPORT_ERROR)),
          step.errored({ result: TRANSPORT_ERROR }),
        ],
      ],
    });
    const fresh = new ScriptedCursorAgent({
      agentId: freshId,
      runIds: ["run-hermetic-transport-fresh-0001"],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(evFresh.init()),
          step.event(evFresh.assistant(FINAL_TEXT)),
          step.turnEnded({ inputTokens: 2_200, outputTokens: 30 }),
          step.finished({ result: FINAL_TEXT, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    // Both agents are CREATED: the first by the turn, the second by the recovery.
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [stale, fresh], catalog: SDK_CATALOG },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome ──────────────────────────────────────────────────────
    expect(invocation.outcome.kind, "a recovered turn RETURNS like any completion").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    expect(slim.final_text).toBe(FINAL_TEXT);
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
    const final = record.lastFullStatus!;
    expect(final.error, "the primary failure is superseded by the recovery").toBe("");

    // ── Assert: the transport-recovery spine ─────────────────────────────────
    expect(scenario.sdk.resolutions.map((r) => [r.kind, r.agentId])).toEqual([
      ["create", staleId],
      ["create", freshId],
    ]);
    expect(stale.sends, "the first handle ran exactly once").toHaveLength(1);
    expect(stale.closeCalls, "the first handle is disposed").toBe(1);
    expect(fresh.sends, "the fresh agent ran the turn exactly once — no second retry").toHaveLength(1);
    expect(fresh.closeCalls, "the fresh handle is parked, not closed").toBe(0);
    expect(_parkedAgentCountForTests()).toBe(1);
    // The SAME prompt is re-sent: a created agent had no conversation to
    // rebuild from, unlike the poisoned-handle recovery's rebuilt prompt.
    expect(String(fresh.sends[0].message)).toBe(String(stale.sends[0].message));
    // Two harness_state_id binds: the primary agent, then the fresh one.
    expect(record.sessionUpdates.map((s) => s.spec?.harnessStateId)).toEqual([staleId, freshId]);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/recovery-transport-timeout.status.json");
  });

  it("an SDK-side cancel ends the turn CANCELLED with no error and parks the agent", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    const agentId = "agent-hermetic-sdkcancel-0001";
    const runId = "run-hermetic-sdkcancel-0001";
    const ev = sdkEvents(agentId, runId);
    const agent = new ScriptedCursorAgent({
      agentId,
      runIds: [runId],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Looking at the pull requests.")),
          // The run is cancelled from OUTSIDE the runner (Cursor's side): no
          // runner flag is set, the stream ends, wait() answers "cancelled".
          step.effect("the SDK cancels the run", ({ run }) => run.cancel()),
          step.event(ev.assistant(NEVER_SEEN)),
          step.finished({ result: NEVER_SEEN }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind, "a cancelled run RETURNS").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_CANCELLED");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_CANCELLED,
    ]);
    const final = record.lastFullStatus!;
    expect(final.error, "a cancel is not an error").toBe("");
    expect(final.completedAt, "the turn is complete").not.toBe("");
    expect(systemMessages(final), "no copy is written for an SDK-side cancel").toEqual([]);
    expect(final.messages.some((m) => m.content === NEVER_SEEN), "nothing after the cancel is processed").toBe(false);

    // ── Assert: engine disposition (today's) ─────────────────────────────────
    expect(agent.runs[0].cancelCalls, "the one cancel is the SDK's own").toHaveLength(1);
    expect(agent.closeCalls).toBe(0);
    expect(_parkedAgentCountForTests(), "Phase 13 parks on every phase").toBe(1);
    expect(record.sessionUpdates).toHaveLength(1);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/run-cancelled.status.json");
  });
});
