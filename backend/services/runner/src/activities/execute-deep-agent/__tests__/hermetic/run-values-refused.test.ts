/**
 * Hermetic arm: the run's value fetch is refused for a reason its person
 * fixes (an entry gone from its vault since the run was planned).
 *
 * Invariant pinned: the runtime's values phase settles the turn as
 * RUN_FAILED on the actionable surface with the server's own sentence —
 * the key, its declarer and the vault — unframed, with one
 * `Execution failed:` row, and RETURNS (a retry would read the same
 * vaults). The model is never asked, and no workspace is provisioned. Any
 * other failure of the fetch (a credential the server refuses) is the
 * platform's: it takes the runtime's generic error arm, never the
 * person-facing one.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { MessageType, RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../../__test-utils__/hermetic-deep-agent.js";

const REFUSAL =
  "the agent support-bot needs ZENDESK_TOKEN from vault 'Support tools', which no longer holds it: " +
  "save it there again, then recover the run";

describe("ExecuteDeepAgent hermetic — the run's values are refused", () => {
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

  it("fails the turn with the server's sentence and returns, never asking the model", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Answer the ticket." });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => {
        throw new Error("the model must never be asked when the run's values are refused");
      },
      clientOverrides: {
        fetchExecutionValues: vi.fn(async () => {
          throw new ConnectError(REFUSAL, Code.FailedPrecondition);
        }),
      },
    });

    const turn = await runDeepAgentTurn(scenario, { turnSeq: 0 });

    expect(turn.outcome.kind, "a refusal the person fixes RETURNS").toBe("returned");
    const final = record.lastFullStatus!;
    expect(final.phase).toBe(RunPhase.RUN_FAILED);
    expect(final.error).toBe(REFUSAL);
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
      `Execution failed: ${REFUSAL}`,
    ]);
  });

  it("takes the generic error arm for a fetch the server refuses as the platform's", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Answer the ticket." });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => {
        throw new Error("the model must never be asked when the run's values cannot be fetched");
      },
      clientOverrides: {
        fetchExecutionValues: vi.fn(async () => {
          throw new ConnectError("not bound to this execution", Code.PermissionDenied);
        }),
      },
    });

    const turn = await runDeepAgentTurn(scenario, { turnSeq: 0 });

    expect(turn.outcome.kind).toBe("returned");
    const final = record.lastFullStatus!;
    expect(final.phase).toBe(RunPhase.RUN_FAILED);
    expect(final.error).toContain("not bound to this execution");
    expect(final.error, "never the person-facing sentence").not.toBe("not bound to this execution");
  });
});
