"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { RefObject } from "react";
import { useNodesState, useEdgesState, useReactFlow } from "@xyflow/react";
import type {
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  Connection,
  IsValidConnection,
} from "@xyflow/react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowGraphModel, WorkflowGraphNode } from "./workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model";
import {
  yamlToGraph,
  toReactFlowElements,
  categorizeKind,
  stringToTaskKind,
  taskKindToString,
} from "./workflow-graph-conversions";
import { TASK_KIND_DRAG_MIME } from "./WorkflowTaskPalette";
import {
  DAGRE_CONFIG,
  CANVAS_NODE_HEIGHT,
} from "./canvas-constants";
import type { GraphCommand } from "./graph-commands";
import {
  AddNodeCommand,
  DeleteNodeCommand,
  AddEdgeCommand,
  DeleteEdgeCommand,
  CompoundCommand,
  MoveNodesCommand,
  UpdateNodeFieldCommand,
  RenameNodeCommand,
  UpdateNodeMetaCommand,
  MigrateBranchHandleCommand,
  DuplicateNodeCommand,
  AddSwitchCaseCommand,
  AddParallelBranchCommand,
  AddCatchHandlerCommand,
  RemoveSwitchCaseCommand,
  ReorderSwitchCasesCommand,
  RemoveForkBranchCommand,
  ReorderForkBranchesCommand,
  RenameForkBranchCommand,
  SetForkCompeteCommand,
  UpdateCatchConfigCommand,
  RemoveCatchBlockCommand,
  UpdateForEachConfigCommand,
  ToggleNodeDisabledCommand,
  WrapInTryCatchCommand,
  generateEdgeId,
  generateTaskName,
  createTaskNode,
  isSentinelNode,
} from "./graph-commands";
import { graphToYaml } from "./workflow-graph-conversions";
import { useTaskKindRegistry } from "./useTaskKindRegistry";
import type { TaskKindDescriptor } from "./types";
import { useGraphHistory } from "./useGraphHistory";
import { useWorkflowLayout, applyDagreLayout, registryNodeDimensions } from "./layout";
import type { LayoutEngine } from "./layout";
import { serializeSelection, pasteClipboard } from "./clipboard";
import type { ClipboardEntry } from "./clipboard";

/** Selection state for the canvas inspector. */
export interface CanvasSelection {
  readonly type: "node" | "edge";
  readonly id: string;
}

/** Options for {@link useWorkflowCanvas}. */
export interface UseWorkflowCanvasOptions {
  /**
   * Layout engine for the "Auto Layout" action.
   * When provided, this engine is used instead of the default dagre engine.
   * Pass the result of {@link useElkLayoutEngine} for ELK-powered layout.
   * When `null` or `undefined`, dagre is used as the default.
   */
  readonly layoutEngine?: LayoutEngine | null;
}

/** Return value of {@link useWorkflowCanvas}. */
export interface UseWorkflowCanvasReturn {
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly onNodesChange: OnNodesChange;
  readonly onEdgesChange: OnEdgesChange;
  readonly onConnect: (connection: Connection) => void;
  readonly isValidConnection: IsValidConnection;
  readonly onDrop: (event: React.DragEvent) => void;
  readonly onDragOver: (event: React.DragEvent) => void;
  readonly onNodesDelete: (deleted: Node[]) => void;
  readonly onEdgesDelete: (deleted: Edge[]) => void;
  readonly selection: CanvasSelection | null;
  readonly selectNode: (id: string) => void;
  readonly selectEdge: (id: string) => void;
  readonly clearSelection: () => void;
  readonly autoLayout: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isDirty: boolean;
  readonly graph: WorkflowGraphModel | null;
  readonly error: string | null;
  readonly updateNodeField: (nodeId: string, fieldPath: string, value: unknown) => void;
  readonly renameNode: (nodeId: string, newName: string) => void;
  readonly updateNodeExport: (nodeId: string, exportAs: string | undefined) => void;
  readonly updateNodeFlow: (nodeId: string, thenTarget: string | undefined) => void;
  readonly getNodeDescriptor: (nodeId: string) => TaskKindDescriptor | undefined;
  readonly serializeToYaml: () => string | null;
  readonly updateBranchRouting: (
    nodeId: string,
    handleId: string,
    targetTask: string | undefined,
  ) => void;
  readonly migrateBranchHandle: (
    nodeId: string,
    oldHandleId: string,
    newHandleId: string,
  ) => void;
  readonly removeBranchEdges: (nodeId: string, handleId: string) => void;
  readonly insertTaskOnEdge: (edgeId: string, kindString: string) => void;
  readonly addSuccessorTask: (sourceNodeId: string, kindString: string) => void;
  readonly duplicateNode: (nodeId: string) => void;
  readonly addNodeAtPosition: (kindString: string, position: { x: number; y: number }) => void;
  readonly addSwitchCase: (switchNodeId: string, caseName: string, condition: string) => void;
  readonly addForkBranch: (forkNodeId: string, branchName: string) => void;
  readonly addCatchHandler: (tryCatchNodeId: string, errorType: string) => void;
  readonly removeSwitchCase: (switchNodeId: string, caseName: string) => void;
  readonly reorderSwitchCases: (switchNodeId: string, newOrder: readonly string[]) => void;
  readonly removeForkBranch: (forkNodeId: string, branchName: string) => void;
  readonly reorderForkBranches: (forkNodeId: string, newOrder: readonly string[]) => void;
  readonly renameForkBranch: (forkNodeId: string, oldName: string, newName: string) => void;
  readonly setForkCompete: (forkNodeId: string, compete: boolean) => void;
  readonly updateCatchConfig: (tryCatchNodeId: string, updates: { as?: string; compensate?: boolean }) => void;
  readonly removeCatchBlock: (tryCatchNodeId: string) => void;
  readonly updateForEachConfig: (forEachNodeId: string, updates: Partial<{ each: string; in: string; max_parallelism: number; batch_size: number; on_error: string }>) => void;
  readonly getGraphModel: () => WorkflowGraphModel;
  readonly selectAll: () => void;
  readonly toggleNodeDisabled: (nodeId: string) => void;
  readonly wrapInTryCatch: (nodeId: string) => void;
  readonly copySelection: () => void;
  readonly pasteAtCenter: () => void;
  readonly cutSelection: () => void;
  readonly hasClipboard: boolean;
  readonly duplicateSelection: () => void;
  readonly disableSelection: () => void;
  readonly deleteSelection: () => void;
  readonly getSelectedNodeIds: () => ReadonlySet<string>;
}

/**
 * Orchestrator hook for the workflow canvas editor.
 *
 * Manages the {@link WorkflowGraphModel} through a command/history pipeline
 * (AD-T15-B2-001). Structural mutations (add/delete nodes and edges) go
 * through {@link GraphCommand}s dispatched to the history. React Flow state
 * is derived from the model after each mutation.
 *
 * @param yaml - The workflow YAML to initialize from. Changes trigger re-parse.
 * @param containerRef - Ref to the canvas container for keyboard shortcut scoping.
 * @param options - Optional configuration including a custom layout engine.
 *
 * @since T15 (Visual Canvas Editor)
 */
export function useWorkflowCanvas(
  yaml: string | null,
  containerRef: RefObject<HTMLDivElement | null>,
  options?: UseWorkflowCanvasOptions,
): UseWorkflowCanvasReturn {
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const initialModelRef = useRef<WorkflowGraphModel | null>(null);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState([] as Edge[]);
  const { screenToFlowPosition } = useReactFlow();

  // Parse YAML into the initial graph model
  const parsedModel = useMemo<WorkflowGraphModel | null>(() => {
    if (!yaml?.trim()) return null;
    try {
      const parsed = yamlToGraph(yaml);
      return applyDagreLayout(parsed);
    } catch (e) {
      return null;
    }
  }, [yaml]);

  // Set up graph history with the parsed model
  const history = useGraphHistory(parsedModel, containerRef);

  // Sync: when YAML changes, reset the history and RF elements
  useEffect(() => {
    if (!yaml?.trim()) {
      setError(null);
      setNodes([]);
      setEdges([]);
      initialModelRef.current = null;
      return;
    }

    try {
      const parsed = yamlToGraph(yaml);
      const laidOut = applyDagreLayout(parsed);
      history.reset(laidOut);
      initialModelRef.current = laidOut;
      setError(null);

      const elements = toReactFlowElements(laidOut);
      setNodes(elements.nodes);
      setEdges(elements.edges);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse workflow YAML.");
      setNodes([]);
      setEdges([]);
      initialModelRef.current = null;
    }
  }, [yaml]);

  // Sync React Flow elements whenever the model changes via history
  const syncFromModel = useCallback(
    (model: WorkflowGraphModel) => {
      const elements = toReactFlowElements(model);
      setNodes(elements.nodes);
      setEdges(elements.edges);
    },
    [setNodes, setEdges],
  );

  const dispatch = useCallback(
    (command: GraphCommand) => {
      const next = history.dispatch(command);
      syncFromModel(next);
      return next;
    },
    [history.dispatch, syncFromModel],
  );

  // ---------------------------------------------------------------------------
  // Node position changes (drag) — update the model to stay in sync
  // ---------------------------------------------------------------------------

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      onNodesChangeRaw(changes);
    },
    [onNodesChangeRaw],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      onEdgesChangeRaw(changes);
    },
    [onEdgesChangeRaw],
  );

  // ---------------------------------------------------------------------------
  // Connection validation (AD-T15-B2-004)
  // ---------------------------------------------------------------------------

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      const model = history.currentModel;
      if (!model || !connection.source || !connection.target) return false;

      // No self-connections
      if (connection.source === connection.target) return false;

      // Cannot connect to __start__
      if (connection.target === START_NODE_ID) return false;

      // Cannot connect from __end__
      if (connection.source === END_NODE_ID) return false;

      // No duplicate edges (same source+target+sourceHandle)
      const hasDuplicate = model.edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          (e.sourceHandle ?? null) === (connection.sourceHandle ?? null),
      );
      if (hasDuplicate) return false;

      return true;
    },
    [history.currentModel],
  );

  // ---------------------------------------------------------------------------
  // Connection creation
  // ---------------------------------------------------------------------------

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const model = history.currentModel;
      if (!model) return;

      const sourceNode = model.nodes.find((n) => n.id === connection.source);
      if (!sourceNode) return;

      const kindStr = taskKindToString(sourceNode.kind);
      const isMultiOutput = kindStr === "switch_case" || kindStr === "human_input";

      const newEdge = {
        id: generateEdgeId(),
        source: connection.source,
        target: connection.target,
        ...(connection.sourceHandle && { sourceHandle: connection.sourceHandle }),
      };

      // For single-output nodes, replace existing outgoing edge (from default handle)
      if (!isMultiOutput && !connection.sourceHandle) {
        const existingOutgoing = model.edges.find(
          (e) => e.source === connection.source && !e.sourceHandle,
        );
        if (existingOutgoing) {
          dispatch(
            new CompoundCommand("Replace connection", [
              new DeleteEdgeCommand(existingOutgoing.id),
              new AddEdgeCommand(newEdge),
            ]),
          );
          return;
        }
      }

      dispatch(new AddEdgeCommand(newEdge));
    },
    [history.currentModel, dispatch],
  );

  // ---------------------------------------------------------------------------
  // Drop handler (drag-to-create from palette)
  // ---------------------------------------------------------------------------

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kindString = event.dataTransfer.getData(TASK_KIND_DRAG_MIME);
      if (!kindString) return;

      const model = history.currentModel;

      const kind = stringToTaskKind(kindString);
      const category = categorizeKind(kindString);

      const existingNames = new Set(model.nodes.map((n) => n.taskName));
      const taskName = generateTaskName(kindString, existingNames);

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const node = createTaskNode(taskName, kind, kindString, category, position);

      // If the graph has no nodes at all (first drop on empty canvas),
      // bootstrap the model with sentinel nodes before adding the task.
      const taskNodes = model.nodes.filter((n) => !isSentinelNode(n.id));
      if (model.nodes.length === 0) {
        const startNode: WorkflowGraphNode = {
          id: START_NODE_ID,
          taskName: "Start",
          kind: 0 as WorkflowTaskKind,
          category: "start",
          config: {} as JsonObject,
          position: { x: 0, y: 0 },
        };
        const endNode: WorkflowGraphNode = {
          id: END_NODE_ID,
          taskName: "End",
          kind: 0 as WorkflowTaskKind,
          category: "end",
          config: {} as JsonObject,
          position: { x: 0, y: 0 },
        };
        const bootstrapModel: WorkflowGraphModel = {
          document: { dsl: "1.0.0", namespace: "", name: "", version: "0.0.1" },
          nodes: [startNode, endNode],
          edges: [],
        };
        history.reset(bootstrapModel);
        initialModelRef.current = bootstrapModel;

        const autoEdge = {
          id: generateEdgeId(),
          source: START_NODE_ID,
          target: taskName,
        };
        const next = dispatch(new AddNodeCommand(node, autoEdge));

        // AD-T03-006: removed rAF→dagre→history.reset() pattern.
        // The node is already positioned at the drop coordinates.
        // Users trigger auto-layout explicitly when they want a clean graph.
      } else if (taskNodes.length === 0) {
        const autoEdge = {
          id: generateEdgeId(),
          source: START_NODE_ID,
          target: taskName,
        };
        dispatch(new AddNodeCommand(node, autoEdge));
      } else {
        dispatch(new AddNodeCommand(node, null));
      }
    },
    [history, dispatch, syncFromModel, screenToFlowPosition],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  // ---------------------------------------------------------------------------
  // Deletion
  // ---------------------------------------------------------------------------

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const nonSentinels = deleted.filter((n) => !isSentinelNode(n.id));
      if (nonSentinels.length === 0) return;

      if (nonSentinels.length === 1) {
        const n = nonSentinels[0];
        dispatch(new DeleteNodeCommand(n.id, n.data?.taskName as string ?? n.id));
      } else {
        const commands = nonSentinels.map(
          (n) => new DeleteNodeCommand(n.id, n.data?.taskName as string ?? n.id),
        );
        dispatch(new CompoundCommand(`Delete ${nonSentinels.length} tasks`, commands));
      }
    },
    [dispatch],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return;

      if (deleted.length === 1) {
        dispatch(new DeleteEdgeCommand(deleted[0].id));
      } else {
        const commands = deleted.map((e) => new DeleteEdgeCommand(e.id));
        dispatch(new CompoundCommand(`Delete ${deleted.length} connections`, commands));
      }
    },
    [dispatch],
  );

  // ---------------------------------------------------------------------------
  // Task kind registry (for inspector descriptor lookup)
  // ---------------------------------------------------------------------------

  const registry = useTaskKindRegistry();

  // ---------------------------------------------------------------------------
  // Inspector mutation methods (AD-T15-B3-001)
  // ---------------------------------------------------------------------------

  const updateNodeField = useCallback(
    (nodeId: string, fieldPath: string, value: unknown) => {
      const model = history.currentModel;
      if (!model) return;
      const node = model.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      dispatch(new UpdateNodeFieldCommand(nodeId, fieldPath, value, node.taskName));
    },
    [history.currentModel, dispatch],
  );

  const renameNode = useCallback(
    (nodeId: string, newName: string) => {
      const model = history.currentModel;
      if (!model) return;
      const node = model.nodes.find((n) => n.id === nodeId);
      if (!node || node.taskName === newName) return;
      dispatch(new RenameNodeCommand(node.taskName, newName));
      setSelection({ type: "node", id: newName });
    },
    [history.currentModel, dispatch],
  );

  const updateNodeExport = useCallback(
    (nodeId: string, exportAs: string | undefined) => {
      const model = history.currentModel;
      if (!model) return;
      const node = model.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      dispatch(new UpdateNodeMetaCommand(nodeId, "export", exportAs, node.taskName));
    },
    [history.currentModel, dispatch],
  );

  const updateNodeFlow = useCallback(
    (nodeId: string, thenTarget: string | undefined) => {
      const model = history.currentModel;
      if (!model) return;
      const node = model.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      dispatch(new UpdateNodeMetaCommand(nodeId, "flow", thenTarget, node.taskName));
    },
    [history.currentModel, dispatch],
  );

  const getNodeDescriptor = useCallback(
    (nodeId: string): TaskKindDescriptor | undefined => {
      const model = history.currentModel;
      if (!model) return undefined;
      const node = model.nodes.find((n) => n.id === nodeId);
      if (!node) return undefined;
      const kindStr = taskKindToString(node.kind);
      return registry.getByKind(kindStr);
    },
    [history.currentModel, registry.getByKind],
  );

  // ---------------------------------------------------------------------------
  // Branch routing methods (AD-T15-B4: edge-config sync for switch_case/human_input)
  // ---------------------------------------------------------------------------

  const updateBranchRouting = useCallback(
    (nodeId: string, handleId: string, targetTask: string | undefined) => {
      const model = history.currentModel;
      if (!model) return;

      const existingEdge = model.edges.find(
        (e) => e.source === nodeId && e.sourceHandle === handleId,
      );

      if (!targetTask) {
        if (existingEdge) {
          dispatch(new DeleteEdgeCommand(existingEdge.id));
        }
        return;
      }

      if (existingEdge) {
        if (existingEdge.target === targetTask) return;
        const label = handleId.includes("_") ? handleId.split("_").slice(1).join("_") : undefined;
        dispatch(
          new CompoundCommand(`Route ${handleId} to ${targetTask}`, [
            new DeleteEdgeCommand(existingEdge.id),
            new AddEdgeCommand({
              id: generateEdgeId(),
              source: nodeId,
              target: targetTask,
              sourceHandle: handleId,
              label,
            }),
          ]),
        );
      } else {
        const label = handleId.includes("_") ? handleId.split("_").slice(1).join("_") : undefined;
        dispatch(
          new AddEdgeCommand({
            id: generateEdgeId(),
            source: nodeId,
            target: targetTask,
            sourceHandle: handleId,
            label,
          }),
        );
      }
    },
    [history.currentModel, dispatch],
  );

  const migrateBranchHandle = useCallback(
    (nodeId: string, oldHandleId: string, newHandleId: string) => {
      if (oldHandleId === newHandleId) return;
      dispatch(new MigrateBranchHandleCommand(nodeId, oldHandleId, newHandleId));
    },
    [dispatch],
  );

  const removeBranchEdges = useCallback(
    (nodeId: string, handleId: string) => {
      const model = history.currentModel;
      if (!model) return;

      const edgesToRemove = model.edges.filter(
        (e) => e.source === nodeId && e.sourceHandle === handleId,
      );
      if (edgesToRemove.length === 0) return;

      if (edgesToRemove.length === 1) {
        dispatch(new DeleteEdgeCommand(edgesToRemove[0].id));
      } else {
        dispatch(
          new CompoundCommand(
            `Remove ${edgesToRemove.length} branch edges`,
            edgesToRemove.map((e) => new DeleteEdgeCommand(e.id)),
          ),
        );
      }
    },
    [history.currentModel, dispatch],
  );

  // ---------------------------------------------------------------------------
  // Insert task on edge (AD-T15-UX: "+" button affordance)
  // ---------------------------------------------------------------------------

  const insertTaskOnEdge = useCallback(
    (edgeId: string, kindString: string) => {
      const model = history.currentModel;
      if (!model) return;

      const edge = model.edges.find((e) => e.id === edgeId);
      if (!edge) return;

      const sourceNode = model.nodes.find((n) => n.id === edge.source);
      const targetNode = model.nodes.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) return;

      const kind = stringToTaskKind(kindString);
      const category = categorizeKind(kindString);
      const existingNames = new Set(model.nodes.map((n) => n.taskName));
      const taskName = generateTaskName(kindString, existingNames);

      const midPosition = {
        x: (sourceNode.position.x + targetNode.position.x) / 2,
        y: (sourceNode.position.y + targetNode.position.y) / 2 + 40,
      };

      const node = createTaskNode(taskName, kind, kindString, category, midPosition);
      const edgeToNew = {
        id: generateEdgeId(),
        source: edge.source,
        target: taskName,
        ...(edge.sourceHandle && { sourceHandle: edge.sourceHandle }),
      };
      const edgeFromNew = {
        id: generateEdgeId(),
        source: taskName,
        target: edge.target,
      };

      const next = dispatch(
        new CompoundCommand(`Insert ${kindString} on edge`, [
          new DeleteEdgeCommand(edgeId),
          new AddNodeCommand(node, edgeToNew),
          new AddEdgeCommand(edgeFromNew),
        ]),
      );

      setSelection({ type: "node", id: taskName });
    },
    [history, dispatch, syncFromModel],
  );

  // ---------------------------------------------------------------------------
  // Add successor task (AD-T01: "+" button on node)
  // ---------------------------------------------------------------------------

  const addSuccessorTask = useCallback(
    (sourceNodeId: string, kindString: string) => {
      const model = history.currentModel;
      if (!model) return;

      const sourceNode = model.nodes.find((n) => n.id === sourceNodeId);
      if (!sourceNode) return;

      const kind = stringToTaskKind(kindString);
      const category = categorizeKind(kindString);
      const existingNames = new Set(model.nodes.map((n) => n.taskName));
      const taskName = generateTaskName(kindString, existingNames);

      const position = {
        x: sourceNode.position.x,
        y: sourceNode.position.y + CANVAS_NODE_HEIGHT + DAGRE_CONFIG.ranksep,
      };

      const node = createTaskNode(taskName, kind, kindString, category, position);

      const existingEdgeToEnd = model.edges.find(
        (edge) => edge.source === sourceNodeId && edge.target === END_NODE_ID,
      );

      const commands: GraphCommand[] = [new AddNodeCommand(node, null)];

      if (existingEdgeToEnd) {
        // splice before end: source -> new -> __end__
        commands.unshift(new DeleteEdgeCommand(existingEdgeToEnd.id));
        commands.push(
          new AddEdgeCommand({
            id: generateEdgeId(),
            source: sourceNodeId,
            target: taskName,
            ...(existingEdgeToEnd.sourceHandle && {
              sourceHandle: existingEdgeToEnd.sourceHandle,
            }),
          }),
        );
        commands.push(
          new AddEdgeCommand({
            id: generateEdgeId(),
            source: taskName,
            target: END_NODE_ID,
          }),
        );
      } else {
        // standard append
        commands.push(
          new AddEdgeCommand({
            id: generateEdgeId(),
            source: sourceNodeId,
            target: taskName,
          }),
        );
      }

      dispatch(
        new CompoundCommand(`Add ${kindString} after "${sourceNode.taskName}"`, commands),
      );

      setSelection({ type: "node", id: taskName });
    },
    [history, dispatch, syncFromModel],
  );

  // ---------------------------------------------------------------------------
  // Duplicate node (AD-T05: context menu duplicate)
  // ---------------------------------------------------------------------------

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const model = history.currentModel;
      if (!model) return;

      const sourceNode = model.nodes.find((n) => n.id === nodeId);
      if (!sourceNode || isSentinelNode(nodeId)) return;

      const kindStr = taskKindToString(sourceNode.kind);
      const existingNames = new Set(model.nodes.map((n) => n.taskName));
      const newName = generateTaskName(kindStr, existingNames);

      dispatch(new DuplicateNodeCommand(nodeId, newName));
      setSelection({ type: "node", id: newName });
    },
    [history.currentModel, dispatch],
  );

  // ---------------------------------------------------------------------------
  // Toggle node disabled (T10: Inspector actions)
  // ---------------------------------------------------------------------------

  const toggleNodeDisabled = useCallback(
    (nodeId: string) => {
      const model = history.currentModel;
      if (!model) return;
      const node = model.nodes.find((n) => n.id === nodeId);
      if (!node || isSentinelNode(nodeId)) return;
      dispatch(new ToggleNodeDisabledCommand(nodeId, node.taskName));
    },
    [history.currentModel, dispatch],
  );

  // ---------------------------------------------------------------------------
  // Wrap in try/catch (T10: Inspector actions)
  // ---------------------------------------------------------------------------

  const wrapInTryCatch = useCallback(
    (nodeId: string) => {
      const model = history.currentModel;
      if (!model) return;
      const node = model.nodes.find((n) => n.id === nodeId);
      if (!node || isSentinelNode(nodeId)) return;

      const existingNames = new Set(model.nodes.map((n) => n.taskName));
      const tryCatchName = generateTaskName("try_catch", existingNames);

      dispatch(new WrapInTryCatchCommand(nodeId, node.taskName, tryCatchName));
      setSelection({ type: "node", id: tryCatchName });
    },
    [history.currentModel, dispatch],
  );

  // ---------------------------------------------------------------------------
  // Add node at position (AD-T05: pane context menu "Add Task")
  // ---------------------------------------------------------------------------

  const addNodeAtPosition = useCallback(
    (kindString: string, position: { x: number; y: number }) => {
      const model = history.currentModel;
      if (!model) return;

      const kind = stringToTaskKind(kindString);
      const category = categorizeKind(kindString);
      const existingNames = new Set(model.nodes.map((n) => n.taskName));
      const taskName = generateTaskName(kindString, existingNames);

      const node = createTaskNode(taskName, kind, kindString, category, position);
      dispatch(new AddNodeCommand(node, null));
      setSelection({ type: "node", id: taskName });
    },
    [history.currentModel, dispatch],
  );

  // ---------------------------------------------------------------------------
  // Branch-specific insertion (T08)
  // ---------------------------------------------------------------------------

  const addSwitchCase = useCallback(
    (switchNodeId: string, caseName: string, condition: string) => {
      dispatch(new AddSwitchCaseCommand(switchNodeId, caseName, condition));
    },
    [dispatch],
  );

  const addForkBranch = useCallback(
    (forkNodeId: string, branchName: string) => {
      dispatch(new AddParallelBranchCommand(forkNodeId, branchName));
    },
    [dispatch],
  );

  const addCatchHandler = useCallback(
    (tryCatchNodeId: string, errorType: string) => {
      dispatch(new AddCatchHandlerCommand(tryCatchNodeId, errorType));
    },
    [dispatch],
  );

  // ---------------------------------------------------------------------------
  // Branch management (T09)
  // ---------------------------------------------------------------------------

  const removeSwitchCase = useCallback(
    (switchNodeId: string, caseName: string) => {
      dispatch(new RemoveSwitchCaseCommand(switchNodeId, caseName));
    },
    [dispatch],
  );

  const reorderSwitchCases = useCallback(
    (switchNodeId: string, newOrder: readonly string[]) => {
      dispatch(new ReorderSwitchCasesCommand(switchNodeId, newOrder));
    },
    [dispatch],
  );

  const removeForkBranch = useCallback(
    (forkNodeId: string, branchName: string) => {
      dispatch(new RemoveForkBranchCommand(forkNodeId, branchName));
    },
    [dispatch],
  );

  const reorderForkBranches = useCallback(
    (forkNodeId: string, newOrder: readonly string[]) => {
      dispatch(new ReorderForkBranchesCommand(forkNodeId, newOrder));
    },
    [dispatch],
  );

  const renameForkBranch = useCallback(
    (forkNodeId: string, oldName: string, newName: string) => {
      dispatch(new RenameForkBranchCommand(forkNodeId, oldName, newName));
    },
    [dispatch],
  );

  const setForkCompete = useCallback(
    (forkNodeId: string, compete: boolean) => {
      dispatch(new SetForkCompeteCommand(forkNodeId, compete));
    },
    [dispatch],
  );

  const updateCatchConfig = useCallback(
    (tryCatchNodeId: string, updates: { as?: string; compensate?: boolean }) => {
      dispatch(new UpdateCatchConfigCommand(tryCatchNodeId, updates));
    },
    [dispatch],
  );

  const removeCatchBlock = useCallback(
    (tryCatchNodeId: string) => {
      dispatch(new RemoveCatchBlockCommand(tryCatchNodeId));
    },
    [dispatch],
  );

  const updateForEachConfig = useCallback(
    (forEachNodeId: string, updates: Partial<{ each: string; in: string; max_parallelism: number; batch_size: number; on_error: string }>) => {
      dispatch(new UpdateForEachConfigCommand(forEachNodeId, updates));
    },
    [dispatch],
  );

  const getGraphModel = useCallback(() => history.currentModel, [history.currentModel]);

  // ---------------------------------------------------------------------------
  // Select all (AD-T05: pane context menu "Select All")
  // ---------------------------------------------------------------------------

  const selectAll = useCallback(() => {
    const model = history.currentModel;
    if (!model) return;

    const selectableNodes = model.nodes
      .filter((n) => !isSentinelNode(n.id))
      .map((n) => ({ id: n.id, type: "select" as const, selected: true }));

    if (selectableNodes.length > 0) {
      onNodesChangeRaw(selectableNodes);
    }
  }, [history.currentModel, onNodesChangeRaw]);

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const selectNode = useCallback((id: string) => {
    setSelection({ type: "node", id });
  }, []);

  const selectEdge = useCallback((id: string) => {
    setSelection({ type: "edge", id });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-layout (AD-T03-002: dispatches MoveNodesCommand for undo support)
  // ---------------------------------------------------------------------------

  const { layoutGraph, isLayouting } = useWorkflowLayout({
    engine: options?.layoutEngine ?? undefined,
    getNodeDimensions: registryNodeDimensions,
  });

  const autoLayout = useCallback(async () => {
    const model = history.currentModel;
    if (!model || model.nodes.length === 0) return;

    const oldPositions = model.nodes.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
    }));

    const result = await layoutGraph(model, { type: "whole-graph" });
    if (!result) return;

    const newPositions = model.nodes.map((n) => {
      const pos = result.positions.get(n.id);
      return {
        id: n.id,
        x: pos?.x ?? n.position.x,
        y: pos?.y ?? n.position.y,
      };
    });

    const hasChanges = newPositions.some((np) => {
      const op = oldPositions.find((o) => o.id === np.id);
      return op && (Math.abs(op.x - np.x) > 0.5 || Math.abs(op.y - np.y) > 0.5);
    });

    if (hasChanges) {
      dispatch(new MoveNodesCommand(oldPositions, newPositions));
    }
  }, [history, dispatch, layoutGraph]);

  // ---------------------------------------------------------------------------
  // Clipboard (T11: internal copy/paste)
  // ---------------------------------------------------------------------------

  const clipboardRef = useRef<ClipboardEntry | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);

  const getSelectedNodeIds = useCallback((): ReadonlySet<string> => {
    const selected = new Set<string>();
    for (const n of nodes) {
      if (n.selected && !isSentinelNode(n.id)) {
        selected.add(n.id);
      }
    }
    if (selected.size === 0 && selection?.type === "node" && !isSentinelNode(selection.id)) {
      selected.add(selection.id);
    }
    return selected;
  }, [nodes, selection]);

  const copySelection = useCallback(() => {
    const model = history.currentModel;
    if (!model) return;
    const selectedIds = getSelectedNodeIds();
    if (selectedIds.size === 0) return;
    const entry = serializeSelection(model, selectedIds);
    if (entry) {
      clipboardRef.current = entry;
      setHasClipboard(true);
    }
  }, [history.currentModel, getSelectedNodeIds]);

  const pasteAtCenter = useCallback(() => {
    const entry = clipboardRef.current;
    const model = history.currentModel;
    if (!entry || !model) return;
    const result = pasteClipboard(entry, model);
    if (!result) return;
    dispatch(result.command);
    if (result.newNodeIds.length > 0) {
      setSelection({ type: "node", id: result.newNodeIds[0] });
    }
  }, [history.currentModel, dispatch]);

  const cutSelection = useCallback(() => {
    copySelection();
    const selectedIds = getSelectedNodeIds();
    if (selectedIds.size === 0) return;
    const toDelete = nodes.filter((n) => selectedIds.has(n.id));
    if (toDelete.length > 0) {
      onNodesDelete(toDelete);
    }
  }, [copySelection, getSelectedNodeIds, nodes, onNodesDelete]);

  // ---------------------------------------------------------------------------
  // Batch operations for multi-selection (T11)
  // ---------------------------------------------------------------------------

  const duplicateSelection = useCallback(() => {
    const model = history.currentModel;
    if (!model) return;
    const selectedIds = getSelectedNodeIds();
    if (selectedIds.size === 0) return;

    const existingNames = new Set(model.nodes.map((n) => n.taskName));
    const commands: GraphCommand[] = [];
    for (const nodeId of selectedIds) {
      const sourceNode = model.nodes.find((n) => n.id === nodeId);
      if (!sourceNode) continue;
      const kindStr = taskKindToString(sourceNode.kind);
      const newName = generateTaskName(kindStr, existingNames);
      existingNames.add(newName);
      commands.push(new DuplicateNodeCommand(nodeId, newName));
    }
    if (commands.length > 0) {
      dispatch(new CompoundCommand(`Duplicate ${commands.length} tasks`, commands));
    }
  }, [history.currentModel, getSelectedNodeIds, dispatch]);

  const disableSelection = useCallback(() => {
    const model = history.currentModel;
    if (!model) return;
    const selectedIds = getSelectedNodeIds();
    if (selectedIds.size === 0) return;

    const commands: GraphCommand[] = [];
    for (const nodeId of selectedIds) {
      const node = model.nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      commands.push(new ToggleNodeDisabledCommand(nodeId, node.taskName));
    }
    if (commands.length > 0) {
      dispatch(new CompoundCommand(`Toggle disabled on ${commands.length} tasks`, commands));
    }
  }, [history.currentModel, getSelectedNodeIds, dispatch]);

  const deleteSelection = useCallback(() => {
    const selectedIds = getSelectedNodeIds();
    if (selectedIds.size === 0) return;
    const toDelete = nodes.filter((n) => selectedIds.has(n.id));
    if (toDelete.length > 0) {
      onNodesDelete(toDelete);
    }
  }, [getSelectedNodeIds, nodes, onNodesDelete]);

  // ---------------------------------------------------------------------------
  // Undo / Redo (delegates to history, then syncs RF)
  // ---------------------------------------------------------------------------

  const undo = useCallback(() => {
    history.undo();
    syncFromModel(history.currentModel);
  }, [history, syncFromModel]);

  const redo = useCallback(() => {
    history.redo();
    syncFromModel(history.currentModel);
  }, [history, syncFromModel]);

  // ---------------------------------------------------------------------------
  // Dirty tracking: model reference comparison
  // ---------------------------------------------------------------------------

  const graph = history.currentModel.nodes.length > 0 ? history.currentModel : null;
  const isDirty = initialModelRef.current !== null && graph !== initialModelRef.current;

  const serializeToYaml = useCallback((): string | null => {
    if (!graph) return null;
    try {
      return graphToYaml(graph);
    } catch {
      return null;
    }
  }, [graph]);

  return useMemo(
    () => ({
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      onConnect,
      isValidConnection,
      onDrop,
      onDragOver,
      onNodesDelete,
      onEdgesDelete,
      selection,
      selectNode,
      selectEdge,
      clearSelection,
      autoLayout,
      undo,
      redo,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      isDirty,
      graph,
      error,
      updateNodeField,
      renameNode,
      updateNodeExport,
      updateNodeFlow,
      getNodeDescriptor,
      serializeToYaml,
      updateBranchRouting,
      migrateBranchHandle,
      removeBranchEdges,
      insertTaskOnEdge,
      addSuccessorTask,
      duplicateNode,
      addNodeAtPosition,
      addSwitchCase,
      addForkBranch,
      addCatchHandler,
      removeSwitchCase,
      reorderSwitchCases,
      removeForkBranch,
      reorderForkBranches,
      renameForkBranch,
      setForkCompete,
      updateCatchConfig,
      removeCatchBlock,
      updateForEachConfig,
      getGraphModel,
      selectAll,
      toggleNodeDisabled,
      wrapInTryCatch,
      copySelection,
      pasteAtCenter,
      cutSelection,
      hasClipboard,
      duplicateSelection,
      disableSelection,
      deleteSelection,
      getSelectedNodeIds,
    }),
    [
      nodes, edges, onNodesChange, onEdgesChange, onConnect,
      isValidConnection, onDrop, onDragOver, onNodesDelete, onEdgesDelete,
      selection, selectNode, selectEdge, clearSelection, autoLayout,
      undo, redo, history.canUndo, history.canRedo, isDirty, graph, error,
      updateNodeField, renameNode, updateNodeExport, updateNodeFlow,
      getNodeDescriptor, serializeToYaml,
      updateBranchRouting, migrateBranchHandle, removeBranchEdges,
      insertTaskOnEdge, addSuccessorTask,
      duplicateNode, addNodeAtPosition,
      addSwitchCase, addForkBranch, addCatchHandler,
      removeSwitchCase, reorderSwitchCases,
      removeForkBranch, reorderForkBranches, renameForkBranch, setForkCompete,
      updateCatchConfig, removeCatchBlock, updateForEachConfig,
      getGraphModel,
      selectAll, toggleNodeDisabled, wrapInTryCatch,
      copySelection, pasteAtCenter, cutSelection, hasClipboard,
      duplicateSelection, disableSelection, deleteSelection, getSelectedNodeIds,
    ],
  );
}

// ---------------------------------------------------------------------------
// Synchronous dagre layout — delegated to shared utility (T04 extraction)
// ---------------------------------------------------------------------------
