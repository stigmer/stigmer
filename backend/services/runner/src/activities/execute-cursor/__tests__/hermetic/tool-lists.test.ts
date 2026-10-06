/**
 * Hermetic: an agent's tool lists through the whole `ExecuteCursor` activity.
 *
 * Invariants pinned, each on what the SDK double was asked or what the record
 * persisted (no golden: the transcript is the plain turn's):
 *  - an allow-list reaches `Agent.create` as the SDK's `tools`, in its own
 *    names, with `read` kept (the hook confines it) and the excluded tools
 *    absent;
 *  - an `Agent(type, …)` type list fails the turn before any agent is created,
 *    naming the entry: Cursor's own sub-agent types start through a `task`
 *    call no hook sees, so the list could not bind; bare `Agent` runs;
 *  - a sub-agent carrying lists of its own fails the turn before any agent is
 *    created, naming the sub-agent: the hook cannot tell a sub-agent's call
 *    from the main agent's, so its lists could not bind;
 *  - a `tools` list naming nothing the turn has fails the turn the same way;
 *    both refusals settle as the native engine settles them: RUN_FAILED
 *    on the actionable surface, the refusal's own sentence as `status.error`
 *    and the one `Execution failed:` row;
 *  - an engine extra the real hook refuses under an allow-list (a hook name
 *    its table lacks, a different stream name), called by a sub-agent and
 *    surfacing on the root stream too, settles as FAILED rows carrying the
 *    refusal the model read, and the turn completes: it is never read as a
 *    foreign hook's block (#205).
 * The hook's own refusals are pinned on the real script in
 * `hook-script.test.ts`; resume's re-pass of the options in
 * `session-lifecycle.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SubAgentSchema, type SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

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
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import { hookBuiltin } from "../../__test-utils__/cursor-hook-harness.js";
import { ToolListResolutionError, ToolScope, outOfScopeMessage } from "../../../../shared/tool-lists.js";
import {
  ApprovalPolicySource,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  runWorkspaceHook,
  sessionWorkspaceDir,
  type CursorRecordOptions,
} from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";

const USER_MESSAGE = "Summarise the README.";
const ANSWER = "It is a readme.";

function answeringAgent(agentId: string, runId: string, clock: ScriptedClock): ScriptedCursorAgent {
  return new ScriptedCursorAgent({
    agentId,
    runIds: [runId],
    observeStep: () => clock.tick(),
    turns: [
      [
        step.event({ type: "system", subtype: "init", agent_id: agentId, run_id: runId }),
        step.event({
          type: "assistant",
          agent_id: agentId,
          run_id: runId,
          message: { role: "assistant", content: [{ type: "text", text: ANSWER }] },
        }),
        step.turnEnded({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }),
        step.finished({
          result: ANSWER,
          model: { id: FIXTURE.model, params: [{ id: "fast", value: "false" }, { id: "thinking", value: "false" }] },
        }),
      ],
    ],
  });
}

function systemRows(status: { messages: { type: MessageType; content: string }[] }): string[] {
  return status.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
}

function subAgent(name: string, lists: { tools?: string[]; disallowedTools?: string[] } = {}): SubAgent {
  return create(SubAgentSchema, {
    name,
    description: `${name} sub-agent`,
    instructions: "Do the delegated thing thoroughly.",
    tools: lists.tools ?? [],
    disallowedTools: lists.disallowedTools ?? [],
  });
}

describe("ExecuteCursor hermetic — tool lists", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  beforeEach(() => clock.reset());

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  async function run(record: CursorRecordOptions, agent: ScriptedCursorAgent) {
    const scenario = beginCursorScenario({
      env,
      clock,
      record: cursorExecutionRecord(record),
      sdk: { agents: [agent], catalog: SDK_CATALOG },
    });
    const invocation = await runCursorTurn(scenario);
    expect(invocation.outcome.kind).toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    return { scenario, phase: slim.phase, final: scenario.record.lastFullStatus! };
  }

  it("hands the SDK the allow-list in its own names: read kept, the excluded built-ins absent", async () => {
    const { scenario, phase } = await run(
      { message: USER_MESSAGE, tools: ["Read", "Grep"] },
      answeringAgent("agent-lists-allow", "run-lists-allow", clock),
    );
    expect(phase).toBe("RUN_COMPLETED");
    expect(scenario.sdk.resolutions.map((r) => r.kind)).toEqual(["create"]);
    const options = scenario.sdk.resolutions[0].options!;
    expect(options.tools).toEqual(expect.arrayContaining(["read", "grep", "semSearch"]));
    for (const excluded of ["shell", "edit", "delete", "task", "readLints"]) expect(options.tools).not.toContain(excluded);
    expect(options.disallowedTools).toBeUndefined();
  });

  it("hands the SDK a deny-list as disallowedTools and leaves tools unset", async () => {
    const { scenario, phase } = await run(
      { message: USER_MESSAGE, disallowedTools: ["Bash"] },
      answeringAgent("agent-lists-deny", "run-lists-deny", clock),
    );
    expect(phase).toBe("RUN_COMPLETED");
    const options = scenario.sdk.resolutions[0].options!;
    expect(options.disallowedTools).toEqual(["shell"]);
    expect(options.tools).toBeUndefined();
  });

  it("passes no restriction for an agent with no lists", async () => {
    const { scenario } = await run({ message: USER_MESSAGE }, answeringAgent("agent-lists-none", "run-lists-none", clock));
    const options = scenario.sdk.resolutions[0].options!;
    expect(options).not.toHaveProperty("tools");
    expect(options).not.toHaveProperty("disallowedTools");
  });

  it("refuses an Agent(type, …) type list, naming the entry, before any agent exists", async () => {
    const neverUsed = new ScriptedCursorAgent({ agentId: "agent-lists-never-types", turns: [] });
    const { scenario, phase, final } = await run(
      { message: USER_MESSAGE, tools: ["Read", "Agent(explore)"], subAgents: [subAgent("researcher")] },
      neverUsed,
    );
    expect(phase).toBe("RUN_FAILED");
    expect(final.error).toMatch(/^.+ lists Agent\(explore\), which the Cursor engine cannot enforce: it cannot limit which sub-agents an agent starts\./);
    expect(systemRows(final)).toEqual([`Execution failed: ${final.error}`]);
    expect(scenario.sdk.resolutions, "the SDK was never reached").toHaveLength(0);
  });

  it("runs an agent that lists bare Agent, registering its sub-agents and keeping task", async () => {
    const { scenario, phase } = await run(
      { message: USER_MESSAGE, tools: ["Read", "Agent"], subAgents: [subAgent("researcher"), subAgent("writer")] },
      answeringAgent("agent-lists-types", "run-lists-types", clock),
    );
    expect(phase).toBe("RUN_COMPLETED");
    const options = scenario.sdk.resolutions[0].options!;
    expect(Object.keys(options.agents ?? {}).sort()).toEqual(["researcher", "writer"]);
    expect(options.tools).toContain("task");
  });

  it("refuses the turn when a sub-agent carries its own lists, naming it, before any agent exists", async () => {
    const neverUsed = new ScriptedCursorAgent({ agentId: "agent-lists-never-1", turns: [] });
    const { scenario, phase, final } = await run(
      { message: USER_MESSAGE, subAgents: [subAgent("helper", { tools: ["Read"] }), subAgent("plain")] },
      neverUsed,
    );
    expect(phase).toBe("RUN_FAILED");
    expect(final.error.startsWith('Sub-agent "helper" carries its own tool lists'), "the refusal's own sentence, unprefixed").toBe(true);
    expect(final.error).toContain("native engine");
    expect(final.error).not.toContain('"plain"');
    expect(systemRows(final)).toEqual([`Execution failed: ${final.error}`]);
    expect(scenario.sdk.resolutions, "the SDK was never reached").toHaveLength(0);
  });

  it("a sub-agent's engine extra refused under an allow-list is one failed call with the refusal text, and the turn completes", async () => {
    const agentId = "agent-lists-extra";
    const runId = "run-lists-extra";
    const evs = sdkEvents(agentId, runId);
    const HOOK_BLOCK = "Tool call blocked by a hook.";
    const genArgs = { prompt: "a cat" };
    const taskArgs = { subagentType: "helper", description: "Draw a cat", prompt: "Draw a cat." };
    const taskResult = {
      conversationSteps: [
        { toolCall: { toolCallId: "sub-gen-1", generateImageToolCall: { args: genArgs, result: { error: HOOK_BLOCK } } } },
        { type: "assistantMessage", message: { text: "I could not draw it." } },
      ],
    };
    const hookDecisions: string[] = [];
    const runHook = () =>
      step.effect("hook: the sub-agent's GenerateImage", () => {
        hookDecisions.push(runWorkspaceHook(sessionWorkspaceDir(env), hookBuiltin("GenerateImage", genArgs)).permission);
      });
    const agent = new ScriptedCursorAgent({
      agentId,
      runIds: [runId],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(evs.init()),
          step.event(evs.toolCall("task-1", "task", "running", taskArgs)),
          runHook(),
          step.event(evs.toolCall("task-1", "task", "completed", taskArgs, taskResult)),
          // The same refusal surfacing on the root stream, under the stream's
          // own name: the shape that would read as a foreign block if the
          // hook's and the stream's names had to agree.
          runHook(),
          step.event(evs.toolCall("gen-1", "generateImage", "error", genArgs, HOOK_BLOCK)),
          step.event(evs.assistant(ANSWER)),
          step.turnEnded({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: ANSWER, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const lists = { tools: ["Read", "Agent"], disallowedTools: [] };
    const { phase, final } = await run({ message: USER_MESSAGE, ...lists, subAgents: [subAgent("helper")] }, agent);

    expect(hookDecisions, "the real hook refused both").toEqual(["deny", "deny"]);
    expect(phase, "a refused call never fails the turn").toBe("RUN_COMPLETED");
    const expected = outOfScopeMessage("GenerateImage", ToolScope.of("The agent", lists));
    const rootRow = final.messages.flatMap((m) => m.toolCalls).find((tc) => tc.id === "gen-1")!;
    const subRows = final.subAgentRuns.flatMap((sa) => sa.messages.flatMap((m) => m.toolCalls));
    expect(subRows.map((tc) => tc.id)).toEqual(["sub-gen-1"]);
    for (const row of [rootRow, subRows[0]]) {
      expect(row.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
      expect(row.error).toBe(expected);
      expect(row.requiresApproval).toBe(false);
      expect(row.approvalPolicySource).toBe(ApprovalPolicySource.UNSPECIFIED);
    }
  });

  it("refuses the turn when a tools list names nothing the turn has", async () => {
    const neverUsed = new ScriptedCursorAgent({ agentId: "agent-lists-never-2", turns: [] });
    const { scenario, phase, final } = await run({ message: USER_MESSAGE, tools: ["mcp__nosuch"] }, neverUsed);
    expect(phase).toBe("RUN_FAILED");
    const message = new ToolListResolutionError("The agent", ["mcp__nosuch"]).message;
    expect(final.error).toBe(message);
    expect(systemRows(final)).toEqual([`Execution failed: ${message}`]);
    expect(scenario.sdk.resolutions).toHaveLength(0);
  });
});
