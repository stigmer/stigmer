import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallAgentTaskBuilder } from "../../tasks/call-agent.js";
import { createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import type { CallAgentTaskDef, TaskExecutionContext, AgentCallResult } from "../../types.js";

let mockCallAgent: ReturnType<typeof vi.fn>;

function makeCtx(): TaskExecutionContext {
  return {
    evaluateExpressions: evaluateExpressionBatch,
    doc: { document: { dsl: "1.0.0", name: "test-workflow" }, do: [] },
    sleep: () => { throw new Error("not used"); },
    listen: () => { throw new Error("not used"); },
    runCommand: () => { throw new Error("not used"); },
    runWorkflow: () => { throw new Error("not used"); },
    awaitHumanInput: () => { throw new Error("not used"); },
    callHttp: () => { throw new Error("not used"); },
    callGrpc: () => { throw new Error("not used"); },
    callFunction: () => { throw new Error("not used"); },
    callAgent: (...args: Parameters<TaskExecutionContext["callAgent"]>) => mockCallAgent(...args),
  };
}

describe("CallAgentTaskBuilder", () => {
  beforeEach(() => {
    mockCallAgent = vi.fn();
  });

  it("calls ctx.callAgent with static config", async () => {
    const result: AgentCallResult = {
      final_text: "Code looks good",
      agent_execution_id: "aex-123",
    };
    mockCallAgent.mockResolvedValue(result);

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "code-reviewer",
        message: "Review this code",
      },
    };

    const builder = new CallAgentTaskBuilder("reviewCode", taskDef);
    const executor = builder.build();
    const state = createState();
    state.data["__stigmer_execution_id"] = "wex-456";

    const output = await executor({}, state, makeCtx());

    expect(mockCallAgent).toHaveBeenCalledOnce();
    const [config, _env, metadata] = mockCallAgent.mock.calls[0];
    expect(config.agent).toBe("code-reviewer");
    expect(config.message).toBe("Review this code");
    expect(metadata.taskName).toBe("reviewCode");
    expect(metadata.workflowExecutionId).toBe("wex-456");
    expect(output).toEqual(result);
  });

  it("evaluates jq expressions in message", async () => {
    mockCallAgent.mockResolvedValue({ final_text: "done" });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "summarizer",
        message: "${ $context.fetchCode.body }",
      },
    };

    const builder = new CallAgentTaskBuilder("summarize", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { fetchCode: { body: "function hello() {}" } };

    await executor({}, state, makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.message).toBe("function hello() {}");
  });

  it("preserves runtime placeholders for activity-side resolution", async () => {
    mockCallAgent.mockResolvedValue({ final_text: "done" });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "reviewer",
        message: "Review code",
        env: { GITHUB_TOKEN: "${.secrets.GH_TOKEN}" },
      },
    };

    const builder = new CallAgentTaskBuilder("review", taskDef);
    const executor = builder.build();
    const state = createState();

    await executor({}, state, makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.env.GITHUB_TOKEN).toBe("${.secrets.GH_TOKEN}");
  });

  it("passes org from config when specified", async () => {
    mockCallAgent.mockResolvedValue({ final_text: "done" });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "my-agent",
        message: "Hello",
        org: "acme",
      },
    };

    const builder = new CallAgentTaskBuilder("invoke", taskDef);
    const executor = builder.build();

    await executor({}, createState(), makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.org).toBe("acme");
  });

  it("shouldRun returns true", async () => {
    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: { agent: "a", message: "m" },
    };
    const builder = new CallAgentTaskBuilder("t", taskDef);
    expect(await builder.shouldRun()).toBe(true);
  });
});
