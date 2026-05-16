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
import dagre from "@dagrejs/dagre";
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
  CANVAS_NODE_WIDTH,
  CANVAS_NODE_HEIGHT,
  SENTINEL_NODE_WIDTH,
  SENTINEL_NODE_HEIGHT,
} from "./canvas-constants";
import type { GraphCommand } from "./graph-commands";
import {
  AddNodeCommand,
  DeleteNodeCommand,
  AddEdgeCommand,
  DeleteEdgeCommand,
  CompoundCommand,
  UpdateNodeFieldCommand,
  RenameNodeCommand,
  UpdateNodeMetaCommand,
  MigrateBranchHandleCommand,
  generateEdgeId,
  generateTaskName,
  createTaskNode,
  isSentinelNode,
} from "./graph-commands";
import { graphToYaml } from "./workflow-graph-conversions";
import { useTaskKindRegistry } from "./useTaskKindRegistry";
import type { TaskKindDescriptor } from "./types";
import { useGraphHistory } from "./useGraphHistory";

/** Selection state for the canvas inspector. */
export interface CanvasSelection {
  readonly type: "node" | "edge";
  readonly id: string;
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
 *
 * @since T15 (Visual Canvas Editor)
 */
export function useWorkflowCanvas(
  yaml: string | null,
  containerRef: RefObject<HTMLDivElement | null>,
): UseWorkflowCanvasReturn {
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const initialModelRef = useRef<WorkflowGraphModel | null>(null);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState([] as Edge[]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on yaml change
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
      if (!model) return;

      const kind = stringToTaskKind(kindString);
      const category = categorizeKind(kindString);

      const existingNames = new Set(model.nodes.map((n) => n.taskName));
      const taskName = generateTaskName(kindString, existingNames);

      // Convert screen coordinates to flow coordinates
      const reactFlowBounds = (event.target as HTMLElement)
        .closest(".react-flow")
        ?.getBoundingClientRect();
      const position = reactFlowBounds
        ? {
            x: event.clientX - reactFlowBounds.left,
            y: event.clientY - reactFlowBounds.top,
          }
        : { x: event.clientX, y: event.clientY };

      const node = createTaskNode(taskName, kind, kindString, category, position);

      // If no task nodes exist yet, also wire __start__ -> new node
      const taskNodes = model.nodes.filter((n) => !isSentinelNode(n.id));
      if (taskNodes.length === 0) {
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
    [history.currentModel, dispatch],
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

      dispatch(
        new CompoundCommand(`Insert ${kindString} on edge`, [
          new DeleteEdgeCommand(edgeId),
          new AddNodeCommand(node, edgeToNew),
          new AddEdgeCommand(edgeFromNew),
        ]),
      );

      setSelection({ type: "node", id: taskName });

      requestAnimationFrame(() => {
        const currentModel = history.currentModel;
        if (currentModel.nodes.length > 0) {
          const laidOut = applyDagreLayout(currentModel);
          history.reset(laidOut);
          syncFromModel(laidOut);
        }
      });
    },
    [history, dispatch, syncFromModel],
  );

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
  // Auto-layout
  // ---------------------------------------------------------------------------

  const autoLayout = useCallback(() => {
    const model = history.currentModel;
    if (!model || model.nodes.length === 0) return;
    const laidOut = applyDagreLayout(model);
    history.reset(laidOut);
    syncFromModel(laidOut);
  }, [history, syncFromModel]);

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
    }),
    [
      nodes, edges, onNodesChange, onEdgesChange, onConnect,
      isValidConnection, onDrop, onDragOver, onNodesDelete, onEdgesDelete,
      selection, selectNode, selectEdge, clearSelection, autoLayout,
      undo, redo, history.canUndo, history.canRedo, isDirty, graph, error,
      updateNodeField, renameNode, updateNodeExport, updateNodeFlow,
      getNodeDescriptor, serializeToYaml,
      updateBranchRouting, migrateBranchHandle, removeBranchEdges,
      insertTaskOnEdge,
    ],
  );
}

// ---------------------------------------------------------------------------
// Dagre layout
// ---------------------------------------------------------------------------

function applyDagreLayout(graph: WorkflowGraphModel): WorkflowGraphModel {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: DAGRE_CONFIG.rankdir,
    ranksep: DAGRE_CONFIG.ranksep,
    nodesep: DAGRE_CONFIG.nodesep,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
    g.setNode(node.id, {
      width: isSentinel ? SENTINEL_NODE_WIDTH : CANVAS_NODE_WIDTH,
      height: isSentinel ? SENTINEL_NODE_HEIGHT : CANVAS_NODE_HEIGHT,
    });
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes: WorkflowGraphNode[] = graph.nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const isSentinel = node.id === START_NODE_ID || node.id === END_NODE_ID;
    const w = isSentinel ? SENTINEL_NODE_WIDTH : CANVAS_NODE_WIDTH;
    const h = isSentinel ? SENTINEL_NODE_HEIGHT : CANVAS_NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: (dagreNode?.x ?? 0) - w / 2,
        y: (dagreNode?.y ?? 0) - h / 2,
      },
    };
  });

  return { ...graph, nodes: layoutNodes };
}
