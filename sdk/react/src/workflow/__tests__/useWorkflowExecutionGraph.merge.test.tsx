// Pins how useWorkflowExecutionGraph merges live execution state into the
// graph's nodes: each task node carries the status its derived task state
// reports (or "not_reached"), a fork node carries how many of its branches
// have finished, a running agent_call carries its agent's live activity, a
// node gated on a child agent's tool approval names that tool, and the
// Start/End sentinels never become draggable. The graph is built from the
// pinned workflow version the execution names, fetched through a stubbed
// client; the execution and task states are handed in from outside, the
// way the execution viewer shares its own subscription.
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import type { Node } from "@xyflow/react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { StigmerContext } from "../../context";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import type { CanvasTaskNodeData } from "../workflow-graph-conversions";
import { useWorkflowExecutionGraph } from "../useWorkflowExecutionGraph";

const PINNED_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: merge-fixture
spec:
  document:
    dsl: "1.0.0"
    namespace: test
    name: merge-fixture
    version: "0.0.1"
  tasks:
    - name: triage
      kind: agent_call
      task_config:
        agent: "org/triage-agent"
        message: "triage the ticket"
      flow:
        then: parallel_step
    - name: parallel_step
      kind: fork
      task_config:
        branches:
          - name: branch_a
            do:
              - name: summarize
                kind: llm_call
                task_config:
                  model: gpt-4o
          - name: branch_b
            do:
              - name: extract
                kind: transform
                task_config:
                  engine: TRANSFORM_ENGINE_JQ
                  expression: "."
      flow:
        then: end
`;

function taskState(overrides: Partial<DerivedTaskState> & Pick<DerivedTaskState, "taskName" | "status">): DerivedTaskState {
  return {
    taskKind: WorkflowTaskKind.agent_call,
    durationMs: 0,
    costMicros: BigInt(0),
    tokensUsed: BigInt(0),
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
    inputSummary: null,
    outputSummary: null,
    approvalRequest: null,
    approvalResolution: null,
    ...overrides,
  };
}

function wrapperFor(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(StigmerContext.Provider, { value: client }, children);
  };
}

const client = {
  workflow: {
    getVersion: async () => ({ validatedYaml: PINNED_YAML }),
  },
} as unknown as Stigmer;

function dataOf(nodes: Node[], taskName: string): CanvasTaskNodeData {
  const node = nodes.find((n) => (n.data as CanvasTaskNodeData).taskName === taskName);
  expect(node, `a node for ${taskName}`).toBeDefined();
  return node!.data as CanvasTaskNodeData;
}

describe("useWorkflowExecutionGraph — execution state merged into nodes", () => {
  const execution = create(WorkflowExecutionSchema, {
    metadata: { id: "wex-merge", org: "org-1" },
    spec: { workflowId: "wfl-merge" },
    status: {
      workflowVersionHash: "v-hash",
      pendingApprovals: [
        { childAgentExecutionId: "aex-child", approval: { toolName: "refund_order" } },
      ],
    },
  });

  it("merges task status, fork progress, agent activity and the gated tool, and pins sentinels in place", async () => {
    const taskStates = new Map<string, DerivedTaskState>([
      [
        "triage",
        taskState({
          taskName: "triage",
          status: "waiting_approval",
          childExecutionId: "aex-child",
          agentSlug: "triage-agent",
          currentToolName: "refund_order",
          messagesCount: 3,
        }),
      ],
      ["parallel_step", taskState({ taskName: "parallel_step", taskKind: WorkflowTaskKind.fork, status: "running" })],
      ["summarize", taskState({ taskName: "summarize", status: "completed", durationMs: 1200 })],
    ]);

    const { result } = renderHook(
      () => useWorkflowExecutionGraph({ executionId: "wex-merge", execution, taskStates, nodesDraggable: true }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.nodes.length).toBeGreaterThan(0));
    const { nodes } = result.current;

    const fork = dataOf(nodes, "parallel_step");
    expect(fork.executionState).toEqual(expect.objectContaining({ status: "running" }));
    // One of the two branches has every task completed.
    expect(fork.forkProgress).toEqual({ completed: 1, total: 2, compete: false });

    const triage = dataOf(nodes, "triage");
    expect(triage.executionState).toEqual(expect.objectContaining({ status: "waiting_approval" }));
    expect(triage.approvalToolName).toBe("refund_order");
    // Agent activity is shown only while the task is running.
    expect(triage.agentActivity).toBeUndefined();

    const sentinels = nodes.filter((n) => (n.data as CanvasTaskNodeData).isSentinel);
    expect(sentinels.length).toBeGreaterThan(0);
    for (const sentinel of sentinels) expect(sentinel.draggable).toBe(false);
    for (const task of nodes.filter((n) => !(n.data as CanvasTaskNodeData).isSentinel)) {
      expect(task.draggable).toBe(true);
      expect(task.connectable).toBe(false);
    }
  });

  it("reports a task with no derived state as not reached, and a running agent's live activity", async () => {
    const taskStates = new Map<string, DerivedTaskState>([
      [
        "triage",
        taskState({
          taskName: "triage",
          status: "running",
          agentSlug: "triage-agent",
          currentToolName: "lookup_order",
          messagesCount: 2,
          toolCallsCount: 1,
        }),
      ],
    ]);

    const { result } = renderHook(
      () => useWorkflowExecutionGraph({ executionId: "wex-merge", execution, taskStates }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => expect(result.current.nodes.length).toBeGreaterThan(0));
    const { nodes } = result.current;

    expect(dataOf(nodes, "triage").agentActivity).toEqual({
      agentSlug: "triage-agent",
      currentToolName: "lookup_order",
      messagesCount: 2,
      toolCallsCount: 1,
    });
    const fork = dataOf(nodes, "parallel_step");
    expect(fork.executionState).toEqual({ status: "not_reached" });
    expect(fork.forkProgress).toEqual({ completed: 0, total: 2, compete: false });
  });
});
