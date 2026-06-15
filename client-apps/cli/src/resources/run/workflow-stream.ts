// Live `run workflow` streaming over the canonical WorkflowExecutionEvent stream.
//
// Unlike the agent path (which has only status snapshots and so must diff them —
// see resources/stream/headless.ts), WorkflowExecution exposes subscribeEvents:
// an incremental, sequenced, persisted event stream with explicit terminal
// markers. A live run view *is* a timeline view, so we consume that stream
// directly and render through the shared workflow event renderer (B1). This is
// why `run workflow`, `execution logs`, and the web execution viewer all speak
// the same event vocabulary — the server's — instead of a CLI-private one.
//
// Mirrors the *behavior* of Go's streamWorkflowExecution (run_stream.go): render
// progress, resolve bubbled tool approvals via the run's approval policy, stop on
// a terminal state, then print a completion summary. It diverges deliberately on
// the source primitive (events, not snapshots) and on approvals: per the shipped
// decision, workflows have no inline raw-mode prompter, so an approval is either
// resolved by the configured policy (--approve-default / --auto-approve) or left
// for the user to resolve out-of-band via `stigmer execution approve`.

import { create } from "@bufbuild/protobuf";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkflowExecution, WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase, WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import {
  SubmitWorkflowApprovalInputSchema,
  SubscribeEventsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { shouldColorize, type Styler, styler } from "../../output/style.js";
import { calculateDuration } from "../execution-format.js";
import { formatWorkflowPhase } from "../execution.js";
import { APPROVAL_RETRY_BASE_DELAY_MS, APPROVAL_RETRY_MAX_ATTEMPTS, retryWithBackoff } from "../stream/submit.js";
import { toWorkflowEventView } from "../stream/workflow-event-view.js";
import { renderWorkflowEventPlaintext } from "../stream/workflow-render-plaintext.js";
import { workflowEventToNdjson } from "../stream/workflow-render-ndjson.js";

/** Output mode for the run stream: human (inline) lines or NDJSON. */
export type RunOutputMode = "inline" | "json";

export interface WorkflowStreamDeps {
  readonly client: Stigmer;
  readonly executionId: string;
  readonly outputMode: RunOutputMode;
  /** Approval policy: APPROVE_ALL when --auto-approve, else --approve-default (or UNSPECIFIED). */
  readonly defaultAction: ApprovalAction;
}

/** Output sinks; defaults to stdout (events) + stderr (notices/summary). */
export interface WorkflowStreamStreams {
  data(line: string): void;
  status(line: string): void;
  readonly colorize: boolean;
}

/**
 * Stream a workflow execution to a terminal state, then print a summary. Returns
 * the authoritative final execution (a final Get), mirroring the agent path's
 * return for symmetry. Ctrl-C aborts the subscription cleanly.
 */
export async function streamWorkflowExecution(
  deps: WorkflowStreamDeps,
  streams: WorkflowStreamStreams = defaultStreams(),
): Promise<WorkflowExecution> {
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const resolved = new Set<string>();
  try {
    const stream = deps.client.workflowExecution.subscribeEvents(
      create(SubscribeEventsRequestSchema, { executionId: deps.executionId }),
      controller.signal,
    );
    for await (const event of stream) {
      renderEvent(event, deps.outputMode, streams);
      await maybeResolveApproval(event, deps, streams, resolved, controller.signal);
      if (toWorkflowEventView(event).terminal) break;
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }

  return runWorkflowEpilogue(deps.client, deps.executionId, streams);
}

function renderEvent(event: WorkflowExecutionEvent, mode: RunOutputMode, streams: WorkflowStreamStreams): void {
  if (mode === "json") {
    streams.data(`${JSON.stringify(workflowEventToNdjson(event))}\n`);
    return;
  }
  renderWorkflowEventPlaintext(event, { write: streams.data }, streams.colorize);
}

// Resolve a bubbled tool approval. With a policy, submit it (retrying transient
// failures); without one, print the manual escape hatch and leave it for the user.
// Each tool_call_id is handled once (mirrors Go's promptedToolCallIDs guard).
async function maybeResolveApproval(
  event: WorkflowExecutionEvent,
  deps: WorkflowStreamDeps,
  streams: WorkflowStreamStreams,
  resolved: Set<string>,
  signal: AbortSignal,
): Promise<void> {
  if (event.payload.case !== "approvalRequested") return;
  const toolCallId = event.payload.value.toolCallId;
  if (toolCallId === "" || resolved.has(toolCallId)) return;
  resolved.add(toolCallId);

  const escapeHatch = `stigmer execution approve ${deps.executionId} --tool-call ${toolCallId} --action approve`;
  if (deps.defaultAction === ApprovalAction.UNSPECIFIED) {
    streams.status(`  ⏳ Approval required for ${toolCallId}. Resolve it with:`);
    streams.status(`     ${escapeHatch}`);
    return;
  }

  await retryWithBackoff(signal, APPROVAL_RETRY_MAX_ATTEMPTS, APPROVAL_RETRY_BASE_DELAY_MS, async () => {
    await deps.client.workflowExecution.submitApproval(
      create(SubmitWorkflowApprovalInputSchema, {
        executionId: deps.executionId,
        toolCallId,
        action: deps.defaultAction,
      }),
    );
  });
  streams.status(`  ✓ Approval auto-resolved (${approvalLabel(deps.defaultAction)}) for ${toolCallId}`);
}

// Final Get + a compact completion summary (port of Go's
// displayWorkflowExecutionComplete, without the panel chrome — to stderr so
// piped event output on stdout stays clean).
async function runWorkflowEpilogue(
  client: Stigmer,
  executionId: string,
  streams: WorkflowStreamStreams,
): Promise<WorkflowExecution> {
  const exec = await client.workflowExecution.get(executionId);
  const style = styler(streams.colorize);
  const status = exec.status;
  const phase = status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  streams.status("");
  streams.status(summaryHeadline(phase, status?.error ?? "", style));

  const duration = calculateDuration(status?.startedAt ?? "", status?.completedAt ?? "");
  if (duration !== "-") streams.status(`  Duration:  ${duration}`);

  const tasks = status?.tasks ?? [];
  const counts = countTasks(tasks);
  streams.status(`  Tasks:     ${tasks.length} total`);
  if (counts.completed > 0) streams.status(`             ${counts.completed} completed`);
  if (counts.failed > 0) streams.status(`             ${counts.failed} failed`);
  if (counts.skipped > 0) streams.status(`             ${counts.skipped} skipped`);

  return exec;
}

function summaryHeadline(phase: ExecutionPhase, error: string, style: Styler): string {
  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
      return style.green("✓ Workflow completed");
    case ExecutionPhase.EXECUTION_FAILED:
      return style.red(`✗ Workflow failed${error !== "" ? `: ${error}` : ""}`);
    case ExecutionPhase.EXECUTION_CANCELLED:
      return style.yellow("Workflow cancelled");
    case ExecutionPhase.EXECUTION_TERMINATED:
      return style.yellow("Workflow terminated");
    default:
      return style.yellow(`Workflow exited (${formatWorkflowPhase(phase)})`);
  }
}

interface TaskCounts {
  completed: number;
  failed: number;
  skipped: number;
}

// Tally terminal task outcomes. Mirrors Go's countWorkflowTasks.
function countTasks(tasks: readonly WorkflowTask[]): TaskCounts {
  const counts: TaskCounts = { completed: 0, failed: 0, skipped: 0 };
  for (const task of tasks) {
    if (task.status === WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED) counts.completed++;
    else if (task.status === WorkflowTaskStatus.WORKFLOW_TASK_FAILED) counts.failed++;
    else if (task.status === WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED) counts.skipped++;
  }
  return counts;
}

function approvalLabel(action: ApprovalAction): string {
  return (ApprovalAction[action] ?? "unspecified").toLowerCase();
}

function defaultStreams(): WorkflowStreamStreams {
  return {
    data: (line) => void process.stdout.write(line),
    status: (line) => void process.stderr.write(`${line}\n`),
    colorize: shouldColorize(process.stderr),
  };
}
