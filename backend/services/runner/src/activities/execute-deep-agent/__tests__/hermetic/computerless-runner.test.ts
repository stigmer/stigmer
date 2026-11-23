/**
 * Hermetic: a runner that serves only conversations without a computer
 * (`STIGMER_RUNNER_SERVES=computerless`, `runner-serves.ts`) through the
 * whole `ExecuteDeepAgent` activity.
 *
 * Invariant pinned: such a runner refuses a turn of a conversation that has
 * a computer, whatever routed it here, before the model is asked and before
 * any workspace is provisioned, with a sentence naming the setting; and
 * serves a conversation without one as any runner does. The same turn of a
 * conversation with a computer on a runner that serves every conversation
 * runs, so the test fails if the refusal is removed or widened.
 */

import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { existsSync, mkdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn, sessionWorkspaceDir } from "../../__test-utils__/hermetic-deep-agent.js";

describe("ExecuteDeepAgent hermetic — a runner that serves only conversations without a computer", () => {
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

  it("refuses a conversation with a computer before the model is asked or a workspace is made, naming the setting", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Build it.", computer: Computer.REQUIRED });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      config: { serves: "computerless" },
      script: () => {
        throw new Error("the model must never be asked when the turn is refused");
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    const final = record.lastFullStatus!;
    expect(final.phase).toBe(RunPhase.RUN_FAILED);
    expect(final.error).toMatch(/^This conversation has a computer, and this runner serves only conversations without one \(STIGMER_RUNNER_SERVES=computerless\)/);
    expect(existsSync(sessionWorkspaceDir(env)), "no workspace was provisioned").toBe(false);
  });

  it("serves a conversation without a computer as any runner does", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Say hi.", computer: Computer.NONE });
    const scenario = beginDeepAgentScenario({ env, clock, record, config: { serves: "computerless" }, script: () => ({ turns: [{ text: "Hi." }] }) });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
  });

  it("runs the same conversation with a computer on a runner that serves every conversation", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Build it.", computer: Computer.REQUIRED });
    const scenario = beginDeepAgentScenario({ env, clock, record, config: { serves: "all" }, script: () => ({ turns: [{ text: "Built." }] }) });
    mkdirSync(sessionWorkspaceDir(env), { recursive: true });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
  });
});
