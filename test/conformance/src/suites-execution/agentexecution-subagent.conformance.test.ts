// Conformance suite for sub-agent delegation on an AgentExecution: the parent's
// `task` tool call, the child's own transcript under status.sub_agent_executions,
// and the field contract of a completed SubAgentExecution.
// Domain: agentic / agentexecution — the delegation surface a console renders
// as a nested run.
//
// Delegation is the built-in `task` tool: the parent emits a tool_use naming a
// sub-agent (`subagent_type`) and a description, the runner runs the child as a
// nested graph on the same LLM loop, the child's final text becomes the task
// tool's result, and the parent takes one more turn to answer. The mock is one
// FIFO for both — the arrival order IS parent, child, parent — which is the
// same model the Go offline suite scripted (subagent_offline_test.go; DD-001).
//
// Asserted: the parent's ToolCall `task` completes with the child's output as
// its result; sub_agent_executions carries exactly the named child, COMPLETED,
// with id / name / subject / started_at / completed_at / output all populated
// (the shape the SDK's sub-agent panel reads); the run consumed exactly its
// three turns.
import { ExecutionPhase, SubAgentStatus, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// The built-in delegation tool the deep-agent harness binds when an agent
// declares sub-agents.
const TASK_TOOL_NAME = "task";
const RESEARCHER = "researcher";
const CHILD_ANSWER =
  "Renewable energy encompasses solar, wind and hydroelectric sources that replenish naturally.";

describe("AgentExecution sub-agent delegation", () => {
  it("a task tool_use delegates to the named sub-agent: the parent's ToolCall completes and sub_agent_executions carries the child's full record", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-parent"),
        instructions:
          "You are a project manager. When asked to research a topic, you MUST delegate to the researcher sub-agent using the task tool. Do not answer directly.",
        subAgents: [
          {
            name: RESEARCHER,
            description: "Researches a topic and summarizes it",
            instructions: "You are a researcher. When given a topic, provide a brief 2-3 sentence summary. Be concise and factual.",
          },
        ],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    // Turn 1 (parent): delegate. Turn 2 (child): answer. Turn 3 (parent): synthesize.
    mock.enqueue(
      anthropicToolUse("toolu_task_01", TASK_TOOL_NAME, {
        description: "Summarize renewable energy",
        prompt: "Provide a brief summary of renewable energy sources.",
        subagent_type: RESEARCHER,
      }),
    );
    mock.enqueue(anthropicText(CHILD_ANSWER));
    mock.enqueue(anthropicText(`Based on the researcher's findings: ${CHILD_ANSWER}`));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-subagent"),
        agentId: agent.metadata!.id,
        message: "Please delegate to the researcher to summarize renewable energy.",
        autoApproveAll: true,
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `delegation should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]} ` +
        `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // The parent's transcript: a completed `task` call whose result is the child's answer.
    const parentToolCalls = (final.status?.messages ?? []).flatMap((m) => m.toolCalls);
    const task = parentToolCalls.find((tc) => tc.name === TASK_TOOL_NAME);
    expect(task, "the parent recorded a task tool call").toBeDefined();
    expect(task!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(task!.result, "the task result is the sub-agent's output").toContain("solar");

    // The child's own record.
    const subAgents = final.status?.subAgentExecutions ?? [];
    expect(subAgents.map((s) => s.name), "exactly the named sub-agent ran").toEqual([RESEARCHER]);
    const child = subAgents[0]!;
    expect(child.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    expect(child.id, "a sub-agent execution has its own id").not.toBe("");
    expect(child.subject, "the delegation's description is the child's subject").not.toBe("");
    expect(child.startedAt).not.toBe("");
    expect(child.completedAt).not.toBe("");
    expect(child.output, "the child's final text is its output").toContain("solar");

    expect(mock.remaining(), "every scripted turn was consumed").toBe(0);
    expect(mock.consumed(), "parent, child, parent — three turns").toBe(3);
  });
});
