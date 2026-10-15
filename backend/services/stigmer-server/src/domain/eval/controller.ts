/**
 * Eval controller — the Eval kind's command and query sides. An eval is
 * an evals/ folder pushed whole: `push` reads it and stores the eval with
 * its cases in its status (push.ts holds the steps); `getByReference` and
 * `listVersions` are the shared content-addressed version steps bound to
 * the eval's digest and tag (versions.ts); `download` and `getDownloadUrl`
 * hand back one version's archive to whoever may view the eval;
 * `updateVisibility`, `rename` and `delete` are the shared shapes.
 *
 * Every download names the eval at a version, resolved by the same ladder
 * as getByReference, and asks can_view on it before a byte or a URL
 * leaves the server: an eval may hold copies of conversations, so a
 * person who can no longer view it can download no version, whatever
 * digest they remember. A plugin's and a skill's archives are fetched by
 * storage key instead, the capability a runner holds; nothing here serves
 * a key.
 *
 * Wiring mirrors the plugin controller's: the store and the archive store
 * are required; the transfer lane is OPTIONAL (absent, the upload mint and
 * the download URL answer FailedPrecondition, push takes inline bytes and
 * download returns them inline).
 *
 * Proven by __tests__/eval.test.ts (composed-server round trips) and
 * eval.conformance.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { EvalSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import type { Eval } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalCommandController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/command_pb";
import {
  EvalArchiveDownloadUrlSchema,
  EvalArchiveSchema,
  EvalArtifactUploadUrlSchema,
  EvalListSchema,
  PushEvalRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import type {
  CreateEvalArtifactUploadUrlRequest,
  EvalArchive,
  EvalArchiveDownloadUrl,
  EvalArtifactUploadUrl,
  EvalId,
  EvalList,
  ListEvalsRequest,
  ListEvalVersionsInput,
  ListEvalVersionsResponse,
  PushEvalRequest,
} from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { EvalQueryController } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/query_pb";
import { EvalStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceReference,
  RenameInput,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceAuditSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import { ArtifactNotFoundError } from "../../archive/content-store.js";
import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import { MAX_ZIP_SIZE } from "../../archive/limits.js";
import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { runGuardedWrite } from "../../pipeline/guarded-write.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  CONVERGED_KEY,
  EXISTING_PUSHED_RESOURCE_KEY,
  PUSHED_RESOURCE_KEY,
  newCheckAndStoreArtifactStep,
  newClaimPushedNameStep,
  newFindExistingBySlugStep,
  newGateAndHashArchiveStep,
  newGenerateIdIfNeededStep,
  newGuardPushVisibilityStep,
  newPushAuthorizationTuplesStep,
  newResolveConvergenceStep,
  newStorePushedStep,
} from "../../pipeline/steps/archive-push.js";
import {
  newCleanupGrantsStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import { setAuditFieldsForUpdate } from "../../pipeline/steps/defaults.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY, newLoadTargetStep } from "../../pipeline/steps/load-target.js";
import { newReleaseNamesStep, releaseNameOnFailure } from "../../pipeline/steps/names.js";
import { readOrgListPage } from "../../pipeline/steps/org-list-page.js";
import { renameResource, storeRenameRows } from "../../pipeline/steps/rename.js";
import {
  ARTIFACT_BYTES_KEY,
  newResolveArtifactSourceStep,
} from "../../pipeline/steps/resolve-artifact-source.js";
import { newValidateVisibilityUpdateStep } from "../../pipeline/steps/validate-visibility.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newDeleteVersionArchivesStep } from "../../pipeline/steps/version-archive.js";
import {
  LIST_VERSIONS_RESPONSE_KEY,
  newLoadAndMapVersionsStep,
  newLoadByReferenceWithVersionStep,
  newResolveBySlugForVersionsStep,
  versionHistoryTarget,
} from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { ArchiveStaging, DownloadCapability, StagedUpload } from "../skill/transfer/staging.js";
import { EVAL_NOUN, EVAL_TRANSFER_LANE_NOT_CONFIGURED } from "./constants.js";
import { evalListIndex } from "./list-index.js";
import {
  evalPushBinding,
  newArchiveCurrentEvalStep,
  newBuildInitialEvalStep,
  newPopulateEvalFieldsStep,
  newReadEvalFolderStep,
  writeTargetsOf,
} from "./push.js";
import { evalVersionBinding } from "./versions.js";

export interface EvalControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composed list read scope — list narrows through it; undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
  /** The eval archives (`evals/<digest>.zip`), on the blob driver every archive kind shares. */
  readonly artifactStorage: ContentAddressedArchiveStore;
  /** The one staging port every archive kind uploads and downloads through; absent, the lane answers FailedPrecondition. */
  readonly staging?: ArchiveStaging;
}

/** Registers both eval services on the router (routes stage). */
export function registerEvalServices(router: ConnectRouter, deps: EvalControllerDeps): void {
  router.service(EvalCommandController, {
    push: (req, ctx) => push(deps, req, ctx),
    createArtifactUploadUrl: (req, ctx) => createArtifactUploadUrl(deps, req, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    rename: (input, ctx) => rename(deps, input, ctx),
    delete: (id, ctx) => deleteEval(deps, id, ctx),
  });
  router.service(EvalQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    listVersions: (req, ctx) => listVersions(deps, req, ctx),
    download: (ref, ctx) => download(deps, ref, ctx),
    getDownloadUrl: (ref, ctx) => getDownloadUrl(deps, ref, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

// ─── push ────────────────────────────────────────────────────────────────

type PushDesc = typeof PushEvalRequestSchema;

/**
 * Push — the plan chain, then the install chain unless the plan found the
 * stored eval already this push (push.ts holds the shape). Authorization
 * is the chain's own (AuthorizeEvalWrite), before the upload is consumed.
 */
async function push(deps: EvalControllerDeps, req: PushEvalRequest, ctx: HandlerContext): Promise<Eval> {
  // A retried attempt keeps the artifact bytes the first one consumed: an
  // upload reference is single-use (ResolveArtifactSource).
  let previous: RequestContext<PushDesc> | undefined;
  return runGuardedWrite(async () => {
    const reqCtx = new RequestContext(PushEvalRequestSchema, req, callerIdentityOf(ctx), kindOf(ctx));
    const consumed = previous?.get(ARTIFACT_BYTES_KEY);
    if (consumed !== undefined) {
      reqCtx.set(ARTIFACT_BYTES_KEY, consumed);
    }
    previous = reqCtx;
    await newPipeline<PushDesc>("eval-push-plan", deps.logger)
      .addStep(newAuthorizeStep(EvalCommandController.method.push, deps.authorizer))
      .addStep(newValidateProtoStep())
      .addStep(newBuildInitialEvalStep<PushDesc>((input) => input))
      .addStep(newFindExistingBySlugStep(deps.store, evalPushBinding))
      .addStep(newAuthorizeResolvedTargetStep<PushDesc>(deps.authorizer, writeTargetsOf, "AuthorizeEvalWrite"))
      .addStep(
        newResolveArtifactSourceStep<PushDesc>(deps.staging, {
          source: (input) => ({ artifact: input.artifact, artifactUploadRef: input.artifactUploadRef }),
          laneNotConfigured: EVAL_TRANSFER_LANE_NOT_CONFIGURED,
        }),
      )
      .addStep(newGateAndHashArchiveStep<PushDesc>(EVAL_NOUN))
      .addStep(newReadEvalFolderStep())
      .addStep(newGenerateIdIfNeededStep<PushDesc>())
      .addStep(newGuardPushVisibilityStep(deps.store, evalPushBinding, "GuardEvalVisibility"))
      .addStep(newResolveConvergenceStep(evalPushBinding))
      .build()
      .execute(reqCtx);

    if (reqCtx.get(CONVERGED_KEY) === true) {
      return reqCtx.get(EXISTING_PUSHED_RESOURCE_KEY) as Eval;
    }

    await newPipeline<PushDesc>("eval-push-install", deps.logger)
      .addStep(newCheckAndStoreArtifactStep<PushDesc>(deps.artifactStorage))
      .addStep(newPopulateEvalFieldsStep())
      .addStep(newClaimPushedNameStep(deps.store, evalPushBinding))
      .addStep(newStorePushedStep(deps.store, evalPushBinding, "StoreEval"))
      .addStep(newArchiveCurrentEvalStep(deps.store, deps.logger))
      .addStep(
        newPushAuthorizationTuplesStep<typeof EvalSchema, PushDesc>(
          deps.authorizationLifecycle,
          deps.logger,
          "EvalPushAuthorizationTuples",
        ),
      )
      .build()
      .execute(reqCtx)
      .catch(releaseNameOnFailure(deps.store, deps.logger, reqCtx));
    return reqCtx.get(PUSHED_RESOURCE_KEY) as Eval;
  });
}

// ─── createArtifactUploadUrl ─────────────────────────────────────────────

type MintDesc = typeof EvalCommandController.method.createArtifactUploadUrl.input;

/**
 * Mints a short-lived, single-use upload URL through the shared staging
 * port, after asking exactly what the push naming the same slug will ask;
 * an over-limit declaration is refused with the limit before any bytes
 * move.
 */
async function createArtifactUploadUrl(
  deps: EvalControllerDeps,
  req: CreateEvalArtifactUploadUrlRequest,
  ctx: HandlerContext,
): Promise<EvalArtifactUploadUrl> {
  const staging = deps.staging;
  if (staging === undefined) {
    throw failedPreconditionError(EVAL_TRANSFER_LANE_NOT_CONFIGURED);
  }
  const reqCtx = new RequestContext(
    EvalCommandController.method.createArtifactUploadUrl.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<MintDesc>("eval-create-artifact-upload-url", deps.logger)
    .addStep(newAuthorizeStep(EvalCommandController.method.createArtifactUploadUrl, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newBuildInitialEvalStep<MintDesc>((input) => input))
    .addStep(newFindExistingBySlugStep<typeof EvalSchema, MintDesc>(deps.store, evalPushBinding))
    .addStep(newAuthorizeResolvedTargetStep<MintDesc>(deps.authorizer, writeTargetsOf, "AuthorizeEvalWrite"))
    .build()
    .execute(reqCtx);

  if (req.sizeBytes > BigInt(MAX_ZIP_SIZE)) {
    throw invalidArgumentError(
      `eval archive size ${req.sizeBytes} bytes exceeds the ${MAX_ZIP_SIZE}-byte (100MB) archive limit`,
    );
  }
  let minted: StagedUpload;
  try {
    minted = await staging.mint(Number(req.sizeBytes));
  } catch (error) {
    throw internalError(error, "failed to mint upload reference");
  }
  return create(EvalArtifactUploadUrlSchema, {
    url: minted.url,
    artifactUploadRef: minted.ref,
    ttlSeconds: Math.trunc(minted.ttlMs / 1000),
  });
}

// ─── updateVisibility ────────────────────────────────────────────────────

const UPDATE_VISIBILITY_EVAL_KEY = "updateVisibilityEval";
type UpdateVisibilityDesc = typeof EvalCommandController.method.updateVisibility.input;

/** A targeted metadata update on the eval. Load runs before level validation so NOT_FOUND wins. */
async function updateVisibility(
  deps: EvalControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<Eval> {
  const reqCtx = new RequestContext(
    EvalCommandController.method.updateVisibility.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>("eval-update-visibility", deps.logger)
    .addStep(newAuthorizeStep(EvalCommandController.method.updateVisibility, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadEvalByIdStep(deps.store))
    .addStep(newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_EVAL_KEY))
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newSetEvalVisibilityStep())
    .addStep(newPersistEvalVisibilityStep(deps.store))
    .addStep(newUpdateVisibilityTuplesStep(deps.authorizationLifecycle, UPDATE_VISIBILITY_EVAL_KEY))
    .build()
    .execute(reqCtx);
  return reqCtx.get(UPDATE_VISIBILITY_EVAL_KEY) as Eval;
}

/** Loads the eval by resource_id; a missing one answers NotFound, a store fault Internal. */
function newLoadEvalByIdStep(store: Store): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadEvalForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      let evalResource: Eval;
      try {
        evalResource = await store.getResource(ctx.apiResourceKind, ctx.input.resourceId, EvalSchema);
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(EVAL_NOUN, ctx.input.resourceId);
        }
        throw internalError(error, "failed to load eval");
      }
      ctx.set(UPDATE_VISIBILITY_EVAL_KEY, evalResource);
    },
  };
}

/** Sets metadata.visibility and stamps the StatusAudit slot. */
function newSetEvalVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetEvalVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const evalResource = ctx.get(UPDATE_VISIBILITY_EVAL_KEY) as Eval;
      if (evalResource.metadata !== undefined) {
        evalResource.metadata.visibility = ctx.input.visibility;
      }
      setAuditFieldsForUpdate(EvalSchema, evalResource, "status_audit", ctx.callerIdentity);
    },
  };
}

/**
 * The visibility and status audit the chain set on the loaded eval,
 * applied to the live row inside the store's atomic write, so a push that
 * landed since the load stays.
 */
function newPersistEvalVisibilityStep(store: Store): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistEvalForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const evalResource = ctx.get(UPDATE_VISIBILITY_EVAL_KEY) as Eval;
      const id = evalResource.metadata?.id ?? "";
      let written: Eval;
      try {
        written = await store.updateResource(ctx.apiResourceKind, id, EvalSchema, (row) => {
          if (row.metadata !== undefined) {
            row.metadata.visibility = evalResource.metadata?.visibility ?? row.metadata.visibility;
          }
          const audit = ((row.status ??= create(EvalStatusSchema)).audit ??= create(ApiResourceAuditSchema));
          audit.statusAudit = evalResource.status?.audit?.statusAudit;
        });
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(EVAL_NOUN, id);
        }
        throw internalError(error, "failed to save eval");
      }
      ctx.set(UPDATE_VISIBILITY_EVAL_KEY, written);
    },
  };
}

// ─── rename ──────────────────────────────────────────────────────────────

/**
 * Rename — the only writer of an eval's slug (pipeline/steps/rename.ts):
 * the name moves, then the live row's slug; the old slug keeps leading to
 * it for reading for 30 days, and a push naming it is refused.
 */
async function rename(deps: EvalControllerDeps, input: RenameInput, ctx: HandlerContext): Promise<Eval> {
  return renameResource(
    {
      method: EvalCommandController.method.rename,
      names: deps.store,
      rows: storeRenameRows(deps.store, ApiResourceKind.eval, EvalSchema),
      authorizer: deps.authorizer,
      logger: deps.logger,
    },
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
}

// ─── delete ──────────────────────────────────────────────────────────────

type DeleteDesc = typeof EvalCommandController.method.delete.input;

/**
 * Delete — removes the eval, its version history, its names and its
 * grants. Nothing references an eval yet, so nothing refuses it. Returns
 * the deleted eval.
 */
async function deleteEval(deps: EvalControllerDeps, id: EvalId, ctx: HandlerContext): Promise<Eval> {
  const reqCtx = new RequestContext(
    EvalCommandController.method.delete.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<DeleteDesc>("eval-delete", deps.logger)
    .addStep(newAuthorizeStep(EvalCommandController.method.delete, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, EvalSchema))
    .addStep(
      newDeleteVersionArchivesStep(deps.store, deps.logger, {
        stepName: "DeleteEvalArchives",
        noun: EVAL_NOUN,
      }),
    )
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.eval))
    .addStep(newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx);
  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(new Error("deleted eval not found in context"), "deleted eval not found in context");
  }
  return deleted as Eval;
}

// ─── queries ─────────────────────────────────────────────────────────────

async function get(deps: EvalControllerDeps, id: EvalId, ctx: HandlerContext): Promise<Eval> {
  const reqCtx = new RequestContext(EvalQueryController.method.get.input, id, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof EvalQueryController.method.get.input>("eval-get", deps.logger)
    .addStep(newAuthorizeStep(EvalQueryController.method.get, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, EvalSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Eval;
}

type ReferenceDesc = typeof EvalQueryController.method.getByReference.input;

/**
 * The eval a reference names, at its version, once the caller may view
 * it: slug and organization with the version ladder, then can_view on the
 * RESOLVED eval exactly as `get` asks it by id. getByReference and both
 * downloads run it, so a download is never laxer than a read.
 */
async function loadViewableAtVersion(
  deps: EvalControllerDeps,
  method: (typeof EvalQueryController.method)["getByReference" | "download" | "getDownloadUrl"],
  pipelineName: string,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Eval> {
  const reqCtx = new RequestContext(method.input, ref, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<ReferenceDesc>(pipelineName, deps.logger)
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceWithVersionStep(deps.store, evalVersionBinding, "LoadEvalByReference"))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(EvalQueryController.method.get),
        "AuthorizeResolvedEval",
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Eval;
}

async function getByReference(deps: EvalControllerDeps, ref: ApiResourceReference, ctx: HandlerContext): Promise<Eval> {
  return loadViewableAtVersion(deps, EvalQueryController.method.getByReference, "eval-get-by-reference", ref, ctx);
}

/**
 * Download — one version's archive bytes over gRPC (≤10MB messages; larger
 * archives ride getDownloadUrl), after can_view on the eval.
 */
async function download(deps: EvalControllerDeps, ref: ApiResourceReference, ctx: HandlerContext): Promise<EvalArchive> {
  const version = await loadViewableAtVersion(deps, EvalQueryController.method.download, "eval-download", ref, ctx);
  const digest = digestOf(version);
  let artifact: Uint8Array;
  try {
    artifact = await deps.artifactStorage.get(deps.artifactStorage.getStorageKey(digest));
  } catch (error) {
    throw archiveReadError(error, digest, "failed to load eval archive");
  }
  return create(EvalArchiveSchema, { artifact, digest });
}

/**
 * GetDownloadUrl — the transfer-lane twin of Download: after can_view on
 * the eval, stats (never loads) the version's archive, then asks the
 * shared staging port for its URL. ttl_seconds is the floor of the URL's
 * validity, as on the skill lane.
 */
async function getDownloadUrl(
  deps: EvalControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<EvalArchiveDownloadUrl> {
  const staging = deps.staging;
  if (staging === undefined) {
    throw failedPreconditionError(EVAL_TRANSFER_LANE_NOT_CONFIGURED);
  }
  const version = await loadViewableAtVersion(
    deps,
    EvalQueryController.method.getDownloadUrl,
    "eval-get-download-url",
    ref,
    ctx,
  );
  const digest = digestOf(version);
  const storageKey = deps.artifactStorage.getStorageKey(digest);
  let size: number;
  try {
    size = await deps.artifactStorage.size(storageKey);
  } catch (error) {
    throw archiveReadError(error, digest, "failed to stat eval archive");
  }
  let capability: DownloadCapability;
  try {
    capability = await staging.downloadUrl(storageKey);
  } catch (error) {
    throw internalError(error, "failed to mint eval archive download URL");
  }
  return create(EvalArchiveDownloadUrlSchema, {
    url: capability.url,
    ttlSeconds: Math.trunc(capability.ttlMs / 1000),
    sizeBytes: BigInt(size),
    digest,
  });
}

/** The digest of the version a reference resolved to; a version without one is a stored row gone wrong. */
function digestOf(version: Eval): string {
  const digest = version.status?.digest ?? "";
  if (digest === "") {
    throw internalError(new Error("resolved eval version has no digest"), "failed to load eval archive");
  }
  return digest;
}

/** A missing archive is NotFound naming the version; any other failure is an infrastructure fault. */
function archiveReadError(error: unknown, digest: string, message: string): Error {
  if (error instanceof ArtifactNotFoundError) {
    return notFoundError("eval archive", digest);
  }
  return internalError(error, message);
}

type ListVersionsDesc = typeof EvalQueryController.method.listVersions.input;

/** ListVersions — resolve by slug, authorize the resolved eval, map audit records, paginate. */
async function listVersions(
  deps: EvalControllerDeps,
  req: ListEvalVersionsInput,
  ctx: HandlerContext,
): Promise<ListEvalVersionsResponse> {
  const reqCtx = new RequestContext(
    EvalQueryController.method.listVersions.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ListVersionsDesc>("eval-list-versions", deps.logger)
    .addStep(newAuthorizeStep(EvalQueryController.method.listVersions, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newResolveBySlugForVersionsStep(deps.store, evalVersionBinding, "ResolveEvalBySlug"))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        versionHistoryTarget(ApiResourceKind.eval, "unauthorized to view eval version history"),
        "AuthorizeResolvedEval",
      ),
    )
    .addStep(newLoadAndMapVersionsStep(deps.store, evalVersionBinding, "LoadAndMapVersions"))
    .build()
    .execute(reqCtx);
  return reqCtx.get(LIST_VERSIONS_RESPONSE_KEY) as ListEvalVersionsResponse;
}

const EVAL_LIST_KEY = "evalList";

/**
 * List — one page of an organization's evals, newest first, through the
 * eval list index; the read scope keeps the evals the caller could get by
 * id, as every organization list does.
 */
async function list(deps: EvalControllerDeps, req: ListEvalsRequest, ctx: HandlerContext): Promise<EvalList> {
  const reqCtx = new RequestContext(EvalQueryController.method.list.input, req, callerIdentityOf(ctx), kindOf(ctx));
  await newPipeline<typeof EvalQueryController.method.list.input>("eval-list", deps.logger)
    .addStep(newAuthorizeStep(EvalQueryController.method.list, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep({
      name: "ListByOrg",
      async execute(step): Promise<void> {
        const page = await readOrgListPage({
          store: deps.store,
          logger: deps.logger,
          listReadScope: deps.listReadScope,
          caller: step.callerIdentity,
          kind: ApiResourceKind.eval,
          schema: EvalSchema,
          declaration: evalListIndex,
          request: step.input,
        });
        step.set(EVAL_LIST_KEY, create(EvalListSchema, { entries: page.entries, nextPageToken: page.nextPageToken }));
      },
    })
    .build()
    .execute(reqCtx);
  return reqCtx.get(EVAL_LIST_KEY) as EvalList;
}
