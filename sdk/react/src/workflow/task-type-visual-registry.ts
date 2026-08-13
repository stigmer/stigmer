import {
  CANVAS_NODE_WIDTH,
  CANVAS_NODE_HEIGHT,
  SENTINEL_NODE_WIDTH,
  SENTINEL_NODE_HEIGHT,
} from "./canvas-constants.js";
import { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model.js";

/**
 * Semantic shape identifier for workflow nodes.
 *
 * Each visual class maps to a distinct SVG shape that communicates the
 * task's structural role at a glance:
 *
 * - `task-card` — rounded rectangle for general work tasks
 * - `decision-diamond` — rotated square for conditional branching
 * - `parallel-bar` — wide horizontal bar for parallel splits
 * - `event-circle` — circle for events, signals, and timing
 * - `gate-octagon` — octagon for human review gates (stop sign metaphor)
 * - `subworkflow-card` — double-border card for sub-workflow invocations
 * - `container` — rounded container for tasks with nested children
 * - `terminal-pill` — pill/capsule for start and end sentinels
 */
export type VisualClass =
  | "task-card"
  | "decision-diamond"
  | "parallel-bar"
  | "event-circle"
  | "gate-octagon"
  | "subworkflow-card"
  | "container"
  | "terminal-pill";

/**
 * Describes how a task kind's connection handles are structured.
 *
 * T02 (NodeShell) reads this to render the appropriate React Flow Handles.
 * T01 defines the patterns; T02 implements the rendering.
 */
export type PortPattern =
  | "standard"
  | "branch-per-case"
  | "branch-per-outcome"
  | "branch-per-branch"
  | "container"
  | "source-only"
  | "sink-only";

/**
 * Visual specification for a single workflow task kind.
 *
 * Combines shape, dimension, port, and accessibility metadata.
 * The layout engine (dagre today, ELK in T03) uses `defaultWidth`
 * and `defaultHeight + captionHeight` for node sizing. The renderer
 * (T02 NodeShell) uses `visualClass` to select the SVG shape component.
 *
 * For non-rectangular shapes (diamond, octagon, circle), the task name
 * renders as an external caption BELOW the shape. `captionHeight` reserves
 * space for this caption in the layout bounding box. The SVG shape itself
 * renders at `defaultHeight`, and the full layout allocation is
 * `defaultHeight + captionHeight`.
 */
export interface TaskTypeVisualSpec {
  readonly visualClass: VisualClass;
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  /**
   * Height reserved for the task name caption below the shape.
   * 0 for shapes with internal text (cards, bars, pills).
   * >0 for non-rectangular shapes where text is placed externally.
   */
  readonly captionHeight: number;
  readonly portPattern: PortPattern;
  readonly isContainer: boolean;
  readonly ariaShapeLabel: string;
}

const TASK_CARD: TaskTypeVisualSpec = {
  visualClass: "task-card",
  defaultWidth: CANVAS_NODE_WIDTH,
  defaultHeight: CANVAS_NODE_HEIGHT,
  captionHeight: 0,
  portPattern: "standard",
  isContainer: false,
  ariaShapeLabel: "card",
} as const;

const DECISION_DIAMOND: TaskTypeVisualSpec = {
  visualClass: "decision-diamond",
  defaultWidth: 140,
  defaultHeight: 120,
  captionHeight: 24,
  portPattern: "branch-per-case",
  isContainer: false,
  ariaShapeLabel: "diamond",
} as const;

const PARALLEL_BAR: TaskTypeVisualSpec = {
  visualClass: "parallel-bar",
  defaultWidth: 260,
  defaultHeight: 32,
  captionHeight: 0,
  portPattern: "branch-per-branch",
  isContainer: false,
  ariaShapeLabel: "horizontal bar",
} as const;

const EVENT_CIRCLE: TaskTypeVisualSpec = {
  visualClass: "event-circle",
  defaultWidth: 80,
  defaultHeight: 70,
  captionHeight: 20,
  portPattern: "standard",
  isContainer: false,
  ariaShapeLabel: "circle",
} as const;

const GATE_OCTAGON: TaskTypeVisualSpec = {
  visualClass: "gate-octagon",
  defaultWidth: 160,
  defaultHeight: 140,
  captionHeight: 24,
  portPattern: "branch-per-outcome",
  isContainer: false,
  ariaShapeLabel: "octagon",
} as const;

const SUBWORKFLOW_CARD: TaskTypeVisualSpec = {
  visualClass: "subworkflow-card",
  defaultWidth: CANVAS_NODE_WIDTH,
  defaultHeight: CANVAS_NODE_HEIGHT,
  captionHeight: 0,
  portPattern: "standard",
  isContainer: false,
  ariaShapeLabel: "sub-workflow card",
} as const;

const CONTAINER: TaskTypeVisualSpec = {
  visualClass: "container",
  defaultWidth: 280,
  defaultHeight: 120,
  captionHeight: 0,
  portPattern: "container",
  isContainer: true,
  ariaShapeLabel: "container",
} as const;

const TERMINAL_PILL: TaskTypeVisualSpec = {
  visualClass: "terminal-pill",
  defaultWidth: SENTINEL_NODE_WIDTH,
  defaultHeight: SENTINEL_NODE_HEIGHT,
  captionHeight: 0,
  portPattern: "source-only",
  isContainer: false,
  ariaShapeLabel: "pill",
} as const;

const TERMINAL_PILL_END: TaskTypeVisualSpec = {
  ...TERMINAL_PILL,
  portPattern: "sink-only",
} as const;

/**
 * Static registry mapping every workflow task kind string to its
 * visual specification.
 *
 * Includes all 20 `WorkflowTaskKind` enum values plus the two
 * sentinel pseudo-kinds (`__start__`, `__end__`).
 *
 * Frozen to prevent accidental mutation — this is static metadata
 * that must not change at runtime.
 */
export const VISUAL_REGISTRY: ReadonlyMap<string, TaskTypeVisualSpec> = Object.freeze(
  new Map<string, TaskTypeVisualSpec>([
    // ai
    ["agent_call", TASK_CARD],
    ["llm_call", TASK_CARD],
    ["eval", TASK_CARD],

    // control_flow
    ["switch_case", DECISION_DIAMOND],
    ["for_each", CONTAINER],
    ["fork", PARALLEL_BAR],
    ["try_catch", CONTAINER],
    ["wait", EVENT_CIRCLE],

    // invocation
    ["http_call", TASK_CARD],
    ["grpc_call", TASK_CARD],
    ["activity_call", TASK_CARD],
    ["run_workflow", SUBWORKFLOW_CARD],

    // data
    ["set_vars", TASK_CARD],
    ["transform", TASK_CARD],
    ["validate", TASK_CARD],

    // governance
    ["human_input", GATE_OCTAGON],

    // event
    ["listen", EVENT_CIRCLE],
    ["emit_event", EVENT_CIRCLE],
    ["notification", EVENT_CIRCLE],
    ["raise_error", EVENT_CIRCLE],

    // Sentinel pseudo-kinds: keyed by the sentinel node ids, which double
    // as the sentinels' kindString (see graphNodeKindString).
    [START_NODE_ID, TERMINAL_PILL],
    [END_NODE_ID, TERMINAL_PILL_END],
  ]),
);

const DEFAULT_SPEC: TaskTypeVisualSpec = TASK_CARD;

/**
 * Returns the visual specification for a task kind string.
 *
 * Falls back to `task-card` for unknown kinds, ensuring a valid spec
 * is always returned even for future task kinds not yet in the registry.
 */
export function getVisualSpec(kind: string): TaskTypeVisualSpec {
  return VISUAL_REGISTRY.get(kind) ?? DEFAULT_SPEC;
}
