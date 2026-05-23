import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { TopologyNodeCategory } from "./useWorkflowTopology";
import type {
  WorkflowGraphModel,
  WorkflowGraphNode,
  WorkflowGraphEdge,
} from "./workflow-graph-model";
import { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model";

// ---------------------------------------------------------------------------
// GraphCommand interface
// ---------------------------------------------------------------------------

/**
 * A reversible mutation on a {@link WorkflowGraphModel}.
 *
 * Commands are the only way to mutate the graph in canvas mode.
 * Each command knows how to apply itself and how to undo itself,
 * enabling a full undo/redo stack without storing model snapshots.
 */
export interface GraphCommand {
  readonly type: string;
  readonly description: string;
  apply(model: WorkflowGraphModel): WorkflowGraphModel;
  undo(model: WorkflowGraphModel): WorkflowGraphModel;
}

// ---------------------------------------------------------------------------
// AddNodeCommand
// ---------------------------------------------------------------------------

export class AddNodeCommand implements GraphCommand {
  readonly type = "add_node";
  readonly description: string;
  private readonly node: WorkflowGraphNode;
  private readonly autoEdge: WorkflowGraphEdge | null;

  /**
   * @param node The node to add.
   * @param autoEdge Optional edge to create alongside the node
   *   (e.g. __start__ -> first task on an empty canvas).
   */
  constructor(node: WorkflowGraphNode, autoEdge: WorkflowGraphEdge | null = null) {
    this.node = node;
    this.autoEdge = autoEdge;
    this.description = `Add task "${node.taskName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = [...model.nodes, this.node];
    const edges = this.autoEdge ? [...model.edges, this.autoEdge] : [...model.edges];
    return { ...model, nodes, edges };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.filter((n) => n.id !== this.node.id);
    const edgeIdsToRemove = new Set<string>([
      ...(this.autoEdge ? [this.autoEdge.id] : []),
    ]);
    const edges = edgeIdsToRemove.size > 0
      ? model.edges.filter((e) => !edgeIdsToRemove.has(e.id))
      : [...model.edges];
    return { ...model, nodes, edges };
  }
}

// ---------------------------------------------------------------------------
// DeleteNodeCommand
// ---------------------------------------------------------------------------

export class DeleteNodeCommand implements GraphCommand {
  readonly type = "delete_node";
  readonly description: string;
  private readonly nodeId: string;
  private removedNode: WorkflowGraphNode | null = null;
  private removedEdges: WorkflowGraphEdge[] = [];

  constructor(nodeId: string, taskName: string) {
    this.nodeId = nodeId;
    this.description = `Delete task "${taskName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    this.removedNode = model.nodes.find((n) => n.id === this.nodeId) ?? null;
    this.removedEdges = model.edges.filter(
      (e) => e.source === this.nodeId || e.target === this.nodeId,
    );

    const nodes = model.nodes.filter((n) => n.id !== this.nodeId);
    const removedEdgeIds = new Set(this.removedEdges.map((e) => e.id));
    const edges = model.edges.filter((e) => !removedEdgeIds.has(e.id));

    return { ...model, nodes, edges };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    if (!this.removedNode) return model;
    const nodes = [...model.nodes, this.removedNode];
    const edges = [...model.edges, ...this.removedEdges];
    return { ...model, nodes, edges };
  }
}

// ---------------------------------------------------------------------------
// AddEdgeCommand
// ---------------------------------------------------------------------------

export class AddEdgeCommand implements GraphCommand {
  readonly type = "add_edge";
  readonly description: string;
  private readonly edge: WorkflowGraphEdge;

  constructor(edge: WorkflowGraphEdge) {
    this.edge = edge;
    this.description = `Connect "${edge.source}" → "${edge.target}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    return { ...model, edges: [...model.edges, this.edge] };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    return { ...model, edges: model.edges.filter((e) => e.id !== this.edge.id) };
  }
}

// ---------------------------------------------------------------------------
// DeleteEdgeCommand
// ---------------------------------------------------------------------------

export class DeleteEdgeCommand implements GraphCommand {
  readonly type = "delete_edge";
  readonly description: string;
  private readonly edgeId: string;
  private removedEdge: WorkflowGraphEdge | null = null;

  constructor(edgeId: string) {
    this.edgeId = edgeId;
    this.description = `Delete connection`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    this.removedEdge = model.edges.find((e) => e.id === this.edgeId) ?? null;
    return { ...model, edges: model.edges.filter((e) => e.id !== this.edgeId) };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    if (!this.removedEdge) return model;
    return { ...model, edges: [...model.edges, this.removedEdge] };
  }
}

// ---------------------------------------------------------------------------
// MoveNodesCommand
// ---------------------------------------------------------------------------

interface NodePosition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export class MoveNodesCommand implements GraphCommand {
  readonly type = "move_nodes";
  readonly description: string;
  private readonly oldPositions: readonly NodePosition[];
  private readonly newPositions: readonly NodePosition[];

  constructor(oldPositions: readonly NodePosition[], newPositions: readonly NodePosition[]) {
    this.oldPositions = oldPositions;
    this.newPositions = newPositions;
    this.description = oldPositions.length === 1
      ? `Move task`
      : `Move ${oldPositions.length} tasks`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    return applyPositions(model, this.newPositions);
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    return applyPositions(model, this.oldPositions);
  }
}

function applyPositions(
  model: WorkflowGraphModel,
  positions: readonly NodePosition[],
): WorkflowGraphModel {
  const posMap = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
  const nodes = model.nodes.map((n) => {
    const pos = posMap.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
  return { ...model, nodes };
}

// ---------------------------------------------------------------------------
// CompoundCommand
// ---------------------------------------------------------------------------

/**
 * Groups multiple commands into a single undo/redo unit.
 *
 * Applied in order, undone in reverse order.
 */
export class CompoundCommand implements GraphCommand {
  readonly type = "compound";
  readonly description: string;
  private readonly commands: readonly GraphCommand[];

  constructor(description: string, commands: readonly GraphCommand[]) {
    this.description = description;
    this.commands = commands;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    let current = model;
    for (const cmd of this.commands) {
      current = cmd.apply(current);
    }
    return current;
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    let current = model;
    for (let i = this.commands.length - 1; i >= 0; i--) {
      current = this.commands[i].undo(current);
    }
    return current;
  }
}

// ---------------------------------------------------------------------------
// UpdateNodeFieldCommand
// ---------------------------------------------------------------------------

/**
 * Updates a single field path within a node's `config` object.
 *
 * Stores the previous value at that path for precise undo.
 * Supports dot-separated paths for nested fields (e.g., "response_schema.type").
 */
export class UpdateNodeFieldCommand implements GraphCommand {
  readonly type = "update_node_field";
  readonly description: string;
  private readonly nodeId: string;
  private readonly fieldPath: string;
  private readonly newValue: unknown;
  private oldValue: unknown = undefined;

  constructor(nodeId: string, fieldPath: string, newValue: unknown, taskName: string) {
    this.nodeId = nodeId;
    this.fieldPath = fieldPath;
    this.newValue = newValue;
    this.description = `Update "${taskName}" field "${fieldPath}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const node = model.nodes.find((n) => n.id === this.nodeId);
    if (!node) return model;

    this.oldValue = getNestedValue(node.config as Record<string, unknown>, this.fieldPath);
    const newConfig = setNestedValue(
      node.config as Record<string, unknown>,
      this.fieldPath,
      this.newValue,
    ) as JsonObject;

    const nodes = model.nodes.map((n) =>
      n.id === this.nodeId ? { ...n, config: newConfig } : n,
    );
    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const node = model.nodes.find((n) => n.id === this.nodeId);
    if (!node) return model;

    const restoredConfig = this.oldValue === undefined
      ? deleteNestedValue(node.config as Record<string, unknown>, this.fieldPath) as JsonObject
      : setNestedValue(node.config as Record<string, unknown>, this.fieldPath, this.oldValue) as JsonObject;

    const nodes = model.nodes.map((n) =>
      n.id === this.nodeId ? { ...n, config: restoredConfig } : n,
    );
    return { ...model, nodes };
  }
}

// ---------------------------------------------------------------------------
// RenameNodeCommand
// ---------------------------------------------------------------------------

/**
 * Renames a task node, updating its `id`, `taskName`, and all references
 * in edges (source/target) and other nodes' `flow.then` values.
 *
 * Atomic: undo restores all references to the old name.
 */
export class RenameNodeCommand implements GraphCommand {
  readonly type = "rename_node";
  readonly description: string;
  private readonly oldName: string;
  private readonly newName: string;

  constructor(oldName: string, newName: string) {
    this.oldName = oldName;
    this.newName = newName;
    this.description = `Rename "${oldName}" to "${newName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    return this.rename(model, this.oldName, this.newName);
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    return this.rename(model, this.newName, this.oldName);
  }

  private rename(model: WorkflowGraphModel, from: string, to: string): WorkflowGraphModel {
    const nodes = model.nodes.map((n) => {
      if (n.id === from) {
        return { ...n, id: to, taskName: to };
      }
      if (n.flow?.then === from) {
        return { ...n, flow: { then: to } };
      }
      return n;
    });

    const edges = model.edges.map((e) => {
      const sourceMatch = e.source === from;
      const targetMatch = e.target === from;
      if (!sourceMatch && !targetMatch) return e;
      return {
        ...e,
        ...(sourceMatch && { source: to }),
        ...(targetMatch && { target: to }),
      };
    });

    return { ...model, nodes, edges };
  }
}

// ---------------------------------------------------------------------------
// UpdateNodeMetaCommand
// ---------------------------------------------------------------------------

/** Which meta property is being updated. */
export type NodeMetaField = "export" | "flow";

/**
 * Updates non-config node properties: `export.as` or `flow.then`.
 *
 * Lightweight command for small property mutations that don't touch
 * the task_config object.
 */
export class UpdateNodeMetaCommand implements GraphCommand {
  readonly type = "update_node_meta";
  readonly description: string;
  private readonly nodeId: string;
  private readonly field: NodeMetaField;
  private readonly newValue: string | undefined;
  private oldValue: string | undefined = undefined;

  constructor(nodeId: string, field: NodeMetaField, newValue: string | undefined, taskName: string) {
    this.nodeId = nodeId;
    this.field = field;
    this.newValue = newValue;
    this.description = `Update "${taskName}" ${field}`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const node = model.nodes.find((n) => n.id === this.nodeId);
    if (!node) return model;

    if (this.field === "export") {
      this.oldValue = node.export?.as;
      const exportVal = this.newValue ? { as: this.newValue } : undefined;
      const nodes = model.nodes.map((n) =>
        n.id === this.nodeId ? { ...n, export: exportVal } : n,
      );
      return { ...model, nodes };
    }

    // field === "flow"
    this.oldValue = node.flow?.then;
    const flowVal = this.newValue ? { then: this.newValue } : undefined;
    const nodes = model.nodes.map((n) =>
      n.id === this.nodeId ? { ...n, flow: flowVal } : n,
    );
    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const node = model.nodes.find((n) => n.id === this.nodeId);
    if (!node) return model;

    if (this.field === "export") {
      const exportVal = this.oldValue ? { as: this.oldValue } : undefined;
      const nodes = model.nodes.map((n) =>
        n.id === this.nodeId ? { ...n, export: exportVal } : n,
      );
      return { ...model, nodes };
    }

    // field === "flow"
    const flowVal = this.oldValue ? { then: this.oldValue } : undefined;
    const nodes = model.nodes.map((n) =>
      n.id === this.nodeId ? { ...n, flow: flowVal } : n,
    );
    return { ...model, nodes };
  }
}

// ---------------------------------------------------------------------------
// MigrateBranchHandleCommand
// ---------------------------------------------------------------------------

/**
 * Updates the `sourceHandle` of all edges from a node's old handle ID
 * to a new handle ID. Used when a switch_case case or human_input outcome
 * is renamed (AD-T15-B4: name-based handle IDs).
 */
export class MigrateBranchHandleCommand implements GraphCommand {
  readonly type = "migrate_branch_handle";
  readonly description: string;
  private readonly nodeId: string;
  private readonly oldHandleId: string;
  private readonly newHandleId: string;

  constructor(nodeId: string, oldHandleId: string, newHandleId: string) {
    this.nodeId = nodeId;
    this.oldHandleId = oldHandleId;
    this.newHandleId = newHandleId;
    this.description = `Rename handle "${oldHandleId}" to "${newHandleId}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    return this.migrate(model, this.oldHandleId, this.newHandleId);
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    return this.migrate(model, this.newHandleId, this.oldHandleId);
  }

  private migrate(
    model: WorkflowGraphModel,
    from: string,
    to: string,
  ): WorkflowGraphModel {
    const edges = model.edges.map((e) =>
      e.source === this.nodeId && e.sourceHandle === from
        ? { ...e, sourceHandle: to, label: to.includes("_") ? to.split("_").slice(1).join("_") : e.label }
        : e,
    );
    return { ...model, edges };
  }
}

// ---------------------------------------------------------------------------
// DuplicateNodeCommand
// ---------------------------------------------------------------------------

const DUPLICATE_OFFSET = { x: 30, y: 30 };

/**
 * Duplicates a task node with a new unique name and offset position.
 *
 * Deep-clones the source node's config. Does not duplicate edges — the user
 * connects the duplicate manually. This matches the behavior of n8n and
 * Retool canvas editors where duplicating edges would create ambiguous topology.
 */
export class DuplicateNodeCommand implements GraphCommand {
  readonly type = "duplicate_node";
  readonly description: string;
  private readonly sourceNodeId: string;
  readonly newTaskName: string;

  constructor(sourceNodeId: string, newTaskName: string) {
    this.sourceNodeId = sourceNodeId;
    this.newTaskName = newTaskName;
    this.description = `Duplicate task "${sourceNodeId}" as "${newTaskName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const source = model.nodes.find((n) => n.id === this.sourceNodeId);
    if (!source) return model;

    const clone: WorkflowGraphNode = {
      ...source,
      id: this.newTaskName,
      taskName: this.newTaskName,
      config: structuredClone(source.config),
      position: {
        x: source.position.x + DUPLICATE_OFFSET.x,
        y: source.position.y + DUPLICATE_OFFSET.y,
      },
      export: undefined,
      flow: undefined,
    };

    return { ...model, nodes: [...model.nodes, clone] };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    return {
      ...model,
      nodes: model.nodes.filter((n) => n.id !== this.newTaskName),
    };
  }
}

// ---------------------------------------------------------------------------
// Nested value utilities for UpdateNodeFieldCommand
// ---------------------------------------------------------------------------

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".");
  if (keys.length === 1) {
    return { ...obj, [keys[0]]: value };
  }
  const [head, ...rest] = keys;
  const child = (obj[head] != null && typeof obj[head] === "object")
    ? obj[head] as Record<string, unknown>
    : {};
  return { ...obj, [head]: setNestedValue(child, rest.join("."), value) };
}

function deleteNestedValue(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const keys = path.split(".");
  if (keys.length === 1) {
    const { [keys[0]]: _, ...rest } = obj;
    return rest;
  }
  const [head, ...restKeys] = keys;
  const child = (obj[head] != null && typeof obj[head] === "object")
    ? obj[head] as Record<string, unknown>
    : {};
  return { ...obj, [head]: deleteNestedValue(child, restKeys.join(".")) };
}

// ---------------------------------------------------------------------------
// T08: Branch-specific insertion commands
// ---------------------------------------------------------------------------

export class AddSwitchCaseCommand implements GraphCommand {
  readonly type = "add_switch_case";
  readonly description: string;
  private readonly switchNodeId: string;
  private readonly caseName: string;
  private readonly condition: string;
  private readonly childNode: WorkflowGraphNode | null;
  private readonly childEdge: WorkflowGraphEdge | null;

  constructor(
    switchNodeId: string,
    caseName: string,
    condition: string,
    childNode: WorkflowGraphNode | null = null,
    childEdge: WorkflowGraphEdge | null = null,
  ) {
    this.switchNodeId = switchNodeId;
    this.caseName = caseName;
    this.condition = condition;
    this.childNode = childNode;
    this.childEdge = childEdge;
    this.description = `Add case "${caseName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.switchNodeId) return node;
      const prevCases = (node.config as Record<string, unknown>).cases;
      const nextCases = Array.isArray(prevCases) ? [...prevCases] : [];
      nextCases.push({
        name: this.caseName,
        ...(this.condition.trim() && { when: this.condition.trim() }),
      });
      return { ...node, config: { ...node.config, cases: nextCases } as JsonObject };
    });

    const withChildNode = this.childNode ? [...nodes, this.childNode] : nodes;
    const edges = this.childEdge ? [...model.edges, this.childEdge] : [...model.edges];
    return { ...model, nodes: withChildNode, edges };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes
      .filter((node) => !this.childNode || node.id !== this.childNode.id)
      .map((node) => {
        if (node.id !== this.switchNodeId) return node;
        const prevCases = (node.config as Record<string, unknown>).cases;
        const nextCases = Array.isArray(prevCases)
          ? prevCases.filter((entry) => {
              if (typeof entry !== "object" || entry === null) return true;
              return (entry as { name?: string }).name !== this.caseName;
            })
          : [];
        return { ...node, config: { ...node.config, cases: nextCases } as JsonObject };
      });

    const edges = this.childEdge
      ? model.edges.filter((edge) => edge.id !== this.childEdge!.id)
      : [...model.edges];

    return { ...model, nodes, edges };
  }
}

export class AddParallelBranchCommand implements GraphCommand {
  readonly type = "add_parallel_branch";
  readonly description: string;
  private readonly forkNodeId: string;
  private readonly branchName: string;
  private readonly childNode: WorkflowGraphNode | null;
  private readonly childEdge: WorkflowGraphEdge | null;

  constructor(
    forkNodeId: string,
    branchName: string,
    childNode: WorkflowGraphNode | null = null,
    childEdge: WorkflowGraphEdge | null = null,
  ) {
    this.forkNodeId = forkNodeId;
    this.branchName = branchName;
    this.childNode = childNode;
    this.childEdge = childEdge;
    this.description = `Add branch "${branchName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forkNodeId) return node;
      const prevBranches = (node.config as Record<string, unknown>).branches;
      const nextBranches = Array.isArray(prevBranches) ? [...prevBranches] : [];
      nextBranches.push({ name: this.branchName, do: [] });
      return { ...node, config: { ...node.config, branches: nextBranches } as JsonObject };
    });

    const withChildNode = this.childNode ? [...nodes, this.childNode] : nodes;
    const edges = this.childEdge ? [...model.edges, this.childEdge] : [...model.edges];
    return { ...model, nodes: withChildNode, edges };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes
      .filter((node) => !this.childNode || node.id !== this.childNode.id)
      .map((node) => {
        if (node.id !== this.forkNodeId) return node;
        const prevBranches = (node.config as Record<string, unknown>).branches;
        const nextBranches = Array.isArray(prevBranches)
          ? prevBranches.filter((entry) => {
              if (typeof entry !== "object" || entry === null) return true;
              return (entry as { name?: string }).name !== this.branchName;
            })
          : [];
        return { ...node, config: { ...node.config, branches: nextBranches } as JsonObject };
      });

    const edges = this.childEdge
      ? model.edges.filter((edge) => edge.id !== this.childEdge!.id)
      : [...model.edges];

    return { ...model, nodes, edges };
  }
}

export class AddCatchHandlerCommand implements GraphCommand {
  readonly type = "add_catch_handler";
  readonly description: string;
  private readonly tryCatchNodeId: string;
  private readonly errorType: string;
  private readonly childNode: WorkflowGraphNode | null;
  private readonly childEdge: WorkflowGraphEdge | null;
  private previousCatch: unknown = undefined;

  constructor(
    tryCatchNodeId: string,
    errorType: string,
    childNode: WorkflowGraphNode | null = null,
    childEdge: WorkflowGraphEdge | null = null,
  ) {
    this.tryCatchNodeId = tryCatchNodeId;
    this.errorType = errorType;
    this.childNode = childNode;
    this.childEdge = childEdge;
    this.description = "Add catch handler";
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.tryCatchNodeId) return node;
      this.previousCatch = (node.config as Record<string, unknown>).catch;
      const nextCatch = {
        as: this.errorType.trim() || "error",
        do: [],
      };
      return { ...node, config: { ...node.config, catch: nextCatch } as JsonObject };
    });

    const withChildNode = this.childNode ? [...nodes, this.childNode] : nodes;
    const edges = this.childEdge ? [...model.edges, this.childEdge] : [...model.edges];
    return { ...model, nodes: withChildNode, edges };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes
      .filter((node) => !this.childNode || node.id !== this.childNode.id)
      .map((node) => {
        if (node.id !== this.tryCatchNodeId) return node;
        if (this.previousCatch === undefined) {
          const { catch: _removed, ...rest } = node.config as Record<string, unknown>;
          return { ...node, config: rest as JsonObject };
        }
        return { ...node, config: { ...node.config, catch: this.previousCatch } as JsonObject };
      });

    const edges = this.childEdge
      ? model.edges.filter((edge) => edge.id !== this.childEdge!.id)
      : [...model.edges];

    return { ...model, nodes, edges };
  }
}

// ---------------------------------------------------------------------------
// GraphHistory
// ---------------------------------------------------------------------------

const MAX_HISTORY_SIZE = 50;

/**
 * Manages a stack of {@link GraphCommand}s over a {@link WorkflowGraphModel},
 * supporting undo and redo with a bounded history.
 *
 * Pure TypeScript — no React dependencies.
 */
export class GraphHistory {
  private model: WorkflowGraphModel;
  private undoStack: GraphCommand[] = [];
  private redoStack: GraphCommand[] = [];

  constructor(initialModel: WorkflowGraphModel) {
    this.model = initialModel;
  }

  get current(): WorkflowGraphModel {
    return this.model;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  dispatch(command: GraphCommand): WorkflowGraphModel {
    this.model = command.apply(this.model);
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_HISTORY_SIZE) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    return this.model;
  }

  undo(): WorkflowGraphModel {
    const command = this.undoStack.pop();
    if (!command) return this.model;
    this.model = command.undo(this.model);
    this.redoStack.push(command);
    return this.model;
  }

  redo(): WorkflowGraphModel {
    const command = this.redoStack.pop();
    if (!command) return this.model;
    this.model = command.apply(this.model);
    this.undoStack.push(command);
    return this.model;
  }

  reset(model: WorkflowGraphModel): void {
    this.model = model;
    this.undoStack = [];
    this.redoStack = [];
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

let edgeIdCounter = 0;

/** Generates a unique edge ID for new canvas edges. */
export function generateEdgeId(): string {
  return `e_canvas_${Date.now()}_${edgeIdCounter++}`;
}

/**
 * Generates a unique task name for a newly dropped task kind.
 *
 * Strategy: `{kind}_{N}` where N is the lowest positive integer
 * that avoids collision with existing task names.
 */
export function generateTaskName(
  kindString: string,
  existingNames: ReadonlySet<string>,
): string {
  let n = 1;
  while (existingNames.has(`${kindString}_${n}`)) {
    n++;
  }
  return `${kindString}_${n}`;
}

/**
 * Creates a {@link WorkflowGraphNode} for a newly dropped task.
 */
export function createTaskNode(
  taskName: string,
  kind: WorkflowTaskKind,
  kindString: string,
  category: TopologyNodeCategory,
  position: { x: number; y: number },
): WorkflowGraphNode {
  return {
    id: taskName,
    taskName,
    kind,
    category,
    config: {} as JsonObject,
    position,
  };
}

/**
 * Returns the set of node IDs that are sentinel (non-deletable) nodes.
 */
export function isSentinelNode(nodeId: string): boolean {
  return nodeId === START_NODE_ID || nodeId === END_NODE_ID;
}
