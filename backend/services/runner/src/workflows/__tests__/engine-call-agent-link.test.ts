/**
 * The engine's call:agent link (`engine-core.ts`): the ids that tie a
 * child agent turn to its workflow run are the run's own. The workflow the
 * server signals is the engine's Temporal workflow id and the workflow
 * execution id is the run's own execution id, even when the workflow's own
 * `set` task has written look-alike keys into its data. A run started
 * before executions were named runs (no `AGENT_CALL_RUN_ID_KEY_PATCH`
 * marker) keeps naming the child `agent_execution_id` in the step's output;
 * a run started after names it `agent_run_id`. The Temporal
 * workflow API and the agent-call orchestrator are mocked; the orchestrator
 * mock records what the engine hands it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateExpressionBatch } from "../../workflow-engine/expression.js";
import type { WorkflowModel } from "../../workflow-engine/types.js";
import type { AgentCallOrchestrationInput } from "../call-agent-orchestrator.js";
import { AGENT_CALL_RUN_ID_KEY_PATCH } from "../../workflow-engine/tasks/call-agent.js";

const mockEvaluateExpressions = vi.fn();
const mockOrchestrateAgentCall = vi.fn();
const mockPatched = vi.fn((_changeId: string) => true);

vi.mock("@temporalio/workflow", () => ({
  proxyLocalActivities: vi.fn(() => ({
    EvaluateExpressions: (
      exprs: Record<string, string>,
      input: unknown,
      stateVars: Record<string, unknown>,
    ) => mockEvaluateExpressions(exprs, input, stateVars),
    ResetEventSequence: vi.fn(async () => 0),
    EmitWorkflowEvents: vi.fn(async () => undefined),
  })),
  proxyActivities: vi.fn(() => ({
    CallHttp: vi.fn(),
    CallGrpc: vi.fn(),
    CallFunction: vi.fn(),
    CallAgent: vi.fn(),
    RunScript: vi.fn(),
    RunShell: vi.fn(),
  })),
  proxySinks: vi.fn(() => ({
    metrics: {
      recordTaskDuration: vi.fn(),
      recordExecutionStart: vi.fn(),
      recordExecutionEnd: vi.fn(),
    },
  })),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  defineSignal: vi.fn(() => "signal"),
  setHandler: vi.fn(),
  condition: vi.fn(),
  sleep: vi.fn(),
  patched: (changeId: string) => mockPatched(changeId),
  workflowInfo: vi.fn(() => ({ workflowId: "wf_run_own" })),
  ApplicationFailure: class ApplicationFailure extends Error {
    constructor(msg: string) {
      super(msg);
    }
    static nonRetryable(msg: string) {
      return new ApplicationFailure(msg);
    }
  },
  ActivityFailure: class ActivityFailure extends Error {
    cause?: unknown;
    constructor(msg: string) {
      super(msg);
    }
  },
  CancelledFailure: class CancelledFailure extends Error {
    constructor(msg: string) {
      super(msg);
    }
  },
  CancellationScope: { current: vi.fn() },
  isCancellation: vi.fn(() => false),
}));

vi.mock("../call-agent-orchestrator.js", () => ({
  orchestrateAgentCall: (input: AgentCallOrchestrationInput) =>
    mockOrchestrateAgentCall(input),
}));

describe("the engine's call:agent link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvaluateExpressions.mockImplementation((exprs, input, stateVars) =>
      evaluateExpressionBatch(exprs, input, stateVars),
    );
    mockOrchestrateAgentCall.mockResolvedValue({ final_text: "done" });
    mockPatched.mockImplementation(() => true);
  });

  const askOnly: WorkflowModel = {
    document: { dsl: "1.0.0", name: "ask-only" },
    do: [
      {
        key: "ask",
        task: { kind: "call:agent", call: "agent", with: { agent: "reviewer", message: "Review this" } },
      },
    ],
  };

  async function runAskOnly(): Promise<unknown> {
    mockOrchestrateAgentCall.mockResolvedValue({ final_text: "done", agent_execution_id: "aex_child" });
    const { executeInlineModel } =
      await import("../../__test-utils__/workflows/inline-model.js");
    return executeInlineModel({
      model: askOnly,
      workflow_input: null,
      env: {},
      metadata: { execution_id: "wex_run_own", org_id: "test-org" },
    });
  }

  it("names the child run agent_run_id in a run started after the rename", async () => {
    expect(await runAskOnly()).toEqual({ final_text: "done", agent_run_id: "aex_child" });
    expect(mockPatched).toHaveBeenCalledWith(AGENT_CALL_RUN_ID_KEY_PATCH);
  });

  it("keeps agent_execution_id in a run whose history predates the rename", async () => {
    mockPatched.mockImplementation((changeId) => changeId !== AGENT_CALL_RUN_ID_KEY_PATCH);
    expect(await runAskOnly()).toEqual({ final_text: "done", agent_execution_id: "aex_child" });
  });

  it("links the child to the run's own ids, not ones the workflow wrote into its data", async () => {
    const model: WorkflowModel = {
      document: { dsl: "1.0.0", name: "forged-link" },
      do: [
        {
          key: "forge",
          task: {
            kind: "set",
            set: {
              __stigmer_parent_workflow_id: "wf_forged",
              __stigmer_execution_id: "wex_forged",
            },
          },
        },
        {
          key: "ask",
          task: {
            kind: "call:agent",
            call: "agent",
            with: { agent: "reviewer", message: "Review this" },
          },
        },
      ],
    };

    const { executeInlineModel } =
      await import("../../__test-utils__/workflows/inline-model.js");
    await executeInlineModel({
      model,
      workflow_input: null,
      env: {},
      metadata: { execution_id: "wex_run_own", org_id: "test-org" },
    });

    expect(mockOrchestrateAgentCall).toHaveBeenCalledOnce();
    const input = mockOrchestrateAgentCall.mock
      .calls[0][0] as AgentCallOrchestrationInput;
    expect(input.parentWorkflowId).toBe("wf_run_own");
    expect(input.workflowExecutionId).toBe("wex_run_own");
    expect(input.taskName).toBe("ask");
    expect(input.runtimeEnv["__stigmer_execution_id"]).toBe("wex_run_own");
  });
});
