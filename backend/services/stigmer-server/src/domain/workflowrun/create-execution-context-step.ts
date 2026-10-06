/**
 * CreateExecutionContext — builds and persists the ExecutionContext
 * carrying a workflow run's environment, then strips spec.runtime_env so
 * secrets never reach the persisted execution or Temporal history.
 *
 * Where a run's keys come from (`workflowRunEnvironment`, shared with
 * recover's RecreateExecutionContext in lifecycle.ts):
 *   1. spec.runtime_env, what the caller passed with the run;
 *   2. the least-privilege filter against the workflow's env declarations
 *      (undeclared keys warn and drop; a workflow that declares nothing
 *      passes everything through, for backward compatibility);
 *   3. every declared key still missing, from the personal environment of
 *      the run's person (agentexecution/run-person.ts
 *      `workflowRunPersonOf`: whoever started the run, read from the row,
 *      so recover rebuilds what create built), by the one rule agent
 *      turns follow (environment/personal.ts
 *      `fillDeclaredFromPersonalEnvironment`): none for a workflow of
 *      another organization than the run, every failure non-fatal;
 *   4. a required key still missing only warns — the run fails at the
 *      step that needs it with a clearer error.
 *
 * The declarations are the workflow row PinWorkflowVersion loaded and
 * pinned (pin-workflow-version-step.ts), never a second load, so the keys
 * a run declares are the version it runs.
 *
 * Go skips the whole step when its late-injected deps are nil; the TS
 * composition root wires them unconditionally, so that arm is
 * structurally unreachable here and deliberately not modeled (the
 * loud-boot doctrine: a missing dependency is a wiring bug, not a mode).
 */
import { create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { ExecutionContextDeleter } from "../executioncontext/internal-delete.js";
import { workflowRunPersonOf } from "../agentrun/run-person.js";
import { fillDeclaredFromPersonalEnvironment } from "../environment/personal.js";
import type { PersonalEnvironmentReader } from "../environment/personal.js";
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
import { pinnedWorkflowOf } from "./pin-workflow-version-step.js";

/** The narrow executioncontext CREATE edge (Go executionCtxClient.Create). */
export interface WorkflowExecutionContextCreator {
  create(executionContext: ExecutionContext): Promise<ExecutionContext>;
}
export type WorkflowExecutionContextCreatorProvider =
  () => WorkflowExecutionContextCreator;

export interface WorkflowExecutionContextBuilderDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The decrypted secret read of the personal-environment fill (the RPC surface redacts, oss#405). */
  readonly environmentReader: () => PersonalEnvironmentReader;
  readonly executionContextCreator: WorkflowExecutionContextCreatorProvider;
  /**
   * The server's own delete of a context, through its delete chain: the
   * recover step removes the interrupted run's stale context with it
   * before recreating one (stigmer#1647).
   */
  readonly executionContextDeleter: () => ExecutionContextDeleter;
}

/**
 * The environment a workflow run receives: `runtimeEnv` filtered to the
 * workflow's declarations, then every declared key still missing from the
 * run's person's personal environment (the module header's order). Never
 * throws for a missing key or a failed personal read.
 */
export async function workflowRunEnvironment(
  deps: WorkflowExecutionContextBuilderDeps,
  workflow: Workflow,
  execution: WorkflowRun,
  runtimeEnv: { readonly [key: string]: ExecutionValue },
): Promise<Map<string, ExecutionValue>> {
  const executionId = execution.metadata?.id ?? "";
  const workflowId = workflow.metadata?.id ?? "";
  const declarations = workflow.spec?.env ?? {};

  const merged = mergeEnvironmentLayers([], runtimeEnv);

  // Least-privilege whitelist: workflows only receive declared vars.
  const { filtered, excludedKeys } = filterByDeclaredKeys(merged, declarations);
  if (excludedKeys.length > 0) {
    deps.logger.warn("Filtered env vars not declared in workflow env", {
      executionId,
      workflowId,
      excludedKeys,
    });
  }

  const filled = await fillDeclaredFromPersonalEnvironment(
    deps.environmentReader(),
    deps.store,
    deps.logger,
    filtered,
    {
      declarations,
      exclude: new Set(),
      owner: {
        noun: "workflow",
        id: workflowId,
        declares: declarations,
        orgOf: () => Promise.resolve(workflow.metadata?.org ?? ""),
      },
      executionOrg: execution.metadata?.org ?? "",
      person: workflowRunPersonOf(execution),
      executionId,
    },
  );

  const missingRequired = validateRequiredKeys(filled, declarations);
  if (missingRequired.length > 0) {
    deps.logger.warn(
      "Required env vars missing after environment merge — execution may fail",
      { executionId, workflowId, missingRequired },
    );
  }
  return filled;
}

export function newCreateExecutionContextStep(
  deps: WorkflowExecutionContextBuilderDeps,
): PipelineStep<typeof WorkflowRunSchema> {
  return {
    name: "CreateExecutionContext",
    async execute(ctx) {
      const execution = ctx.newState;
      const executionId = execution.metadata?.id ?? "";
      const executionOrg = execution.metadata?.org ?? "";

      const environment = await workflowRunEnvironment(
        deps,
        pinnedWorkflowOf(ctx),
        execution,
        execution.spec?.runtimeEnv ?? {},
      );

      const executionContext = create(ExecutionContextSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "ExecutionContext",
        metadata: {
          name: `exec-ctx-${executionId}`,
          org: executionOrg,
        },
        spec: {
          executionId,
          data: Object.fromEntries(environment),
        },
      });

      try {
        const created = await deps
          .executionContextCreator()
          .create(executionContext);
        deps.logger.info("Successfully created execution context", {
          executionContextId: created.metadata?.id ?? "",
          executionId,
          dataEntries: environment.size,
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
