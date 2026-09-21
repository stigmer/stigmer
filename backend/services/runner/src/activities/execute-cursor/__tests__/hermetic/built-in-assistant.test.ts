/**
 * Hermetic pin: the BUILT-IN ASSISTANT through the whole `ExecuteCursor`
 * activity — a session that names no agent instance, so the blueprint chain
 * stops at the session, the control plane is never asked for an instance or
 * an agent, and the first message the Cursor agent receives opens with the
 * one built-in text framed as this harness's `<agent_instructions>`
 * (`shared/builtin-assistant-prompt.ts`; the golden in
 * `../goldens/prompt.enhanced.no-instructions.prompt.md` photographs the
 * whole prompt).
 *
 * Invariant pinned: the agent-less record is a first-class turn on this
 * harness too — IN_PROGRESS then COMPLETED with the scripted answer, the
 * same shape as `plain-turn.test.ts` — and the words the engine saw are the
 * shared ones. The two harnesses' pins together are the proof that a person
 * who picks no agent meets the same assistant on either.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { BUILT_IN_ASSISTANT_INSTRUCTIONS } from "../../../../shared/builtin-assistant-prompt.js";
import { ScriptedCursorAgent, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
} from "../../__test-utils__/hermetic-cursor.js";

const AGENT_ID = "agent-hermetic-assistant-0001";
const RUN_ID = "run-hermetic-assistant-0001";
const USER_MESSAGE = "Say hello in five words or fewer.";
const ASSISTANT_TEXT = "Hello from the assistant.";

describe("ExecuteCursor hermetic — the built-in assistant", () => {
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

  it("runs a session with no agent to COMPLETED with the built-in words in the first message", async () => {
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
          step.turnEnded({ inputTokens: 900, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 }),
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
    const record = cursorExecutionRecord({ message: USER_MESSAGE, builtInAssistant: true });
    const instanceRead = vi.fn(async () => {
      throw new Error("must not be reached");
    });
    const agentRead = vi.fn(async () => {
      throw new Error("must not be reached");
    });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [agent], catalog: SDK_CATALOG },
      clientOverrides: { getAgentInstance: instanceRead, getAgent: agentRead },
    });

    const invocation = await runCursorTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
    expect(instanceRead).not.toHaveBeenCalled();
    expect(agentRead).not.toHaveBeenCalled();

    expect(agent.sends).toHaveLength(1);
    const sent = String(agent.sends[0].message);
    expect(sent.startsWith(`<agent_instructions>\n${BUILT_IN_ASSISTANT_INSTRUCTIONS}\n</agent_instructions>`)).toBe(true);
    expect(sent).toContain(USER_MESSAGE);
  });
});
