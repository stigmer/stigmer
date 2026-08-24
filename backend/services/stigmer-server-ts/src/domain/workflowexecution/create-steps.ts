/**
 * Create-pipeline steps — ports create.go's inline steps: the
 * workflow-or-instance presence validation (the #196 InvalidArgument
 * contrast to agentexecution's Internal invariant), the self-healing
 * default-instance resolution, the initial PENDING phase, and the
 * post-persist Temporal start whose failure marks the execution FAILED
 * (recoverable via Recover).
 *
 * The engine gate itself lives in engine.ts (shared shape with the
 * sibling domain); its pinned position is step 4 of the create chain.
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/status_pb";
import {
  WorkflowExecutionSchema,
  WorkflowExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Store } from "../../store/interface.js";
import { fromBinary } from "@bufbuild/protobuf";

import { defaultWorkflowInstanceSlug } from "../workflowinstance/defaultinstance.js";
import { buildDefaultWorkflowInstanceRequest } from "../workflowinstance/defaultinstance.js";

import type { WorkflowExecutionEngineStateProvider } from "./engine.js";

type ExecutionDesc = typeof WorkflowExecutionSchema;

/**
 * The narrow workflowinstance CREATE edge (Go
 * workflowInstanceClient.CreateAsSystem) — consumer-defined so the
 * dependency reads at the domain boundary; satisfied by the in-process
 * workflowinstance command client under the process-global operator
 * identity.
 */
export interface ExecutionWorkflowInstanceCreator {
  createAsSystem(instance: WorkflowInstance): Promise<WorkflowInstance>;
}
export type ExecutionWorkflowInstanceCreatorProvider =
  () => ExecutionWorkflowInstanceCreator;

/**
 * ValidateWorkflowOrInstance — at least one of workflow_id /
 * workflow_instance_id must be provided. Matches the cloud
 * WorkflowExecutionCreateHandler. AgentExecution differs: it has a
 * ResolveDefaultAgent step, so its guard is an unreachable invariant
 * (Internal), not reachable InvalidArgument validation (issue #196).
 */
export function newValidateWorkflowOrInstanceStep(): PipelineStep<ExecutionDesc> {
  return {
    name: "ValidateWorkflowOrInstance",
    execute(ctx) {
      const spec = ctx.input.spec;
      if (
        (spec?.workflowInstanceId ?? "") === "" &&
        (spec?.workflowId ?? "") === ""
      ) {
        throw invalidArgumentError(
          "either workflow_id or workflow_instance_id must be provided",
        );
      }
    },
  };
}

export interface CreateDefaultInstanceDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly workflowInstanceCreator: ExecutionWorkflowInstanceCreatorProvider;
}

/**
 * CreateDefaultInstanceIfNeeded — create.go: when only workflow_id is
 * provided, resolve (or provision) the workflow's default instance:
 *
 *   1. load the workflow (NotFound if missing);
 *   2. use status.default_instance_id when set;
 *   3. else look the instance up by its deterministic slug — the
 *      self-heal for a past run where the instance was created but the
 *      workflow status write failed (prevents duplicate-slug errors);
 *   4. else create it via the in-process client (CreateAsSystem) and
 *      write default_instance_id back onto the workflow.
 *
 * Every path stamps the resolved id onto execution.spec.
 * workflow_instance_id, which downstream steps (EC creation, workflow
 * start) read.
 */
export function newCreateDefaultInstanceIfNeededStep(
  deps: CreateDefaultInstanceDeps,
): PipelineStep<ExecutionDesc> {
  return {
    name: "CreateDefaultInstanceIfNeeded",
    async execute(ctx) {
      const input = ctx.input;
      if ((input.spec?.workflowInstanceId ?? "") !== "") {
        return;
      }
      const workflowId = input.spec?.workflowId ?? "";
      const execution = ctx.newState;

      let workflow: Workflow;
      try {
        workflow = await deps.store.getResource(
          ApiResourceKind.workflow,
          workflowId,
          WorkflowSchema,
        );
      } catch {
        throw notFoundError("Workflow", workflowId);
      }

      const defaultInstanceId = workflow.status?.defaultInstanceId ?? "";
      if (defaultInstanceId !== "") {
        setInstanceId(execution, defaultInstanceId);
        return;
      }

      // Self-heal: the instance may exist even though the workflow status
      // write failed on a previous run.
      const slug = defaultWorkflowInstanceSlug(workflow.metadata?.slug ?? "");
      let existingInstance: WorkflowInstance | undefined;
      try {
        existingInstance = await findInstanceBySlug(deps, slug);
      } catch (error) {
        throw internalError(
          error,
          "failed to look up existing default instance",
        );
      }

      if (existingInstance !== undefined) {
        const existingId = existingInstance.metadata?.id ?? "";
        deps.logger.info(
          "Found existing default instance, updating workflow status",
          { instanceId: existingId, workflowId },
        );
        await backfillDefaultInstanceId(
          deps,
          workflow,
          workflowId,
          existingId,
          "failed to update workflow with existing default instance",
        );
        setInstanceId(execution, existingId);
        return;
      }

      deps.logger.info("Default instance not found, creating new one", {
        workflowId,
      });
      const instanceRequest = buildDefaultWorkflowInstanceRequest(
        workflow.metadata!,
      );
      let createdInstance: WorkflowInstance;
      try {
        createdInstance = await deps
          .workflowInstanceCreator()
          .createAsSystem(instanceRequest);
      } catch (error) {
        if (error instanceof ConnectError) {
          // Go wraps the client error with %w — the inner gRPC code
          // survives to the wire (oss#852 convention).
          throw goWrappedStatusError(
            "failed to create default workflow instance",
            error,
          );
        }
        throw internalError(error, "failed to create default workflow instance");
      }

      const createdId = createdInstance.metadata?.id ?? "";
      await backfillDefaultInstanceId(
        deps,
        workflow,
        workflowId,
        createdId,
        "failed to update workflow with default instance",
      );
      setInstanceId(execution, createdId);
      deps.logger.info("Successfully created and registered default instance", {
        instanceId: createdId,
        workflowId,
      });
    },
  };
}

function setInstanceId(
  execution: { spec?: { workflowInstanceId: string } },
  instanceId: string,
): void {
  if (execution.spec !== undefined) {
    execution.spec.workflowInstanceId = instanceId;
  }
}

async function backfillDefaultInstanceId(
  deps: CreateDefaultInstanceDeps,
  workflow: Workflow,
  workflowId: string,
  instanceId: string,
  failureMessage: string,
): Promise<void> {
  const status = workflow.status ?? create(WorkflowStatusSchema);
  workflow.status = status;
  status.defaultInstanceId = instanceId;
  try {
    await deps.store.saveResource(
      ApiResourceKind.workflow,
      workflowId,
      WorkflowSchema,
      workflow,
    );
  } catch (error) {
    throw internalError(error, failureMessage);
  }
}

/**
 * Go findInstanceBySlug: a full workflow_instance scan matched on
 * metadata.slug; malformed rows are skipped.
 */
async function findInstanceBySlug(
  deps: CreateDefaultInstanceDeps,
  slug: string,
): Promise<WorkflowInstance | undefined> {
  const rows = await deps.store.listResources(
    ApiResourceKind.workflow_instance,
  );
  for (const data of rows) {
    let instance: WorkflowInstance;
    try {
      instance = fromBinary(WorkflowInstanceSchema, data);
    } catch {
      deps.logger.warn(
        "Failed to unmarshal workflow instance during slug lookup",
      );
      continue;
    }
    if (instance.metadata?.slug === slug) {
      return instance;
    }
  }
  return undefined;
}

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
 * availability was guaranteed by the step-4 gate, so a failure here is a
 * live/transient Temporal error: the execution is marked FAILED with the
 * error text and persisted (recoverable via Recover), then the RPC
 * answers Internal. Dispatch-queue resolution lives inside the engine
 * (#21), fed by spec.execution_target.
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
      // Unreachable while the gate holds (the engine cannot flip between
      // step 4 and here pre-#21); modeled the same way Go's non-nil
      // assumption is — a loud failure, not a silent skip.
      let startError: Error | undefined;
      if (!engineState.connected) {
        startError = new Error(
          "workflow engine disconnected after the create gate",
        );
      } else {
        try {
          await engineState.engine.startInvokeWorkflow({
            executionId,
            workflowInstanceId: execution.spec?.workflowInstanceId ?? "",
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
