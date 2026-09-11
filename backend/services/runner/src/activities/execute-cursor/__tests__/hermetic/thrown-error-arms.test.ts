/**
 * Hermetic goldens: the THROWN-ERROR ARMS of the outer catch — an error that
 * escapes a setup phase, before any stream ran, becomes EXECUTION_FAILED with
 * two system messages and the activity RETURNS.
 *
 * The outer `catch` of the activity has two arms for an error that is not a
 * Temporal cancellation and not a pause: a thrown `CursorSdkError` (routed
 * through the SAME classifier as the `run.wait()` error path, so its
 * category and diagnostics survive) and everything else (formatted by
 * `describeExecutionError` as `[<ErrorType>] <message>`). Both write the same
 * pair of system messages — the generic "Internal system error occurred..."
 * and an "Error details: ..." carrying the classified or formatted text — and
 * both RETURN the failed status rather than throwing: a Temporal retry would
 * replay the same setup against the same fault.
 *
 * Two scenarios, one per arm, each failing at a DIFFERENT setup phase:
 *
 *  1. `Agent.create` throws a `CursorSdkError` (Phase 8: the SDK refuses the
 *     key). The error propagates unretried — `resolveAgentWithTransportRecovery`
 *     retries only a TimeoutError — and the SDK arm classifies it `auth`.
 *     Golden `goldens/sdk-error-at-create.status.json`.
 *
 *  2. `client.getAgent` rejects with a plain `Error` (Phase 2: a control-plane
 *     fault while resolving the blueprint). The generic arm formats it with
 *     the error's constructor name. Golden `goldens/resolution-error.status.json`.
 *
 * Both fail BEFORE the first status persist, so the ONLY phase the control
 * plane ever sees for these executions is EXECUTION_FAILED — `persistedPhases`
 * is `[FAILED]`, not `[IN_PROGRESS, FAILED]`.
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
import { ScriptedCursorAgent } from "../../__test-utils__/scripted-agent.js";
import { ScriptedCursorSdkError } from "../../__test-utils__/scripted-sdk.js";
import {
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  stubRegistryFetch,
} from "../../__test-utils__/hermetic-cursor.js";

const USER_MESSAGE = "Draft the release notes.";
const GENERIC_SYSTEM_MESSAGE = "Internal system error occurred. Please contact support if this issue persists.";
// The SDK refusing the key: the shape the real CursorSdkError carries for a 401.
const SDK_ERROR_MESSAGE = "Cursor API rejected the request: invalid API key";
// A control-plane fault with deliberately neutral text — no provider, network
// or billing word in it — so the GENERIC arm is what the golden pins, not a
// specific diagnosis (`describeExecutionError` classifies known prose first).
const CONTROL_PLANE_FAULT = "hermetic fault injected at getAgent";

function systemMessages(status: { messages: { type: MessageType; content: string }[] }): string[] {
  return status.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
}

describe("ExecuteCursor hermetic — thrown-error arms of the outer catch", () => {
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

  it("a CursorSdkError thrown by Agent.create is classified and fails the turn", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset(); // both goldens read from :00
    // Declared so a create that unexpectedly SUCCEEDS is a loud test failure
    // (its script has no result step) rather than a quiet pass.
    const neverUsed = new ScriptedCursorAgent({ agentId: "agent-hermetic-never-created", turns: [] });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: {
        agents: [neverUsed],
        createFailure: new ScriptedCursorSdkError(SDK_ERROR_MESSAGE, {
          code: "unauthenticated",
          status: 401,
          operation: "Agent.create",
        }),
        catalog: SDK_CATALOG,
      },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind, "the SDK arm RETURNS the failed status").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_FAILED");
    expect(record.persistedPhases, "nothing was persisted before the failure").toEqual([
      ExecutionPhase.EXECUTION_FAILED,
    ]);
    const final = record.lastFullStatus!;
    expect(final.error).toBe(`${SDK_ERROR_MESSAGE} [category=auth, source=sdk, retryable=false]`);
    expect(final.completedAt).not.toBe("");
    expect(systemMessages(final)).toEqual([GENERIC_SYSTEM_MESSAGE, `Error details: ${final.error}`]);

    // ── Assert: where it stopped ─────────────────────────────────────────────
    expect(scenario.sdk.resolutions.map((r) => r.kind), "one create attempt, unretried").toEqual(["create"]);
    expect(neverUsed.sends, "no agent ever ran").toHaveLength(0);
    expect(record.sessionUpdates, "no harness_state_id to bind").toHaveLength(0);
    expect(_parkedAgentCountForTests()).toBe(0);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    expect(invocation.heartbeats.length).toBeGreaterThan(0);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/sdk-error-at-create.status.json");
  });

  it("a plain Error during blueprint resolution fails the turn through the generic arm", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    const neverUsed = new ScriptedCursorAgent({ agentId: "agent-hermetic-never-resolved", turns: [] });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [neverUsed], catalog: SDK_CATALOG },
      clientOverrides: {
        getAgent: vi.fn(async () => {
          throw new Error(CONTROL_PLANE_FAULT);
        }),
      },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind, "the generic arm RETURNS the failed status").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_FAILED");
    expect(record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_FAILED]);
    const final = record.lastFullStatus!;
    expect(final.error).toBe(`Execution failed: [Error] ${CONTROL_PLANE_FAULT}`);
    expect(final.completedAt).not.toBe("");
    expect(systemMessages(final)).toEqual([
      GENERIC_SYSTEM_MESSAGE,
      `Error details: [Error] ${CONTROL_PLANE_FAULT}`,
    ]);

    // ── Assert: where it stopped ─────────────────────────────────────────────
    expect(record.setupProgress, "Phase 2 was reported, nothing after it").toEqual([
      "Fetching execution",
      "Resolving agent blueprint",
    ]);
    expect(scenario.sdk.resolutions, "the SDK was never reached").toHaveLength(0);
    expect(record.sessionUpdates).toHaveLength(0);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/resolution-error.status.json");
  });
});
