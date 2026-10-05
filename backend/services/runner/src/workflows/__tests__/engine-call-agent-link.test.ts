/**
 * The engine's call:agent link (`engine-core.ts`): the ids that tie a
 * child agent turn to its workflow run are the run's own. The workflow the
 * server signals is the engine's Temporal workflow id and the workflow
 * execution id is the run's own execution id, even when the workflow's own
 * `set` task has written look-alike keys into its data. The Temporal
 * workflow API and the agent-call orchestrator are mocked; the orchestrator
 * mock records what the engine hands it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateExpressionBatch } from "../../workflow-engine/expression.js";
import type { WorkflowModel } from "../../workflow-engine/types.js";
import type { AgentCallOrchestrationInput } from "../call-agent-orchestrator.js";

const mockEvaluateExpressions = vi.fn();
const mockOrchestrateAgentCall = vi.fn();

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
  patched: vi.fn(() => true),
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
