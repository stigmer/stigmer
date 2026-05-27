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

describe("CallAgentTaskBuilder — enrichResultWithCost", () => {
  beforeEach(() => {
    mockCallAgent = vi.fn();
  });

  it("adds __stigmer_cost_micros and token fields when usage_summary is present", async () => {
    const result: AgentCallResult = {
      final_text: "done",
      agent_execution_id: "aex-cost-1",
      usage_summary: { total_tokens: 1200, estimated_cost_usd: 0.03 },
    };
    mockCallAgent.mockResolvedValue(result);

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: { agent: "cost-agent", message: "compute" },
    };

    const builder = new CallAgentTaskBuilder("costTask", taskDef);
    const executor = builder.build();
    const output = await executor({}, createState(), makeCtx()) as Record<string, unknown>;

    expect(output.__stigmer_cost_micros).toBe(30_000);
    expect(output.input_tokens).toBe(1200);
    expect(output.output_tokens).toBe(0);
  });

  it("does not add cost fields when usage_summary is absent", async () => {
    const result: AgentCallResult = {
      final_text: "no usage",
      agent_execution_id: "aex-no-cost",
    };
    mockCallAgent.mockResolvedValue(result);

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: { agent: "simple-agent", message: "hello" },
    };

    const builder = new CallAgentTaskBuilder("noCostTask", taskDef);
    const executor = builder.build();
    const output = await executor({}, createState(), makeCtx()) as Record<string, unknown>;

    expect(output.__stigmer_cost_micros).toBeUndefined();
    expect(output.input_tokens).toBeUndefined();
    expect(output.output_tokens).toBeUndefined();
  });

  it("rounds cost micros to nearest integer", async () => {
    const result: AgentCallResult = {
      final_text: "done",
      agent_execution_id: "aex-round",
      usage_summary: { total_tokens: 50, estimated_cost_usd: 0.000123 },
    };
    mockCallAgent.mockResolvedValue(result);

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: { agent: "round-agent", message: "go" },
    };

    const builder = new CallAgentTaskBuilder("roundTask", taskDef);
    const executor = builder.build();
    const output = await executor({}, createState(), makeCtx()) as Record<string, unknown>;

    expect(output.__stigmer_cost_micros).toBe(Math.round(0.000123 * 1_000_000));
  });
});

// ---------------------------------------------------------------------------
// Output Schema Propagation — verifies that output.schema survives the
// expression resolution pipeline and reaches ctx.callAgent intact.
// This is the exact failure mode from the daily-notification-plan production
// bug where structuredOutputSchema was intermittently missing.
// ---------------------------------------------------------------------------

describe("CallAgentTaskBuilder — output.schema propagation", () => {
  beforeEach(() => {
    mockCallAgent = vi.fn();
  });

  const cohortSchema = {
    type: "object",
    required: ["executive_summary", "cohorts", "anomalies"],
    properties: {
      executive_summary: { type: "string" },
      dau: { type: "number" },
      dau_trend_pct: { type: "number" },
      cohorts: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "size", "action_needed"],
          properties: {
            name: { type: "string" },
            size: { type: "number" },
            retention_trend: { type: "string" },
            action_needed: { type: "boolean" },
          },
        },
      },
      anomalies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            metric: { type: "string" },
            description: { type: "string" },
            severity: { type: "string", enum: ["warning", "critical"] },
          },
        },
      },
      data_quality_notes: { type: "string" },
    },
  };

  it("passes output.schema to ctx.callAgent when present", async () => {
    mockCallAgent.mockResolvedValue({ structured: { executive_summary: "ok", cohorts: [], anomalies: [] } });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "notification-analyst",
        message: "Generate the daily cohort analysis report.",
        output: { schema: cohortSchema, on_invalid: "ON_INVALID_FAIL" },
        config: { model: "claude-sonnet-4", timeout: 300 },
        harness: "HARNESS_CURSOR",
      },
    };

    const builder = new CallAgentTaskBuilder("analyze_player_data", taskDef);
    const executor = builder.build();
    await executor({}, createState(), makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.output).toBeDefined();
    expect(config.output.schema).toBeDefined();
    expect(config.output.schema.required).toEqual(["executive_summary", "cohorts", "anomalies"]);
    expect(config.output.schema.properties.cohorts.type).toBe("array");
    expect(config.output.on_invalid).toBe("ON_INVALID_FAIL");
  });

  it("preserves output.schema after embedded expression resolution in message", async () => {
    mockCallAgent.mockResolvedValue({ structured: { executive_summary: "ok", cohorts: [], anomalies: [] } });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "notification-analyst",
        message:
          "Generate the daily cohort analysis report for Garden Design Makeover.\n" +
          "Date: ${ $env.NOTIFICATION_DATE }\n" +
          "Data source: decor schema.",
        output: { schema: cohortSchema, on_invalid: "ON_INVALID_FAIL" },
        config: { model: "claude-sonnet-4" },
      },
    };

    const builder = new CallAgentTaskBuilder("analyze_player_data", taskDef);
    const executor = builder.build();
    const state = createState();
    state.env = { NOTIFICATION_DATE: "2026-05-26" };

    await executor({}, state, makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.message).toContain("Date: 2026-05-26");
    expect(config.message).not.toContain("${ $env");
    expect(config.output).toBeDefined();
    expect(config.output.schema).toBeDefined();
    expect(config.output.schema.required).toEqual(["executive_summary", "cohorts", "anomalies"]);
  });

  it("preserves output.schema when message has strict expression references", async () => {
    mockCallAgent.mockResolvedValue({ structured: { executive_summary: "ok", cohorts: [], anomalies: [] } });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "analyst",
        message: "${ $context.previous_task.report }",
        output: { schema: cohortSchema, on_invalid: "ON_INVALID_FAIL" },
      },
    };

    const builder = new CallAgentTaskBuilder("analyze", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { previous_task: { report: "Analyze this data set carefully." } };

    await executor({}, state, makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.message).toBe("Analyze this data set carefully.");
    expect(config.output).toBeDefined();
    expect(config.output.schema.required).toEqual(["executive_summary", "cohorts", "anomalies"]);
  });

  it("preserves output.schema when env var in message resolves to empty", async () => {
    mockCallAgent.mockResolvedValue({ structured: { executive_summary: "ok", cohorts: [], anomalies: [] } });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "analyst",
        message: "Date: ${ $env.OPTIONAL_DATE }\nProceed with analysis.",
        output: { schema: cohortSchema, on_invalid: "ON_INVALID_FAIL" },
      },
    };

    const builder = new CallAgentTaskBuilder("analyze", taskDef);
    const executor = builder.build();
    const state = createState();
    state.env = {};

    await executor({}, state, makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.message).toBe("Date: \nProceed with analysis.");
    expect(config.output).toBeDefined();
    expect(config.output.schema.required).toEqual(["executive_summary", "cohorts", "anomalies"]);
  });

  it("preserves output.schema alongside config, harness, and env fields", async () => {
    mockCallAgent.mockResolvedValue({ structured: { executive_summary: "ok", cohorts: [], anomalies: [] } });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "notification-analyst",
        message: "Analyze data.",
        env: { POSTGRES_CONNECTION_URL: "${.secrets.PG_URL}" },
        config: { model: "claude-sonnet-4", timeout: 300 },
        output: { schema: cohortSchema, on_invalid: "ON_INVALID_FAIL" },
        harness: "HARNESS_CURSOR",
      },
    };

    const builder = new CallAgentTaskBuilder("analyze_player_data", taskDef);
    const executor = builder.build();
    await executor({}, createState(), makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.agent).toBe("notification-analyst");
    expect(config.config?.model).toBe("claude-sonnet-4");
    expect(config.env?.POSTGRES_CONNECTION_URL).toBe("${.secrets.PG_URL}");
    expect(config.harness).toBe("HARNESS_CURSOR");
    expect(config.output).toBeDefined();
    expect(config.output.schema.properties.anomalies.items.properties.severity.enum)
      .toEqual(["warning", "critical"]);
  });

  it("passes undefined output when no output.schema is configured", async () => {
    mockCallAgent.mockResolvedValue({ final_text: "done" });

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "simple-agent",
        message: "Do something",
      },
    };

    const builder = new CallAgentTaskBuilder("simpleTask", taskDef);
    const executor = builder.build();
    await executor({}, createState(), makeCtx());

    const [config] = mockCallAgent.mock.calls[0];
    expect(config.output).toBeUndefined();
  });
});

describe("CallAgentTaskBuilder — ON_INVALID_FAIL", () => {
  beforeEach(() => {
    mockCallAgent = vi.fn();
  });

  it("throws when output validation fails with ON_INVALID_FAIL", async () => {
    const invalidResult: AgentCallResult = {
      final_text: "not structured",
      agent_execution_id: "aex-fail-1",
    };
    mockCallAgent.mockResolvedValue(invalidResult);

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "strict-agent",
        message: "Give me JSON",
        output: {
          schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
          on_invalid: "ON_INVALID_FAIL" as const,
        },
      },
    };

    const builder = new CallAgentTaskBuilder("failTask", taskDef);
    const executor = builder.build();

    await expect(executor({}, createState(), makeCtx())).rejects.toThrow(
      /Agent output validation failed for task 'failTask'/,
    );
  });
});

describe("CallAgentTaskBuilder — ON_INVALID_FALLBACK", () => {
  beforeEach(() => {
    mockCallAgent = vi.fn();
  });

  it("returns flow directive when validation fails with ON_INVALID_FALLBACK", async () => {
    const invalidResult: AgentCallResult = {
      final_text: "not json",
      agent_execution_id: "aex-fb-1",
    };
    mockCallAgent.mockResolvedValue(invalidResult);

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "fallback-agent",
        message: "Produce JSON",
        output: {
          schema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
          on_invalid: "ON_INVALID_FALLBACK" as const,
          fallback_task: "handleBadOutput",
        },
      },
    };

    const builder = new CallAgentTaskBuilder("fallbackTask", taskDef);
    const executor = builder.build();
    const output = await executor({}, createState(), makeCtx()) as Record<string, unknown>;

    expect(output.__flow_directive__).toBe("handleBadOutput");
    expect(output.validation_errors).toBeDefined();
    expect(Array.isArray(output.validation_errors)).toBe(true);
    expect(output.original_output).toBeDefined();
  });

  it("defaults fallback_task to 'continue' when not specified", async () => {
    const invalidResult: AgentCallResult = {
      final_text: "bad output",
      agent_execution_id: "aex-fb-2",
    };
    mockCallAgent.mockResolvedValue(invalidResult);

    const taskDef: CallAgentTaskDef = {
      kind: "call:agent",
      call: "agent",
      with: {
        agent: "fallback-agent",
        message: "Produce JSON",
        output: {
          schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
          on_invalid: "ON_INVALID_FALLBACK" as const,
        },
      },
    };

    const builder = new CallAgentTaskBuilder("fallbackDefault", taskDef);
    const executor = builder.build();
    const output = await executor({}, createState(), makeCtx()) as Record<string, unknown>;

    expect(output.__flow_directive__).toBe("continue");
  });
});
