/**
 * Internal clipboard for workflow canvas copy/paste operations.
 *
 * Pure TypeScript — no React dependency. The clipboard buffer itself
 * lives as a `useRef` in the hook layer; this module provides the
 * serialization and paste logic that operates on {@link WorkflowGraphModel}.
 *
 * Cross-workflow clipboard is intentionally not supported. Pasted nodes
 * receive new unique names and remapped edge references, keeping the
 * graph model self-consistent.
 *
 * @since T11 (Context Menus and Keyboard Shortcuts)
 */

import type {
  WorkflowGraphModel,
  WorkflowGraphNode,
  WorkflowGraphEdge,
} from "./workflow-graph-model.js";
import { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model.js";
import type { GraphCommand } from "./graph-commands.js";
import {
  AddNodeCommand,
  AddEdgeCommand,
  CompoundCommand,
  generateEdgeId,
  generateTaskName,
} from "./graph-commands.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Snapshot of selected nodes and their internal edges. */
export interface ClipboardEntry {
  readonly nodes: readonly WorkflowGraphNode[];
  readonly edges: readonly WorkflowGraphEdge[];
}

/** Result of a paste operation, ready to dispatch. */
export interface PasteResult {
  readonly command: GraphCommand;
  readonly newNodeIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

const PASTE_OFFSET = { x: 40, y: 40 };

/**
 * Deep-clone selected nodes and their internal edges into a clipboard entry.
 *
 * - Sentinel nodes (`__start__`, `__end__`) are excluded.
 * - Only edges where **both** endpoints are in the selection are included.
 * - Nodes are deep-cloned so subsequent model mutations don't affect the buffer.
 */
export function serializeSelection(
  model: WorkflowGraphModel,
  selectedNodeIds: ReadonlySet<string>,
): ClipboardEntry | null {
  const filteredIds = new Set<string>();
  for (const id of selectedNodeIds) {
    if (id !== START_NODE_ID && id !== END_NODE_ID) {
      filteredIds.add(id);
    }
  }

  if (filteredIds.size === 0) return null;

  const nodes = model.nodes
    .filter((n) => filteredIds.has(n.id))
    .map((n) => structuredClone(n) as WorkflowGraphNode);

  const edges = model.edges
    .filter((e) => filteredIds.has(e.source) && filteredIds.has(e.target))
    .map((e) => structuredClone(e) as WorkflowGraphEdge);

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

/**
 * Produce graph commands that paste a clipboard entry into the model.
 *
 * - Each pasted node gets a new unique name via {@link generateTaskName}.
 * - Positions are offset from the original by {@link PASTE_OFFSET}.
 * - Edge source/target references are remapped to the new node IDs.
 * - Returns a single {@link CompoundCommand} for atomic undo.
 */
export function pasteClipboard(
  entry: ClipboardEntry,
  model: WorkflowGraphModel,
  positionOffset?: { x: number; y: number },
): PasteResult | null {
  if (entry.nodes.length === 0) return null;

  const offset = positionOffset ?? PASTE_OFFSET;
  const existingNames = new Set(model.nodes.map((n) => n.taskName));
  const idMap = new Map<string, string>();
  const commands: GraphCommand[] = [];
  const newNodeIds: string[] = [];

  for (const node of entry.nodes) {
    const kindStr = kindToString(node.kind);
    const newName = generateTaskName(kindStr, existingNames);
    existingNames.add(newName);
    idMap.set(node.id, newName);
    newNodeIds.push(newName);

    commands.push(
      new AddNodeCommand({
        ...node,
        id: newName,
        taskName: newName,
        config: structuredClone(node.config),
        position: {
          x: node.position.x + offset.x,
          y: node.position.y + offset.y,
        },
        export: undefined,
        flow: undefined,
      }),
    );
  }

  for (const edge of entry.edges) {
    const newSource = idMap.get(edge.source);
    const newTarget = idMap.get(edge.target);
    if (!newSource || !newTarget) continue;

    commands.push(
      new AddEdgeCommand({
        ...edge,
        id: generateEdgeId(),
        source: newSource,
        target: newTarget,
      }),
    );
  }

  return {
    command: new CompoundCommand(
      `Paste ${entry.nodes.length} task${entry.nodes.length > 1 ? "s" : ""}`,
      commands,
    ),
    newNodeIds,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reverse-map a WorkflowTaskKind enum value to its string representation.
 *
 * Falls back to `"task"` for unrecognized values. Intentionally does not
 * import the full kind-metadata module to keep this file dependency-light.
 */
function kindToString(kind: number): string {
  const KIND_MAP: Record<number, string> = {
    0: "task",
    1: "agent_call",
    2: "llm_call",
    3: "http_call",
    4: "grpc_call",
    5: "activity_call",
    6: "set_variables",
    7: "switch_case",
    8: "for_each",
    9: "raise_error",
    10: "listen",
    11: "wait",
    12: "human_input",
    13: "run_workflow",
    14: "try_catch",
    15: "fork",
    16: "transform",
    17: "validate",
    18: "notification",
    19: "eval",
  };
  return KIND_MAP[kind] ?? "task";
}
