/**
 * Workflow controller — ports pkg/domain/workflow/controller (command +
 * query sides): the workflow authoring/validation/versioning surface.
 * Create runs the pipeline (Layer-2 validation gate, canonical CNCF YAML,
 * the version hash over the whole spec, v1 archived last); an unchanged
 * Update archives nothing and still moves a newly named tag (the shared
 * version-metadata rule); Delete removes the workflow and leaves its runs
 * (oss#582); versions resolve by hash or tag through the audit store with
 * the tag COLUMN as the source of truth; tagVersion moves tags
 * single-holder (oss#341). Every version step is the shared machinery,
 * bound in version-resolution.ts. Who observes the workflow's runs is
 * `spec.execution_visibility`, set at create and changed only by
 * updateExecutionVisibility (execution-visibility.ts).
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by workflow.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/.
 *
 * Every chain opens with Authorize; create, delete, updateVisibility and
 * updateExecutionVisibility run the shared tuple-lifecycle steps against
 * the composed lifecycle;
 * getByReference and listVersions authorize the resolved workflow as `get`
 * would. getVersion evaluates its annotation through authorizeDirect;
 * validateSpec deliberately does not, since it persists nothing. Per-RPC
 * posture: docs/authorization-coverage.md §17.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, enumToJson } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import type {
  UpdateWorkflowExecutionVisibilityInput,
  WorkflowId,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/io_pb";
import {
  ServerlessWorkflowValidationSchema,
  ValidationState,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { ServerlessWorkflowValidation } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type {
  GetWorkflowVersionInput,
  ListWorkflowVersionsInput,
  ListWorkflowVersionsResponse,
  TagWorkflowVersionInput,
  WorkflowVersionEntry,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import {
  ApiResourceKind,
  ApiResourceKindSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  authorizeDirect,
  newAuthorizeStep,
} from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import {
  LIST_VERSIONS_RESPONSE_KEY,
  getVersionEntry,
  versionHistoryTarget,
} from "../../pipeline/steps/version-history.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import {
  setAuditFieldsForUpdate,
  newBuildNewStateStep,
} from "../../pipeline/steps/defaults.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  newDeleteSearchIndexStep,
  newIndexSearchStep,
} from "../../pipeline/steps/index-search.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import { newGuardPluginManagedStep } from "../../pipeline/steps/guard-plugin-managed.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
  withResolvedApplyId,
} from "../../pipeline/steps/load-for-apply.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import {
  collectSpecReferences,
  newGuardReferenceFloorOnEscalationStep,
  newNormalizeReferencesStep,
  newValidateReferencesStep,
} from "../../pipeline/steps/references.js";
import {
  collectAgentCallReferences,
  newValidateAgentCallReferencesStep,
} from "./agent-call-references.js";
import { newResolveAgentCallOrganizationsStep } from "./agent-call-organizations.js";
import { newOrganizationNameResolver } from "../organization/names.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import {
  newValidateProtoStep,
  validator,
} from "../../pipeline/steps/validation.js";
import {
  newRefuseChildOrgsVisibilityInChildStep,
  newRefuseChildOrgsVisibilityInChildUpdateStep,
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { formatViolation } from "./validation/format-violation.js";
import type { InProcessValidator } from "./validation/validator.js";
import { workflowSearchExtractor } from "./search-extractor.js";
import {
  newComputeVersionHashStep,
  newPopulateServerlessValidationStep,
  newPopulateServerlessValidationStepForUpdate,
  newValidateWorkflowSpecStep,
} from "./steps.js";
import {
  UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY,
  newCreateExecutionVisibilityTuplesStep,
  newIndexWorkflowAfterExecutionVisibilityUpdateStep,
  newLoadWorkflowForExecutionVisibilityUpdateStep,
  newPersistWorkflowForExecutionVisibilityUpdateStep,
  newPreserveExecutionVisibilityStep,
  newSetWorkflowExecutionVisibilityStep,
  newUpdateExecutionVisibilityTuplesStep,
} from "./execution-visibility.js";
import {
  TAG_VERSION_RESULT_KEY,
  TAG_VERSION_WORKFLOW_KEY,
  newLoadAndMapWorkflowVersionsStep,
  newLoadWorkflowByReferenceStep,
  newLoadWorkflowForTagVersionStep,
  newPopulateWorkflowVersionStep,
  newResolveWorkflowBySlugStep,
  newSaveVersionAuditStep,
  newTagWorkflowVersionStep,
  workflowVersionBinding,
} from "./version-resolution.js";

export interface WorkflowControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The Layer-2 validator (converter + structural checks + registry). */
  readonly validator: InProcessValidator;
}

/** Registers both workflow services on the router (routes stage). */
export function registerWorkflowServices(
  router: ConnectRouter,
  deps: WorkflowControllerDeps,
): void {
  router.service(WorkflowCommandController, {
    apply: (workflow, ctx) => apply(deps, workflow, ctx),
    create: (workflow, ctx) => createWorkflow(deps, workflow, ctx),
    update: (workflow, ctx) => update(deps, workflow, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    updateExecutionVisibility: (input, ctx) =>
      updateExecutionVisibility(deps, input, ctx),
    delete: (id, ctx) => deleteWorkflow(deps, id, ctx),
    // validateSpec deliberately evaluates NO authorization despite its
    // can_create_workflow annotation: nothing is loaded or persisted, and
    // the caller only gets a verdict on their own submitted spec. The
    // annotation mismatch is
    // recorded in docs/authorization-coverage.md.
    validateSpec: (workflow) => validateSpec(deps, workflow),
    tagVersion: (input, ctx) => tagVersion(deps, input, ctx),
  });
  router.service(WorkflowQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    listVersions: (input, ctx) => listVersions(deps, input, ctx),
    getVersion: (input, ctx) => getVersion(deps, input, callerIdentityOf(ctx)),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

// ---------------------------------------------------------------------------
// Command side
// ---------------------------------------------------------------------------

/**
 * Create — chain per Go buildCreatePipeline: v1 archives after the
 * persist and the tuple steps (the audit step re-persists either of its
 * reverts, a stripped hash or a cleared tag, because no Persist follows it
 * here). A run audience the request names reaches the driver beside the
 * resource's own tuples.
 */
async function createWorkflow(
  deps: WorkflowControllerDeps,
  workflow: Workflow,
  ctx: HandlerContext,
): Promise<Workflow> {
  const reqCtx = new RequestContext(
    WorkflowSchema,
    workflow,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowSchema>("workflow-create", deps.logger)
    .addStep(
      newAuthorizeStep(
        WorkflowCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newRefuseChildOrgsVisibilityInChildStep(deps.store))
    .addStep(newValidateWorkflowSpecStep(deps.validator, deps.logger))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newResolveAgentCallOrganizationsStep(newOrganizationNameResolver(deps.store)))
    .addStep(newValidateAgentCallReferencesStep(deps.store, deps.authorizer))
    .addStep(newPopulateServerlessValidationStep(deps.logger))
    .addStep(newComputeVersionHashStep(deps.logger))
    .addStep(newPopulateWorkflowVersionStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(
      newCreateExecutionVisibilityTuplesStep(deps.authorizationLifecycle),
    )
    .addStep(newSaveVersionAuditStep(deps.store, deps.logger, true))
    .addStep(
      newIndexSearchStep(deps.store, workflowSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline: an unchanged spec registers no
 * version (the archive step repoints, oss#341) while a newly named tag
 * still moves; the audit step's revert is flushed by the Persist step that
 * follows it.
 */
async function update(
  deps: WorkflowControllerDeps,
  workflow: Workflow,
  ctx: HandlerContext,
): Promise<Workflow> {
  const reqCtx = new RequestContext(
    WorkflowSchema,
    workflow,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowSchema>("workflow-update", deps.logger)
    .addStep(
      newAuthorizeStep(
        WorkflowCommandController.method.update,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newValidateWorkflowSpecStep(deps.validator, deps.logger))
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    // A resource a plugin materialised is the plugin's to redefine; a client
    // write is refused naming the plugin (GuardPluginManaged, keyed on the
    // STORED labels and the plugin row's existence).
    .addStep(newGuardPluginManagedStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newPreserveExecutionVisibilityStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newNormalizeReferencesStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newResolveAgentCallOrganizationsStep(newOrganizationNameResolver(deps.store)))
    .addStep(newValidateAgentCallReferencesStep(deps.store, deps.authorizer))
    .addStep(newPopulateServerlessValidationStepForUpdate(deps.logger))
    .addStep(newComputeVersionHashStep(deps.logger))
    .addStep(newPopulateWorkflowVersionStep())
    .addStep(newSaveVersionAuditStep(deps.store, deps.logger, false))
    .addStep(newPersistStep(deps.store))
    .addStep(
      newIndexSearchStep(deps.store, workflowSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update: a minimal probe pipeline decides
 * existence, then delegates to Create or Update with the ORIGINAL request
 * message (Go delegates `workflow`, not the pipeline's mutated clone);
 * the update arm carries the resolved id via withResolvedApplyId.
 */
async function apply(
  deps: WorkflowControllerDeps,
  workflow: Workflow,
  ctx: HandlerContext,
): Promise<Workflow> {
  const reqCtx = new RequestContext(
    WorkflowSchema,
    workflow,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowSchema>("workflow-apply", deps.logger)
    .addStep(
      newAuthorizeStep(WorkflowCommandController.method.apply, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadForApplyStep(deps.store))
    .build()
    .execute(reqCtx);

  const shouldCreate = reqCtx.get(SHOULD_CREATE_KEY);
  if (typeof shouldCreate !== "boolean") {
    throw internalError(
      new Error("apply pipeline did not set shouldCreate flag"),
      "apply operation failed to determine create vs update",
    );
  }
  return shouldCreate
    ? createWorkflow(deps, workflow, ctx)
    : update(deps, withResolvedApplyId(WorkflowSchema, workflow, reqCtx), ctx);
}

/**
 * Delete — the workflow row, its access and its search entry. Its runs
 * and its version/audit rows deliberately survive (oss#582): runs carry
 * spec.workflow_id and remain viewable, and they render their historical
 * graphs through getVersion(workflow_id, version_hash), so deleting
 * version rows would break the viewer for exactly the runs that survive.
 * Returns the deleted workflow (the audit-trail convention).
 */
async function deleteWorkflow(
  deps: WorkflowControllerDeps,
  workflowId: WorkflowId,
  ctx: HandlerContext,
): Promise<Workflow> {
  const reqCtx = new RequestContext(
    WorkflowCommandController.method.delete.input,
    workflowId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowCommandController.method.delete.input>(
    "workflow-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        WorkflowCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, WorkflowSchema))
    .addStep(newGuardPluginManagedStep(deps.store))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted workflow not found in context"),
      "deleted workflow not found in context",
    );
  }
  return deleted as Workflow;
}

// ---------------------------------------------------------------------------
// updateVisibility — update_visibility.go: a targeted metadata update (only
// metadata.visibility changes; spec/status untouched). The level check runs
// AFTER load, preserving the cross-edition error precedence: unknown id +
// bad level = NOT_FOUND on both editions. The workflow conformance suite's
// visibility block is the wire pin.
// ---------------------------------------------------------------------------

const UPDATE_VISIBILITY_WORKFLOW_KEY = "updateVisibilityWorkflow";

type UpdateVisibilityDesc =
  typeof WorkflowCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: WorkflowControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<Workflow> {
  const reqCtx = new RequestContext(
    WorkflowCommandController.method.updateVisibility.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>(
    "workflow-update-visibility",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        WorkflowCommandController.method.updateVisibility,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadWorkflowForVisibilityUpdateStep(deps.store))
    .addStep(
      newGuardPluginManagedStep(deps.store, {
        existingKey: UPDATE_VISIBILITY_WORKFLOW_KEY,
      }),
    )
    .addStep(
      newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_WORKFLOW_KEY),
    )
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newRefuseChildOrgsVisibilityInChildUpdateStep(deps.store, UPDATE_VISIBILITY_WORKFLOW_KEY))
    // The reference floor's second door: a workflow may not be raised above
    // the agents its agent_call tasks run.
    .addStep(
      newGuardReferenceFloorOnEscalationStep(
        deps.store,
        UPDATE_VISIBILITY_WORKFLOW_KEY,
        [
          (row) => collectSpecReferences(WorkflowSchema, row),
          (row) =>
            collectAgentCallReferences(
              (row as Workflow).spec,
              (row as Workflow).metadata?.org ?? "",
            ),
        ],
      ),
    )
    .addStep(newSetWorkflowVisibilityStep())
    .addStep(newPersistWorkflowForVisibilityUpdateStep(deps.store))
    .addStep(
      newUpdateVisibilityTuplesStep(
        deps.authorizationLifecycle,
        UPDATE_VISIBILITY_WORKFLOW_KEY,
      ),
    )
    .addStep(newIndexWorkflowAfterVisibilityUpdateStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  return reqCtx.get(UPDATE_VISIBILITY_WORKFLOW_KEY) as Workflow;
}

/** Loads the workflow by resource_id; a missing one answers NotFound, a store fault Internal. */
function newLoadWorkflowForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadWorkflowForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const input = ctx.input;
      let workflow: Workflow;
      try {
        workflow = await store.getResource(
          ApiResourceKind.workflow,
          input.resourceId,
          WorkflowSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("workflow", input.resourceId);
        }
        throw internalError(error, "failed to load workflow");
      }
      ctx.set(UPDATE_VISIBILITY_WORKFLOW_KEY, workflow);
    },
  };
}

/** Sets metadata.visibility and refreshes the status-audit fields. */
function newSetWorkflowVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetWorkflowVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const input = ctx.input;
      const workflow = ctx.get(UPDATE_VISIBILITY_WORKFLOW_KEY) as Workflow;

      workflow.metadata!.visibility = input.visibility;

      try {
        setAuditFieldsForUpdate(
          WorkflowSchema,
          workflow,
          "status_audit",
          ctx.callerIdentity,
        );
      } catch (error) {
        throw new Error(
          `failed to set audit fields: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      ctx.set(UPDATE_VISIBILITY_WORKFLOW_KEY, workflow);
    },
  };
}

function newPersistWorkflowForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistWorkflowForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const workflow = ctx.get(UPDATE_VISIBILITY_WORKFLOW_KEY) as Workflow;
      try {
        await store.saveResource(
          ApiResourceKind.workflow,
          workflow.metadata?.id ?? "",
          WorkflowSchema,
          workflow,
        );
      } catch (error) {
        throw internalError(error, "failed to save workflow");
      }
    },
  };
}

/** Best-effort reindex after the visibility flip (Go warns, never fails). */
function newIndexWorkflowAfterVisibilityUpdateStep(
  store: Store,
  logger: Logger,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "IndexWorkflowAfterVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const workflow = ctx.get(UPDATE_VISIBILITY_WORKFLOW_KEY) as Workflow;
      const entry = workflowSearchExtractor.getSearchIndexEntry(workflow);
      if (entry === undefined) {
        logger.warn(
          "IndexWorkflowAfterVisibilityUpdate: extractor returned nil, skipping",
          { id: workflow.metadata?.id ?? "" },
        );
        return;
      }
      try {
        await store.upsertSearchIndex(
          ApiResourceKind.workflow,
          workflow.metadata?.id ?? "",
          entry,
        );
      } catch (error) {
        logger.warn(
          "IndexWorkflowAfterVisibilityUpdate: failed (best-effort)",
          {
            error: error instanceof Error ? error.message : String(error),
            id: workflow.metadata?.id ?? "",
          },
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// updateExecutionVisibility — who observes the workflow's runs: a targeted
// spec update (only spec.execution_visibility changes) and the one door
// that changes it after create. can_manage_audience is the owner's, never
// an editor's. Open source authorizes run reads from the row itself, so
// the persisted level is the grant; a composed tuple driver hears the
// audience the new level names after the persist. The level is not part
// of the version, so nothing here touches the version machinery.
// ---------------------------------------------------------------------------

type UpdateExecutionVisibilityDesc =
  typeof WorkflowCommandController.method.updateExecutionVisibility.input;

async function updateExecutionVisibility(
  deps: WorkflowControllerDeps,
  input: UpdateWorkflowExecutionVisibilityInput,
  ctx: HandlerContext,
): Promise<Workflow> {
  const reqCtx = new RequestContext(
    WorkflowCommandController.method.updateExecutionVisibility.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<UpdateExecutionVisibilityDesc>(
    "workflow-update-execution-visibility",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        WorkflowCommandController.method.updateExecutionVisibility,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(
      newLoadWorkflowForExecutionVisibilityUpdateStep<UpdateExecutionVisibilityDesc>(
        deps.store,
        (c) => c.input.resourceId,
      ),
    )
    .addStep(
      newSetWorkflowExecutionVisibilityStep<UpdateExecutionVisibilityDesc>(
        (c) => c.input.executionVisibility,
      ),
    )
    .addStep(
      newPersistWorkflowForExecutionVisibilityUpdateStep<UpdateExecutionVisibilityDesc>(
        deps.store,
      ),
    )
    .addStep(
      newUpdateExecutionVisibilityTuplesStep<UpdateExecutionVisibilityDesc>(
        deps.authorizationLifecycle,
      ),
    )
    .addStep(
      newIndexWorkflowAfterExecutionVisibilityUpdateStep<UpdateExecutionVisibilityDesc>(
        deps.store,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx);

  return reqCtx.get(UPDATE_EXECUTION_VISIBILITY_WORKFLOW_KEY) as Workflow;
}

// ---------------------------------------------------------------------------
// validateSpec — validate_spec.go: validates without persisting. Runs the
// same two layers as Create/Update but with the OPPOSITE failure contract —
// it never throws for a user-fixable spec problem; everything a user can
// fix comes back as ServerlessWorkflowValidation{state: INVALID}. gRPC
// errors are reserved for input that cannot be validated at all (a nil
// spec) and genuine internal faults.
//
// Deliberately NOT pipeline-based (Go's note): a pipeline aborts on the
// first step error — exactly what the persist path wants — while this RPC
// must COLLECT the verdict across both layers and always return it.
// ---------------------------------------------------------------------------

function validateSpec(
  deps: WorkflowControllerDeps,
  workflow: Workflow,
): ServerlessWorkflowValidation {
  if (workflow.spec === undefined) {
    throw invalidArgumentError("workflow and workflow.spec are required");
  }

  // Layer 1: generic proto field constraints, folded into the structured
  // result (not thrown), short-circuiting: Layer 2's converter assumes
  // well-typed input, so running it after a Layer-1 failure would only
  // re-report the same defect. Mirrors Cloud's WorkflowValidateSpecHandler.
  const violations = protoFieldViolations(workflow);
  if (violations.length > 0) {
    return create(ServerlessWorkflowValidationSchema, {
      state: ValidationState.INVALID,
      errors: violations,
      validatedAt: timestampNow(),
    });
  }

  // Layer 2: workflow-domain structural validation. The validator returns
  // a structured verdict for every state; only a thrown error signals a
  // genuine internal fault.
  try {
    return deps.validator.validate(workflow.spec);
  } catch (error) {
    throw internalError(error, "workflow validation system error");
  }
}

/**
 * Layer-1 proto field violations as human-readable strings — Go
 * protoFieldViolations. The per-violation format is the shared
 * cross-edition rendering ("<field.path> – <message>"); both layers must
 * emit identical strings for the same violation.
 */
function protoFieldViolations(workflow: Workflow): string[] {
  const result = validator().validate(WorkflowSchema, workflow);
  if (result.kind === "valid") {
    return [];
  }
  if (result.kind === "invalid") {
    return result.error.violations.map((v) => formatViolation(v));
  }
  // Anything other than a validation verdict is a fault in the validation
  // machinery itself, not a user-fixable spec problem.
  throw internalError(result.error, "workflow validation could not run");
}

// ---------------------------------------------------------------------------
// tagVersion — tag_version.go: tags are mutable, single-value pointers to
// immutable versions (git-tag semantics). The audit tag COLUMN is the
// single source of truth; the dedicated RPC and apply-time tagging both
// write through store.setAuditTag, so a tag can never name more than one
// version. The live workflow's metadata.version.tag is then reconciled to
// mirror the head version's authoritative tag.
// ---------------------------------------------------------------------------

type TagVersionDesc = typeof WorkflowCommandController.method.tagVersion.input;

async function tagVersion(
  deps: WorkflowControllerDeps,
  input: TagWorkflowVersionInput,
  ctx: HandlerContext,
): Promise<Workflow> {
  const reqCtx = new RequestContext(
    WorkflowCommandController.method.tagVersion.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<TagVersionDesc>("workflow-tag-version", deps.logger)
    .addStep(
      newAuthorizeStep(
        WorkflowCommandController.method.tagVersion,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadWorkflowForTagVersionStep(deps.store))
    // Moving a tag redefines which version a plugin-managed workflow
    // advertises; the plugin owns that, so a client is refused naming it.
    .addStep(
      newGuardPluginManagedStep(deps.store, {
        existingKey: TAG_VERSION_WORKFLOW_KEY,
      }),
    )
    .addStep(newTagWorkflowVersionStep(deps.store))
    .build()
    .execute(reqCtx);

  return reqCtx.get(TAG_VERSION_RESULT_KEY) as Workflow;
}

// ---------------------------------------------------------------------------
// Query side
// ---------------------------------------------------------------------------

async function get(
  deps: WorkflowControllerDeps,
  workflowId: WorkflowId,
  ctx: HandlerContext,
): Promise<Workflow> {
  const reqCtx = new RequestContext(
    WorkflowQueryController.method.get.input,
    workflowId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowQueryController.method.get.input>(
    "workflow-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(WorkflowQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, WorkflowSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Workflow;
}

/**
 * getByReference — the slug/org read plus the version ladder, as a chain:
 * Authorize (a no-op under the lane's skip annotation) → ValidateProto →
 * LoadWorkflowByReference (the ladder, version-resolution.ts) →
 * AuthorizeResolvedTarget, which asks of the loaded head's id exactly what
 * `get` asks by id, so a slug reveals nothing a member could not read
 * through the id. The archived snapshot shares the head's id, so the check
 * on a versioned read is the check on the head.
 */
async function getByReference(
  deps: WorkflowControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Workflow> {
  const reqCtx = new RequestContext(
    WorkflowQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof WorkflowQueryController.method.getByReference.input>(
    "workflow-get-by-reference",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        WorkflowQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadWorkflowByReferenceStep(deps.store))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(WorkflowQueryController.method.get),
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Workflow;
}

// ---------------------------------------------------------------------------
// listVersions — list_versions.go: the audit history as WorkflowVersionEntry
// list, newest first, offset-paginated with a base64 index token.
// is_current = the entry whose hash matches the LIVE HEAD, not the newest
// row: a rollback apply repoints the head at an older archived version
// without inserting a new row (oss#341), so recency and currency
// legitimately diverge. Legacy duplicate-hash rows (pre-repoint data) mark
// only the first match, keeping exactly-one-current true for them too.
// ---------------------------------------------------------------------------

type ListVersionsDesc =
  typeof WorkflowQueryController.method.listVersions.input;

async function listVersions(
  deps: WorkflowControllerDeps,
  input: ListWorkflowVersionsInput,
  ctx: HandlerContext,
): Promise<ListWorkflowVersionsResponse> {
  const reqCtx = new RequestContext(
    WorkflowQueryController.method.listVersions.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ListVersionsDesc>("workflow-list-versions", deps.logger)
    .addStep(
      newAuthorizeStep(
        WorkflowQueryController.method.listVersions,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveWorkflowBySlugStep(deps.store))
    // The Java WorkflowListVersionsHandler's mid-chain can_view on the
    // RESOLVED workflow id (the skip annotation exists because the target
    // resolves from org+slug, not a request field); the copy is the Java
    // handler's byte-pinned error_msg, and the resolve step above already
    // answered NOT_FOUND for an unknown slug, the load-first order both
    // editions share.
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        versionHistoryTarget(
          ApiResourceKind.workflow,
          "unauthorized to view workflow version history",
        ),
        "AuthorizeResolvedWorkflow",
      ),
    )
    .addStep(newLoadAndMapWorkflowVersionsStep(deps.store))
    .build()
    .execute(reqCtx);

  return reqCtx.get(
    LIST_VERSIONS_RESPONSE_KEY,
  ) as ListWorkflowVersionsResponse;
}

// ---------------------------------------------------------------------------
// getVersion — get_version.go: a specific historical version by content
// hash. Used by the TS runner during hydration (the exact YAML that should
// execute) and the execution viewer (the correct graph for historical
// executions).
// ---------------------------------------------------------------------------

async function getVersion(
  deps: WorkflowControllerDeps,
  req: GetWorkflowVersionInput,
  identity: CallerIdentity,
): Promise<WorkflowVersionEntry> {
  if (req.workflowId === "") {
    throw invalidArgumentError("workflow_id is required");
  }
  if (req.versionHash === "") {
    throw invalidArgumentError("version_hash is required");
  }
  // The annotation's can_view check. The annotation is the contract and
  // this server enforces it; declared but never evaluated, it would leave
  // a cross-organization version read open.
  await authorizeDirect(
    WorkflowQueryController.method.getVersion,
    deps.authorizer,
    identity,
    req,
  );

  return getVersionEntry(deps.store, workflowVersionBinding, {
    resourceId: req.workflowId,
    versionHash: req.versionHash,
  });
}
