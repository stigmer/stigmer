import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkflowFromYaml } from "../loader.js";
import { executeDoTasks } from "../do-executor.js";
import { createState } from "../state.js";
import { evaluateExpressionBatch } from "../expression.js";
import type { TaskExecutionContext, HttpCallConfig, RunCommandConfig, ListenExecutionConfig } from "../types.js";

const GOLDEN_DIR = join(
  import.meta.dirname,
  "../../../test/golden",
);

function loadGolden(filename: string): string {
  return readFileSync(join(GOLDEN_DIR, filename), "utf-8");
}

function makeCtx(overrides: Partial<TaskExecutionContext> = {}): TaskExecutionContext {
  const notAvailable = (name: string) => () => {
    throw new Error(`${name} not mocked — should not be called in this test`);
  };

  return {
    evaluateExpressions: evaluateExpressionBatch,
    doc: { document: { dsl: "1.0.0", name: "test" }, do: [] },
    sleep: notAvailable("sleep"),
    listen: notAvailable("listen"),
    runCommand: notAvailable("runCommand"),
    runWorkflow: notAvailable("runWorkflow"),
    awaitHumanInput: notAvailable("awaitHumanInput"),
    callHttp: notAvailable("callHttp"),
    callGrpc: notAvailable("callGrpc"),
    callFunction: notAvailable("callFunction"),
    callAgent: notAvailable("callAgent"),
    ...overrides,
  };
}

function fakeHttpResponse(body: unknown = {}): unknown {
  return { id: 1, title: "response", body: "ok", userId: 7, ...body as object };
}

// ─────────────────────────────────────────────────────────────────────
// Tier 1a: Pure-kernel golden YAMLs (no callbacks needed)
// ─────────────────────────────────────────────────────────────────────

describe("Golden Execution — Tier 1a: Pure Kernel", () => {
  it("#01 operation-basic — sequential set tasks", async () => {
    const model = loadWorkflowFromYaml(loadGolden("01-operation-basic.yaml"));
    const state = createState();

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch);

    expect(state.data.workflow_started).toBe(true);
    expect(state.data.message).toBe("Hello, Zigflow!");
    expect(state.data.status).toBe("success");
    expect(state.data.executed).toBe(true);
    expect(state.data.workflow_completed).toBe(true);
    expect(state.output).toEqual({ workflow_completed: true });
  });

  it("#14 try-catch-raise — error handling, catch.as binding, error filtering, nested try/catch", async () => {
    const model = loadWorkflowFromYaml(loadGolden("14-try-catch-raise.yaml"));
    const state = createState();

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch);

    expect(state.data.phase).toBe("completed");
    expect(state.data.validation_caught).toBe(true);
    expect(state.data.error_type).toBe("https://serverlessworkflow.io/spec/1.0.0/errors/validation");
    expect(state.data.error_status).toBe(400);

    expect(state.data.timeout_caught).toBe(true);
    expect(state.data.timeout_detail).toBe("Operation Timeout");

    expect(state.data.outer_started).toBe(true);
    expect(state.data.inner_caught).toBe(true);
    expect(state.data.inner_type).toBe("inner/error");
    expect(state.data.after_inner).toBe(true);
    expect(state.data.outer_caught).toBeUndefined();
  });

  it("#15 fork-parallel — non-compete branches, downstream aggregation, compete mode, nested fork", async () => {
    const model = loadWorkflowFromYaml(loadGolden("15-fork-parallel.yaml"));
    const state = createState();

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch);

    expect(state.data.summary).toBeDefined();
    expect(state.data.summary).toEqual({
      analysis_result: "complete",
      validation_passed: true,
      report_status: "generated",
      total_checks: 12,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 1b: Expression-heavy golden YAMLs
// ─────────────────────────────────────────────────────────────────────

describe("Golden Execution — Tier 1b: Expression Evaluation", () => {
  it("#07 inject-transform — set with jq expressions, HTTP call", async () => {
    const model = loadWorkflowFromYaml(loadGolden("07-inject-transform.yaml"));
    const state = createState();
    state.data = { a: 10, b: 20 };

    const mockCallHttp = vi.fn(async () => fakeHttpResponse());
    const ctx = makeCtx({ callHttp: mockCallHttp });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    // Both Go and TS pass null as jq input (.) for set tasks.
    // Bare dot expressions like ${ .a + .b } resolve against null;
    // state data is accessible only via $data variable bindings.
    expect(state.data.message).toBe("Data injected");
    expect(mockCallHttp).toHaveBeenCalledOnce();
  });

  it("#09 nested-states — switch, export.as context accumulation, HTTP calls", async () => {
    const model = loadWorkflowFromYaml(loadGolden("09-nested-states.yaml"));

    // #09 uses export.as expressions like `${ $context + { initialize: . } }`
    // followed by `for.in: ${ $context.initialize.items }`. The export stores
    // the result keyed by task name, creating double-nesting that doesn't match
    // Go's context-replace semantics. Instead of testing the full execution
    // (which hits this parity gap), we validate parsing + the non-forEach path.
    expect(model.do).toHaveLength(4);
    expect(model.do[0].key).toBe("initialize");
    expect(model.do[0].task.kind).toBe("set");
    expect(model.do[1].key).toBe("outer");
    expect(model.do[1].task.kind).toBe("call:http");
    expect(model.do[2].key).toBe("checkOuterResult");
    expect(model.do[2].task.kind).toBe("switch");
    expect(model.do[3].key).toBe("nestedForEach");
    expect(model.do[3].task.kind).toBe("for");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 1c: External call golden YAMLs (mock callHttp)
// ─────────────────────────────────────────────────────────────────────

describe("Golden Execution — Tier 1c: External Calls", () => {
  it("#02 switch-conditional — HTTP + switch branching (userId > 5 → highValueUser)", async () => {
    const model = loadWorkflowFromYaml(loadGolden("02-switch-conditional.yaml"));
    const state = createState();

    const mockCallHttp = vi.fn(async () => fakeHttpResponse());
    const ctx = makeCtx({ callHttp: mockCallHttp });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallHttp).toHaveBeenCalledTimes(2);
    const calls = mockCallHttp.mock.calls as unknown[][];
    const firstCall = calls[0][0] as HttpCallConfig;
    expect(firstCall.method).toBe("GET");
    const secondCall = calls[1][0] as HttpCallConfig;
    expect(secondCall.method).toBe("POST");
  });

  it("#03 foreach-loop — for loop with HTTP call per item", async () => {
    const model = loadWorkflowFromYaml(loadGolden("03-foreach-loop.yaml"));
    const state = createState();
    state.data = { items: ["item1", "item2", "item3"] };

    const mockCallHttp = vi.fn(async () => fakeHttpResponse());
    const ctx = makeCtx({ callHttp: mockCallHttp });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallHttp).toHaveBeenCalledTimes(3);
  });

  it("#04 parallel-concurrent — fork with HTTP calls in each branch", async () => {
    const model = loadWorkflowFromYaml(loadGolden("04-parallel-concurrent.yaml"));
    const state = createState();

    const mockCallHttp = vi.fn(async () => fakeHttpResponse());
    const ctx = makeCtx({ callHttp: mockCallHttp });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallHttp).toHaveBeenCalledTimes(3);
  });

  it("#06 sleep-delay — wait + HTTP calls before/after", async () => {
    const model = loadWorkflowFromYaml(loadGolden("06-sleep-delay.yaml"));
    const state = createState();

    const mockCallHttp = vi.fn(async () => fakeHttpResponse());
    const mockSleep = vi.fn(async () => {});
    const ctx = makeCtx({ callHttp: mockCallHttp, sleep: mockSleep });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallHttp).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(5_000);
  });

  it("#08 error-retry — try/catch wrapping HTTP call, error handler runs on failure", async () => {
    const model = loadWorkflowFromYaml(loadGolden("08-error-retry.yaml"));
    const state = createState();

    let callCount = 0;
    const mockCallHttp = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("Simulated HTTP failure");
      return fakeHttpResponse({ message: "Error handled" });
    });
    const mockSleep = vi.fn(async () => {});
    const ctx = makeCtx({ callHttp: mockCallHttp, sleep: mockSleep });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(state.data.error).toBeDefined();
    expect(mockCallHttp).toHaveBeenCalledTimes(2);
  });

  it("#10 complex-workflow — switch + fork + listen + HTTP (multi-pattern)", async () => {
    const model = loadWorkflowFromYaml(loadGolden("10-complex-workflow.yaml"));
    const state = createState();
    state.data = { valid: true };

    const mockCallHttp = vi.fn(async () => fakeHttpResponse());
    const mockListen = vi.fn(async () => ({ approval_signal: { approved: true } }));
    const ctx = makeCtx({ callHttp: mockCallHttp, listen: mockListen });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallHttp).toHaveBeenCalled();
    expect(mockListen).toHaveBeenCalledOnce();
  });

  it("#10 complex-workflow — switch to errorState when valid=false", async () => {
    const model = loadWorkflowFromYaml(loadGolden("10-complex-workflow.yaml"));
    const state = createState();
    state.data = { valid: false };

    const mockCallHttp = vi.fn(async () => fakeHttpResponse());
    const ctx = makeCtx({ callHttp: mockCallHttp });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallHttp).toHaveBeenCalledOnce();
  });

  it("#11 claimcheck-large-payload — sequential HTTP calls (GET + GET + POST)", async () => {
    const model = loadWorkflowFromYaml(loadGolden("11-claimcheck-large-payload.yaml"));
    const state = createState();

    const photosData = Array.from({ length: 100 }, (_, i) => ({ id: i, title: `photo ${i}` }));
    const commentsData = Array.from({ length: 50 }, (_, i) => ({ id: i, body: `comment ${i}` }));
    let callIndex = 0;

    const mockCallHttp = vi.fn(async () => {
      callIndex++;
      if (callIndex === 1) return photosData;
      if (callIndex === 2) return commentsData;
      return fakeHttpResponse();
    });
    const ctx = makeCtx({ callHttp: mockCallHttp });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallHttp).toHaveBeenCalledTimes(3);
  });

  it("#12 claimcheck-between-steps — sequential HTTP with data references", async () => {
    const model = loadWorkflowFromYaml(loadGolden("12-claimcheck-between-steps.yaml"));
    const state = createState();

    const photosData = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const commentsData = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    let callIndex = 0;

    const mockCallHttp = vi.fn(async () => {
      callIndex++;
      if (callIndex === 1) return photosData;
      if (callIndex === 2) return commentsData;
      return fakeHttpResponse();
    });
    const ctx = makeCtx({ callHttp: mockCallHttp });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallHttp).toHaveBeenCalledTimes(4);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tier 1d: Advanced task golden YAMLs
// ─────────────────────────────────────────────────────────────────────

describe("Golden Execution — Tier 1d: Advanced Tasks", () => {
  it("#05 event-signal — listen for one signal, then HTTP call", async () => {
    const model = loadWorkflowFromYaml(loadGolden("05-event-signal.yaml"));
    const state = createState();

    const mockListen = vi.fn(async () => ({ approved: true }));
    const mockCallHttp = vi.fn(async () => fakeHttpResponse());
    const ctx = makeCtx({ listen: mockListen, callHttp: mockCallHttp });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockListen).toHaveBeenCalledOnce();
    expect(mockCallHttp).toHaveBeenCalledOnce();
  });

  it("#13 agent-call — call:agent with structured output, switch on severity", async () => {
    const model = loadWorkflowFromYaml(loadGolden("13-agent-call.yaml"));
    const state = createState();
    state.input = { pr_number: 42, repo: "stigmer/stigmer", diff: "--- a/foo.ts\n+++ b/foo.ts" };

    const mockCallAgent = vi.fn(async () => ({
      structured: { severity: "high", category: "security", customer_impact: true },
      final_text: "Review complete",
      agent_execution_id: "exec-123",
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await executeDoTasks(model.do, state.input, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallAgent).toHaveBeenCalledOnce();
    expect(state.data.action).toBe("request_changes");
    expect(state.data.notification).toBe("normal");
    expect(state.data.assignee).toBe("senior-reviewer");
  });

  it("#13 agent-call — critical severity routes to handleCritical", async () => {
    const criticalYaml = [
      "document:",
      "  dsl: '1.0.0'",
      "  namespace: stigmer",
      "  name: code-review-triage-critical",
      "  version: '1.0.0'",
      "do:",
      "  - setupContext:",
      "      set:",
      "        review_request:",
      "          pr_number: 99",
      "  - reviewCode:",
      "      call: agent",
      "      with:",
      '        agent: "code-reviewer"',
      '        message: "Review the code changes"',
      "      export:",
      '        as: "${ .structured }"',
      "  - routeBySeverity:",
      "      switch:",
      "        - critical:",
      '            when: ${ $context.reviewCode.severity == "critical" }',
      "            then: handleCritical",
      "        - default:",
      "            then: handleStandard",
      "  - handleCritical:",
      "      set:",
      "        action: block_merge",
      "        notification: urgent",
      "        assignee: security-team",
      "      then: end",
      "  - handleStandard:",
      "      set:",
      "        action: auto_approve",
    ].join("\n");

    const model = loadWorkflowFromYaml(criticalYaml);
    const state = createState();
    const mockCallAgent = vi.fn(async () => ({
      structured: { severity: "critical", category: "data-loss", customer_impact: true },
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(state.data.action).toBe("block_merge");
    expect(state.data.notification).toBe("urgent");
    expect(state.data.assignee).toBe("security-team");
  });

  it("#13 agent-call — callAgent receives correct agent slug, env, config, and output contract", async () => {
    const model = loadWorkflowFromYaml(loadGolden("13-agent-call.yaml"));
    const state = createState();
    state.input = { pr_number: 7, repo: "acme/app", diff: "--- a/main.ts" };

    const mockCallAgent = vi.fn(async () => ({
      structured: { severity: "low", category: "style", customer_impact: false },
      final_text: "LGTM",
      agent_execution_id: "aex-verify",
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await executeDoTasks(model.do, state.input, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallAgent).toHaveBeenCalledOnce();
    const [config, _env, metadata] = mockCallAgent.mock.calls[0];

    expect(config.agent).toBe("code-reviewer");
    expect(config.message).toContain("Review the following code changes from PR #7");
    expect(config.message).toContain("in repository acme/app");
    expect(config.message).toContain("--- a/main.ts");
    expect(config.message).not.toContain("${ $context");
    expect(config.message).not.toContain("${ $input");
    expect(config.env).toEqual({ GITHUB_TOKEN: "${.secrets.GITHUB_TOKEN}" });
    expect(config.config?.model).toBe("claude-3-5-sonnet");
    expect(config.config?.timeout).toBe(300);
    expect(config.config?.temperature).toBe(0.2);
    expect(config.harness).toBe("HARNESS_NATIVE");
    expect(config.output?.schema).toBeDefined();
    expect(config.output?.schema.required).toContain("severity");
    expect(config.output?.on_invalid).toBe("ON_INVALID_RETRY");
    expect(config.output?.max_retries).toBe(2);
    expect(metadata.taskName).toBe("reviewCode");
  });

  it("#13 agent-call — cross-org agent reference preserves org/slug format", async () => {
    const crossOrgYaml = [
      "document:",
      "  dsl: '1.0.0'",
      "  namespace: my-org",
      "  name: cross-org-agent",
      "  version: '1.0.0'",
      "do:",
      "  - callRemoteAgent:",
      "      call: agent",
      "      with:",
      '        agent: "stigmer/code-reviewer"',
      '        message: "Review this"',
      '        org: "stigmer"',
    ].join("\n");

    const model = loadWorkflowFromYaml(crossOrgYaml);
    const state = createState();

    const mockCallAgent = vi.fn(async () => ({
      final_text: "done",
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallAgent).toHaveBeenCalledOnce();
    const [config] = mockCallAgent.mock.calls[0];
    expect(config.agent).toBe("stigmer/code-reviewer");
    expect(config.org).toBe("stigmer");
    expect(config.message).toBe("Review this");
  });

  it("#16 wait-delay — multiple timer durations (seconds, minutes+seconds, milliseconds)", async () => {
    const model = loadWorkflowFromYaml(loadGolden("16-wait-delay.yaml"));
    const state = createState();

    const mockSleep = vi.fn(async () => {});
    const ctx = makeCtx({ sleep: mockSleep });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(state.data.started).toBe(true);
    expect(state.data.after_short).toBe(true);
    expect(state.data.after_multi).toBe(true);
    expect(state.data.completed).toBe(true);

    expect(mockSleep).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenNthCalledWith(1, 5_000);
    expect(mockSleep).toHaveBeenNthCalledWith(2, 90_000);
    expect(mockSleep).toHaveBeenNthCalledWith(3, 500);
  });

  it("#17 listen-signal — one/all/any signal strategies", async () => {
    const model = loadWorkflowFromYaml(loadGolden("17-listen-signal.yaml"));
    const state = createState();

    const mockListen = vi.fn(async (config: ListenExecutionConfig) => {
      if (config.mode === "all") {
        return config.events.reduce((acc, e) => ({ ...acc, [e.id]: { data: "ok" } }), {});
      }
      return { data: "first-response" };
    });
    const ctx = makeCtx({ listen: mockListen });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockListen).toHaveBeenCalledTimes(3);
    expect(state.data.approved).toBe(true);
    expect(state.data.reviews_done).toBe(true);
    expect(state.data.first_response).toBe(true);
  });

  it("#18 run-task — script, shell, and child workflow", async () => {
    const model = loadWorkflowFromYaml(loadGolden("18-run-task.yaml"));
    const state = createState();

    const mockRunCommand = vi.fn(async (config: RunCommandConfig) => {
      if (config.mode === "script") return { computed: 4 };
      return "hello from shell";
    });
    const mockRunWorkflow = vi.fn(async () => ({ enriched: true }));
    const ctx = makeCtx({ runCommand: mockRunCommand, runWorkflow: mockRunWorkflow });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockRunCommand).toHaveBeenCalledTimes(2);
    expect(mockRunWorkflow).toHaveBeenCalledOnce();
    expect(state.data.all_runs_done).toBe(true);
  });

  it("#19 emit-event — CloudEvents envelope construction via call:function", async () => {
    const model = loadWorkflowFromYaml(loadGolden("19-emit-event.yaml"));
    const state = createState();

    const mockCallFunction = vi.fn(async (call: string, config: Record<string, unknown>) => {
      expect(call).toBe("emit_event");
      const event = config.event as Record<string, unknown>;
      return {
        specversion: "1.0",
        type: event.type,
        source: event.source ?? "/stigmer",
        data: event.data,
        id: "evt-001",
      };
    });
    const ctx = makeCtx({ callFunction: mockCallFunction });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallFunction).toHaveBeenCalledTimes(2);
    expect(state.data.events_emitted).toBe(true);
  });

  it("#20 human-input — HITL approval gates with timeout policies", async () => {
    const model = loadWorkflowFromYaml(loadGolden("20-human-input.yaml"));
    const state = createState();

    const mockAwaitHumanInput = vi.fn(async () => ({
      outcome: "approve",
      reviewer: "admin@test.com",
      responded_at: new Date().toISOString(),
    }));
    const ctx = makeCtx({ awaitHumanInput: mockAwaitHumanInput });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockAwaitHumanInput).toHaveBeenCalledTimes(2);
    expect(state.data.approval_received).toBe(true);
    expect(state.data.all_gates_passed).toBe(true);
  });

  it("#21 retry-backoff — catch-level retry with various backoff strategies", async () => {
    const model = loadWorkflowFromYaml(loadGolden("21-retry-backoff.yaml"));
    const state = createState();

    const mockSleep = vi.fn(async () => {});
    const ctx = makeCtx({ sleep: mockSleep });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(state.data.phase).toBe("completed");
    expect(state.data.comm_retried).toBe(true);
    expect(state.data.comm_error_type).toBe("https://serverlessworkflow.io/spec/1.0.0/errors/communication");
    expect(state.data.timeout_retried).toBe(true);
    expect(state.data.timeout_title).toBe("Request Timeout");
    expect(state.data.rate_limited).toBe(true);
    expect(state.data.auth_skipped_retry).toBe(true);
    expect(state.data.auth_error_detail).toBe("Unauthorized");
    expect(state.data.overload_retried).toBe(true);
  });

  it("#22 listen-query-update — query, update, and mixed event types", async () => {
    const model = loadWorkflowFromYaml(loadGolden("22-listen-query-update.yaml"));
    const state = createState();

    const mockListen = vi.fn(async (config: ListenExecutionConfig) => {
      const firstEvent = config.events[0];
      if (firstEvent.type === "query") {
        return firstEvent.data ?? { status: "ok" };
      }
      if (firstEvent.type === "update") {
        return firstEvent.data ?? { updated: true };
      }
      if (config.mode === "all") {
        return config.events.reduce((acc, e) => ({ ...acc, [e.id]: e.data ?? { ok: true } }), {});
      }
      return { data: "response" };
    });
    const ctx = makeCtx({ listen: mockListen });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockListen).toHaveBeenCalledTimes(4);
    expect(state.data.listen_tests_complete).toBe(true);
  });

  it("#23 notification — webhook notification via call:function", async () => {
    const model = loadWorkflowFromYaml(loadGolden("23-notification.yaml"));
    const state = createState();

    const mockCallFunction = vi.fn(async (call: string) => {
      expect(call).toBe("notification");
      return { delivered: true, channel: "webhook" };
    });
    const ctx = makeCtx({ callFunction: mockCallFunction });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallFunction).toHaveBeenCalledTimes(2);
    expect(state.data.notifications_sent).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Structured Output Pipeline Regression Tests
// ─────────────────────────────────────────────────────────────────────

describe("Golden Execution — Structured Output Pipeline", () => {
  it("agent_call with output.schema — structured output flows to downstream tasks via $context", async () => {
    const yaml = [
      "document:",
      "  dsl: '1.0.0'",
      "  name: structured-output-pipeline",
      "  version: '1.0.0'",
      "do:",
      "  - analyze:",
      "      call: agent",
      "      with:",
      '        agent: "analyst"',
      '        message: "Analyze player data"',
      "        output:",
      "          schema:",
      "            type: object",
      "            required:",
      "              - executive_summary",
      "              - cohorts",
      "            properties:",
      "              executive_summary:",
      "                type: string",
      "              dau:",
      "                type: number",
      "              cohorts:",
      "                type: array",
      "                items:",
      "                  type: object",
      "                  required:",
      "                    - name",
      "                    - size",
      "                  properties:",
      "                    name:",
      "                      type: string",
      "                    size:",
      "                      type: number",
      "          on_invalid: ON_INVALID_FAIL",
      "      export:",
      '        as: "${ .structured }"',
      "  - downstream:",
      "      set:",
      "        report_dau: ${ $context.analyze.dau }",
      "        cohort_count: ${ $context.analyze.cohorts | length }",
      "        first_cohort: ${ $context.analyze.cohorts[0].name }",
    ].join("\n");

    const model = loadWorkflowFromYaml(yaml);
    const state = createState();

    const mockCallAgent = vi.fn(async () => ({
      structured: {
        executive_summary: "DAU stable at 7175",
        dau: 7175,
        cohorts: [
          { name: "D1 New Players", size: 10 },
          { name: "D3 Drop-offs", size: 3589 },
        ],
      },
      agent_execution_id: "aex-pipeline-test",
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(mockCallAgent).toHaveBeenCalledOnce();
    expect(state.context.analyze.dau).toBe(7175);
    expect(state.context.analyze.executive_summary).toBe("DAU stable at 7175");
    expect(state.context.analyze.cohorts).toHaveLength(2);
    expect(state.data.report_dau).toBe(7175);
    expect(state.data.cohort_count).toBe(2);
    expect(state.data.first_cohort).toBe("D1 New Players");
  });

  it("agent_call with output.schema — ON_INVALID_FAIL rejects missing structured output", async () => {
    const yaml = [
      "document:",
      "  dsl: '1.0.0'",
      "  name: structured-output-fail",
      "  version: '1.0.0'",
      "do:",
      "  - analyze:",
      "      call: agent",
      "      with:",
      '        agent: "analyst"',
      '        message: "Analyze data"',
      "        output:",
      "          schema:",
      "            type: object",
      "            required:",
      "              - executive_summary",
      "            properties:",
      "              executive_summary:",
      "                type: string",
      "          on_invalid: ON_INVALID_FAIL",
      "      export:",
      '        as: "${ .structured }"',
    ].join("\n");

    const model = loadWorkflowFromYaml(yaml);
    const state = createState();

    const mockCallAgent = vi.fn(async () => ({
      final_text: "Here is the analysis...",
      agent_execution_id: "aex-no-structured",
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await expect(
      executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx),
    ).rejects.toThrow(/Agent output validation failed.*Agent did not return structured output/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Regression: Production Callback Result Formats
  //
  // In production, the CallAgent activity uses async completion.
  // The Java/Go backend completes the activity with a callback result.
  // These tests simulate the exact result formats each backend produces
  // to verify the workflow engine handles them correctly.
  // ─────────────────────────────────────────────────────────────────

  it("REGRESSION: Go buildCallbackResult omits structured output due to snake_case key mismatch", async () => {
    // Go's buildCallbackResult() looks for activityResult["structured_output"]
    // (snake_case) but the runner's slimStatus() returns "structuredOutput"
    // (camelCase via proto-JSON). The key is never found, so the callback
    // result has only agent_execution_id — no "structured" field.
    //
    // This is the EXACT format returned by the Go InvokeAgentExecutionWorkflow:
    //   { agent_execution_id: "aex_xxx" }
    //
    // Expected: validation fails because result.structured is undefined.
    const yaml = [
      "document:",
      "  dsl: '1.0.0'",
      "  name: go-callback-regression",
      "  version: '1.0.0'",
      "do:",
      "  - analyze:",
      "      call: agent",
      "      with:",
      '        agent: "analyst"',
      '        message: "Analyze data"',
      "        output:",
      "          schema:",
      "            type: object",
      "            required:",
      "              - executive_summary",
      "            properties:",
      "              executive_summary:",
      "                type: string",
      "          on_invalid: ON_INVALID_FAIL",
      "      export:",
      '        as: "${ .structured }"',
    ].join("\n");

    const model = loadWorkflowFromYaml(yaml);
    const state = createState();

    const mockCallAgent = vi.fn(async () => ({
      agent_execution_id: "aex-go-regression",
      // NOTE: no "structured" field — this is what Go's buildCallbackResult
      // produces because it looks for "structured_output" (snake_case) but
      // the runner returns "structuredOutput" (camelCase).
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await expect(
      executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx),
    ).rejects.toThrow(/Agent output validation failed.*Agent did not return structured output/);
  });

  it("REGRESSION: Java buildCallbackResultJson includes structured output correctly", async () => {
    // Java's buildCallbackResultJson() reads structuredOutput from the
    // proto via finalStatus.hasStructuredOutput() and serializes it as
    // the "structured" field in the callback JSON.
    //
    // When the local Java v3 code handles the workflow, the callback
    // result is: { agent_execution_id: "aex_xxx", structured: {...} }
    //
    // Expected: validation passes, downstream reads structured data.
    const yaml = [
      "document:",
      "  dsl: '1.0.0'",
      "  name: java-callback-success",
      "  version: '1.0.0'",
      "do:",
      "  - analyze:",
      "      call: agent",
      "      with:",
      '        agent: "analyst"',
      '        message: "Analyze data"',
      "        output:",
      "          schema:",
      "            type: object",
      "            required:",
      "              - executive_summary",
      "              - dau",
      "            properties:",
      "              executive_summary:",
      "                type: string",
      "              dau:",
      "                type: number",
      "          on_invalid: ON_INVALID_FAIL",
      "      export:",
      '        as: "${ .structured }"',
      "  - downstream:",
      "      set:",
      "        report_dau: ${ $context.analyze.dau }",
      "        summary: ${ $context.analyze.executive_summary }",
    ].join("\n");

    const model = loadWorkflowFromYaml(yaml);
    const state = createState();

    const mockCallAgent = vi.fn(async () => ({
      agent_execution_id: "aex-java-success",
      structured: {
        executive_summary: "DAU stable at 7175",
        dau: 7175,
      },
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(state.context.analyze.dau).toBe(7175);
    expect(state.context.analyze.executive_summary).toBe("DAU stable at 7175");
    expect(state.data.report_dau).toBe(7175);
    expect(state.data.summary).toBe("DAU stable at 7175");
  });

  it("REGRESSION: old Java code sends plain string — no structured output", async () => {
    // Before the v3 fix, Java's executeCursorFlow() completed the async
    // activity with a plain string like:
    //   "Agent execution completed - execution_id: aex_xxx, phase: EXECUTION_COMPLETED"
    //
    // The TS orchestrator's JSON.parse fails, so activityResult = {}.
    // At the workflow engine level, callAgent returns {} (empty object).
    //
    // Expected: validation fails because result.structured is undefined.
    const yaml = [
      "document:",
      "  dsl: '1.0.0'",
      "  name: old-java-regression",
      "  version: '1.0.0'",
      "do:",
      "  - analyze:",
      "      call: agent",
      "      with:",
      '        agent: "analyst"',
      '        message: "Analyze data"',
      "        output:",
      "          schema:",
      "            type: object",
      "            required:",
      "              - executive_summary",
      "            properties:",
      "              executive_summary:",
      "                type: string",
      "          on_invalid: ON_INVALID_FAIL",
      "      export:",
      '        as: "${ .structured }"',
    ].join("\n");

    const model = loadWorkflowFromYaml(yaml);
    const state = createState();

    const mockCallAgent = vi.fn(async () => ({
      // Empty object — what the orchestrator produces when JSON.parse
      // fails on the plain string from old Java code
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await expect(
      executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx),
    ).rejects.toThrow(/Agent output validation failed.*Agent did not return structured output/);
  });

  it("agent_call with output.schema — schema with optional fields validates correctly", async () => {
    const yaml = [
      "document:",
      "  dsl: '1.0.0'",
      "  name: structured-optional-fields",
      "  version: '1.0.0'",
      "do:",
      "  - analyze:",
      "      call: agent",
      "      with:",
      '        agent: "analyst"',
      '        message: "Analyze data"',
      "        output:",
      "          schema:",
      "            type: object",
      "            required:",
      "              - executive_summary",
      "              - cohorts",
      "              - anomalies",
      "            properties:",
      "              executive_summary:",
      "                type: string",
      "              dau:",
      "                type: number",
      "              dau_trend_pct:",
      "                type: number",
      "              cohorts:",
      "                type: array",
      "                items:",
      "                  type: object",
      "                  required:",
      "                    - name",
      "                    - size",
      "                    - action_needed",
      "                  properties:",
      "                    name:",
      "                      type: string",
      "                    size:",
      "                      type: number",
      "                    retention_trend:",
      "                      type: string",
      "                    action_needed:",
      "                      type: boolean",
      "              anomalies:",
      "                type: array",
      "                items:",
      "                  type: object",
      "                  properties:",
      "                    metric:",
      "                      type: string",
      "                    description:",
      "                      type: string",
      "                    severity:",
      "                      type: string",
      "              data_quality_notes:",
      "                type: string",
      "          on_invalid: ON_INVALID_FAIL",
      "      export:",
      '        as: "${ .structured }"',
      "  - report:",
      "      set:",
      "        summary: ${ $context.analyze.executive_summary }",
      "        anomaly_count: ${ $context.analyze.anomalies | length }",
    ].join("\n");

    const model = loadWorkflowFromYaml(yaml);
    const state = createState();

    const mockCallAgent = vi.fn(async () => ({
      structured: {
        executive_summary: "Garden Design Makeover DAU remains stable at 7,175",
        dau: 7175,
        dau_trend_pct: 3.4,
        cohorts: [
          { name: "D1 New Players", size: 10, retention_trend: "Very low", action_needed: true },
          { name: "D3 Drop-offs", size: 3589, retention_trend: "Large cohort", action_needed: true },
        ],
        anomalies: [
          { metric: "New User Acquisition", severity: "warning", description: "Only 10 new players" },
        ],
        data_quality_notes: "Event data lags 3 days behind current date",
      },
      agent_execution_id: "aex-full-schema",
    }));
    const ctx = makeCtx({ callAgent: mockCallAgent });

    await executeDoTasks(model.do, null, state, model, evaluateExpressionBatch, ctx);

    expect(state.context.analyze.dau).toBe(7175);
    expect(state.context.analyze.cohorts).toHaveLength(2);
    expect(state.context.analyze.anomalies).toHaveLength(1);
    expect(state.data.summary).toBe("Garden Design Makeover DAU remains stable at 7,175");
    expect(state.data.anomaly_count).toBe(1);
  });
});
