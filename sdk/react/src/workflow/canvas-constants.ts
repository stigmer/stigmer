import type { TopologyNodeCategory } from "./useWorkflowTopology.js";
import type { TaskKindCategory } from "./types.js";

/**
 * Category-to-color mapping using `--stgm-*` CSS custom properties.
 *
 * Shared between the read-only SVG topology graph and the interactive
 * React Flow canvas editor to ensure consistent visual language.
 */
export const CATEGORY_COLORS: Readonly<Record<TopologyNodeCategory, string>> = {
  start: "var(--stgm-muted-foreground, #737373)",
  end: "var(--stgm-muted-foreground, #737373)",
  ai: "var(--stgm-chart-purple, #8b5cf6)",
  control_flow: "var(--stgm-chart-blue, #3b82f6)",
  invocation: "var(--stgm-muted-foreground, #737373)",
  data: "var(--stgm-chart-green, #22c55e)",
  governance: "var(--stgm-chart-orange, #f97316)",
  event: "var(--stgm-chart-yellow, #eab308)",
  unspecified: "var(--stgm-muted-foreground, #737373)",
};

/** Dagre layout configuration for top-to-bottom DAG rendering. */
export const DAGRE_CONFIG = {
  rankdir: "TB" as const,
  ranksep: 60,
  nodesep: 30,
} as const;

/**
 * More generous dagre spacing for execution graphs. Execution nodes carry
 * status badges, duration chips, and fork-progress bars that need more
 * vertical and horizontal clearance than bare editor/overview nodes.
 */
export const EXECUTION_DAGRE_CONFIG = {
  rankdir: "TB" as const,
  ranksep: 80,
  nodesep: 50,
} as const;

/** Shape accepted by {@link applyDagreLayout} for custom spacing overrides. */
export interface DagreLayoutConfig {
  readonly rankdir: "TB" | "LR";
  readonly ranksep: number;
  readonly nodesep: number;
}

/** Default padding around the SVG viewBox in the read-only graph. */
export const GRAPH_PADDING = 40;

/** Node dimensions for the read-only topology graph. */
export const TOPOLOGY_NODE_WIDTH = 180;
export const TOPOLOGY_NODE_HEIGHT = 40;

/** Node dimensions for canvas task nodes (wider to accommodate controls). */
export const CANVAS_NODE_WIDTH = 220;
export const CANVAS_NODE_HEIGHT = 56;

/** Sentinel node dimensions (Start/End pills). */
export const SENTINEL_NODE_WIDTH = 100;
export const SENTINEL_NODE_HEIGHT = 36;

/** React Flow handle (port) positions for canvas nodes. */
export const HANDLE_POSITIONS = {
  input: { x: 0.5, y: 0 },
  output: { x: 0.5, y: 1 },
} as const;

/** Human-readable display names for task kind categories. */
export const CATEGORY_DISPLAY_NAMES: Readonly<Record<TaskKindCategory, string>> = {
  ai: "AI",
  control_flow: "Control Flow",
  invocation: "Invocation",
  data: "Data",
  governance: "Governance",
  event: "Event",
  unspecified: "Other",
};

/**
 * Identifier pattern for workflow task names.
 *
 * Mirrors the `buf.validate` constraint on `WorkflowTask.name` in
 * `ai/stigmer/agentic/workflow/v1/spec.proto`.
 */
export const TASK_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** User-facing error message when a task name fails {@link TASK_NAME_PATTERN}. */
export const TASK_NAME_PATTERN_ERROR =
  "Must start with a letter or underscore, alphanumeric/underscore only";

/**
 * Rendering order for task kind categories in palettes and pickers.
 *
 * AI tasks first (most common), then control flow, invocation, data,
 * governance, events. Unspecified is a catch-all at the end.
 */
export const CATEGORY_ORDER: readonly TaskKindCategory[] = [
  "ai",
  "control_flow",
  "invocation",
  "data",
  "governance",
  "event",
  "unspecified",
];
