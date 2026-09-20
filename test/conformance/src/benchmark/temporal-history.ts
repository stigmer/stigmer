// Reads what happened BEFORE the runner's activity started, from the Temporal
// history of an agent execution's invoke workflow: the time from the
// workflow's start to the execute activity's start (the control plane's and
// the queue's share of the user's wait), and the EnsureThread hop's own
// duration inside it.
// Domain: conformance benchmark (the Temporal-clock axes).
//
// The history is read through the `temporal` CLI, which the execution lane
// already requires (harness/global-setup-execution.ts) and harness/temporal.ts
// already shells out to; a Temporal client dependency for one read would be a
// second way of doing what the kit does. The workflow id format and the
// activity names are imported from the server's own `names.ts` — pinned wire
// bytes with one home, reached the way the IPC smoke reaches the runner's
// protocol module — never copied.
//
// The JSON shape is the CLI's proto-JSON rendering (`temporal workflow show
// --output json`): `events[].eventType` is the enum name
// (`EVENT_TYPE_ACTIVITY_TASK_SCHEDULED`), each event carries `eventTime`, and
// the started/completed events point at their scheduled event through
// `scheduledEventId`. The fixture beside the unit arm is a captured history,
// so a CLI that changes its rendering fails the arm, not the live run.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ENSURE_THREAD_ACTIVITY_NAME,
  EXECUTE_CURSOR_ACTIVITY_NAME,
  EXECUTE_DEEP_AGENT_ACTIVITY_NAME,
  invokeWorkflowIdFor,
} from "../../../../backend/services/stigmer-server/src/temporal/agentexecution/names";
import type { BenchmarkHarness } from "./report";

const execFileAsync = promisify(execFile);

export { invokeWorkflowIdFor };

/** The runner activity a harness's turn runs as, by the runtime's harness label. */
export function executeActivityNameFor(harness: BenchmarkHarness): string {
  switch (harness) {
    case "deep-agent":
      return EXECUTE_DEEP_AGENT_ACTIVITY_NAME;
    case "cursor":
      return EXECUTE_CURSOR_ACTIVITY_NAME;
    default: {
      const exhaustive: never = harness;
      throw new Error(`unknown harness ${String(exhaustive)}`);
    }
  }
}

export interface HistoryEvent {
  eventId: string;
  eventTime: string;
  eventType: string;
  activityTaskScheduledEventAttributes?: { activityType?: { name?: string } };
  activityTaskStartedEventAttributes?: { scheduledEventId?: string };
  activityTaskCompletedEventAttributes?: { scheduledEventId?: string };
}

export interface WorkflowHistory {
  events: HistoryEvent[];
}

export interface HistoryAxes {
  before_activity_ms: number | null;
  ensure_thread_ms: number | null;
}

/** `temporal workflow show --output json` for one workflow id. */
export async function showWorkflow(hostPort: string, namespace: string, workflowId: string): Promise<WorkflowHistory> {
  const { stdout } = await execFileAsync(
    "temporal",
    ["workflow", "show", "--workflow-id", workflowId, "--address", hostPort, "--namespace", namespace, "--output", "json"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return readWorkflowHistory(JSON.parse(stdout));
}

/** Refuses by name a body that is not a history with an events array. */
export function readWorkflowHistory(body: unknown): WorkflowHistory {
  if (typeof body !== "object" || body === null || !Array.isArray((body as { events?: unknown }).events)) {
    throw new Error("not a Temporal history: expected an object with an events array");
  }
  return body as WorkflowHistory;
}

/**
 * The two Temporal-clock axes. `before_activity_ms` is the workflow's start
 * to the FIRST ActivityTaskStarted whose scheduled event names
 * `executeActivityName`; `ensure_thread_ms` is EnsureThread's scheduled-to-
 * completed. Either is `null` when its events are absent (a run that failed
 * before dispatch, a history the CLI rendered differently).
 */
export function historyAxes(history: WorkflowHistory, executeActivityName: string): HistoryAxes {
  const started = history.events.find((event) => event.eventType === "EVENT_TYPE_WORKFLOW_EXECUTION_STARTED");
  const scheduledById = new Map<string, HistoryEvent>();
  for (const event of history.events) {
    if (event.eventType === "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED") scheduledById.set(event.eventId, event);
  }
  const activityOf = (scheduledEventId: string | undefined): string | undefined =>
    scheduledEventId === undefined
      ? undefined
      : scheduledById.get(scheduledEventId)?.activityTaskScheduledEventAttributes?.activityType?.name;

  const executeStarted = history.events.find(
    (event) =>
      event.eventType === "EVENT_TYPE_ACTIVITY_TASK_STARTED" &&
      activityOf(event.activityTaskStartedEventAttributes?.scheduledEventId) === executeActivityName,
  );
  const ensureScheduled = history.events.find(
    (event) =>
      event.eventType === "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED" &&
      event.activityTaskScheduledEventAttributes?.activityType?.name === ENSURE_THREAD_ACTIVITY_NAME,
  );
  const ensureCompleted =
    ensureScheduled === undefined
      ? undefined
      : history.events.find(
          (event) =>
            event.eventType === "EVENT_TYPE_ACTIVITY_TASK_COMPLETED" &&
            event.activityTaskCompletedEventAttributes?.scheduledEventId === ensureScheduled.eventId,
        );

  return {
    before_activity_ms: elapsedMs(started, executeStarted),
    ensure_thread_ms: elapsedMs(ensureScheduled, ensureCompleted),
  };
}

function elapsedMs(from: HistoryEvent | undefined, to: HistoryEvent | undefined): number | null {
  if (from === undefined || to === undefined) return null;
  const start = Date.parse(from.eventTime);
  const end = Date.parse(to.eventTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) * 10) / 10;
}
