/**
 * Hermetic golden: a RESOLUTION ERROR — the control plane rejects a read the
 * setup depends on (`client.getAgent`) before any graph exists.
 *
 * Invariant pinned: the runtime's blueprint phase throws, the runtime's
 * catch takes its generic-error arm (`terminal-table.ts` `unexpectedErrorArm`),
 * persists ONE EXECUTION_FAILED status carrying
 * `status.error = "Execution failed: [Error] <message>"` and two system rows
 * — the boilerplate "Internal system error occurred. Please contact support
 * if this issue persists." and `"Error details: [Error] <message>"` — and
 * RETURNS the slim status (the workflow reads the phase; a throw would make
 * Temporal retry a deterministic failure). Nothing streamed, no lock taken
 * (the fault precedes the lock phase), no artifacts.
 *
 * The row shape is one of the alignments #1096 made on purpose: the
 * orchestrator wrote one row `"Error: [Error] <message>"`; the runtime's arm
 * writes the boilerplate plus the details row. `status.error` itself did
 * not move (the conformance suite pins it). The setup labels are the
 * runtime's resolution phases'.
 *
 * Carried from `index.test.ts` ("returns EXECUTION_FAILED status when setup
 * fails", "includes error message in failed status", "always returns a
 * serializable result").
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";

const CONTROL_PLANE_FAULT = "hermetic fault injected at getAgent";

describe("ExecuteDeepAgent hermetic — resolution error", () => {
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

  it("fails with the fault's message in status.error and one system row, and returns", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: "Never reaches a model." });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => {
        throw new Error("the model must never be asked on a resolution failure");
      },
      clientOverrides: {
        getAgent: vi.fn(async () => {
          throw new Error(CONTROL_PLANE_FAULT);
        }),
      },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind, "a deterministic failure RETURNS; a retry would fail the same way").toBe(
      "returned",
    );
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_FAILED");
    expect(() => JSON.stringify(slim), "the return is serializable").not.toThrow();
    expect(record.persistedPhases, "the one and only full persist").toEqual([ExecutionPhase.EXECUTION_FAILED]);

    // ── Assert: the copy ─────────────────────────────────────────────────────
    const final = record.lastFullStatus!;
    expect(final.error).toBe(`Execution failed: [Error] ${CONTROL_PLANE_FAULT}`);
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
      "Internal system error occurred. Please contact support if this issue persists.",
      `Error details: [Error] ${CONTROL_PLANE_FAULT}`,
    ]);
    expect(final.messages, "the two system rows are the whole transcript").toHaveLength(2);

    // ── Assert: nothing past the fault ───────────────────────────────────────
    expect(recordedModelBuilds(), "no model was built").toHaveLength(0);
    expect(record.setupProgress).toEqual(["Fetching execution", "Resolving agent blueprint"]);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/resolution-error.status.json");
  });
});
