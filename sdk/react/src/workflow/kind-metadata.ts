import type { TopologyNodeCategory } from "./useWorkflowTopology";

/**
 * Canonical kind → category mapping, aligned with sidecar YAML metadata
 * in `apis/ai/stigmer/agentic/workflow/v1/tasks/meta/*.yaml`.
 *
 * This is the single source of truth for client-side category classification.
 * When the API registry is loaded, prefer `descriptor.category` from the
 * registry; this map serves as a reliable fallback during loading or for
 * offline rendering.
 */
const CATEGORY_FOR_KIND: ReadonlyMap<string, TopologyNodeCategory> = new Map([
  // ai
  ["agent_call", "ai"],
  ["llm_call", "ai"],
  ["eval", "ai"],

  // control_flow
  ["switch_case", "control_flow"],
  ["for_each", "control_flow"],
  ["fork", "control_flow"],
  ["try_catch", "control_flow"],
  ["wait", "control_flow"],

  // invocation
  ["http_call", "invocation"],
  ["grpc_call", "invocation"],
  ["activity_call", "invocation"],
  ["run_workflow", "invocation"],

  // data
  ["set_vars", "data"],
  ["transform", "data"],
  ["validate", "data"],

  // governance
  ["human_input", "governance"],

  // event
  ["listen", "event"],
  ["emit_event", "event"],
  ["notification", "event"],
  ["raise_error", "event"],
]);

/**
 * Canonical kind → display name mapping, aligned with sidecar YAML
 * `display_name` values.
 *
 * Used as a static fallback when the API registry is not yet loaded.
 * When the registry is available, prefer `descriptor.displayName`.
 */
const DISPLAY_NAME_FOR_KIND: ReadonlyMap<string, string> = new Map([
  ["set_vars", "Set Variables"],
  ["http_call", "HTTP Call"],
  ["grpc_call", "gRPC Call"],
  ["activity_call", "Activity Call"],
  ["switch_case", "Switch Case"],
  ["for_each", "For Each"],
  ["fork", "Fork"],
  ["try_catch", "Try/Catch"],
  ["listen", "Listen"],
  ["wait", "Wait"],
  ["raise_error", "Raise Error"],
  ["run_workflow", "Run Workflow"],
  ["agent_call", "Agent Call"],
  ["llm_call", "LLM Call"],
  ["transform", "Transform"],
  ["human_input", "Human Input"],
  ["validate", "Validate"],
  ["emit_event", "Emit Event"],
  ["notification", "Notification"],
  ["eval", "Evaluate (LLM Judge)"],
]);

/**
 * Returns the functional category for a given task kind string.
 *
 * Replaces the three duplicated `categorizeKind` implementations that
 * previously existed in `workflow-graph-conversions.ts`,
 * `useWorkflowTopology.ts`, and `topologyFromTasks.ts`.
 *
 * Categories align with the proto `TaskKindCategory` enum and the
 * sidecar YAML `category` field — not the drifted client-side Sets
 * that previously classified `validate` as `governance` and `wait`
 * as `event`.
 */
export function categorizeKind(kind: string): TopologyNodeCategory {
  return CATEGORY_FOR_KIND.get(kind) ?? "unspecified";
}

/**
 * Returns the human-readable display name for a task kind.
 *
 * Falls back to title-casing the kind string (e.g. `"my_task"` →
 * `"My Task"`) for unknown kinds, ensuring a reasonable label is
 * always available even before the API registry loads.
 */
export function kindToDisplayName(kind: string): string {
  return DISPLAY_NAME_FOR_KIND.get(kind) ?? titleCaseKind(kind);
}

function titleCaseKind(kind: string): string {
  return kind
    .split("_")
    .map((w) => (w.length === 0 ? "" : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}
