/**
 * Local activities for emitting workflow execution events.
 *
 * Converts plain event descriptors (safe for the Temporal deterministic
 * sandbox) into WorkflowExecutionEvent proto objects and sends them
 * alongside a status update via gRPC. Best-effort — failures are logged
 * but do not fail the activity.
 *
 * Registered as proxyLocalActivities in engine-core.ts so the workflow
 * sandbox can emit events at task boundaries and approval gates.
 */

import { StigmerClient } from "../client/stigmer-client.js";
import { loadConfig } from "../config.js";
import { create } from "@bufbuild/protobuf";
import {
  WorkflowExecutionEventSchema,
  type WorkflowExecutionEvent,
  WorkflowEventType,
  ExecutionStartedPayloadSchema,
  ExecutionCompletedPayloadSchema,
  ExecutionFailedPayloadSchema,
  TaskStartedPayloadSchema,
  TaskCompletedPayloadSchema,
  TaskFailedPayloadSchema,
  TaskSkippedPayloadSchema,
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  AgentCallStartedPayloadSchema,
  AgentCallCompletedPayloadSchema,
  HumanInputOutcomeInfoSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowExecutionStatusSchema, WorkflowTaskSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  WorkflowExecutionUpdateStatusInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ExecutionPhase, WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowEventDescriptor } from "../workflow-engine/types.js";
import type { TaskStatusEntry } from "../workflow-engine/task-status-accumulator.js";

const TASK_STATUS_MAP: Record<TaskStatusEntry["status"], WorkflowTaskStatus> = {
  started: WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS,
  completed: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
  failed: WorkflowTaskStatus.WORKFLOW_TASK_FAILED,
  skipped: WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED,
  waiting_approval: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
};

const TASK_KIND_MAP: Record<string, number> = {
  "set": 1,
  "call:agent": 2,
  "call:http": 3,
  "call:grpc": 4,
  "call:function": 5,
  "do": 6,
  "for": 7,
  "fork": 8,
  "listen": 9,
  "switch": 10,
  "try": 11,
  "wait": 12,
  "raise": 13,
  "run": 14,
  "human_input": 16,
};

function buildClient(): StigmerClient {
  const config = loadConfig();
  return new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: config.stigmerToken,
  });
}

let sequenceCounter = 0;

function nextSequence(): bigint {
  sequenceCounter += 1;
  return BigInt(sequenceCounter);
}

export async function resetSequenceCounter(): Promise<void> {
  sequenceCounter = 0;
}

/** @internal Exported for unit testing only. */
export function toProtoEvent(desc: WorkflowEventDescriptor): WorkflowExecutionEvent {
  const base = create(WorkflowExecutionEventSchema, {
    eventId: crypto.randomUUID(),
    sequenceNumber: nextSequence(),
    occurredAt: desc.occurredAt,
    taskName: desc.taskName ?? "",
  });

  switch (desc.type) {
    case "execution_started":
      base.eventType = WorkflowEventType.execution_started;
      base.payload = {
        case: "executionStarted",
        value: create(ExecutionStartedPayloadSchema, {
          totalTasks: desc.totalTasks,
          workflowId: desc.workflowId,
          workflowInstanceId: desc.workflowInstanceId,
        }),
      };
      break;

    case "execution_completed":
      base.eventType = WorkflowEventType.execution_completed;
      base.payload = {
        case: "executionCompleted",
        value: create(ExecutionCompletedPayloadSchema, {
          durationMs: BigInt(desc.durationMs),
          totalCostMicros: BigInt(desc.totalCostMicros),
          totalTokens: BigInt(desc.totalTokens),
        }),
      };
      break;

    case "execution_failed":
      base.eventType = WorkflowEventType.execution_failed;
      base.payload = {
        case: "executionFailed",
        value: create(ExecutionFailedPayloadSchema, {
          error: desc.error,
          failedTaskName: desc.failedTaskName,
          durationMs: BigInt(desc.durationMs),
        }),
      };
      break;

    case "task_started":
      base.eventType = WorkflowEventType.task_started;
      base.payload = {
        case: "taskStarted",
        value: create(TaskStartedPayloadSchema, {
          taskKind: TASK_KIND_MAP[desc.taskKind] ?? 0,
          attemptNumber: desc.attemptNumber,
        }),
      };
      break;

    case "task_completed":
      base.eventType = WorkflowEventType.task_completed;
      base.payload = {
        case: "taskCompleted",
        value: create(TaskCompletedPayloadSchema, {
          taskKind: TASK_KIND_MAP[desc.taskKind] ?? 0,
          durationMs: BigInt(desc.durationMs),
          costMicros: BigInt(desc.costMicros),
          tokensUsed: BigInt(desc.tokensUsed),
        }),
      };
      break;

    case "task_failed":
      base.eventType = WorkflowEventType.task_failed;
      base.payload = {
        case: "taskFailed",
        value: create(TaskFailedPayloadSchema, {
          taskKind: TASK_KIND_MAP[desc.taskKind] ?? 0,
          error: desc.error,
          attemptNumber: desc.attemptNumber,
          willRetry: desc.willRetry,
          durationMs: BigInt(desc.durationMs),
        }),
      };
      break;

    case "task_skipped":
      base.eventType = WorkflowEventType.task_skipped;
      base.payload = {
        case: "taskSkipped",
        value: create(TaskSkippedPayloadSchema, {
          taskKind: TASK_KIND_MAP[desc.taskKind] ?? 0,
          reason: desc.reason,
        }),
      };
      break;

    case "approval_requested":
      base.eventType = WorkflowEventType.approval_requested;
      base.payload = {
        case: "approvalRequested",
        value: create(ApprovalRequestedPayloadSchema, {
          prompt: desc.prompt,
          approvers: [...desc.approvers],
          timeoutSeconds: desc.timeoutSeconds,
          outcomes: desc.outcomes.map((o) =>
            create(HumanInputOutcomeInfoSchema, { name: o.name, label: o.label }),
          ),
          formSchema: desc.formSchema
            ? (desc.formSchema as JsonObject)
            : undefined,
        }),
      };
      break;

    case "approval_resolved":
      base.eventType = WorkflowEventType.approval_resolved;
      base.payload = {
        case: "approvalResolved",
        value: create(ApprovalResolvedPayloadSchema, {
          resolvedBy: desc.resolvedBy,
          comment: desc.comment,
          waitDurationMs: BigInt(desc.waitDurationMs),
        }),
      };
      break;

    case "agent_call_started":
      base.eventType = WorkflowEventType.agent_call_started;
      base.payload = {
        case: "agentCallStarted",
        value: create(AgentCallStartedPayloadSchema, {
          childExecutionId: desc.childExecutionId,
          agentSlug: desc.agentSlug,
          messageSummary: desc.messageSummary,
        }),
      };
      break;

    case "agent_call_completed":
      base.eventType = WorkflowEventType.agent_call_completed;
      base.payload = {
        case: "agentCallCompleted",
        value: create(AgentCallCompletedPayloadSchema, {
          childExecutionId: desc.childExecutionId,
          durationMs: BigInt(desc.durationMs),
          tokensConsumed: BigInt(desc.tokensConsumed),
          costMicros: BigInt(desc.costMicros),
          error: desc.error,
        }),
      };
      break;
  }

  return base;
}

export async function emitWorkflowEvents(
  executionId: string,
  events: WorkflowEventDescriptor[],
  taskStatuses?: TaskStatusEntry[],
): Promise<void> {
  if (!executionId || events.length === 0) return;

  try {
    const client = buildClient();
    const protoEvents = events.map(toProtoEvent);

    const protoTasks = (taskStatuses ?? []).map(ts =>
      create(WorkflowTaskSchema, {
        taskName: ts.taskName,
        status: TASK_STATUS_MAP[ts.status],
        startedAt: ts.startedAt ?? "",
        completedAt: ts.completedAt ?? "",
        error: ts.error ?? "",
      }),
    );

    const startedEvent = events.find(e => e.type === "execution_started");

    const input = create(WorkflowExecutionUpdateStatusInputSchema, {
      executionId,
      status: create(WorkflowExecutionStatusSchema, {
        tasks: protoTasks,
        ...(startedEvent && {
          phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
          startedAt: startedEvent.occurredAt,
        }),
      }),
      events: protoEvents,
    });
    await client.workflowExecutionCommand.updateStatus(input);
  } catch (err) {
    console.error(
      `Failed to emit ${events.length} workflow event(s) for ${executionId}:`,
      err,
    );
  }
}

export function createWorkflowEventActivities() {
  return {
    EmitWorkflowEvents: emitWorkflowEvents,
    ResetEventSequence: resetSequenceCounter,
  };
}
