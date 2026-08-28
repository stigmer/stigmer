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
 * Versus Stigmer Cloud, OSS excludes the Authorize/TransformResponse/
 * SendResponse steps (no multi-tenant auth or response transformation) and
 * serves artifact bytes itself instead of R2 pre-signed URLs — same
 * capability-URL trust model, same client semantics.
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
import { newAuthorizeVisibilityTransitionStep } from "../../pipeline/steps/visibility-gates.js";
import {
  newCleanupIamPoliciesStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import {
  RESOURCE_ID_KEY,
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
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityUpdateStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import { MAX_ZIP_SIZE, TRANSFER_LANE_NOT_CONFIGURED } from "./constants.js";
import {
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
import { downloadUrl, uploadUrl } from "./transfer/handler.js";
import type { UploadSlots } from "./transfer/slots.js";
import {
  LIST_VERSIONS_RESPONSE_KEY,
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

/** The transfer lane's controller-side pair (Go SetTransferLane). */
export interface SkillTransferLaneDeps {
  readonly slots: UploadSlots;
  /** Externally-reachable base minted into upload and download URLs. */
  readonly baseUrl: string;
}

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
   * The HTTP transfer lane (Go SetTransferLane). Optional — absent,
   * createArtifactUploadUrl and getArtifactDownloadUrl answer
   * FailedPrecondition and push accepts inline bytes only.
   */
  readonly transferLane?: SkillTransferLaneDeps;
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
 * Push — the 12-step upsert-by-slug pipeline (push.ts holds the steps and
 * the versioning discipline). Returns the built skill from context: the
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
    .addStep(newResolveArtifactSourceStep(deps.transferLane?.slots))
    .addStep(newBuildInitialSkillStep())
    .addStep(newExtractAndHashArtifactStep())
    .addStep(newResolveSlugForPushStep())
    .addStep(newFindExistingBySlugStep(deps.store))
    .addStep(newGenerateIdIfNeededStep())
    .addStep(newCheckAndStoreArtifactStep(deps.artifactStorage))
    .addStep(newPopulateSkillFieldsStep())
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
 * CreateArtifactUploadUrl — mints a short-lived, single-use HTTP upload
 * URL for an artifact exceeding the gRPC message cap (#675). The size gate
 * is the fail-loud half of the contract: an over-limit artifact is refused
 * with the actual limit in the message BEFORE any bytes move, instead of
 * surfacing as a transport error mid-upload.
 */
async function createArtifactUploadUrl(
  deps: SkillControllerDeps,
  req: CreateSkillArtifactUploadUrlRequest,
  ctx: HandlerContext,
): Promise<SkillArtifactUploadUrl> {
  const lane = deps.transferLane;
  if (lane === undefined) {
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

  let minted: { ref: string; ttlMs: number };
  try {
    minted = lane.slots.mint(Number(req.sizeBytes));
  } catch (error) {
    throw internalError(error, "failed to mint upload reference");
  }

  return create(SkillArtifactUploadUrlSchema, {
    url: uploadUrl(lane.baseUrl, minted.ref),
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
 * DeleteSkillArchivesStep): failures log and never block the delete.
 */
function newDeleteSkillArchivesStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof SkillCommandController.method.delete.input> {
  return {
    name: "DeleteSkillArchives",
    async execute(
      ctx: RequestContext<typeof SkillCommandController.method.delete.input>,
    ): Promise<void> {
      const resourceId = ctx.get(RESOURCE_ID_KEY);
      if (typeof resourceId !== "string") {
        throw new Error(
          "resource id not found in context (ExtractResourceIdStep must run first)",
        );
      }
      try {
        const deletedCount = await store.deleteAuditByResourceId(
          ctx.apiResourceKind,
          resourceId,
        );
        if (deletedCount > 0) {
          logger.info("Deleted archive records for skill", {
            skillId: resourceId,
            count: deletedCount,
          });
        }
      } catch (error) {
        logger.warn("failed to delete skill archives (best-effort)", {
          skillId: resourceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
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
 * stats (never loads) the artifact and mints its capability URL. The URL
 * does not expire on OSS (ttl_seconds = 0) — it embeds the same
 * content-hash capability a stored storage key would.
 */
async function getArtifactDownloadUrl(
  deps: SkillControllerDeps,
  req: GetArtifactRequest,
  ctx: HandlerContext,
): Promise<SkillArtifactDownloadUrl> {
  const lane = deps.transferLane;
  if (lane === undefined) {
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

  return create(SkillArtifactDownloadUrlSchema, {
    url: downloadUrl(lane.baseUrl, req.artifactStorageKey),
    ttlSeconds: 0,
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
