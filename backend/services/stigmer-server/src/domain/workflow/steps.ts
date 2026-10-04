/**
 * Workflow domain pipeline steps — port the step half of
 * pkg/domain/workflow/controller: the Layer-2 validation gate
 * (validate_spec_step.go), status population
 * (populate_serverless_validation_step.go), the version hash
 * (version_steps.go; the rest of the version machinery is the shared one
 * in pipeline/steps/version-archive.ts, bound in version-resolution.ts),
 * default-instance choreography (create.go), and the #592 instance
 * cascade (delete_cascade.go). Proven by workflow.conformance.test.ts
 * (CONFORMANCE_TARGET=local) and __tests__/workflow.test.ts.
 */
import { createHash } from "node:crypto";
import { ConnectError } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/status_pb";
import { ApiResourceMetadataVersionSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { ServerlessWorkflowValidation } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  cleanUpDeletedResource,
  notifyDefaultInstanceLinked,
} from "../../pipeline/steps/authorization-tuples.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { AuditNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { VERSION_HASH_KEY } from "../../pipeline/steps/version-archive.js";
import { truncateHash } from "../../pipeline/steps/version-history.js";
import { buildDefaultWorkflowInstanceRequest } from "../workflowinstance/defaultinstance.js";
import type { InProcessValidator } from "./validation/validator.js";

type WorkflowDesc = typeof WorkflowSchema;

// Context keys — identical strings to Go's so the inventory's step notes
// read straight onto this code.
export const SERVERLESS_VALIDATION_KEY = "serverless_validation";
export { VERSION_HASH_KEY };
export const DEFAULT_INSTANCE_ID_KEY = "default_instance_id";

// ---------------------------------------------------------------------------
// The workflowinstance in-process edge: workflow create provisions
// the default instance through the full interceptor chain. Go's
// CreateAsSystem is the Create RPC under the process-global operator
// identity, so a plain create IS the system-actor create in this edition.
// ---------------------------------------------------------------------------

export interface WorkflowInstanceCreator {
  /**
   * Creates AS THE ORIGINAL CALLER (the Java createAsCaller posture): the
   * propagated identity gives the default instance real owner attribution
   * under an enforcing Authorizer.
   */
  createAsCaller(
    instance: WorkflowInstance,
    caller: CallerIdentity,
  ): Promise<WorkflowInstance>;
}

/**
 * Lazy provider for the workflow↔workflowinstance true cycle — resolved at
 * call time, never at construction.
 */
export type WorkflowInstanceCreatorProvider = () => WorkflowInstanceCreator;

// ---------------------------------------------------------------------------
// ValidateWorkflowSpec — validate_spec_step.go: the Create/Update
// persist-path validation gate. Layer 2 (proto → CNCF YAML + structural
// checks) runs produce-and-gate:
//   1. Produce: the verdict lands in context under SERVERLESS_VALIDATION_KEY
//      so PopulateServerlessValidation can persist the generated YAML and
//      state onto WorkflowStatus.
//   2. Gate: any non-VALID state aborts the pipeline — an invalid workflow
//      must never be persisted.
// This produce-and-gate behavior is exactly why validateSpec (the RPC) does
// NOT reuse this step: it must RETURN the structured verdict for INVALID
// specs rather than abort (controller.ts).
//
// Go carries a nil-validator warn-and-skip arm from its two-phase wiring;
// the validator here is constructor-injected and cannot be absent, so that
// arm has no equivalent.
// ---------------------------------------------------------------------------

export function newValidateWorkflowSpecStep(
  validator: InProcessValidator,
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "ValidateWorkflowSpec",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const workflow = ctx.input;

      // Workflow.spec is not marked required at the proto level
      // (protovalidate cannot catch it), so a spec-less create reaches this
      // step. It is a client input error, hence InvalidArgument.
      if (workflow.spec === undefined) {
        throw invalidArgumentError("workflow spec is required");
      }

      logger.debug("Layer 2: in-process validation (converts + validates)");

      let verdict: ServerlessWorkflowValidation;
      try {
        verdict = validator.validate(workflow.spec);
      } catch (error) {
        logger.error("Layer 2: validation execution failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw internalError(error, "workflow validation system error");
      }

      ctx.set(SERVERLESS_VALIDATION_KEY, verdict);

      switch (verdict.state) {
        case ValidationState.VALID:
          logger.info("Layer 2: validation passed (state: VALID)", {
            warnings: verdict.warnings.length,
          });
          return;

        case ValidationState.INVALID: {
          logger.warn("Layer 2: validation failed (state: INVALID)", {
            errors: verdict.errors.length,
            warnings: verdict.warnings.length,
          });
          const errorMessage =
            verdict.errors.length > 0
              ? verdict.errors[0]!
              : "workflow structure validation failed";
          throw invalidArgumentError(
            `workflow validation failed: ${errorMessage}`,
          );
        }

        case ValidationState.FAILED: {
          logger.error("Layer 2: validation system error (state: FAILED)", {
            errors: verdict.errors.length,
          });
          const systemError =
            verdict.errors.length > 0
              ? verdict.errors[0]!
              : "validation system encountered an error";
          throw internalError(
            new Error(systemError),
            "workflow validation system error",
          );
        }

        default:
          logger.error("Layer 2: unknown validation state", {
            state: verdict.state,
          });
          throw internalError(
            new Error(String(verdict.state)),
            "workflow validation returned unknown state",
          );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// PopulateServerlessValidation — populate_serverless_validation_step.go:
// copies the verdict from context into
// workflow.status.serverless_workflow_validation so the generated CNCF YAML
// travels with the workflow (execution hydration reads it). Only VALID
// verdicts reach this step (INVALID/FAILED aborted the pipeline earlier).
// The create variant warn-skips an absent verdict; the update variant
// errors on a wrong-typed one (update always re-validates).
// ---------------------------------------------------------------------------

export function newPopulateServerlessValidationStep(
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "PopulateServerlessValidation",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const wf = ctx.newState;
      const verdict = ctx.get(SERVERLESS_VALIDATION_KEY) as
        | ServerlessWorkflowValidation
        | undefined;
      if (verdict === undefined) {
        logger.warn(
          "serverless validation result not found in context - skipping population",
          { workflowId: wf.metadata?.id ?? "" },
        );
        return;
      }

      wf.status ??= create(WorkflowStatusSchema);
      wf.status.serverlessWorkflowValidation = verdict;
      ctx.setNewState(wf);
    },
  };
}

export function newPopulateServerlessValidationStepForUpdate(
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "PopulateServerlessValidation",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const wf = ctx.newState;
      const raw = ctx.get(SERVERLESS_VALIDATION_KEY);
      if (raw === undefined) {
        logger.warn(
          "serverless validation result not found in context - validator may be disabled",
          { workflowId: wf.metadata?.id ?? "" },
        );
        return;
      }
      const verdict = raw as ServerlessWorkflowValidation;

      wf.status ??= create(WorkflowStatusSchema);
      wf.status.serverlessWorkflowValidation = verdict;
      ctx.setNewState(wf);

      logger.debug("refreshed serverless validation on update", {
        workflowId: wf.metadata?.id ?? "",
        yamlLength: verdict.yaml.length,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The version hash — version_steps.go. The hash is deterministic because
// the converter renders canonically: same workflow spec = same YAML
// = same hash.
// ---------------------------------------------------------------------------

/** SHA-256 of the generated CNCF YAML, stashed under VERSION_HASH_KEY. */
export function newComputeVersionHashStep(
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "ComputeVersionHash",
    execute(ctx: RequestContext<WorkflowDesc>): void {
      const yaml =
        ctx.newState.status?.serverlessWorkflowValidation?.yaml ?? "";
      if (yaml === "") {
        logger.debug(
          "no YAML in validation status — skipping version hash computation",
        );
        return;
      }

      const hexHash = createHash("sha256").update(yaml).digest("hex");
      ctx.set(VERSION_HASH_KEY, hexHash);

      logger.debug("computed workflow version hash", {
        versionHash: truncateHash(hexHash),
        yamlLength: yaml.length,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Default-instance choreography — create.go: the instance is created via
// the in-process client AFTER Persist (children need the parent's id), then
// the workflow's status.default_instance_id is written in an explicit
// second persist (separated so the extra database write is visible in the
// pipeline).
// ---------------------------------------------------------------------------

export function newCreateDefaultInstanceStep(
  creatorProvider: WorkflowInstanceCreatorProvider,
  logger: Logger,
): PipelineStep<WorkflowDesc> {
  return {
    name: "CreateDefaultInstance",
    async execute(ctx: RequestContext<WorkflowDesc>): Promise<void> {
      const workflow = ctx.newState;
      const metadata = workflow.metadata;
      if (metadata === undefined) {
        throw internalError(
          new Error("workflow metadata is nil after persist"),
          "workflow metadata is nil after persist",
        );
      }

      logger.info("Creating default instance for workflow", {
        workflowId: metadata.id,
        slug: metadata.slug,
        org: metadata.org,
      });

      const instanceRequest = buildDefaultWorkflowInstanceRequest(metadata);

      // Go create.go:118-121 wraps the downstream error with fmt.Errorf
      // ("failed to create default instance: %w"); the wire keeps the inner
      // CODE but carries the wrapped text, transport formatting included —
      // mirrored via goWrappedStatusError (the leak is oss#852, to fix in
      // both editions). Unstatused failures
      // fall to the pipeline's Internal fallback, exactly Go's plain-error
      // path.
      let created: WorkflowInstance;
      try {
        created = await creatorProvider().createAsCaller(
          instanceRequest,
          ctx.callerIdentity,
        );
      } catch (error) {
        if (error instanceof ConnectError) {
          throw goWrappedStatusError("failed to create default instance", error);
        }
        throw new Error(
          `failed to create default instance: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      logger.info("Successfully created default instance for workflow", {
        instanceId: created.metadata?.id ?? "",
        workflowId: metadata.id,
      });

      ctx.set(DEFAULT_INSTANCE_ID_KEY, created.metadata?.id ?? "");
    },
  };
}

export function newUpdateWorkflowStatusWithDefaultInstanceStep(
  store: Store,
  logger: Logger,
  authorizationLifecycle?: ResourceAuthorizationLifecycle,
): PipelineStep<WorkflowDesc> {
  return {
    name: "UpdateWorkflowStatusWithDefaultInstance",
    async execute(ctx: RequestContext<WorkflowDesc>): Promise<void> {
      const workflow = ctx.newState;
      const workflowId = workflow.metadata?.id ?? "";

      const defaultInstanceId = ctx.get(DEFAULT_INSTANCE_ID_KEY);
      if (typeof defaultInstanceId !== "string" || defaultInstanceId === "") {
        logger.error("DEFAULT_INSTANCE_ID not found in context for workflow", {
          workflowId,
        });
        throw new Error("default instance ID not found in context");
      }

      workflow.status ??= create(WorkflowStatusSchema);
      workflow.status.defaultInstanceId = defaultInstanceId;

      try {
        await store.saveResource(
          ctx.apiResourceKind,
          workflowId,
          WorkflowSchema,
          workflow,
        );
      } catch (error) {
        logger.error("failed to persist workflow with default_instance_id", {
          error: error instanceof Error ? error.message : String(error),
          workflowId,
        });
        throw new Error(
          `failed to persist workflow with default instance: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // The default_of invariant rides the pointer persist.
      await notifyDefaultInstanceLinked(authorizationLifecycle, {
        instanceKind: ApiResourceKind.workflow_instance,
        instanceId: defaultInstanceId,
        blueprintKind: ApiResourceKind.workflow,
        blueprintId: workflowId,
      });

      ctx.setNewState(workflow);

      logger.info("updated workflow status with default_instance_id", {
        defaultInstanceId,
        workflowId,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// CascadeDeleteInstances — delete_cascade.go: workflow deletion cascades to
// ALL of the workflow's instances — the system-managed default AND
// user-created ones — before the workflow row itself is removed (children
// before parent, so a mid-failure retry converges).
//
// WorkflowInstance slugs are org-scoped and the parent workflow's detail
// page is the only instance-management surface, so an orphan would occupy
// its slug org-wide forever with no UI left to delete it (oss#592, repro'd
// live). Instances are configuration OF the workflow, meaningless without
// it; owner ruling: they go with it (the agent cascade shares this contract
// since oss#611).
//
// What deliberately SURVIVES a workflow delete, and must never be swept
// into this cascade:
//   - WorkflowExecutions — historical record (owner ruling on #582). They
//     carry a denormalized spec.workflow_id and remain viewable after the
//     workflow (and its instances) are gone.
//   - Version/audit rows — surviving executions render their historical
//     graphs via getVersion(workflow_id, version_hash), so deleting version
//     rows would break the execution viewer for exactly the executions the
//     ruling preserves.
//
// Instances are matched by spec.workflow_id — a required, validated field
// on every instance — so a single ID sweep covers the default instance too.
// ---------------------------------------------------------------------------

export function newCascadeDeleteWorkflowInstancesStep<Desc extends DescMessage>(
  store: Store,
  lifecycle: ResourceAuthorizationLifecycle | undefined,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteInstances",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const workflow = ctx.get(EXISTING_RESOURCE_KEY) as Workflow | undefined;
      if (workflow === undefined) {
        throw internalError(
          new Error("workflow not found in context (LoadExistingForDelete must run first)"),
          "workflow not found in context (LoadExistingForDelete must run first)",
        );
      }
      const workflowId = workflow.metadata?.id ?? "";

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.workflow_instance);
      } catch (error) {
        throw internalError(error, "failed to list workflow instances for cascade delete");
      }

      let deleted = 0;
      for (const data of rows) {
        let instance: WorkflowInstance;
        try {
          instance = fromBinary(WorkflowInstanceSchema, data);
        } catch {
          continue;
        }
        if (instance.spec?.workflowId !== workflowId) {
          continue;
        }
        const instanceId = instance.metadata?.id ?? "";
        try {
          await store.deleteResource(ApiResourceKind.workflow_instance, instanceId);
        } catch (error) {
          throw internalError(
            error,
            `failed to cascade-delete instance ${instanceId} of workflow ${workflowId}`,
          );
        }
        // The instance's access goes with its row, as its own delete would
        // clean it, while the workflow's links still stand (stigmer#1603).
        await cleanUpDeletedResource(lifecycle, logger, {
          kind: ApiResourceKind.workflow_instance,
          resourceId: instanceId,
          orgId: instance.metadata?.org ?? "",
          caller: ctx.callerIdentity,
        });

        // Best-effort, matching DeleteSearchIndexStep: a stale index entry
        // is a cosmetic search artifact, not a correctness problem.
        try {
          await store.deleteSearchIndex(ApiResourceKind.workflow_instance, instanceId);
        } catch (error) {
          logger.warn(
            "CascadeDeleteInstances: failed to remove search index entry (best-effort)",
            {
              error: error instanceof Error ? error.message : String(error),
              instanceId,
            },
          );
        }
        deleted++;
      }

      if (deleted > 0) {
        logger.info("cascade-deleted instances of workflow", {
          count: deleted,
          workflowId,
        });
      }
    },
  };
}
