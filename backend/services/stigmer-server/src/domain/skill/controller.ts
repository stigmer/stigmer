/**
 * Skill controller — ports pkg/domain/skill/controller (command + query
 * sides): push-only content-addressed artifacts with the HTTP transfer
 * lane (#675). Skills are knowledge documents (SKILL.md + supporting
 * files) pushed as ZIP artifacts; identity derives from the frontmatter,
 * versions are content-addressed SHA-256 hashes with single-holder tags,
 * artifacts are write-once and never garbage-collected.
 *
 * Wiring mirrors Go's: the store and skill artifact storage are required;
 * execution artifact storage (pushFromExecutionArtifact) and the transfer
 * lane (createArtifactUploadUrl / getArtifactDownloadUrl / push-by-ref)
 * are OPTIONAL modeled states — Go injects them via setters, here they are
 * optional deps; every absent-surface answer is a deliberate arm, not an
 * accident.
 *
 * Versus Stigmer Cloud, OSS excludes the TransformResponse/SendResponse
 * steps (no response transformation). The transfer lane's capability
 * URLs come from the blob driver through the staging port
 * (transfer/staging.ts): the local driver's point at this server's own
 * HTTP lane, a bucket driver's straight at the bucket — same
 * capability-URL trust model, same client semantics, one code path.
 *
 * Proven by skill.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * the co-located __tests__/ suites.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import type { DescMethod } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";

import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import {
  GetArtifactResponseSchema,
  PushSkillRequestSchema,
  SkillArtifactDownloadUrlSchema,
  SkillArtifactUploadUrlSchema,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import type {
  CreateSkillArtifactUploadUrlRequest,
  GetArtifactRequest,
  GetArtifactResponse,
  ListSkillVersionsInput,
  ListSkillVersionsResponse,
  PushSkillFromExecutionArtifactRequest,
  PushSkillRequest,
  SkillArtifactDownloadUrl,
  SkillArtifactUploadUrl,
  SkillId,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import type {
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import { versionHistoryTarget } from "../../pipeline/steps/version-history.js";
import { newAuthorizeVisibilityTransitionStep } from "../../pipeline/steps/visibility-gates.js";
import {
  newCleanupIamPoliciesStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newGuardPluginManagedStep } from "../../pipeline/steps/guard-plugin-managed.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityUpdateStep } from "../../pipeline/steps/validate-visibility.js";
import { newDeleteVersionArchivesStep } from "../../pipeline/steps/version-archive.js";
import type { Store } from "../../store/interface.js";
import { MAX_ZIP_SIZE, TRANSFER_LANE_NOT_CONFIGURED } from "./constants.js";
import {
  EXISTING_SKILL_KEY,
  SKILL_KEY,
  newArchiveCurrentSkillStep,
  newBuildInitialSkillStep,
  newCheckAndStoreArtifactStep,
  newExtractAndHashArtifactStep,
  newFindExistingBySlugStep,
  newGenerateIdIfNeededStep,
  newIndexSkillSearchStep,
  newPopulateSkillFieldsStep,
  newResolveArtifactSourceStep,
  newResolveSlugForPushStep,
  newSkillPushAuthorizationTuplesStep,
  newStoreSkillStep,
} from "./push.js";
import { skillSearchExtractor } from "./search-extractor.js";
import { ArtifactNotFoundError } from "./storage/artifact-storage.js";
import type { SkillArtifactStorage } from "./storage/artifact-storage.js";
import type {
  ArchiveStaging,
  DownloadCapability,
  StagedUpload,
} from "./transfer/staging.js";
import {
  LIST_VERSIONS_RESPONSE_KEY,
  LIST_VERSIONS_SKILL_ID_KEY,
  newLoadAndMapVersionsStep,
  newLoadSkillByReferenceStep,
  newResolveSkillBySlugStep,
} from "./version-resolution.js";

/**
 * Go's PushFromExecutionArtifact download deadline: bounds the artifact
 * fetch, sized for the cloud edition's remote storage; the OSS local read
 * finishes far inside it.
 */
const EXECUTION_ARTIFACT_DOWNLOAD_TIMEOUT_MS = 60_000;

export interface SkillControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op (C2). */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly artifactStorage: SkillArtifactStorage;
  /**
   * Execution artifact storage for pushFromExecutionArtifact (Go
   * SetExecutionArtifactStorage). Optional — absent answers Internal
   * "execution artifact storage not configured".
   */
  readonly executionArtifactStorage?: ArtifactStorage;
  /**
   * The transfer lane's staging port (Go SetTransferLane) over the skill
   * blob driver. Optional — absent, createArtifactUploadUrl and
   * getArtifactDownloadUrl answer FailedPrecondition and push accepts
   * inline bytes only.
   */
  readonly staging?: ArchiveStaging;
}

/** Registers both skill services on the router (routes stage). */
export function registerSkillServices(
  router: ConnectRouter,
  deps: SkillControllerDeps,
): void {
  router.service(SkillCommandController, {
    push: (req, ctx) =>
      push(deps, req, ctx, SkillCommandController.method.push),
    createArtifactUploadUrl: (req, ctx) =>
      createArtifactUploadUrl(deps, req, ctx),
    pushFromExecutionArtifact: (req, ctx) =>
      pushFromExecutionArtifact(deps, req, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    delete: (id, ctx) => deleteSkill(deps, id, ctx),
  });
  router.service(SkillQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getArtifact: (req, ctx) => getArtifact(deps, req, ctx),
    getArtifactDownloadUrl: (req, ctx) =>
      getArtifactDownloadUrl(deps, req, ctx),
    listVersions: (req, ctx) => listVersions(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Push — the upsert-by-slug pipeline (push.ts holds the steps and the
 * versioning discipline; GuardReservedLabels is spliced here because the
 * request's labels persist). Returns the built skill from context: the
 * pipeline's message type is the request, so the resource rides SKILL_KEY.
 *
 * `method` is the AUTHORIZING descriptor, passed by the caller because two
 * RPCs run this pipeline: push itself and pushFromExecutionArtifact (which
 * delegates here after its artifact download). Each authorizes under its
 * OWN annotation — a hardcoded method.push would silently evaluate the
 * wrong config the day the two annotations diverge (the runLifecyclePipeline
 * pattern, O2).
 */
async function push(
  deps: SkillControllerDeps,
  req: PushSkillRequest,
  ctx: HandlerContext,
  method: DescMethod,
): Promise<Skill> {
  const reqCtx = new RequestContext(
    PushSkillRequestSchema,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PushSkillRequestSchema>("skill-push", deps.logger)
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newResolveArtifactSourceStep(deps.staging))
    .addStep(newBuildInitialSkillStep())
    .addStep(newExtractAndHashArtifactStep())
    .addStep(newResolveSlugForPushStep())
    .addStep(newFindExistingBySlugStep(deps.store))
    // A skill has no update RPC: a second push under the same name IS the
    // client's mutation path, so a plugin-managed skill refuses it here,
    // naming the plugin. The controller's own re-materialisation passes by
    // origin.
    .addStep(
      newGuardPluginManagedStep<typeof PushSkillRequestSchema>(deps.store, {
        existingKey: EXISTING_SKILL_KEY,
      }),
    )
    .addStep(newGenerateIdIfNeededStep())
    .addStep(newCheckAndStoreArtifactStep(deps.artifactStorage))
    .addStep(newPopulateSkillFieldsStep())
    // The reserved-namespace guard every write boundary runs, positioned
    // after the populate step because the skill rides SKILL_KEY (not
    // newState) and its stored labels ride EXISTING_SKILL_KEY.
    .addStep(
      newGuardReservedLabelsStep<typeof PushSkillRequestSchema>(
        deps.authorizer,
        {
          stateOf: (stepCtx) => stepCtx.get(SKILL_KEY) as Skill | undefined,
          existingKey: EXISTING_SKILL_KEY,
        },
      ),
    )
    .addStep(newArchiveCurrentSkillStep(deps.store, deps.logger))
    .addStep(newStoreSkillStep(deps.store))
    .addStep(
      newSkillPushAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(newIndexSkillSearchStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(SKILL_KEY) as Skill;
}

/**
 * CreateArtifactUploadUrl — mints a short-lived, single-use upload URL for
 * an artifact exceeding the gRPC message cap (#675): the blob driver's own
 * PUT surface, through the staging port. The size gate is the fail-loud
 * half of the contract: an over-limit artifact is refused with the actual
 * limit in the message BEFORE any bytes move, instead of surfacing as a
 * transport error mid-upload.
 */
async function createArtifactUploadUrl(
  deps: SkillControllerDeps,
  req: CreateSkillArtifactUploadUrlRequest,
  ctx: HandlerContext,
): Promise<SkillArtifactUploadUrl> {
  const staging = deps.staging;
  if (staging === undefined) {
    throw failedPreconditionError(TRANSFER_LANE_NOT_CONFIGURED);
  }

  const reqCtx = new RequestContext(
    SkillCommandController.method.createArtifactUploadUrl.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof SkillCommandController.method.createArtifactUploadUrl.input
  >("skill-create-artifact-upload-url", deps.logger)
    .addStep(
      newAuthorizeStep(
        SkillCommandController.method.createArtifactUploadUrl,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);

  if (req.sizeBytes > BigInt(MAX_ZIP_SIZE)) {
    throw invalidArgumentError(
      `skill artifact size ${req.sizeBytes} bytes exceeds the ${MAX_ZIP_SIZE}-byte (100MB) skill limit`,
    );
  }

  let minted: StagedUpload;
  try {
    minted = await staging.mint(Number(req.sizeBytes));
  } catch (error) {
    throw internalError(error, "failed to mint upload reference");
  }

  return create(SkillArtifactUploadUrlSchema, {
    url: minted.url,
    artifactUploadRef: minted.ref,
    ttlSeconds: Math.trunc(minted.ttlMs / 1000),
  });
}

/**
 * PushFromExecutionArtifact — the server-side push: reads a directory
 * artifact an agent execution produced and delegates to the standard push
 * pipeline. The storage_key prefix convention is the ownership check: a
 * key outside artifacts/{execution_id}/ is a traversal attempt.
 */
async function pushFromExecutionArtifact(
  deps: SkillControllerDeps,
  req: PushSkillFromExecutionArtifactRequest,
  ctx: HandlerContext,
): Promise<Skill> {
  if (deps.executionArtifactStorage === undefined) {
    deps.logger.error(
      "Execution artifact storage not configured - cannot push from execution artifact",
    );
    throw internalError(
      new Error("execution artifact storage not configured"),
      "execution artifact storage not configured",
    );
  }

  if (req.executionId === "") {
    throw invalidArgumentError("execution_id is required");
  }
  if (req.storageKey === "") {
    throw invalidArgumentError("storage_key is required");
  }
  if (req.org === "") {
    throw invalidArgumentError("org is required");
  }

  const expectedPrefix = `artifacts/${req.executionId}/`;
  if (!req.storageKey.startsWith(expectedPrefix)) {
    deps.logger.warn(
      "Storage key does not belong to execution - potential path traversal attempt",
      {
        executionId: req.executionId,
        storageKey: req.storageKey,
        expectedPrefix,
      },
    );
    throw invalidArgumentError("storage_key does not belong to this execution");
  }

  deps.logger.info("Pushing skill from execution artifact", {
    executionId: req.executionId,
    storageKey: req.storageKey,
    org: req.org,
    tag: req.tag,
  });

  let data: Uint8Array;
  try {
    data = await withTimeout(
      deps.executionArtifactStorage.download(req.storageKey),
      EXECUTION_ARTIFACT_DOWNLOAD_TIMEOUT_MS,
    );
  } catch (error) {
    deps.logger.error("Failed to download execution artifact", {
      executionId: req.executionId,
      storageKey: req.storageKey,
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to download execution artifact");
  }

  const skill = await push(
    deps,
    create(PushSkillRequestSchema, {
      org: req.org,
      artifact: data,
      tag: req.tag,
    }),
    ctx,
    SkillCommandController.method.pushFromExecutionArtifact,
  );

  deps.logger.info("Successfully pushed skill from execution artifact", {
    executionId: req.executionId,
    storageKey: req.storageKey,
    skillId: skill.metadata?.id ?? "",
    skillName: skill.metadata?.name ?? "",
  });

  return skill;
}

// ─── updateVisibility ────────────────────────────────────────────────────
// Go update_visibility.go: a targeted metadata update — only
// metadata.visibility changes; spec, status, and other metadata fields are
// untouched. Load runs before level validation so NOT_FOUND wins, as in
// Cloud.
// ─────────────────────────────────────────────────────────────────────────

const UPDATE_VISIBILITY_SKILL_KEY = "updateVisibilitySkill";

type UpdateVisibilityDesc =
  typeof SkillCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: SkillControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<Skill> {
  const reqCtx = new RequestContext(
    SkillCommandController.method.updateVisibility.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>(
    "skill-update-visibility",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        SkillCommandController.method.updateVisibility,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadSkillForVisibilityUpdateStep(deps.store))
    .addStep(
      newGuardPluginManagedStep(deps.store, {
        existingKey: UPDATE_VISIBILITY_SKILL_KEY,
      }),
    )
    .addStep(newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_SKILL_KEY))
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(
      newAuthorizeVisibilityTransitionStep(
        UPDATE_VISIBILITY_SKILL_KEY,
        deps.authorizer,
      ),
    )
    .addStep(newSetVisibilityStep())
    .addStep(newPersistSkillForVisibilityUpdateStep(deps.store))
    .addStep(
      newUpdateVisibilityTuplesStep(
        deps.authorizationLifecycle,
        UPDATE_VISIBILITY_SKILL_KEY,
      ),
    )
    .addStep(newIndexSkillAfterVisibilityUpdateStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(UPDATE_VISIBILITY_SKILL_KEY) as Skill;
}

/** Loads the skill by resource_id; ANY load failure → NotFound. */
function newLoadSkillForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadSkillForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const input = ctx.input;
      let skill: Skill;
      try {
        skill = await store.getResource(
          ctx.apiResourceKind,
          input.resourceId,
          SkillSchema,
        );
      } catch {
        throw notFoundError("skill", input.resourceId);
      }
      ctx.set(UPDATE_VISIBILITY_SKILL_KEY, skill);
    },
  };
}

/** Sets metadata.visibility and stamps the StatusAudit slot (#540). */
function newSetVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const skill = ctx.get(UPDATE_VISIBILITY_SKILL_KEY) as Skill;
      if (skill.metadata !== undefined) {
        skill.metadata.visibility = ctx.input.visibility;
      }
      setAuditFieldsForUpdate(
        SkillSchema,
        skill,
        "status_audit",
        ctx.callerIdentity,
      );
    },
  };
}

/** Persists the visibility change. */
function newPersistSkillForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistSkillForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const skill = ctx.get(UPDATE_VISIBILITY_SKILL_KEY) as Skill;
      try {
        await store.saveResource(
          ctx.apiResourceKind,
          skill.metadata?.id ?? "",
          SkillSchema,
          skill,
        );
      } catch (error) {
        throw internalError(error, "failed to save skill");
      }
    },
  };
}

/** Re-indexes after the change (visibility is indexed); best-effort. */
function newIndexSkillAfterVisibilityUpdateStep(
  store: Store,
  logger: Logger,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "IndexSkillAfterVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const skill = ctx.get(UPDATE_VISIBILITY_SKILL_KEY) as Skill;
      const entry = skillSearchExtractor.getSearchIndexEntry(skill);
      if (entry === undefined) {
        logger.warn(
          "IndexSkillAfterVisibilityUpdate: extractor returned nil, skipping",
          {
            id: skill.metadata?.id ?? "",
          },
        );
        return;
      }
      try {
        await store.upsertSearchIndex(
          ctx.apiResourceKind,
          skill.metadata?.id ?? "",
          entry,
        );
      } catch (error) {
        logger.warn("IndexSkillAfterVisibilityUpdate: failed (best-effort)", {
          id: skill.metadata?.id ?? "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * Delete — the 6-step chain; version-history archives are cleaned up
 * best-effort BEFORE the resource row (no FK cascade in the schema, by
 * design). Returns the deleted skill for the audit-trail convention.
 */
async function deleteSkill(
  deps: SkillControllerDeps,
  id: SkillId,
  ctx: HandlerContext,
): Promise<Skill> {
  const reqCtx = new RequestContext(
    SkillCommandController.method.delete.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof SkillCommandController.method.delete.input>(
    "skill-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(SkillCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, SkillSchema))
    .addStep(newGuardPluginManagedStep(deps.store))
    .addStep(newDeleteSkillArchivesStep(deps.store, deps.logger))
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
      new Error("deleted skill not found in context"),
      "deleted skill not found in context",
    );
  }
  return deleted as Skill;
}

/**
 * DeleteSkillArchives — best-effort audit cleanup (Go
 * DeleteSkillArchivesStep): failures log and never block the delete. The
 * mechanics are the shared content-addressed step's.
 */
function newDeleteSkillArchivesStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof SkillCommandController.method.delete.input> {
  return newDeleteVersionArchivesStep(store, logger, {
    stepName: "DeleteSkillArchives",
    noun: "skill",
  });
}

/** Get — the standard LoadTarget-by-id pipeline. */
async function get(
  deps: SkillControllerDeps,
  id: SkillId,
  ctx: HandlerContext,
): Promise<Skill> {
  const reqCtx = new RequestContext(
    SkillQueryController.method.get.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof SkillQueryController.method.get.input>(
    "skill-get",
    deps.logger,
  )
    .addStep(newAuthorizeStep(SkillQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, SkillSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Skill;
}

/** GetByReference — slug + org with the version-resolution ladder. */
async function getByReference(
  deps: SkillControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Skill> {
  const reqCtx = new RequestContext(
    SkillQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof SkillQueryController.method.getByReference.input>(
    "skill-get-by-reference",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        SkillQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadSkillByReferenceStep(deps.store))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(SkillQueryController.method.get),
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Skill;
}

/**
 * GetArtifact — raw ZIP bytes by storage key over gRPC (≤10MB messages;
 * larger artifacts ride the download-URL lane). Authorization is skipped
 * by proto config: the content-hash storage key is the capability token.
 */
async function getArtifact(
  deps: SkillControllerDeps,
  req: GetArtifactRequest,
  ctx: HandlerContext,
): Promise<GetArtifactResponse> {
  const reqCtx = new RequestContext(
    SkillQueryController.method.getArtifact.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof SkillQueryController.method.getArtifact.input>(
    "skill-get-artifact",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        SkillQueryController.method.getArtifact,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);

  let artifact: Uint8Array;
  try {
    artifact = await deps.artifactStorage.get(req.artifactStorageKey);
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) {
      // Go: status.Errorf(codes.NotFound, "skill artifact not found: %s").
      throw new ConnectError(
        `skill artifact not found: ${req.artifactStorageKey}`,
        Code.NotFound,
      );
    }
    throw internalError(error, "failed to load skill artifact");
  }

  return create(GetArtifactResponseSchema, { artifact });
}

/**
 * GetArtifactDownloadUrl — the transfer-lane twin of GetArtifact (#675):
 * stats (never loads) the artifact, then asks the staging port for its
 * capability URL. ttl_seconds is the floor of the URL's validity: a bucket
 * driver signs its GET for exactly that long, while the local lane's URL
 * embeds the same content-hash capability the storage key does and never
 * expires, so the floor holds there trivially.
 */
async function getArtifactDownloadUrl(
  deps: SkillControllerDeps,
  req: GetArtifactRequest,
  ctx: HandlerContext,
): Promise<SkillArtifactDownloadUrl> {
  const staging = deps.staging;
  if (staging === undefined) {
    throw failedPreconditionError(TRANSFER_LANE_NOT_CONFIGURED);
  }

  const reqCtx = new RequestContext(
    SkillQueryController.method.getArtifactDownloadUrl.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof SkillQueryController.method.getArtifactDownloadUrl.input
  >("skill-get-artifact-download-url", deps.logger)
    .addStep(
      newAuthorizeStep(
        SkillQueryController.method.getArtifactDownloadUrl,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);

  let size: number;
  try {
    size = await deps.artifactStorage.size(req.artifactStorageKey);
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) {
      throw new ConnectError(
        `skill artifact not found: ${req.artifactStorageKey}`,
        Code.NotFound,
      );
    }
    throw internalError(error, "failed to stat skill artifact");
  }

  let capability: DownloadCapability;
  try {
    capability = await staging.downloadUrl(req.artifactStorageKey);
  } catch (error) {
    throw internalError(error, "failed to mint skill artifact download URL");
  }

  return create(SkillArtifactDownloadUrlSchema, {
    url: capability.url,
    ttlSeconds: Math.trunc(capability.ttlMs / 1000),
    sizeBytes: BigInt(size),
  });
}

/** ListVersions — resolve by slug, map audit records, paginate. */
async function listVersions(
  deps: SkillControllerDeps,
  req: ListSkillVersionsInput,
  ctx: HandlerContext,
): Promise<ListSkillVersionsResponse> {
  const reqCtx = new RequestContext(
    SkillQueryController.method.listVersions.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof SkillQueryController.method.listVersions.input>(
    "skill-list-versions",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        SkillQueryController.method.listVersions,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSkillBySlugStep(deps.store))
    // The Java SkillListVersionsHandler's mid-chain can_view on the RESOLVED
    // skill id; the copy is the Java handler's byte-pinned error_msg, and an
    // unknown slug was already answered NOT_FOUND by the resolve step above.
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        versionHistoryTarget(
          ApiResourceKind.skill,
          "unauthorized to view skill version history",
          LIST_VERSIONS_SKILL_ID_KEY,
        ),
        "AuthorizeResolvedSkill",
      ),
    )
    .addStep(newLoadAndMapVersionsStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(LIST_VERSIONS_RESPONSE_KEY) as ListSkillVersionsResponse;
}

/** Bounds a promise by the named deadline (Go's context.WithTimeout arm). */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("context deadline exceeded")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
