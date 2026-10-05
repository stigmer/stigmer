/**
 * Create-pipeline steps — the initial PENDING phase and the post-persist
 * Temporal start, whose failure marks the execution FAILED (recoverable
 * via Recover). A run names its workflow (`spec.workflow_id`, required by
 * the proto rule ValidateProto enforces); the workflow is loaded and the
 * run pinned by PinWorkflowVersion (pin-workflow-version-step.ts).
 *
 * The engine gate itself lives in engine.ts (shared shape with the
 * sibling domain); its pinned position is before every side effect of the
 * create chain.
 */
import { create } from "@bufbuild/protobuf";

import {
  WorkflowExecutionSchema,
  WorkflowExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Store } from "../../store/interface.js";

import type { WorkflowExecutionEngineStateProvider } from "./engine.js";

type ExecutionDesc = typeof WorkflowExecutionSchema;

/**
 * SetInitialPhase — PENDING before the Temporal workflow starts, so the
 * frontend shows a thinking indicator immediately.
 */
export function newSetInitialPhaseStep(): PipelineStep<ExecutionDesc> {
  return {
    name: "SetInitialPhase",
    execute(ctx) {
      const execution = ctx.newState;
      if (execution.status === undefined) {
        execution.status = create(WorkflowExecutionStatusSchema);
      }
      execution.status.phase = ExecutionPhase.EXECUTION_PENDING;
    },
  };
}

export interface StartWorkflowDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly engineState: WorkflowExecutionEngineStateProvider;
}

/**
 * StartWorkflow — create.go startWorkflowStep: runs AFTER persist. Engine
 * availability was guaranteed by the create gate, so a failure here is a
 * live/transient Temporal error: the execution is marked FAILED with the
 * error text and persisted (recoverable via Recover), then the RPC
 * answers Internal. Dispatch-queue resolution lives inside the engine
 * client, fed by spec.execution_target.
 */
export function newStartWorkflowStep(
  deps: StartWorkflowDeps,
): PipelineStep<ExecutionDesc> {
  return {
    name: "StartWorkflow",
    async execute(ctx) {
      const execution = ctx.newState;
      const executionId = execution.metadata?.id ?? "";

      const engineState = deps.engineState();
      // Reached only if the engine disconnects between the gate and here; modeled the same way Go's non-nil assumption is — a
      // loud failure, not a silent skip.
      let startError: Error | undefined;
      if (!engineState.connected) {
        startError = new Error(
          "workflow engine disconnected after the create gate",
        );
      } else {
        try {
          await engineState.engine.startInvokeWorkflow({
            executionId,
            workflowId: execution.spec?.workflowId ?? "",
            orgId: execution.metadata?.org ?? "",
            recoveryMode: false,
            executionTarget: execution.spec?.executionTarget ?? 0,
          });
        } catch (error) {
          startError =
            error instanceof Error ? error : new Error(String(error));
        }
      }

      if (startError === undefined) {
        deps.logger.info("Temporal workflow started successfully", {
          executionId,
        });
        return;
      }

      deps.logger.error(
        "Failed to start Temporal workflow - marking execution as FAILED",
        { executionId, error: startError.message },
      );
      if (execution.status === undefined) {
        execution.status = create(WorkflowExecutionStatusSchema);
      }
      execution.status.phase = ExecutionPhase.EXECUTION_FAILED;
      execution.status.error = `Failed to start Temporal workflow: ${goErrorText(startError)}`;
      try {
        await deps.store.saveResource(
          ApiResourceKind.workflow_execution,
          executionId,
          WorkflowExecutionSchema,
          execution,
        );
      } catch (persistError) {
        throw internalError(
          persistError,
          "failed to start workflow and failed to update status",
        );
      }
      throw internalError(startError, "failed to start workflow");
    },
  };
}

/**
 * The %v rendering Go embeds in status.error: a ConnectError renders as
 * grpc-go wire text via its message; plain errors as their message.
 */
function goErrorText(error: Error): string {
  return error.message;
}
