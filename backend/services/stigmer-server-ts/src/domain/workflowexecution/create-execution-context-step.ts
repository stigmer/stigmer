/**
 * CreateExecutionContext — ports create_execution_context_step.go: builds
 * and persists the ExecutionContext carrying the fully-merged environment
 * for the run, then strips spec.runtime_env so secrets never reach the
 * persisted execution or Temporal history.
 *
 * Resolution chain: execution.spec.workflow_instance_id (always set by
 * CreateDefaultInstanceIfNeeded) → instance.environment_refs resolved
 * through the environment RuntimeResolutionService (decrypted — the RPC
 * surface redacts, oss#405) → envmerge with spec.runtime_env as the top
 * layer → least-privilege filter against the workflow's env declarations
 * (undeclared keys warn + drop; empty declarations pass everything for
 * backward compatibility) → required-key validation (warn-only) →
 * ExecutionContext create through the in-process client.
 *
 * Go skips the whole step when its late-injected deps are nil; the TS
 * composition root wires them unconditionally, so that arm is
 * structurally unreachable here and deliberately not modeled (the
 * loud-boot doctrine: a missing dependency is a wiring bug, not a mode).
 *
 * The recover pipeline's RecreateExecutionContext twin lives in
 * lifecycle.ts — its failure posture differs (degrade gracefully).
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { RuntimeResolutionService } from "../../domain/environment/resolution/resolution.js";
import {
  filterByDeclaredKeys,
  mergeEnvironmentLayers,
  validateRequiredKeys,
} from "../../envmerge/envmerge.js";
import {
  goWrappedStatusError,
  internalError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { Store } from "../../store/interface.js";

/**
 * The narrow workflowinstance READ edge (Go workflowInstanceClient.Get)
 * — consumer-defined, satisfied by the in-process query client.
 */
export interface ExecutionWorkflowInstanceLoader {
  get(instanceId: string): Promise<WorkflowInstance>;
}
export type ExecutionWorkflowInstanceLoaderProvider =
  () => ExecutionWorkflowInstanceLoader;

/** The narrow executioncontext CREATE edge (Go executionCtxClient.Create). */
export interface WorkflowExecutionContextCreator {
  create(executionContext: ExecutionContext): Promise<ExecutionContext>;
}
export type WorkflowExecutionContextCreatorProvider =
  () => WorkflowExecutionContextCreator;

export interface WorkflowExecutionContextBuilderDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly workflowInstanceLoader: ExecutionWorkflowInstanceLoaderProvider;
  /** The decrypt-for-execution path (oss#405); a direct service, no RPC. */
  readonly environmentResolution: RuntimeResolutionService;
  readonly executionContextCreator: WorkflowExecutionContextCreatorProvider;
}

export function newCreateExecutionContextStep(
  deps: WorkflowExecutionContextBuilderDeps,
): PipelineStep<typeof WorkflowExecutionSchema> {
  return {
    name: "CreateExecutionContext",
    async execute(ctx) {
      const execution = ctx.newState;
      const executionId = execution.metadata?.id ?? "";
      const executionOrg = execution.metadata?.org ?? "";

      // CreateDefaultInstanceIfNeeded always stamps this, user-provided
      // or auto-resolved.
      const workflowInstanceId = execution.spec?.workflowInstanceId ?? "";
      if (workflowInstanceId === "") {
        throw internalError(
          new Error(
            "workflow_instance_id not resolved from context or execution spec",
          ),
          "workflow_instance_id not resolved from context or execution spec",
        );
      }

      let instance: WorkflowInstance;
      try {
        instance = await deps.workflowInstanceLoader().get(workflowInstanceId);
      } catch (error) {
        if (error instanceof ConnectError) {
          throw goWrappedStatusError(
            `load workflow instance ${workflowInstanceId}`,
            error,
          );
        }
        throw internalError(
          error,
          `load workflow instance ${workflowInstanceId}`,
        );
      }

      const workflowId = instance.spec?.workflowId ?? "";
      let workflow: Workflow;
      try {
        workflow = await deps.store.getResource(
          ApiResourceKind.workflow,
          workflowId,
          WorkflowSchema,
        );
      } catch (error) {
        throw internalError(error, `load workflow ${workflowId}`);
      }

      const environments = await resolveEnvironments(
        deps,
        instance.spec?.environmentRefs ?? [],
      );

      const merged = mergeEnvironmentLayers(
        environments,
        execution.spec?.runtimeEnv ?? {},
      );

      // Least-privilege whitelist: workflows only receive declared vars.
      const workflowEnvDecls = workflow.spec?.env ?? {};
      const { filtered, excludedKeys } = filterByDeclaredKeys(
        merged,
        workflowEnvDecls,
      );
      if (excludedKeys.length > 0) {
        deps.logger.warn("Filtered env vars not declared in workflow env", {
          executionId,
          workflowId,
          excludedKeys,
        });
      }

      const missingRequired = validateRequiredKeys(filtered, workflowEnvDecls);
      if (missingRequired.length > 0) {
        deps.logger.warn(
          "Required env vars missing after environment merge — execution may fail",
          { executionId, workflowId, missingRequired },
        );
      }

      const executionContext = create(ExecutionContextSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "ExecutionContext",
        metadata: {
          name: `exec-ctx-${executionId}`,
          org: executionOrg,
        },
        spec: {
          executionId,
          data: Object.fromEntries(filtered),
        },
      });

      try {
        const created = await deps
          .executionContextCreator()
          .create(executionContext);
        deps.logger.info("Successfully created execution context", {
          executionContextId: created.metadata?.id ?? "",
          executionId,
          dataEntries: filtered.size,
        });
      } catch (error) {
        if (error instanceof ConnectError) {
          throw goWrappedStatusError(
            `create execution context for ${executionId}`,
            error,
          );
        }
        throw internalError(
          error,
          `create execution context for ${executionId}`,
        );
      }

      // runtime_env is a transient creation-time input, now materialized
      // in the ExecutionContext; clearing it keeps secrets out of the
      // persisted execution and Temporal history.
      if (
        execution.spec !== undefined &&
        Object.keys(execution.spec.runtimeEnv).length > 0
      ) {
        execution.spec.runtimeEnv = {};
      }
    },
  };
}

/**
 * Fetches each referenced Environment in order through the runtime
 * resolution service (decrypted values; the RPC surface redacts,
 * oss#405). A failed ref fails the create — Go wraps with the ref
 * coordinates.
 */
async function resolveEnvironments(
  deps: WorkflowExecutionContextBuilderDeps,
  refs: ApiResourceReference[],
): Promise<Environment[]> {
  if (refs.length === 0) {
    return [];
  }
  const environments: Environment[] = [];
  for (const ref of refs) {
    try {
      environments.push(await deps.environmentResolution.resolveByReference(ref));
    } catch (error) {
      const prefix = `resolve environment ref (org=${ref.org}, slug=${ref.slug})`;
      if (error instanceof ConnectError) {
        throw goWrappedStatusError(prefix, error);
      }
      throw internalError(error, prefix);
    }
  }
  return environments;
}
