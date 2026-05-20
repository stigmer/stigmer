/**
 * Listen task executor — waits for external events (signals) to arrive.
 *
 * The kernel validates and normalizes the listen configuration, then
 * delegates to `ctx.listen()` which is wired to the Temporal workflow
 * layer's listen-orchestrator. The kernel never imports Temporal types.
 *
 * Supports three consumption strategies:
 * - `to.one`: single event (treated as "wait for all" with 1 event)
 * - `to.all`: wait for ALL events to fire
 * - `to.any`: wait for the FIRST event to fire
 *
 * Each event filter specifies a signal `id` and `type`. Only `type: "signal"`
 * is supported in this phase (query/update deferred to Phase 6).
 *
 * YAML shape:
 *   - waitForApproval:
 *       listen:
 *         to:
 *           one:
 *             with:
 *               id: approval_signal
 *               type: signal
 */

import type {
  ListenTaskDef,
  ListenConfig,
  EventFilter,
  ListenExecutionConfig,
  ListenEventDef,
  WorkflowState,
  TaskExecutionContext,
} from "../types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const SUPPORTED_EVENT_TYPES = ["signal"];

/**
 * Executes a listen task. Called from `runSingleTask` in do-executor
 * when the task kind is "listen".
 */
export async function executeListenTask(
  taskDef: ListenTaskDef,
  taskName: string,
  state: WorkflowState,
  ctx: TaskExecutionContext,
): Promise<unknown> {
  const config = normalizeListenConfig(taskDef.listen, taskName);
  const result = await ctx.listen(config);

  if (result !== undefined && result !== null) {
    state.addData({ [taskName]: result });
  }

  return result;
}

/**
 * Validates and normalizes the raw ListenConfig into a
 * ListenExecutionConfig suitable for the workflow orchestrator.
 */
function normalizeListenConfig(
  listen: ListenConfig,
  taskName: string,
): ListenExecutionConfig {
  const { events, mode } = extractEvents(listen, taskName);
  const timeoutMs = extractTimeout(listen, taskName);

  return { events, mode, timeoutMs };
}

function extractEvents(
  listen: ListenConfig,
  taskName: string,
): { events: ListenEventDef[]; mode: "all" | "any" } {
  const to = listen.to;
  if (!to) {
    throw new Error(`Listen task '${taskName}': 'to' configuration is required`);
  }

  let rawFilters: EventFilter[];
  let mode: "all" | "any";

  if (to.one) {
    rawFilters = [to.one];
    mode = "all";
  } else if (to.all && to.all.length > 0) {
    rawFilters = to.all;
    mode = "all";
  } else if (to.any && to.any.length > 0) {
    rawFilters = to.any;
    mode = "any";
  } else {
    throw new Error(
      `Listen task '${taskName}': at least one event must be defined in 'to.one', 'to.all', or 'to.any'`,
    );
  }

  const events = rawFilters.map((filter, i) => validateEventFilter(filter, taskName, i));
  return { events, mode };
}

function validateEventFilter(
  filter: EventFilter,
  taskName: string,
  index: number,
): ListenEventDef {
  const w = filter.with as Record<string, unknown> | undefined;
  if (!w) {
    throw new Error(
      `Listen task '${taskName}': event[${index}] must have a 'with' configuration`,
    );
  }

  const id = w.id as string | undefined;
  if (!id) {
    throw new Error(
      `Listen task '${taskName}': event[${index}].with.id is required`,
    );
  }

  const type = w.type as string | undefined;
  if (!type) {
    throw new Error(
      `Listen task '${taskName}': event[${index}].with.type is required`,
    );
  }

  if (!SUPPORTED_EVENT_TYPES.includes(type)) {
    throw new Error(
      `Listen task '${taskName}': event[${index}].with.type '${type}' is not supported. ` +
      `Supported types: ${SUPPORTED_EVENT_TYPES.join(", ")}`,
    );
  }

  const acceptIf = w.acceptIf as string | undefined;

  return { id, type, acceptIf };
}

function extractTimeout(listen: ListenConfig, _taskName: string): number {
  const metadata = (listen as unknown as { metadata?: Record<string, unknown> }).metadata;
  if (!metadata?.timeout) return DEFAULT_TIMEOUT_MS;

  const timeoutStr = metadata.timeout;
  if (typeof timeoutStr === "number") return timeoutStr * 1000;
  if (typeof timeoutStr !== "string") return DEFAULT_TIMEOUT_MS;

  const match = timeoutStr.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return DEFAULT_TIMEOUT_MS;

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "ms": return value;
    case "s": return value * 1_000;
    case "m": return value * 60_000;
    case "h": return value * 3_600_000;
    default: return DEFAULT_TIMEOUT_MS;
  }
}
