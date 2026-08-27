/**
 * Workflow controller — ports pkg/domain/workflow/controller (command +
 * query sides): the workflow authoring/validation/versioning surface.
 * Create runs the 14-step pipeline (Layer-2 validation gate, canonical CNCF
 * YAML, version hash chain, default-instance choreography through the
 * in-process workflowinstance client, v1 archived AFTER
 * default_instance_id); Update adds the CheckVersionChanged idempotence
 * gate; Delete cascades ALL instances (oss#592); versions resolve by hash
 * or tag through the audit store with the tag COLUMN as the source of
 * truth; tagVersion moves tags single-holder (oss#341).
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by workflow.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * __tests__/.
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies, and
 * Publish steps (no multi-tenant auth, IAM/FGA, or event publishing here).
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, enumToJson, fromBinary } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import type { WorkflowId } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/io_pb";
import {
  ServerlessWorkflowValidationSchema,
  ValidationState,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { ServerlessWorkflowValidation } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import {
  ListWorkflowVersionsResponseSchema,
  WorkflowVersionEntrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
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
import {
  ApiResourceMetadataSchema,
  ApiResourceMetadataVersionSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

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
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
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
  findResourceBySlug,
  requireOrgForReference,
} from "../../pipeline/steps/helpers.js";
import {
  newDeleteSearchIndexStep,
  newIndexSearchStep,
} from "../../pipeline/steps/index-search.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
  withResolvedApplyId,
} from "../../pipeline/steps/load-for-apply.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
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
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import {
  AuditNotFoundError,
  ResourceNotFoundError,
} from "../../store/interface.js";
import type { AuditRecord, Store } from "../../store/interface.js";
import { formatViolation } from "./validation/format-violation.js";
import type { InProcessValidator } from "./validation/validator.js";
import { workflowSearchExtractor } from "./search-extractor.js";
import {
  newCascadeDeleteWorkflowInstancesStep,
  newCheckVersionChangedStep,
  newComputeVersionHashStep,
  newCreateDefaultInstanceStep,
  newPopulateServerlessValidationStep,
  newPopulateServerlessValidationStepForUpdate,
  newPopulateVersionHashStep,
  newSaveVersionAuditStep,
  newUpdateWorkflowStatusWithDefaultInstanceStep,
  newValidateWorkflowSpecStep,
  truncateHash,
} from "./steps.js";
import type { WorkflowInstanceCreatorProvider } from "./steps.js";

export interface WorkflowControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op (C2). */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The Layer-2 validator (converter + structural checks + registry). */
  readonly validator: InProcessValidator;
  /**
   * The workflowinstance in-process edge — a lazy provider because
   * workflow↔workflowinstance is a true dependency cycle (DD-002; the
   * ratified DI story breaks cycles with `() => client` closures resolved
   * at call time, never at construction).
   */
  readonly workflowInstanceCreator: WorkflowInstanceCreatorProvider;
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
    delete: (id, ctx) => deleteWorkflow(deps, id, ctx),
    validateSpec: (workflow) => validateSpec(deps, workflow),
    tagVersion: (input, ctx) => tagVersion(deps, input, ctx),
  });
  router.service(WorkflowQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref) => getByReference(deps, ref),
    listVersions: (input, ctx) => listVersions(deps, input, ctx),
    getVersion: (input) => getVersion(deps, input),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

// ---------------------------------------------------------------------------
// Command side
// ---------------------------------------------------------------------------

/**
 * Create — chain per Go buildCreatePipeline: the default instance is
 * created via the in-process client AFTER Persist (children need the
 * parent's id), status.default_instance_id lands in an explicit second
 * persist, and v1 archives LAST so the snapshot captures it (the audit
 * step re-persists on revert because no Persist follows it here).
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
    .addStep(newValidateWorkflowSpecStep(deps.validator, deps.logger))
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPopulateServerlessValidationStep(deps.logger))
    .addStep(newComputeVersionHashStep(deps.logger))
    .addStep(newPopulateVersionHashStep(true))
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(
      newCreateDefaultInstanceStep(deps.workflowInstanceCreator, deps.logger),
    )
    .addStep(
      newUpdateWorkflowStatusWithDefaultInstanceStep(deps.store, deps.logger),
    )
    .addStep(newSaveVersionAuditStep(deps.store, deps.logger, true, true))
    .addStep(
      newIndexSearchStep(deps.store, workflowSearchExtractor, deps.logger),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline: CheckVersionChanged gates the
 * hash/audit steps so an unchanged spec registers no version (idempotent
 * applies, oss#341); the audit step's revert is flushed by the Persist
 * step that follows it.
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
    .addStep(newBuildUpdateStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPopulateServerlessValidationStepForUpdate(deps.logger))
    .addStep(newComputeVersionHashStep(deps.logger))
    .addStep(newCheckVersionChangedStep(deps.logger))
    .addStep(newPopulateVersionHashStep(false))
    .addStep(newSaveVersionAuditStep(deps.store, deps.logger, false, false))
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
 * Delete — cascades ALL instances before the workflow row (oss#592);
 * executions and version/audit rows deliberately survive (oss#582 — see
 * steps.ts). Returns the deleted workflow (the audit-trail convention).
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
    .addStep(newCascadeDeleteWorkflowInstancesStep(deps.store, deps.logger))
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
// bad level = NOT_FOUND on both editions. CW-9's suite block is the wire
// pin (clientPublicVisibilityWrites, true on local targets).
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
      newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_WORKFLOW_KEY),
    )
    .addStep(newValidateVisibilityUpdateStep())
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

/** Loads the workflow by resource_id; ANY load failure → NotFound. */
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
      } catch {
        throw notFoundError("workflow", input.resourceId);
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

const TAG_VERSION_RESULT_KEY = "tagVersionResult";

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
    .addStep(newTagWorkflowVersionStep(deps.store))
    .build()
    .execute(reqCtx);

  return reqCtx.get(TAG_VERSION_RESULT_KEY) as Workflow;
}

function newTagWorkflowVersionStep(store: Store): PipelineStep<TagVersionDesc> {
  return {
    name: "TagWorkflowVersion",
    async execute(ctx: RequestContext<TagVersionDesc>): Promise<void> {
      const req = ctx.input;

      // Load the live workflow to confirm it exists and learn its head hash.
      let workflow: Workflow;
      try {
        workflow = await store.getResource(
          ApiResourceKind.workflow,
          req.workflowId,
          WorkflowSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("workflow", req.workflowId);
        }
        throw internalError(error, "failed to load workflow");
      }

      // Move the tag in the audit store. A version_hash with no audit
      // record yields AuditNotFoundError (the hash-exists check) and leaves
      // the prior holder untouched.
      try {
        await store.setAuditTag(
          ApiResourceKind.workflow,
          req.workflowId,
          req.versionHash,
          req.tag,
        );
      } catch (error) {
        if (error instanceof AuditNotFoundError) {
          throw notFoundError("workflow version", req.versionHash);
        }
        throw internalError(error, "failed to assign workflow version tag");
      }

      // Reconcile the live workflow's metadata.version.tag to mirror the
      // head version's authoritative (post-move) tag. This uniformly covers
      // tagging the head, moving a tag off the head, and touching only
      // archived versions.
      const headTag = await resolveHeadTag(
        store,
        req.workflowId,
        workflow.status?.versionHash ?? "",
      );

      let updated: Workflow;
      try {
        updated = await store.updateResource(
          ApiResourceKind.workflow,
          req.workflowId,
          WorkflowSchema,
          (wf) => {
            wf.metadata ??= create(ApiResourceMetadataSchema);
            wf.metadata.version ??= create(ApiResourceMetadataVersionSchema);
            wf.metadata.version.tag = headTag;
          },
        );
      } catch (error) {
        throw internalError(error, "failed to reconcile workflow head tag");
      }

      ctx.set(TAG_VERSION_RESULT_KEY, updated);
    },
  };
}

/**
 * The tag currently assigned to the workflow's head version, reading the
 * audit tag column (the source of truth). An empty head hash or a head
 * without an audit entry resolves to no tag.
 */
async function resolveHeadTag(
  store: Store,
  workflowId: string,
  headHash: string,
): Promise<string> {
  if (headHash === "") {
    return "";
  }
  try {
    const rec = await store.getAuditRecordByHash(
      ApiResourceKind.workflow,
      workflowId,
      headHash,
    );
    return rec.tag;
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      return "";
    }
    throw internalError(error, "failed to resolve head version tag");
  }
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

/** A 64-hex value is an exact content hash; anything else is a tag. */
const WORKFLOW_HASH_PATTERN = /^[a-f0-9]{64}$/;

/**
 * getByReference — query.go: slug/org resolution plus version resolution.
 * Empty/"latest" → the current head; a version matching the head's hash or
 * tag → the head; otherwise the audit store by hash or tag, with the
 * snapshot's tag overlaid from the audit column (the source of truth) so
 * callers never see a stale embedded tag after a tag move. Like
 * validateSpec, this branching read flow reads more honestly written
 * directly than as a pipeline (Go's own note).
 */
async function getByReference(
  deps: WorkflowControllerDeps,
  ref: ApiResourceReference,
): Promise<Workflow> {
  if (ref.slug === "") {
    throw invalidArgumentError("slug is required in reference");
  }

  // Workflow is org-scoped: its slug is unique only within an org, so an
  // empty-org reference is under-specified.
  requireOrgForReference(ApiResourceKind.workflow, ref.org);

  if (
    ref.kind !== ApiResourceKind.api_resource_kind_unknown &&
    ref.kind !== ApiResourceKind.workflow
  ) {
    // Go renders both sides with .String(): the NAME for defined values and
    // the bare NUMBER for unknown ones (proto3 open enums preserve them, and
    // ref.kind carries no defined_only rule) — enumToJson would throw on the
    // unknown arm (panel finding).
    const got = ApiResourceKind[ref.kind] ?? String(ref.kind);
    throw invalidArgumentError(
      `kind mismatch: expected ${ApiResourceKind[ApiResourceKind.workflow]}, got ${got}`,
    );
  }

  let mainWorkflow: Workflow | undefined;
  try {
    mainWorkflow = await findResourceBySlug(
      deps.store,
      ApiResourceKind.workflow,
      WorkflowSchema,
      ref.slug,
      ref.org,
    );
  } catch (error) {
    // Go wraps the slug scan's store failure (query.go:110) — without this
    // the raw storage error would cross the wire as Unknown (panel finding).
    throw internalError(error, "failed to list workflows");
  }
  if (mainWorkflow === undefined) {
    throw notFoundError("workflow", ref.slug);
  }

  const version = ref.version.trim();
  if (version === "" || version === "latest") {
    return mainWorkflow;
  }

  if (workflowMatchesVersion(mainWorkflow, version)) {
    return mainWorkflow;
  }

  const archived = await findAuditWorkflowByVersion(
    deps.store,
    mainWorkflow.metadata!.id,
    version,
  );
  if (archived === undefined) {
    throw notFoundError("workflow version", `${ref.slug}:${version}`);
  }
  return archived;
}

function workflowMatchesVersion(wf: Workflow, version: string): boolean {
  if (wf.status === undefined) {
    return false;
  }
  if (WORKFLOW_HASH_PATTERN.test(version)) {
    return wf.status.versionHash === version;
  }
  return wf.metadata?.version?.tag === version;
}

async function findAuditWorkflowByVersion(
  store: Store,
  workflowId: string,
  version: string,
): Promise<Workflow | undefined> {
  let rec: AuditRecord;
  try {
    rec = WORKFLOW_HASH_PATTERN.test(version)
      ? await store.getAuditRecordByHash(
          ApiResourceKind.workflow,
          workflowId,
          version,
        )
      : await store.getAuditRecordByTag(
          ApiResourceKind.workflow,
          workflowId,
          version,
        );
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to query workflow audit by version");
  }

  let wf: Workflow;
  try {
    wf = fromBinary(WorkflowSchema, rec.data);
  } catch (error) {
    throw internalError(error, "failed to decode archived workflow version");
  }
  // Overlay the authoritative tag (audit column) onto the snapshot's
  // metadata.version.tag — the snapshot's embedded tag is only correct as
  // of archival time.
  wf.metadata ??= create(ApiResourceMetadataSchema);
  wf.metadata.version ??= create(ApiResourceMetadataVersionSchema);
  wf.metadata.version.tag = rec.tag;
  return wf;
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

const LIST_VERSIONS_DEFAULT_PAGE_SIZE = 50;
const LIST_VERSIONS_MAX_PAGE_SIZE = 100;
const LIST_VERSIONS_WORKFLOW_ID_KEY = "listVersionsWorkflowId";
const LIST_VERSIONS_HEAD_HASH_KEY = "listVersionsHeadHash";
const LIST_VERSIONS_RESPONSE_KEY = "listVersionsResponse";

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
    .addStep(newLoadAndMapWorkflowVersionsStep(deps.store))
    .build()
    .execute(reqCtx);

  return reqCtx.get(LIST_VERSIONS_RESPONSE_KEY) as ListWorkflowVersionsResponse;
}

/** Finds the workflow by org+slug; stashes its id and live head hash. */
function newResolveWorkflowBySlugStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return {
    name: "ResolveWorkflowBySlug",
    async execute(ctx: RequestContext<ListVersionsDesc>): Promise<void> {
      const req = ctx.input;

      let wf: Workflow | undefined;
      try {
        wf = await findResourceBySlug(
          store,
          ApiResourceKind.workflow,
          WorkflowSchema,
          req.slug,
          req.org,
        );
      } catch (error) {
        throw internalError(error, "failed to search for workflow");
      }
      if (wf === undefined) {
        throw notFoundError("workflow", `${req.slug} (org: ${req.org})`);
      }

      ctx.set(LIST_VERSIONS_WORKFLOW_ID_KEY, wf.metadata!.id);
      // The live head's hash decides is_current downstream. Under repoint
      // semantics the current version need not be the newest-archived row,
      // so recency cannot stand in for currency.
      ctx.set(LIST_VERSIONS_HEAD_HASH_KEY, wf.status?.versionHash ?? "");
    },
  };
}

/** Loads audit records, maps to entries, paginates. */
function newLoadAndMapWorkflowVersionsStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return {
    name: "LoadAndMapWorkflowVersions",
    async execute(ctx: RequestContext<ListVersionsDesc>): Promise<void> {
      const req = ctx.input;
      const workflowId = ctx.get(LIST_VERSIONS_WORKFLOW_ID_KEY) as string;

      let records: AuditRecord[];
      try {
        records = await store.listAuditRecords(
          ApiResourceKind.workflow,
          workflowId,
        );
      } catch (error) {
        throw internalError(error, "failed to load workflow version history");
      }

      const headHash =
        (ctx.get(LIST_VERSIONS_HEAD_HASH_KEY) as string | undefined) ?? "";
      let currentMarked = false;
      const entries: WorkflowVersionEntry[] = [];
      for (const rec of records) {
        let wf: Workflow;
        try {
          wf = fromBinary(WorkflowSchema, rec.data);
        } catch {
          continue;
        }
        const isCurrent: boolean =
          !currentMarked &&
          headHash !== "" &&
          (wf.status?.versionHash ?? "") === headHash;
        currentMarked = currentMarked || isCurrent;
        // Tag comes from the audit column (source of truth), not the snapshot.
        entries.push(mapWorkflowToVersionEntry(wf, isCurrent, rec.tag));
      }

      let pageSize = req.pageSize;
      if (pageSize <= 0) {
        pageSize = LIST_VERSIONS_DEFAULT_PAGE_SIZE;
      }
      if (pageSize > LIST_VERSIONS_MAX_PAGE_SIZE) {
        pageSize = LIST_VERSIONS_MAX_PAGE_SIZE;
      }

      let startIndex = 0;
      if (req.pageToken !== "") {
        startIndex = decodePageToken(req.pageToken);
      }

      let pageEntries: WorkflowVersionEntry[] = [];
      let nextPageToken = "";
      if (startIndex < entries.length) {
        const end = Math.min(startIndex + pageSize, entries.length);
        pageEntries = entries.slice(startIndex, end);
        if (end < entries.length) {
          nextPageToken = Buffer.from(String(end)).toString("base64");
        }
      }

      ctx.set(
        LIST_VERSIONS_RESPONSE_KEY,
        create(ListWorkflowVersionsResponseSchema, {
          versions: pageEntries,
          nextPageToken,
          totalCount: entries.length,
        }),
      );
    },
  };
}

/**
 * Base64 offset token → index; malformed tokens are InvalidArgument.
 *
 * Decoding mirrors Go's exact acceptance set (panel finding — Node's
 * Buffer.from is far more lenient): base64.StdEncoding.DecodeString
 * requires the standard alphabet with proper trailing padding but ignores
 * \r and \n; strconv.Atoi accepts an optional sign and leading zeros. The
 * idx < 0 check then rejects negatives, exactly as Go's.
 */
const STD_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const GO_ATOI_PATTERN = /^[+-]?[0-9]+$/;

function decodePageToken(token: string): number {
  const stripped = token.replace(/[\r\n]/g, "");
  if (!STD_BASE64_PATTERN.test(stripped)) {
    throw invalidArgumentError("invalid page_token");
  }
  const decoded = Buffer.from(stripped, "base64").toString("utf8");
  if (!GO_ATOI_PATTERN.test(decoded)) {
    throw invalidArgumentError("invalid page_token");
  }
  const idx = Number(decoded);
  if (!Number.isSafeInteger(idx) || idx < 0) {
    throw invalidArgumentError("invalid page_token");
  }
  return idx;
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
): Promise<WorkflowVersionEntry> {
  if (req.workflowId === "") {
    throw invalidArgumentError("workflow_id is required");
  }
  if (req.versionHash === "") {
    throw invalidArgumentError("version_hash is required");
  }

  // First check the current (live) workflow — avoids an audit lookup for
  // the common case of recent executions.
  let currentWorkflow: Workflow;
  try {
    currentWorkflow = await deps.store.getResource(
      ApiResourceKind.workflow,
      req.workflowId,
      WorkflowSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("workflow", req.workflowId);
    }
    throw internalError(error, "failed to load workflow");
  }

  if ((currentWorkflow.status?.versionHash ?? "") === req.versionHash) {
    // The live head's metadata.version.tag is kept reconciled with the
    // head's authoritative audit tag, so it is the correct tag here.
    return mapWorkflowToVersionEntry(
      currentWorkflow,
      true,
      currentWorkflow.metadata?.version?.tag ?? "",
    );
  }

  let rec: AuditRecord;
  try {
    rec = await deps.store.getAuditRecordByHash(
      ApiResourceKind.workflow,
      req.workflowId,
      req.versionHash,
    );
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      throw notFoundError("workflow version", truncateHash(req.versionHash));
    }
    throw internalError(error, "failed to load workflow version from audit");
  }

  let archived: Workflow;
  try {
    archived = fromBinary(WorkflowSchema, rec.data);
  } catch (error) {
    throw internalError(error, "failed to decode archived workflow version");
  }

  return mapWorkflowToVersionEntry(archived, false, rec.tag);
}

/**
 * Converts an archived Workflow proto to a WorkflowVersionEntry — Go
 * mapWorkflowToVersionEntry. The tag is passed in by the caller from the
 * audit tag column (the source of truth), never read from the embedded
 * snapshot: a snapshot's tag is only correct as of archival time, whereas
 * the column reflects the current tag even after a tag move.
 */
function mapWorkflowToVersionEntry(
  wf: Workflow,
  isCurrent: boolean,
  tag: string,
): WorkflowVersionEntry {
  const entry = create(WorkflowVersionEntrySchema, { isCurrent, tag });

  if (wf.status !== undefined) {
    entry.versionHash = wf.status.versionHash;
    // The validated YAML for runner/viewer consumption.
    if (wf.status.serverlessWorkflowValidation !== undefined) {
      entry.validatedYaml = wf.status.serverlessWorkflowValidation.yaml;
    }
    const audit = wf.status.audit?.specAudit;
    if (audit !== undefined) {
      entry.appliedAt = audit.updatedAt ?? audit.createdAt;
      entry.appliedBy = audit.updatedBy ?? audit.createdBy;
    }
  }

  if (wf.metadata?.version !== undefined) {
    entry.message = wf.metadata.version.message;
  }

  return entry;
}
