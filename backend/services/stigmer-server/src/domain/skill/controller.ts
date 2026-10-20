/**
 * Skill controller — ports pkg/domain/skill/controller (command + query
 * sides): push-only content-addressed artifacts with the HTTP transfer
 * lane (#675). Skills are knowledge documents (SKILL.md + supporting
 * files) pushed as ZIP artifacts; identity derives from the frontmatter,
 * versions are content-addressed SHA-256 hashes with single-holder tags,
 * artifacts are write-once and never garbage-collected.
 *
 * Wiring mirrors Go's: the store, skill artifact storage and the File
 * bytes (pushFromFile) are required; the transfer lane
 * (createArtifactUploadUrl / getArtifactDownloadUrl / push-by-ref) is an
 * OPTIONAL modeled state — Go injects it via a setter, here it is an
 * optional dep; every absent-surface answer is a deliberate arm, not an
 * accident.
 *
 * Every chain opens with Authorize; push runs the tuple-lifecycle splice
 * (SkillPushAuthorizationTuples), and updateVisibility and delete the
 * shared tuple steps; getByReference and listVersions authorize the
 * resolved skill as `get` would; getArtifact and getArtifactDownloadUrl
 * skip authorization by design, the content-hash key being the capability
 * (docs/authorization-coverage.md §21).
 *
 * The transfer lane's capability
 * URLs come from the blob driver through the staging port
 * (transfer/staging.ts): the local driver's point at this server's own
 * HTTP lane, a bucket driver's straight at the bucket — same
 * capability-URL trust model, same client semantics, one code path.
 *
 * Proven by skill.conformance.test.ts (CONFORMANCE_TARGET=local) and
 * the co-located __tests__/ suites.
 */
import { posix } from "node:path";

import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import type { DescMethod } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";

import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import type { Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { FileIdSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import {
  GetArtifactResponseSchema,
  PushSkillFromFileRequestSchema,
  PushSkillRequestSchema,
  SkillArtifactDownloadUrlSchema,
  SkillArtifactUploadUrlSchema,
} from "@stigmer/apis/ai/stigmer/agentic/skill/v1/io_pb";
import type {
  CreateSkillArtifactUploadUrlRequest,
  GetArtifactRequest,
  GetArtifactResponse,
  ListSkillVersionsInput,
  ListSkillVersionsResponse,
  PushSkillFromFileRequest,
  PushSkillRequest,
  SkillArtifactDownloadUrl,
  SkillArtifactUploadUrl,
  SkillId,
} from "@stigmer/apis/ai/stigmer/agentic/skill/v1/io_pb";
import type {
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { SkillStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/status_pb";
import { ApiResourceAuditSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";
import { SkillListSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/io_pb";
import type {
  SkillList,
  ListSkillsRequest,
} from "@stigmer/apis/ai/stigmer/agentic/skill/v1/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
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
import { authorizeDirect, newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import { versionHistoryTarget } from "../../pipeline/steps/version-history.js";
import {
  newCleanupGrantsStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newReleaseNamesStep, releaseNameOnFailure } from "../../pipeline/steps/names.js";
import { newDeleteSearchIndexStep } from "../../pipeline/steps/index-search.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import { newValidateProtoStep, validator } from "../../pipeline/steps/validation.js";
import { readOrgListPage } from "../../pipeline/steps/org-list-page.js";
import { skillListIndex } from "./list-index.js";
import {
  newRefuseChildOrgsVisibilityInChildUpdateStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import { newDeleteVersionArchivesStep } from "../../pipeline/steps/version-archive.js";
import { ResourceNotFoundError } from "../../store/interface.js";
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
  newClaimSkillNameStep,
  newStoreSkillStep,
} from "./push.js";
import { skillSearchExtractor } from "./search-extractor.js";
import { ArtifactNotFoundError, SKILL_ARTIFACT_KEY_PREFIX } from "./storage/artifact-storage.js";
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
import { runGuardedWrite } from "../../pipeline/guarded-write.js";
import { ARTIFACT_BYTES_KEY } from "../../pipeline/steps/resolve-artifact-source.js";
import type { FileBlobs } from "../file/blobs.js";

/**
 * pushFromFile's read deadline: bounds the File's read, sized for the
 * cloud edition's remote storage; the OSS local read finishes far inside
 * it.
 */
const FILE_READ_TIMEOUT_MS = 60_000;

export interface SkillControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed list read scope — list narrows through it; undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
  readonly artifactStorage: SkillArtifactStorage;
  /** The Files' bytes, which pushFromFile reads a skill archive from. */
  readonly fileBlobs: FileBlobs;
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
    pushFromFile: (req, ctx) => pushFromFile(deps, req, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    delete: (id, ctx) => deleteSkill(deps, id, ctx),
  });
  router.service(SkillQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    list: (req, ctx) => list(deps, req, ctx),
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
 * RPCs run this pipeline: push itself and pushFromFile (which delegates
 * here after it reads the File). Each authorizes under its
 * OWN annotation — a hardcoded method.push would silently evaluate the
 * wrong config the day the two annotations diverge (the runLifecyclePipeline
 * pattern).
 */
async function push(
  deps: SkillControllerDeps,
  req: PushSkillRequest,
  ctx: HandlerContext,
  method: DescMethod,
): Promise<Skill> {
  // A retried attempt keeps the artifact bytes the first one consumed: an
  // upload reference is single-use (ResolveArtifactSource).
  let previous: RequestContext<typeof PushSkillRequestSchema> | undefined;
  return runGuardedWrite(async () => {
    const reqCtx = new RequestContext(
      PushSkillRequestSchema,
      req,
      callerIdentityOf(ctx),
      kindOf(ctx),
    );
    const consumed = previous?.get(ARTIFACT_BYTES_KEY);
    if (consumed !== undefined) {
      reqCtx.set(ARTIFACT_BYTES_KEY, consumed);
    }
    previous = reqCtx;
    await newPipeline<typeof PushSkillRequestSchema>("skill-push", deps.logger)
      .addStep(newAuthorizeStep(method, deps.authorizer))
      .addStep(newValidateProtoStep())
      .addStep(newResolveArtifactSourceStep(deps.staging))
      .addStep(newBuildInitialSkillStep())
      .addStep(newExtractAndHashArtifactStep())
      .addStep(newResolveSlugForPushStep())
      .addStep(newFindExistingBySlugStep(deps.store))
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
      .addStep(newClaimSkillNameStep(deps.store))
      .addStep(newStoreSkillStep(deps.store))
      .addStep(newArchiveCurrentSkillStep(deps.store, deps.logger))
      .addStep(
        newSkillPushAuthorizationTuplesStep(
          deps.authorizationLifecycle,
          deps.logger,
        ),
      )
      .addStep(newIndexSkillSearchStep(deps.store, deps.logger))
      .build()
      .execute(reqCtx)
      .catch(releaseNameOnFailure(deps.store, deps.logger, reqCtx));
    return reqCtx.get(SKILL_KEY) as Skill;
  });
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
 * PushFromFile — the server-side push: reads a File holding a skill's ZIP
 * archive and delegates to the standard push pipeline. Every question is
 * asked before a byte is read: whether the caller may push skills into the
 * organization at all, whether the File exists in that organization (a
 * File of another one answers not-found before access is asked, so the
 * answer says nothing about it), whether the caller may view it, and
 * whether it fits the archive cap. The pipeline then authorizes again
 * under this method's annotation, by design.
 */
async function pushFromFile(
  deps: SkillControllerDeps,
  req: PushSkillFromFileRequest,
  ctx: HandlerContext,
): Promise<Skill> {
  const validation = validator().validate(PushSkillFromFileRequestSchema, req);
  if (validation.kind === "invalid") {
    throw new ConnectError(validation.error.message, Code.InvalidArgument);
  }
  /* v8 ignore start -- a backstop: the request's rules compile with the contract, so no request reaches it */
  if (validation.kind === "error") {
    throw internalError(validation.error, "validation could not run");
  }
  /* v8 ignore stop */

  const identity = callerIdentityOf(ctx);
  const method = SkillCommandController.method.pushFromFile;
  await authorizeDirect(method, deps.authorizer, identity, req);

  let file: File;
  try {
    file = await deps.store.getResource(ApiResourceKind.file, req.fileId, FileSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("file", req.fileId);
    }
    throw internalError(error, "failed to load file");
  }
  if ((file.metadata?.org ?? "") !== req.org) {
    throw notFoundError("file", req.fileId);
  }
  await authorizeDirect(
    FileQueryController.method.get,
    deps.authorizer,
    identity,
    create(FileIdSchema, { value: req.fileId }),
  );

  const sizeBytes = Number(file.status?.sizeBytes ?? 0n);
  if (sizeBytes > MAX_ZIP_SIZE) {
    throw invalidArgumentError(
      `file ${req.fileId} is ${sizeBytes} bytes; a skill archive may be at most ${MAX_ZIP_SIZE}`,
    );
  }

  const data = await withTimeout(
    deps.fileBlobs.readHead(req.fileId, sizeBytes),
    FILE_READ_TIMEOUT_MS,
  ).catch((error: unknown) => {
    if (error instanceof ConnectError) {
      throw error;
    }
    throw internalError(error, "failed to read the file");
  });

  const skill = await push(
    deps,
    create(PushSkillRequestSchema, {
      org: req.org,
      artifact: data,
      tag: req.tag,
    }),
    ctx,
    method,
  );

  deps.logger.info("Pushed skill from file", {
    fileId: req.fileId,
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
    .addStep(newRefuseChildOrgsVisibilityInChildUpdateStep(deps.store, UPDATE_VISIBILITY_SKILL_KEY))
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

/** Loads the skill by resource_id; a missing one answers NotFound, a store fault Internal. */
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
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("skill", input.resourceId);
        }
        throw internalError(error, "failed to load skill");
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

/**
 * Persists the visibility change: the visibility and status audit the
 * chain set on the loaded skill, applied to the live row inside the
 * store's atomic read-modify-write, so a push that landed since the load
 * stays (the agent's PersistAgentForVisibilityUpdate). The written row
 * replaces the loaded one under the key.
 */
function newPersistSkillForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistSkillForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const skill = ctx.get(UPDATE_VISIBILITY_SKILL_KEY) as Skill;
      const id = skill.metadata?.id ?? "";
      let written: Skill;
      try {
        written = await store.updateResource(
          ctx.apiResourceKind,
          id,
          SkillSchema,
          (row) => {
            if (row.metadata !== undefined) {
              row.metadata.visibility =
                skill.metadata?.visibility ?? row.metadata.visibility;
            }
            const audit = ((row.status ??= create(SkillStatusSchema)).audit ??=
              create(ApiResourceAuditSchema));
            audit.statusAudit = skill.status?.audit?.statusAudit;
          },
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("skill", id);
        }
        throw internalError(error, "failed to save skill");
      }
      ctx.set(UPDATE_VISIBILITY_SKILL_KEY, written);
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
    .addStep(newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.skill))
    .addStep(
      newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger),
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

  refuseForeignKey(req);
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

  refuseForeignKey(req);
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

const SKILL_LIST_KEY = "skillList";

/**
 * List — one page of an organization's skills, newest first, through the
 * skill list index; the read scope keeps the skills the caller could get by
 * id, as every organization list does. Search finds skills by their
 * words; this browses them.
 */
async function list(
  deps: SkillControllerDeps,
  req: ListSkillsRequest,
  ctx: HandlerContext,
): Promise<SkillList> {
  const reqCtx = new RequestContext(
    SkillQueryController.method.list.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof SkillQueryController.method.list.input>(
    "skill-list",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(SkillQueryController.method.list, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep({
      name: "ListByOrg",
      async execute(step): Promise<void> {
        const page = await readOrgListPage({
          store: deps.store,
          logger: deps.logger,
          listReadScope: deps.listReadScope,
          caller: step.callerIdentity,
          kind: ApiResourceKind.skill,
          schema: SkillSchema,
          declaration: skillListIndex,
          request: step.input,
        });
        step.set(
          SKILL_LIST_KEY,
          create(SkillListSchema, {
            entries: page.entries,
            nextPageToken: page.nextPageToken,
          }),
        );
      },
    })
    .build()
    .execute(reqCtx);
  return reqCtx.get(SKILL_LIST_KEY) as SkillList;
}

/**
 * A key outside the skill store's own prefix reads as not found, as a
 * missing one does: the skill store shares its blob driver with every
 * archive kind, and another kind's archives are not this lane's to serve.
 * A plugin's keep their own lane, and an eval's are served only to its
 * viewers. A key must already be in normal form, so a `..` segment cannot
 * climb out of `skills/` on a store that resolves keys as paths.
 */
function refuseForeignKey(req: GetArtifactRequest): void {
  const key = req.artifactStorageKey;
  if (!key.startsWith(SKILL_ARTIFACT_KEY_PREFIX) || posix.normalize(key) !== key || key.split("/").includes("..")) {
    throw new ConnectError(`skill artifact not found: ${key}`, Code.NotFound);
  }
}
