/**
 * Hermetic: a conversation without a computer (`SessionStatus.computer`
 * COMPUTER_NONE) through the whole `ExecuteDeepAgent` activity.
 *
 * Invariant pinned: the conversation's computer is every graph's. With
 * none, the parent graph and a saved subagent's graph are each offered no
 * `execute` tool, by the path plan mode takes (no shell environment, so a
 * filesystem-only backend and no subagent shell, `turn-setup.ts`). The same
 * agent and subagent in a conversation recorded before the setting (unset,
 * which has a computer) and in one that needs a computer are each offered
 * `execute`, so the test fails if the condition is removed.
 */

import { mkdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

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
import { savedAgentFixture } from "../../../../__test-utils__/execution-record-fixture.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";

const WORKER = "You are the hermetic worker.";

describe("ExecuteDeepAgent hermetic — a conversation without a computer", () => {
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

  /** Runs one turn that hands work to a saved subagent; answers the tools each graph was offered. */
  async function offered(computer: Computer | undefined): Promise<{ parent: string[]; worker: string[] }> {
    const worker = savedAgentFixture("worker", { description: "Works.", instructions: WORKER });
    const record = deepAgentExecutionRecord({
      message: "Delegate.",
      subagents: [worker],
      ...(computer === undefined ? {} : { computer }),
    });
    const seen = { parent: [] as string[], worker: [] as string[] };
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (tools, context) => {
        if (context.systemPrompt.includes(WORKER)) {
          seen.worker = [...tools];
          return { turns: [{ text: "Worked." }] };
        }
        seen.parent = [...tools];
        return {
          turns: [
            { toolCalls: [{ id: "call-task", name: "task", args: { description: "Work.", subagent_type: "worker" } }] },
            { text: "Done." },
          ],
        };
      },
    });
    mkdirSync(sessionWorkspaceDir(env), { recursive: true });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    return seen;
  }

  it("offers neither the parent nor a subagent a shell", async () => {
    const seen = await offered(Computer.NONE);
    expect(seen.parent).toContain("read_file");
    expect(seen.parent).not.toContain("execute");
    expect(seen.worker).toContain("read_file");
    expect(seen.worker).not.toContain("execute");
  });

  it("offers both a shell when the conversation has a computer, recorded or from before the setting", async () => {
    for (const computer of [Computer.REQUIRED, undefined]) {
      const seen = await offered(computer);
      expect(seen.parent).toContain("execute");
      expect(seen.worker).toContain("execute");
    }
  });
});
