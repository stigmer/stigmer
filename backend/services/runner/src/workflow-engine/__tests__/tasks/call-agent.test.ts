import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallAgentTaskBuilder } from "../../tasks/call-agent.js";
import { createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import type { CallAgentTaskDef, TaskExecutionContext, AgentCallResult, EmitEventsFn, WorkflowEventDescriptor } from "../../types.js";

let mockCallAgent: ReturnType<typeof vi.fn>;
let mockEmitEvents: ReturnType<typeof vi.fn>;

function makeCtx(opts?: { emitEvents?: EmitEventsFn }): TaskExecutionContext {
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
    emitEvents: opts?.emitEvents,
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

  it("interpolates embedded expressions in multi-line message", async () => {
    mockCallAgent.mockResolvedValue({ final_text: "done" });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "analyst",
        message:
          "Generate report for ${ $env.GAME_NAME }.\n" +
          "Date: ${ $env.REPORT_DATE }\n" +
          "DAU: ${ $context.metrics.dau }\n" +
          "Analyze the data.",
      },
    };

    const builder = new CallAgentTaskBuilder("runAnalyst", taskDef);
    const executor = builder.build();
    const state = createState();
    state.env = { GAME_NAME: "Garden Design", REPORT_DATE: "2026-05-23" };
    state.context = { metrics: { dau: 25000 } };

    await executor({}, state, makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.message).toBe(
      "Generate report for Garden Design.\n" +
      "Date: 2026-05-23\n" +
      "DAU: 25000\n" +
      "Analyze the data.",
    );
    expect(config.message).not.toContain("${ ");
  });

  it("handles missing optional env var in embedded expression (null → empty)", async () => {
    mockCallAgent.mockResolvedValue({ final_text: "done" });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "analyst",
        message: "Date: ${ $env.OPTIONAL_DATE }\nProceed.",
      },
    };

    const builder = new CallAgentTaskBuilder("runAnalyst", taskDef);
    const executor = builder.build();
    const state = createState();
    state.env = {};

    await executor({}, state, makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.message).toBe("Date: \nProceed.");
  });
});

describe("CallAgentTaskBuilder — agent call event emission", () => {
  beforeEach(() => {
    mockCallAgent = vi.fn();
    mockEmitEvents = vi.fn().mockResolvedValue(undefined);
  });

  function agentTaskDef(overrides?: Partial<CallAgentTaskDef["with"]>): CallAgentTaskDef {
    return {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "code-reviewer",
        message: "Review this code",
        ...overrides,
      },
    };
  }

  function emittedEvents(): WorkflowEventDescriptor[] {
    return (mockEmitEvents.mock.calls as WorkflowEventDescriptor[][][]).flatMap(
      (call) => call[0],
    );
  }

  it("emits agent_call_started before and agent_call_completed after a successful call", async () => {
    const result: AgentCallResult = {
      final_text: "Looks good",
      agent_execution_id: "aex-abc",
      usage_summary: { total_tokens: 500, estimated_cost_usd: 0.05 },
    };
    mockCallAgent.mockResolvedValue(result);

    const builder = new CallAgentTaskBuilder("reviewCode", agentTaskDef());
    const executor = builder.build();
    const ctx = makeCtx({ emitEvents: mockEmitEvents });

    await executor({}, createState(), ctx);

    const events = emittedEvents();
    expect(events).toHaveLength(2);

    const started = events[0];
    expect(started.type).toBe("agent_call_started");
    if (started.type !== "agent_call_started") throw new Error("wrong type");
    expect(started.taskName).toBe("reviewCode");
    expect(started.agentSlug).toBe("code-reviewer");
    expect(started.messageSummary).toBe("Review this code");
    expect(started.childExecutionId).toBe("");

    const completed = events[1];
    expect(completed.type).toBe("agent_call_completed");
    if (completed.type !== "agent_call_completed") throw new Error("wrong type");
    expect(completed.taskName).toBe("reviewCode");
    expect(completed.childExecutionId).toBe("aex-abc");
    expect(completed.tokensConsumed).toBe(500);
    expect(completed.costMicros).toBe(50_000);
    expect(completed.error).toBe("");
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits agent_call_completed with error when call fails", async () => {
    mockCallAgent.mockRejectedValue(new Error("Agent unreachable"));

    const builder = new CallAgentTaskBuilder("failedCall", agentTaskDef());
    const executor = builder.build();
    const ctx = makeCtx({ emitEvents: mockEmitEvents });

    await expect(executor({}, createState(), ctx)).rejects.toThrow("Agent unreachable");

    const events = emittedEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("agent_call_started");

    const completed = events[1];
    expect(completed.type).toBe("agent_call_completed");
    if (completed.type !== "agent_call_completed") throw new Error("wrong type");
    expect(completed.error).toBe("Agent unreachable");
    expect(completed.childExecutionId).toBe("");
    expect(completed.tokensConsumed).toBe(0);
    expect(completed.costMicros).toBe(0);
  });

  it("does not emit events when emitEvents is not provided", async () => {
    mockCallAgent.mockResolvedValue({ final_text: "ok" });

    const builder = new CallAgentTaskBuilder("noEvents", agentTaskDef());
    const executor = builder.build();
    const ctx = makeCtx();

    await executor({}, createState(), ctx);

    expect(mockEmitEvents).not.toHaveBeenCalled();
  });

  it("truncates long messages in messageSummary", async () => {
    mockCallAgent.mockResolvedValue({ final_text: "ok" });
    const longMessage = "A".repeat(500);

    const builder = new CallAgentTaskBuilder("longMsg", agentTaskDef({ message: longMessage }));
    const executor = builder.build();
    const ctx = makeCtx({ emitEvents: mockEmitEvents });

    await executor({}, createState(), ctx);

    const events = emittedEvents();
    const started = events[0];
    if (started.type !== "agent_call_started") throw new Error("wrong type");
    expect(started.messageSummary.length).toBe(200);
  });

  it("emits events for each attempt in output-validation retry loop", async () => {
    const invalidResult: AgentCallResult = {
      final_text: "not json",
      agent_execution_id: "aex-1",
    };
    const validResult: AgentCallResult = {
      structured: { name: "test" },
      agent_execution_id: "aex-2",
      usage_summary: { total_tokens: 100, estimated_cost_usd: 0.01 },
    };
    mockCallAgent
      .mockResolvedValueOnce(invalidResult)
      .mockResolvedValueOnce(validResult);

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "structured-agent",
        message: "Give me JSON",
        output: {
          schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
          on_invalid: "ON_INVALID_RETRY" as const,
          max_retries: 2,
        },
      },
    };

    const builder = new CallAgentTaskBuilder("retryAgent", taskDef);
    const executor = builder.build();
    const ctx = makeCtx({ emitEvents: mockEmitEvents });

    await executor({}, createState(), ctx);

    const events = emittedEvents();
    const startedEvents = events.filter(e => e.type === "agent_call_started");
    const completedEvents = events.filter(e => e.type === "agent_call_completed");
    expect(startedEvents).toHaveLength(2);
    expect(completedEvents).toHaveLength(2);
  });

  it("handles agent result with no usage_summary gracefully", async () => {
    mockCallAgent.mockResolvedValue({ final_text: "ok" });

    const builder = new CallAgentTaskBuilder("noUsage", agentTaskDef());
    const executor = builder.build();
    const ctx = makeCtx({ emitEvents: mockEmitEvents });

    await executor({}, createState(), ctx);

    const events = emittedEvents();
    const completed = events[1];
    if (completed.type !== "agent_call_completed") throw new Error("wrong type");
    expect(completed.tokensConsumed).toBe(0);
    expect(completed.costMicros).toBe(0);
  });
});
