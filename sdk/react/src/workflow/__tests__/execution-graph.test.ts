import { describe, test, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { applyDagreLayout } from "../layout";
import type { DagreLayoutConfig } from "../canvas-constants";
import { DAGRE_CONFIG, EXECUTION_DAGRE_CONFIG } from "../canvas-constants";
import type { WorkflowGraphModel } from "../workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model";
import type { NodeExecutionState, CanvasTaskNodeData } from "../workflow-graph-conversions";
import { toReactFlowElements, yamlToGraph } from "../workflow-graph-conversions";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";

// ---------------------------------------------------------------------------
// applyDagreLayout
// ---------------------------------------------------------------------------

describe("applyDagreLayout", () => {
  const minimalGraph: WorkflowGraphModel = {
    document: { name: "test", dsl: "1.0.0", namespace: "default", version: "0.0.1" },
    nodes: [
      { id: START_NODE_ID, taskName: "Start", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "start", config: {}, position: { x: 0, y: 0 } },
      { id: "task_1", taskName: "task_1", kind: WorkflowTaskKind.agent_call, category: "ai", config: {}, position: { x: 0, y: 0 } },
      { id: END_NODE_ID, taskName: "End", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "end", config: {}, position: { x: 0, y: 0 } },
    ],
    edges: [
      { id: "e1", source: START_NODE_ID, target: "task_1" },
      { id: "e2", source: "task_1", target: END_NODE_ID },
    ],
  };

  test("positions all nodes with non-zero coordinates", () => {
    const result = applyDagreLayout(minimalGraph);
    for (const node of result.nodes) {
      expect(typeof node.position.x).toBe("number");
      expect(typeof node.position.y).toBe("number");
      expect(node.position.x !== 0 || node.position.y !== 0).toBe(true);
    }
  });

  test("produces deterministic layout (same input = same output)", () => {
    const a = applyDagreLayout(minimalGraph);
    const b = applyDagreLayout(minimalGraph);
    for (let i = 0; i < a.nodes.length; i++) {
      expect(a.nodes[i].position).toEqual(b.nodes[i].position);
    }
  });

  test("maintains top-to-bottom ordering (Start above task_1 above End)", () => {
    const result = applyDagreLayout(minimalGraph);
    const startY = result.nodes.find((n) => n.id === START_NODE_ID)!.position.y;
    const taskY = result.nodes.find((n) => n.id === "task_1")!.position.y;
    const endY = result.nodes.find((n) => n.id === END_NODE_ID)!.position.y;
    expect(startY).toBeLessThan(taskY);
    expect(taskY).toBeLessThan(endY);
  });

  test("uses visual registry dimensions for non-sentinel nodes", () => {
    const result = applyDagreLayout(minimalGraph);
    const start = result.nodes.find((n) => n.id === START_NODE_ID)!;
    const task = result.nodes.find((n) => n.id === "task_1")!;
    expect(start.position.x).not.toEqual(task.position.x);
  });
});

// ---------------------------------------------------------------------------
// mergeExecutionState logic (inline test of the merge pattern from hook)
// ---------------------------------------------------------------------------

describe("mergeExecutionState", () => {
  function mergeExecutionState(
    nodes: ReturnType<typeof toReactFlowElements>["nodes"],
    taskStates: ReadonlyMap<string, DerivedTaskState>,
  ) {
    return nodes.map((node) => {
      const nodeData = node.data as CanvasTaskNodeData;
      if (nodeData.isSentinel) return node;

      const taskState = taskStates.get(nodeData.taskName);
      const executionState: NodeExecutionState = taskState
        ? {
            status: taskState.status,
            durationMs: taskState.durationMs,
            costMicros: taskState.costMicros,
            attemptNumber: taskState.attemptNumber,
            error: taskState.error || undefined,
          }
        : { status: "not_reached" };

      return {
        ...node,
        data: { ...nodeData, executionState },
      };
    });
  }

  const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-wf
  org: acme
spec:
  document:
    dsl: "1.0.0"
    name: test-wf
    namespace: default
    version: "0.0.1"
  tasks:
    - name: fetch_data
      kind: http_call
    - name: analyze
      kind: agent_call
`;

  test("marks tasks without event state as not_reached", () => {
    const graph = yamlToGraph(yaml);
    const laidOut = applyDagreLayout(graph);
    const elements = toReactFlowElements(laidOut);
    const taskStates = new Map<string, DerivedTaskState>();

    const merged = mergeExecutionState(elements.nodes, taskStates);
    const analyzeNode = merged.find(
      (n) => (n.data as CanvasTaskNodeData).taskName === "analyze",
    );
    expect((analyzeNode!.data as CanvasTaskNodeData).executionState?.status).toBe(
      "not_reached",
    );
  });

  test("maps DerivedTaskState status to node executionState", () => {
    const graph = yamlToGraph(yaml);
    const laidOut = applyDagreLayout(graph);
    const elements = toReactFlowElements(laidOut);

    const taskStates = new Map<string, DerivedTaskState>([
      [
        "fetch_data",
        {
          taskName: "fetch_data",
          taskKind: WorkflowTaskKind.http_call,
          status: "completed",
          durationMs: 1234,
          costMicros: BigInt(0),
          tokensUsed: BigInt(0),
          attemptNumber: 1,
          error: "",
          childExecutionId: "",
          agentSlug: "",
          currentToolName: "",
          messagesCount: 0,
          toolCallsCount: 0,
        },
      ],
      [
        "analyze",
        {
          taskName: "analyze",
          taskKind: WorkflowTaskKind.agent_call,
          status: "running",
          durationMs: 500,
          costMicros: BigInt(150000),
          tokensUsed: BigInt(4500),
          attemptNumber: 1,
          error: "",
          childExecutionId: "",
          agentSlug: "",
          currentToolName: "",
          messagesCount: 0,
          toolCallsCount: 0,
        },
      ],
    ]);

    const merged = mergeExecutionState(elements.nodes, taskStates);

    const fetchNode = merged.find(
      (n) => (n.data as CanvasTaskNodeData).taskName === "fetch_data",
    );
    expect((fetchNode!.data as CanvasTaskNodeData).executionState?.status).toBe("completed");
    expect((fetchNode!.data as CanvasTaskNodeData).executionState?.durationMs).toBe(1234);

    const analyzeNode = merged.find(
      (n) => (n.data as CanvasTaskNodeData).taskName === "analyze",
    );
    expect((analyzeNode!.data as CanvasTaskNodeData).executionState?.status).toBe("running");
  });

  test("sentinel nodes are not modified", () => {
    const graph = yamlToGraph(yaml);
    const laidOut = applyDagreLayout(graph);
    const elements = toReactFlowElements(laidOut);
    const taskStates = new Map<string, DerivedTaskState>();

    const merged = mergeExecutionState(elements.nodes, taskStates);
    const startNode = merged.find(
      (n) => (n.data as CanvasTaskNodeData).isSentinel && (n.data as CanvasTaskNodeData).taskName === "Start",
    );
    expect((startNode!.data as CanvasTaskNodeData).executionState).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyDagreLayout — custom config parameter
// ---------------------------------------------------------------------------

describe("applyDagreLayout with custom config", () => {
  const graph: WorkflowGraphModel = {
    document: { name: "test", dsl: "1.0.0", namespace: "default", version: "0.0.1" },
    nodes: [
      { id: START_NODE_ID, taskName: "Start", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "start", config: {}, position: { x: 0, y: 0 } },
      { id: "a", taskName: "a", kind: WorkflowTaskKind.agent_call, category: "ai", config: {}, position: { x: 0, y: 0 } },
      { id: "b", taskName: "b", kind: WorkflowTaskKind.http_call, category: "invocation", config: {}, position: { x: 0, y: 0 } },
      { id: END_NODE_ID, taskName: "End", kind: WorkflowTaskKind.workflow_task_kind_unspecified, category: "end", config: {}, position: { x: 0, y: 0 } },
    ],
    edges: [
      { id: "e1", source: START_NODE_ID, target: "a" },
      { id: "e2", source: START_NODE_ID, target: "b" },
      { id: "e3", source: "a", target: END_NODE_ID },
      { id: "e4", source: "b", target: END_NODE_ID },
    ],
  };

  test("uses default DAGRE_CONFIG when no config is provided", () => {
    const withDefault = applyDagreLayout(graph);
    const withExplicit = applyDagreLayout(graph, DAGRE_CONFIG);
    for (let i = 0; i < withDefault.nodes.length; i++) {
      expect(withDefault.nodes[i].position).toEqual(withExplicit.nodes[i].position);
    }
  });

  test("EXECUTION_DAGRE_CONFIG produces more spread-out positions", () => {
    const standard = applyDagreLayout(graph, DAGRE_CONFIG);
    const execution = applyDagreLayout(graph, EXECUTION_DAGRE_CONFIG);

    const standardA = standard.nodes.find((n) => n.id === "a")!;
    const standardB = standard.nodes.find((n) => n.id === "b")!;
    const executionA = execution.nodes.find((n) => n.id === "a")!;
    const executionB = execution.nodes.find((n) => n.id === "b")!;

    const standardSpan = Math.abs(standardB.position.x - standardA.position.x);
    const executionSpan = Math.abs(executionB.position.x - executionA.position.x);
    expect(executionSpan).toBeGreaterThan(standardSpan);
  });

  test("custom config with larger ranksep increases vertical spacing", () => {
    const wideConfig: DagreLayoutConfig = { rankdir: "TB", ranksep: 200, nodesep: 30 };
    const standard = applyDagreLayout(graph, DAGRE_CONFIG);
    const wide = applyDagreLayout(graph, wideConfig);

    const standardStartY = standard.nodes.find((n) => n.id === START_NODE_ID)!.position.y;
    const standardEndY = standard.nodes.find((n) => n.id === END_NODE_ID)!.position.y;
    const wideStartY = wide.nodes.find((n) => n.id === START_NODE_ID)!.position.y;
    const wideEndY = wide.nodes.find((n) => n.id === END_NODE_ID)!.position.y;

    const standardHeight = standardEndY - standardStartY;
    const wideHeight = wideEndY - wideStartY;
    expect(wideHeight).toBeGreaterThan(standardHeight);
  });
});

// ---------------------------------------------------------------------------
// toReactFlowElements — draggable flags on nodes
// ---------------------------------------------------------------------------

describe("toReactFlowElements draggable flags", () => {
  const yaml = `
apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: test-wf
  org: acme
spec:
  document:
    dsl: "1.0.0"
    name: test-wf
    namespace: default
    version: "0.0.1"
  tasks:
    - name: my_task
      kind: agent_call
`;

  test("sentinel nodes have draggable: false", () => {
    const graph = yamlToGraph(yaml);
    const laidOut = applyDagreLayout(graph);
    const elements = toReactFlowElements(laidOut);

    const startNode = elements.nodes.find(
      (n) => (n.data as CanvasTaskNodeData).isSentinel && (n.data as CanvasTaskNodeData).taskName === "Start",
    );
    const endNode = elements.nodes.find(
      (n) => (n.data as CanvasTaskNodeData).isSentinel && (n.data as CanvasTaskNodeData).taskName === "End",
    );

    expect(startNode!.draggable).toBe(false);
    expect(endNode!.draggable).toBe(false);
  });

  test("non-sentinel nodes have draggable: true from toReactFlowElements", () => {
    const graph = yamlToGraph(yaml);
    const laidOut = applyDagreLayout(graph);
    const elements = toReactFlowElements(laidOut);

    const taskNode = elements.nodes.find(
      (n) => (n.data as CanvasTaskNodeData).taskName === "my_task",
    );
    expect(taskNode!.draggable).toBe(true);
  });
});
