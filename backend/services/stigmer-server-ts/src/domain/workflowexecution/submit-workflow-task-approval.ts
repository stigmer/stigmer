/**
 * SubmitWorkflowTaskApproval — ports submit_workflow_task_approval.go
 * (T13c): a human reviewer's decision for a workflow-level human_input
 * task. Constructs the runner's HumanInputResult signal payload, wraps it
 * in the relaySignal envelope on the `human_input_{task}` channel, and
 * delivers via SignalWithStart (the orchestrator forwards to the TS child
 * where the task is blocking).
 *
 * Quirk ported faithfully: the SignalWithStart input's workflowId field
 * carries status.temporal_workflow_id (NOT spec.workflow_id — every other
 * sender passes the spec reference).
 *
 * Reviewer attribution: OSS is single-user; an explicit client-supplied
 * reviewer is honored, otherwise it stays empty ("Empty when not
 * attributed"). Cloud attributes server-side from the authenticated
 * caller.
 */
import type { JsonValue } from "@bufbuild/protobuf";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import {
  ExecutionPhase,
  WorkflowTaskType,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { SubmitWorkflowTaskApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  unavailableError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import type { Store } from "../../store/interface.js";

import {
  HUMAN_INPUT_SIGNAL_PREFIX,
  RELAY_SIGNAL_CHANNEL_NAME,
} from "./constants.js";
import type { WorkflowExecutionEngineStateProvider } from "./engine.js";

export interface SubmitWorkflowTaskApprovalDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly engineState: WorkflowExecutionEngineStateProvider;
}

type TaskApprovalDesc =
  typeof WorkflowExecutionCommandController.method.submitWorkflowTaskApproval.input;

const LOADED_EXECUTION_KEY = "loadedExecution";

export async function submitWorkflowTaskApproval(
  deps: SubmitWorkflowTaskApprovalDeps,
  input: SubmitWorkflowTaskApprovalInput,
): Promise<WorkflowExecution> {
  const reqCtx = new RequestContext(
    WorkflowExecutionCommandController.method.submitWorkflowTaskApproval.input,
    input,
    ApiResourceKind.workflow_execution,
  );
  await newPipeline<TaskApprovalDesc>(
    "workflowexecution-submit-task-approval",
    deps.logger,
  )
    .addStep({
      name: "ValidateTaskApprovalInput",
      execute(ctx) {
        if (ctx.input.executionId === "") {
          throw invalidArgumentError("execution_id is required");
        }
        if (ctx.input.taskName === "") {
          throw invalidArgumentError("task_name is required");
        }
        if (ctx.input.outcome === "") {
          throw invalidArgumentError("outcome is required");
        }
      },
    })
    .addStep({
      name: "LoadExecutionForApproval",
      async execute(ctx) {
        let execution: WorkflowExecution;
        try {
          execution = await deps.store.getResource(
            ApiResourceKind.workflow_execution,
            ctx.input.executionId,
            WorkflowExecutionSchema,
          );
        } catch {
          throw notFoundError("WorkflowExecution", ctx.input.executionId);
        }
        ctx.set(LOADED_EXECUTION_KEY, execution);
      },
    })
    .addStep({
      name: "ValidateApprovalSignalable",
      execute(ctx) {
        const execution = ctx.get(LOADED_EXECUTION_KEY) as WorkflowExecution;
        const phase =
          execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
        if (
          phase !== ExecutionPhase.EXECUTION_PENDING &&
          phase !== ExecutionPhase.EXECUTION_IN_PROGRESS
        ) {
          throw failedPreconditionError(
            `cannot submit task approval: execution is in ${ExecutionPhase[phase]} phase`,
          );
        }
      },
    })
    .addStep({
      name: "ValidateHumanInputTask",
      execute(ctx) {
        const execution = ctx.get(LOADED_EXECUTION_KEY) as WorkflowExecution;
        const taskName = ctx.input.taskName;
        const task = (execution.status?.tasks ?? []).find(
          (candidate) => candidate.taskName === taskName,
        );
        if (task === undefined) {
          throw invalidArgumentError(
            `task '${taskName}' not found in execution status`,
          );
        }
        if (task.taskType !== WorkflowTaskType.WORKFLOW_TASK_APPROVAL) {
          throw invalidArgumentError(
            `task '${taskName}' is not a human_input task (type: ${WorkflowTaskType[task.taskType]})`,
          );
        }
      },
    })
    .addStep({
      name: "SendTaskApprovalSignal",
      async execute(ctx) {
        const execution = ctx.get(LOADED_EXECUTION_KEY) as WorkflowExecution;
        const executionId = ctx.input.executionId;
        const humanInputSignalName =
          HUMAN_INPUT_SIGNAL_PREFIX + ctx.input.taskName;

        const signalPayload: Record<string, JsonValue> = {
          outcome: ctx.input.outcome,
          reviewer: ctx.input.reviewer,
          // Go time.Now().UTC().Format(time.RFC3339): seconds precision.
          responded_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        };
        if (ctx.input.formData !== undefined) {
          signalPayload["form_data"] = ctx.input.formData as JsonValue;
        }
        if (ctx.input.comment !== "") {
          signalPayload["comment"] = ctx.input.comment;
        }

        const engineState = deps.engineState();
        if (!engineState.connected) {
          throw unavailableError(
            `workflow creator not configured for task '${ctx.input.taskName}'`,
          );
        }
        try {
          await engineState.engine.signalWithStart(
            {
              executionId,
              workflowInstanceId: execution.spec?.workflowInstanceId ?? "",
              // Go's quirk: the temporal workflow id, not spec.workflow_id.
              workflowId: execution.status?.temporalWorkflowId ?? "",
              orgId: execution.metadata?.org ?? "",
              recoveryMode: false,
              executionTarget: execution.spec?.executionTarget ?? 0,
            },
            RELAY_SIGNAL_CHANNEL_NAME,
            { signalName: humanInputSignalName, payload: signalPayload },
          );
        } catch (error) {
          throw unavailableError(
            `failed to send approval signal for task '${ctx.input.taskName}': ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        deps.logger.info(
          "AUDIT: Workflow task approval submitted via relaySignal",
          {
            executionId,
            taskName: ctx.input.taskName,
            outcome: ctx.input.outcome,
            signalName: humanInputSignalName,
          },
        );
      },
    })
    .build()
    .execute(reqCtx);

  const execution = reqCtx.get(LOADED_EXECUTION_KEY);
  if (execution === undefined) {
    throw internalError(
      new Error("execution not found in context after pipeline"),
      "execution not found in context after pipeline",
    );
  }
  return execution as WorkflowExecution;
}
