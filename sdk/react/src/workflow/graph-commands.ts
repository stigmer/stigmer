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
// T09: Switch Case management commands
// ---------------------------------------------------------------------------

/**
 * Removes a case from a switch_case node's `config.cases` array
 * and deletes any associated canvas edge (identified by sourceHandle).
 *
 * @since T09 (Branch Management UX)
 */
export class RemoveSwitchCaseCommand implements GraphCommand {
  readonly type = "remove_switch_case";
  readonly description: string;
  private readonly switchNodeId: string;
  private readonly caseName: string;
  private removedCase: unknown = undefined;
  private removedCaseIndex: number = -1;
  private removedEdges: WorkflowGraphEdge[] = [];

  constructor(switchNodeId: string, caseName: string) {
    this.switchNodeId = switchNodeId;
    this.caseName = caseName;
    this.description = `Remove case "${caseName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const handleId = `case_${this.caseName}`;

    const nodes = model.nodes.map((node) => {
      if (node.id !== this.switchNodeId) return node;
      const prevCases = (node.config as Record<string, unknown>).cases;
      if (!Array.isArray(prevCases)) return node;

      this.removedCaseIndex = prevCases.findIndex(
        (c) => c != null && typeof c === "object" && (c as { name?: string }).name === this.caseName,
      );
      if (this.removedCaseIndex >= 0) {
        this.removedCase = prevCases[this.removedCaseIndex];
      }

      const nextCases = prevCases.filter(
        (c) => !(c != null && typeof c === "object" && (c as { name?: string }).name === this.caseName),
      );
      return { ...node, config: { ...node.config, cases: nextCases } as JsonObject };
    });

    this.removedEdges = model.edges.filter(
      (e) => e.source === this.switchNodeId && e.sourceHandle === handleId,
    );

    const edges = model.edges.filter(
      (e) => !(e.source === this.switchNodeId && e.sourceHandle === handleId),
    );

    return { ...model, nodes, edges };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    if (this.removedCase === undefined || this.removedCaseIndex < 0) return model;

    const nodes = model.nodes.map((node) => {
      if (node.id !== this.switchNodeId) return node;
      const prevCases = (node.config as Record<string, unknown>).cases;
      const nextCases = Array.isArray(prevCases) ? [...prevCases] : [];
      nextCases.splice(this.removedCaseIndex, 0, this.removedCase);
      return { ...node, config: { ...node.config, cases: nextCases } as JsonObject };
    });

    const edges = [...model.edges, ...this.removedEdges];
    return { ...model, nodes, edges };
  }
}

/**
 * Reorders cases in a switch_case node's `config.cases` array.
 *
 * @since T09 (Branch Management UX)
 */
export class ReorderSwitchCasesCommand implements GraphCommand {
  readonly type = "reorder_switch_cases";
  readonly description: string;
  private readonly switchNodeId: string;
  private readonly newOrder: readonly string[];
  private previousOrder: string[] = [];

  constructor(switchNodeId: string, newOrder: readonly string[]) {
    this.switchNodeId = switchNodeId;
    this.newOrder = newOrder;
    this.description = "Reorder switch cases";
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.switchNodeId) return node;
      const prevCases = (node.config as Record<string, unknown>).cases;
      if (!Array.isArray(prevCases)) return node;

      this.previousOrder = prevCases
        .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
        .map((c) => c.name as string);

      const caseMap = new Map<string, unknown>();
      for (const c of prevCases) {
        if (c != null && typeof c === "object") {
          caseMap.set((c as { name: string }).name, c);
        }
      }

      const nextCases = this.newOrder
        .map((name) => caseMap.get(name))
        .filter((c): c is unknown => c !== undefined);

      return { ...node, config: { ...node.config, cases: nextCases } as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    if (this.previousOrder.length === 0) return model;

    const nodes = model.nodes.map((node) => {
      if (node.id !== this.switchNodeId) return node;
      const prevCases = (node.config as Record<string, unknown>).cases;
      if (!Array.isArray(prevCases)) return node;

      const caseMap = new Map<string, unknown>();
      for (const c of prevCases) {
        if (c != null && typeof c === "object") {
          caseMap.set((c as { name: string }).name, c);
        }
      }

      const nextCases = this.previousOrder
        .map((name) => caseMap.get(name))
        .filter((c): c is unknown => c !== undefined);

      return { ...node, config: { ...node.config, cases: nextCases } as JsonObject };
    });

    return { ...model, nodes };
  }
}

// ---------------------------------------------------------------------------
// T09: Fork branch management commands
// ---------------------------------------------------------------------------

/**
 * Removes a branch from a fork node's `config.branches` array.
 * Refuses to execute if it would leave fewer than 2 branches (proto min_items constraint).
 *
 * @since T09 (Branch Management UX)
 */
export class RemoveForkBranchCommand implements GraphCommand {
  readonly type = "remove_fork_branch";
  readonly description: string;
  private readonly forkNodeId: string;
  private readonly branchName: string;
  private removedBranch: unknown = undefined;
  private removedIndex: number = -1;

  constructor(forkNodeId: string, branchName: string) {
    this.forkNodeId = forkNodeId;
    this.branchName = branchName;
    this.description = `Remove branch "${branchName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forkNodeId) return node;
      const prevBranches = (node.config as Record<string, unknown>).branches;
      if (!Array.isArray(prevBranches) || prevBranches.length <= 2) return node;

      this.removedIndex = prevBranches.findIndex(
        (b) => b != null && typeof b === "object" && (b as { name?: string }).name === this.branchName,
      );
      if (this.removedIndex >= 0) {
        this.removedBranch = prevBranches[this.removedIndex];
      }

      const nextBranches = prevBranches.filter(
        (b) => !(b != null && typeof b === "object" && (b as { name?: string }).name === this.branchName),
      );
      return { ...node, config: { ...node.config, branches: nextBranches } as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    if (this.removedBranch === undefined || this.removedIndex < 0) return model;

    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forkNodeId) return node;
      const prevBranches = (node.config as Record<string, unknown>).branches;
      const nextBranches = Array.isArray(prevBranches) ? [...prevBranches] : [];
      nextBranches.splice(this.removedIndex, 0, this.removedBranch);
      return { ...node, config: { ...node.config, branches: nextBranches } as JsonObject };
    });

    return { ...model, nodes };
  }
}

/**
 * Reorders branches in a fork node's `config.branches` array.
 *
 * @since T09 (Branch Management UX)
 */
export class ReorderForkBranchesCommand implements GraphCommand {
  readonly type = "reorder_fork_branches";
  readonly description: string;
  private readonly forkNodeId: string;
  private readonly newOrder: readonly string[];
  private previousOrder: string[] = [];

  constructor(forkNodeId: string, newOrder: readonly string[]) {
    this.forkNodeId = forkNodeId;
    this.newOrder = newOrder;
    this.description = "Reorder fork branches";
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forkNodeId) return node;
      const prevBranches = (node.config as Record<string, unknown>).branches;
      if (!Array.isArray(prevBranches)) return node;

      this.previousOrder = prevBranches
        .filter((b): b is Record<string, unknown> => b != null && typeof b === "object")
        .map((b) => b.name as string);

      const branchMap = new Map<string, unknown>();
      for (const b of prevBranches) {
        if (b != null && typeof b === "object") {
          branchMap.set((b as { name: string }).name, b);
        }
      }

      const nextBranches = this.newOrder
        .map((name) => branchMap.get(name))
        .filter((b): b is unknown => b !== undefined);

      return { ...node, config: { ...node.config, branches: nextBranches } as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    if (this.previousOrder.length === 0) return model;

    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forkNodeId) return node;
      const prevBranches = (node.config as Record<string, unknown>).branches;
      if (!Array.isArray(prevBranches)) return node;

      const branchMap = new Map<string, unknown>();
      for (const b of prevBranches) {
        if (b != null && typeof b === "object") {
          branchMap.set((b as { name: string }).name, b);
        }
      }

      const nextBranches = this.previousOrder
        .map((name) => branchMap.get(name))
        .filter((b): b is unknown => b !== undefined);

      return { ...node, config: { ...node.config, branches: nextBranches } as JsonObject };
    });

    return { ...model, nodes };
  }
}

/**
 * Renames a branch in a fork node's `config.branches` array.
 *
 * @since T09 (Branch Management UX)
 */
export class RenameForkBranchCommand implements GraphCommand {
  readonly type = "rename_fork_branch";
  readonly description: string;
  private readonly forkNodeId: string;
  private readonly oldName: string;
  private readonly newName: string;

  constructor(forkNodeId: string, oldName: string, newName: string) {
    this.forkNodeId = forkNodeId;
    this.oldName = oldName;
    this.newName = newName;
    this.description = `Rename branch "${oldName}" to "${newName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forkNodeId) return node;
      const prevBranches = (node.config as Record<string, unknown>).branches;
      if (!Array.isArray(prevBranches)) return node;

      const nextBranches = prevBranches.map((b) => {
        if (b != null && typeof b === "object" && (b as { name?: string }).name === this.oldName) {
          return { ...(b as Record<string, unknown>), name: this.newName };
        }
        return b;
      });
      return { ...node, config: { ...node.config, branches: nextBranches } as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forkNodeId) return node;
      const prevBranches = (node.config as Record<string, unknown>).branches;
      if (!Array.isArray(prevBranches)) return node;

      const nextBranches = prevBranches.map((b) => {
        if (b != null && typeof b === "object" && (b as { name?: string }).name === this.newName) {
          return { ...(b as Record<string, unknown>), name: this.oldName };
        }
        return b;
      });
      return { ...node, config: { ...node.config, branches: nextBranches } as JsonObject };
    });

    return { ...model, nodes };
  }
}

/**
 * Toggles the `compete` flag on a fork node (race mode vs wait-for-all).
 *
 * @since T09 (Branch Management UX)
 */
export class SetForkCompeteCommand implements GraphCommand {
  readonly type = "set_fork_compete";
  readonly description: string;
  private readonly forkNodeId: string;
  private readonly compete: boolean;
  private previousValue: boolean = false;

  constructor(forkNodeId: string, compete: boolean) {
    this.forkNodeId = forkNodeId;
    this.compete = compete;
    this.description = compete ? "Set fork to race mode" : "Set fork to wait-for-all";
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forkNodeId) return node;
      this.previousValue = (node.config as Record<string, unknown>).compete === true;
      const config = { ...node.config } as Record<string, unknown>;
      if (this.compete) {
        config.compete = true;
      } else {
        delete config.compete;
      }
      return { ...node, config: config as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forkNodeId) return node;
      const config = { ...node.config } as Record<string, unknown>;
      if (this.previousValue) {
        config.compete = true;
      } else {
        delete config.compete;
      }
      return { ...node, config: config as JsonObject };
    });

    return { ...model, nodes };
  }
}

// ---------------------------------------------------------------------------
// T09: TryCatch management commands
// ---------------------------------------------------------------------------

/**
 * Updates catch configuration fields (`as`, `compensate`) on a try_catch node.
 *
 * @since T09 (Branch Management UX)
 */
export class UpdateCatchConfigCommand implements GraphCommand {
  readonly type = "update_catch_config";
  readonly description: string;
  private readonly tryCatchNodeId: string;
  private readonly updates: { as?: string; compensate?: boolean };
  private previousValues: Record<string, unknown> = {};
  private updatedKeys: string[] = [];

  constructor(tryCatchNodeId: string, updates: { as?: string; compensate?: boolean }) {
    this.tryCatchNodeId = tryCatchNodeId;
    this.updates = updates;
    this.description = "Update catch configuration";
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.tryCatchNodeId) return node;
      const config = node.config as Record<string, unknown>;
      const prevCatch = config.catch as Record<string, unknown> | undefined;
      if (!prevCatch) return node;

      this.updatedKeys = [];
      this.previousValues = {};

      const nextCatch = { ...prevCatch };
      if (this.updates.as !== undefined) {
        this.previousValues.as = prevCatch.as;
        this.updatedKeys.push("as");
        nextCatch.as = this.updates.as;
      }
      if (this.updates.compensate !== undefined) {
        this.previousValues.compensate = prevCatch.compensate;
        this.updatedKeys.push("compensate");
        if (this.updates.compensate) {
          nextCatch.compensate = true;
        } else {
          delete nextCatch.compensate;
        }
      }

      return { ...node, config: { ...config, catch: nextCatch } as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.tryCatchNodeId) return node;
      const config = node.config as Record<string, unknown>;
      const prevCatch = config.catch as Record<string, unknown> | undefined;
      if (!prevCatch) return node;

      const nextCatch = { ...prevCatch };
      for (const key of this.updatedKeys) {
        const prevValue = this.previousValues[key];
        if (prevValue === undefined) {
          delete nextCatch[key];
        } else {
          nextCatch[key] = prevValue;
        }
      }

      return { ...node, config: { ...config, catch: nextCatch } as JsonObject };
    });

    return { ...model, nodes };
  }
}

/**
 * Removes the catch block from a try_catch node's config.
 *
 * @since T09 (Branch Management UX)
 */
export class RemoveCatchBlockCommand implements GraphCommand {
  readonly type = "remove_catch_block";
  readonly description = "Remove catch handler";
  private readonly tryCatchNodeId: string;
  private previousCatch: unknown = undefined;

  constructor(tryCatchNodeId: string) {
    this.tryCatchNodeId = tryCatchNodeId;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.tryCatchNodeId) return node;
      const config = node.config as Record<string, unknown>;
      this.previousCatch = config.catch;
      const { catch: _removed, ...rest } = config;
      return { ...node, config: rest as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    if (this.previousCatch === undefined) return model;

    const nodes = model.nodes.map((node) => {
      if (node.id !== this.tryCatchNodeId) return node;
      return { ...node, config: { ...node.config, catch: this.previousCatch } as JsonObject };
    });

    return { ...model, nodes };
  }
}

// ---------------------------------------------------------------------------
// T09: ForEach configuration command
// ---------------------------------------------------------------------------

/**
 * Updates for_each configuration fields on a for_each node.
 *
 * @since T09 (Branch Management UX)
 */
export class UpdateForEachConfigCommand implements GraphCommand {
  readonly type = "update_for_each_config";
  readonly description: string;
  private readonly forEachNodeId: string;
  private readonly updates: Partial<{
    each: string;
    in: string;
    max_parallelism: number;
    batch_size: number;
    on_error: string;
  }>;
  private previousValues: Record<string, unknown> = {};

  constructor(
    forEachNodeId: string,
    updates: Partial<{
      each: string;
      in: string;
      max_parallelism: number;
      batch_size: number;
      on_error: string;
    }>,
  ) {
    this.forEachNodeId = forEachNodeId;
    this.updates = updates;
    this.description = "Update for-each configuration";
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forEachNodeId) return node;
      const config = { ...node.config } as Record<string, unknown>;

      for (const [key, value] of Object.entries(this.updates)) {
        if (value !== undefined) {
          this.previousValues[key] = config[key];
          config[key] = value;
        }
      }

      return { ...node, config: config as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.forEachNodeId) return node;
      const config = { ...node.config } as Record<string, unknown>;

      for (const [key, value] of Object.entries(this.previousValues)) {
        if (value === undefined) {
          delete config[key];
        } else {
          config[key] = value;
        }
      }

      return { ...node, config: config as JsonObject };
    });

    return { ...model, nodes };
  }
}

// ---------------------------------------------------------------------------
// T09: Nested task editing commands
// ---------------------------------------------------------------------------

/**
 * Adds a task to a nested `do[]` array within a container node's config.
 * Path format: "branches.0.do" or "try" or "catch.do"
 *
 * @since T09 (Branch Management UX)
 */
export class AddNestedTaskCommand implements GraphCommand {
  readonly type = "add_nested_task";
  readonly description: string;
  private readonly containerNodeId: string;
  private readonly arrayPath: string;
  private readonly task: Record<string, unknown>;

  constructor(
    containerNodeId: string,
    arrayPath: string,
    task: Record<string, unknown>,
  ) {
    this.containerNodeId = containerNodeId;
    this.arrayPath = arrayPath;
    this.task = task;
    const taskName = (task.name as string) || "task";
    this.description = `Add nested task "${taskName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.containerNodeId) return node;
      const config = { ...node.config } as Record<string, unknown>;
      const arr = getNestedArray(config, this.arrayPath);
      if (!arr) return node;
      arr.push(this.task);
      setNestedArray(config, this.arrayPath, arr);
      return { ...node, config: config as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.containerNodeId) return node;
      const config = { ...node.config } as Record<string, unknown>;
      const arr = getNestedArray(config, this.arrayPath);
      if (!arr || arr.length === 0) return node;
      arr.pop();
      setNestedArray(config, this.arrayPath, arr);
      return { ...node, config: config as JsonObject };
    });

    return { ...model, nodes };
  }
}

/**
 * Removes a task from a nested `do[]` array at a specific index.
 *
 * @since T09 (Branch Management UX)
 */
export class RemoveNestedTaskCommand implements GraphCommand {
  readonly type = "remove_nested_task";
  readonly description: string;
  private readonly containerNodeId: string;
  private readonly arrayPath: string;
  private readonly index: number;
  private removedTask: unknown = undefined;

  constructor(containerNodeId: string, arrayPath: string, index: number) {
    this.containerNodeId = containerNodeId;
    this.arrayPath = arrayPath;
    this.index = index;
    this.description = "Remove nested task";
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.containerNodeId) return node;
      const config = { ...node.config } as Record<string, unknown>;
      const arr = getNestedArray(config, this.arrayPath);
      if (!arr || this.index < 0 || this.index >= arr.length) return node;
      this.removedTask = arr[this.index];
      const next = [...arr];
      next.splice(this.index, 1);
      setNestedArray(config, this.arrayPath, next);
      return { ...node, config: config as JsonObject };
    });

    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    if (this.removedTask === undefined) return model;

    const nodes = model.nodes.map((node) => {
      if (node.id !== this.containerNodeId) return node;
      const config = { ...node.config } as Record<string, unknown>;
      const arr = getNestedArray(config, this.arrayPath);
      if (!arr) return node;
      const next = [...arr];
      next.splice(this.index, 0, this.removedTask);
      setNestedArray(config, this.arrayPath, next);
      return { ...node, config: config as JsonObject };
    });

    return { ...model, nodes };
  }
}

/**
 * Reorders tasks within a nested `do[]` array.
 *
 * @since T09 (Branch Management UX)
 */
export class ReorderNestedTasksCommand implements GraphCommand {
  readonly type = "reorder_nested_tasks";
  readonly description = "Reorder nested tasks";
  private readonly containerNodeId: string;
  private readonly arrayPath: string;
  private readonly fromIndex: number;
  private readonly toIndex: number;

  constructor(containerNodeId: string, arrayPath: string, fromIndex: number, toIndex: number) {
    this.containerNodeId = containerNodeId;
    this.arrayPath = arrayPath;
    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    return this.reorder(model, this.fromIndex, this.toIndex);
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    return this.reorder(model, this.toIndex, this.fromIndex);
  }

  private reorder(model: WorkflowGraphModel, from: number, to: number): WorkflowGraphModel {
    const nodes = model.nodes.map((node) => {
      if (node.id !== this.containerNodeId) return node;
      const config = { ...node.config } as Record<string, unknown>;
      const arr = getNestedArray(config, this.arrayPath);
      if (!arr || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return node;
      const next = [...arr];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      setNestedArray(config, this.arrayPath, next);
      return { ...node, config: config as JsonObject };
    });

    return { ...model, nodes };
  }
}

// ---------------------------------------------------------------------------
// Nested array helpers (T09)
// ---------------------------------------------------------------------------

function getNestedArray(config: Record<string, unknown>, path: string): unknown[] | null {
  const keys = path.split(".");
  let current: unknown = config;

  for (const key of keys) {
    if (current == null || typeof current !== "object") return null;
    const idx = Number(key);
    if (!Number.isNaN(idx) && Array.isArray(current)) {
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[key];
    }
  }

  return Array.isArray(current) ? [...current] : null;
}

/**
 * Immutably sets a value at a nested dot-notation path within a config object.
 * Creates shallow copies at each level to avoid mutating the original.
 * Handles numeric segments as array indices.
 */
function setNestedArray(config: Record<string, unknown>, path: string, value: unknown[]): void {
  const keys = path.split(".");
  setAtPath(config, keys, 0, value);
}

function setAtPath(current: Record<string, unknown> | unknown[], keys: string[], depth: number, value: unknown): void {
  if (depth >= keys.length) return;

  const key = keys[depth];
  const isLast = depth === keys.length - 1;
  const idx = Number(key);
  const isIndex = !Number.isNaN(idx) && Array.isArray(current);

  if (isLast) {
    if (isIndex && Array.isArray(current)) {
      current[idx] = value;
    } else {
      (current as Record<string, unknown>)[key] = value;
    }
    return;
  }

  if (isIndex && Array.isArray(current)) {
    const child = current[idx];
    if (child == null || typeof child !== "object") return;
    const childCopy = Array.isArray(child) ? [...child] : { ...(child as Record<string, unknown>) };
    current[idx] = childCopy;
    setAtPath(childCopy as Record<string, unknown> | unknown[], keys, depth + 1, value);
  } else {
    const obj = current as Record<string, unknown>;
    const child = obj[key];
    if (child == null || typeof child !== "object") {
      obj[key] = {};
    } else if (Array.isArray(child)) {
      obj[key] = [...child];
    } else {
      obj[key] = { ...(child as Record<string, unknown>) };
    }
    setAtPath(obj[key] as Record<string, unknown> | unknown[], keys, depth + 1, value);
  }
}

// ---------------------------------------------------------------------------
// ToggleNodeDisabledCommand
// ---------------------------------------------------------------------------

/**
 * Toggles the `disabled` flag on a graph node.
 *
 * Disabled nodes are visually dimmed on the canvas and skipped during
 * execution. The flag round-trips as `x-stigmer-disabled: true` in YAML.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export class ToggleNodeDisabledCommand implements GraphCommand {
  readonly type = "toggle_node_disabled";
  readonly description: string;
  private readonly nodeId: string;
  private previousValue: boolean = false;

  constructor(nodeId: string, taskName: string) {
    this.nodeId = nodeId;
    this.description = `Toggle disabled on "${taskName}"`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((n) => {
      if (n.id !== this.nodeId) return n;
      const currentDisabled = (n.config as Record<string, unknown>)["x-stigmer-disabled"] === true;
      this.previousValue = currentDisabled;
      const config = { ...n.config } as Record<string, unknown>;
      if (currentDisabled) {
        delete config["x-stigmer-disabled"];
      } else {
        config["x-stigmer-disabled"] = true;
      }
      return { ...n, config: config as JsonObject };
    });
    return { ...model, nodes };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    const nodes = model.nodes.map((n) => {
      if (n.id !== this.nodeId) return n;
      const config = { ...n.config } as Record<string, unknown>;
      if (this.previousValue) {
        config["x-stigmer-disabled"] = true;
      } else {
        delete config["x-stigmer-disabled"];
      }
      return { ...n, config: config as JsonObject };
    });
    return { ...model, nodes };
  }
}

// ---------------------------------------------------------------------------
// WrapInTryCatchCommand
// ---------------------------------------------------------------------------

/**
 * Wraps a single node in a `try_catch` container.
 *
 * Creates a new `try_catch` node that contains the target node in its
 * `try` block and inherits the target node's incoming/outgoing edges.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export class WrapInTryCatchCommand implements GraphCommand {
  readonly type = "wrap_in_try_catch";
  readonly description: string;
  private readonly nodeId: string;
  private readonly tryCatchName: string;
  private snapshot: {
    originalNode: WorkflowGraphNode;
    originalEdges: WorkflowGraphEdge[];
  } | null = null;

  constructor(
    nodeId: string,
    taskName: string,
    tryCatchName: string,
  ) {
    this.nodeId = nodeId;
    this.tryCatchName = tryCatchName;
    this.description = `Wrap "${taskName}" in try/catch`;
  }

  apply(model: WorkflowGraphModel): WorkflowGraphModel {
    const targetNode = model.nodes.find((n) => n.id === this.nodeId);
    if (!targetNode) return model;

    const affectedEdges = model.edges.filter(
      (e) => e.source === this.nodeId || e.target === this.nodeId,
    );
    this.snapshot = {
      originalNode: targetNode,
      originalEdges: affectedEdges,
    };

    const tryCatchNode: WorkflowGraphNode = {
      id: this.tryCatchName,
      taskName: this.tryCatchName,
      kind: targetNode.kind,
      category: "control_flow" as TopologyNodeCategory,
      config: {
        try: [{ name: targetNode.taskName, kind: targetNode.kind.toString(), task_config: targetNode.config }],
      } as unknown as JsonObject,
      position: targetNode.position,
    };

    const nodes = model.nodes
      .filter((n) => n.id !== this.nodeId)
      .concat(tryCatchNode);

    const edges = model.edges.map((e) => {
      if (e.source === this.nodeId) return { ...e, source: this.tryCatchName };
      if (e.target === this.nodeId) return { ...e, target: this.tryCatchName };
      return e;
    });

    return { ...model, nodes, edges };
  }

  undo(model: WorkflowGraphModel): WorkflowGraphModel {
    if (!this.snapshot) return model;

    const nodes = model.nodes
      .filter((n) => n.id !== this.tryCatchName)
      .concat(this.snapshot.originalNode);

    const tryCatchEdges = new Set(
      model.edges
        .filter((e) => e.source === this.tryCatchName || e.target === this.tryCatchName)
        .map((e) => e.id),
    );

    const edges = model.edges
      .filter((e) => !tryCatchEdges.has(e.id))
      .concat(this.snapshot.originalEdges);

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
