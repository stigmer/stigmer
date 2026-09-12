/**
 * Hermetic golden: SUB-AGENT DELEGATION — the root agent hands a task to a
 * declared sub-agent through deepagents' `task` tool, and the sub-agent's
 * own turn is tracked as a `SubAgentExecution`.
 *
 * Invariant pinned: `transformAndCompileSubagents` compiles the agent's
 * declared sub-agent (plus deepagents' built-in `general-purpose` and the
 * runner's `shell`) on the SAME model double through `modelFactory`; the root
 * proposes `task({ subagent_type, description })`; the tools node runs the
 * sub-agent graph under a nested namespace (`tools:<uuid>|...`); the
 * `SubAgentTracker` opens a `SubAgentExecution` keyed by the `task` call id
 * (not by the namespace uuid, which never reaches the status), routes the
 * nested model events into its own transcript, and closes it COMPLETED when
 * the `task` tool finishes; the root's transcript carries the `task` row and
 * its closing text. The golden (`goldens/sub-agent-delegation.status.json`)
 * pins the nested transcript shape S4 must reproduce.
 *
 * Role selection: `createDeepAgent` gives the sub-agent the same tool set as
 * its parent (`task` included), so the script tells the roles apart by the
 * system prompt (`ScriptRoleContext.systemPrompt`), which carries the
 * sub-agent's own instructions — the one thing that differs.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create, toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

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

const HELPER_INSTRUCTIONS = "You are the hermetic helper. Answer in one line.";
const TASK_CALL_ID = "call-hermetic-task-0001";
const TASK_DESCRIPTION = "Look up the fixture value.";
const HELPER_ANSWER = "The fixture value is forty-two.";
const ROOT_CLOSING = "The helper reports the fixture value is forty-two.";

describe("ExecuteDeepAgent hermetic — sub-agent delegation", () => {
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

  it("tracks the delegated turn as a SubAgentExecution keyed by the task call and completes", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const helper = create(SubAgentSchema, {
      name: "helper",
      description: "Looks up fixture values.",
      instructions: HELPER_INSTRUCTIONS,
    });
    const record = deepAgentExecutionRecord({ message: "Ask the helper for the fixture value.", subAgents: [helper] });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (_tools, context) =>
        context.systemPrompt.includes(HELPER_INSTRUCTIONS)
          ? { turns: [{ text: HELPER_ANSWER, usage: { inputTokens: 600, outputTokens: 12 } }] }
          : {
              turns: [
                {
                  text: "Delegating to the helper.",
                  toolCalls: [{ id: TASK_CALL_ID, name: "task", args: { description: TASK_DESCRIPTION, subagent_type: "helper" } }],
                  usage: { inputTokens: 1_500, outputTokens: 60 },
                },
                { text: ROOT_CLOSING, usage: { inputTokens: 1_800, outputTokens: 30 } },
              ],
            },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: outcome ──────────────────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // ── Assert: the root transcript ──────────────────────────────────────────
    const final = record.lastFullStatus!;
    const rows = record.toolCalls();
    expect(rows.map((tc) => [tc.id, tc.name, tc.status])).toEqual([[TASK_CALL_ID, "task", ToolCallStatus.TOOL_CALL_COMPLETED]]);
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content)).toEqual([
      "Delegating to the helper.",
      "",
      ROOT_CLOSING,
    ]);

    // ── Assert: the sub-agent execution ──────────────────────────────────────
    expect(final.subAgentExecutions).toHaveLength(1);
    const sub = final.subAgentExecutions[0];
    expect(sub.id, "keyed by the task call id, never by the namespace uuid").toBe(TASK_CALL_ID);
    expect(sub.name).toBe("helper");
    expect(sub.subject).toBe(TASK_DESCRIPTION);
    expect(sub.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    expect(sub.messages.map((m) => [m.type, m.content])).toEqual([[MessageType.MESSAGE_AI, HELPER_ANSWER]]);

    // ── Assert: the model double was built for every compiled role ──────────
    expect(recordedModelBuilds().length, "the primary plus one per compiled sub-agent").toBeGreaterThanOrEqual(2);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/sub-agent-delegation.status.json");
  });
});
