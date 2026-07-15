import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { TopologyNodeCategory } from "../useWorkflowTopology.js";
import { categorizeKind } from "../kind-metadata.js";
import { taskKindToString } from "../workflow-graph-conversions.js";

/**
 * Presentation variant for a task card in the workflow task thread.
 *
 * Deliberately NOT a new task-kind classification (D-T02-3): variants are a
 * thin presentation projection of the canonical categories from
 * `kind-metadata.ts` (`categorizeKind` — the single source of truth that
 * already consolidated three drifted client-side classifications), plus one
 * kind-level special case for the flagship `agent_call` card.
 *
 * - `agent-call` — the flagship: live agent slug, current tool, message and
 *   tool-call counts, transcript expansion (D-T02-2).
 * - `control` — control-flow tasks (switch/fork/for-each/try-catch/wait).
 * - `gate` — governance tasks (human_input); the stop-sign of the thread.
 * - `event` — signal/timing tasks (listen/emit/notification/raise-error).
 * - `action` — everything else (invocations, data transforms, LLM calls);
 *   also the fallback for `unspecified` kinds, which the snapshot-derived
 *   fallback task map produces when the event log is empty.
 */
export type WorkflowThreadCardVariant =
  | "agent-call"
  | "control"
  | "gate"
  | "event"
  | "action";

/**
 * Canonical category → card variant. Data, not branches — the same table
 * pattern the graph's visual registry and the session's tool taxonomy use.
 */
const VARIANT_FOR_CATEGORY: ReadonlyMap<
  TopologyNodeCategory,
  WorkflowThreadCardVariant
> = new Map([
  ["ai", "action"], // agent_call is special-cased below; llm_call/eval read as actions
  ["control_flow", "control"],
  ["invocation", "action"],
  ["data", "action"],
  ["governance", "gate"],
  ["event", "event"],
  ["unspecified", "action"],
]);

/**
 * Resolves the thread card variant for a task kind.
 *
 * `agent_call` is the one kind-level special case (the flagship card);
 * every other kind flows through the canonical category classification.
 */
export function threadCardVariant(
  kind: WorkflowTaskKind,
): WorkflowThreadCardVariant {
  if (kind === WorkflowTaskKind.agent_call) return "agent-call";
  return VARIANT_FOR_CATEGORY.get(categorizeKind(taskKindToString(kind))) ?? "action";
}
