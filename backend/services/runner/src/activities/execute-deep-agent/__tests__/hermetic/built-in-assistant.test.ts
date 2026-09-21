/**
 * Hermetic pin: the BUILT-IN ASSISTANT through the whole `ExecuteDeepAgent`
 * activity — a session that names no agent instance, so the blueprint chain
 * stops at the session (`shared/blueprint-resolver.ts`), the control plane
 * is never asked for an instance or an agent, and the system prompt opens
 * with the one built-in text (`shared/builtin-assistant-prompt.ts`).
 *
 * Invariant pinned: the agent-less record is a first-class turn, not an
 * error arm — IN_PROGRESS then COMPLETED with the scripted answer, the same
 * shape as `plain-turn.test.ts`; and the words the model saw are the shared
 * ones, read off the scripted model's `systemPrompt` context. The status
 * itself is not goldened here: nothing agent-shaped reaches the status, so
 * the plain-turn golden already photographs it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { BUILT_IN_ASSISTANT_INSTRUCTIONS } from "../../../../shared/builtin-assistant-prompt.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";

const USER_MESSAGE = "Say hello.";
const ASSISTANT_TEXT = "Hello from the built-in assistant.";

describe("ExecuteDeepAgent hermetic — the built-in assistant", () => {
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

  it("runs a session with no agent to COMPLETED on the built-in prompt, never reading an instance or an agent", async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE, builtInAssistant: true });
    const systemPrompts: string[] = [];
    const instanceRead = vi.fn(async () => {
      throw new Error("must not be reached");
    });
    const agentRead = vi.fn(async () => {
      throw new Error("must not be reached");
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      clientOverrides: { getAgentInstance: instanceRead, getAgent: agentRead },
      script: (_tools, context) => {
        systemPrompts.push(context.systemPrompt);
        return { turns: [{ text: ASSISTANT_TEXT, usage: { inputTokens: 900, outputTokens: 20 } }] };
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
    const final = record.lastFullStatus!;
    const ai = final.messages.filter((m) => m.type === MessageType.MESSAGE_AI);
    expect(ai).toHaveLength(1);
    expect(ai[0].content).toBe(ASSISTANT_TEXT);

    // The chain stopped at the session: the refusing reads were never
    // reached (they would have failed the resolve phase).
    expect(instanceRead).not.toHaveBeenCalled();
    expect(agentRead).not.toHaveBeenCalled();

    // The model met the shared words, first.
    expect(systemPrompts).toHaveLength(1);
    expect(systemPrompts[0].startsWith(BUILT_IN_ASSISTANT_INSTRUCTIONS)).toBe(true);
  });
});
