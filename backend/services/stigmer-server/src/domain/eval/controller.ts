/**
 * Eval controller — the Eval kind's command and query sides. An eval is
 * an evals/ folder pushed whole: `push` reads it and stores the eval with
 * its cases in its status (push.ts holds the steps); `getByReference` and
 * `listVersions` are the shared content-addressed version steps bound to
 * the eval's digest and tag (versions.ts); `download` and `getDownloadUrl`
 * hand back one version's archive to whoever may view the eval;
 * `updateVisibility`, `rename` and `delete` are the shared shapes.
 * `buildCaseFromRun` answers a run's turn as a case archive and
 * `addCaseFromRun` adds that case to an eval as a new version, both over
 * the one builder (case-from-run.ts), after can_view on the run; the add
 * then runs the push's own chain, so it asks what a push asks.
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
import { Code, ConnectError } from "@connectrpc/connect";
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
  AddEvalCaseFromRunRequest,
  BuildEvalCaseFromRunRequest,
  CreateEvalArtifactUploadUrlRequest,
  EvalArchive,
  EvalCaseArchive,
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
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type {
  ApiResourceReference,
  RenameInput,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceAuditSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { CallerIdentity } from "../../extensions/identity.js";

import { ArtifactNotFoundError } from "../../archive/content-store.js";
import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import { MAX_ZIP_SIZE } from "../../archive/limits.js";
import { openArchiveFiles } from "../../archive/open-files.js";
import { writeArchive } from "../../archive/write.js";
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
import { runGuardedWrite, writeConflictError } from "../../pipeline/guarded-write.js";
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
  newRefuseRenamedSlugStep,
  newResolveConvergenceStep,
  newStorePushedStep,
} from "../../pipeline/steps/archive-push.js";
import {
  newCleanupGrantsStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { authorizeResolvedResource, newAuthorizeStep } from "../../pipeline/steps/authorize.js";
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
import type { OrganizationAdmission } from "../../pipeline/steps/refuse-bound-elsewhere.js";
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
  loadByReferenceWithVersion,
  newLoadAndMapVersionsStep,
  newLoadByReferenceWithVersionStep,
  newResolveBySlugForVersionsStep,
  versionHistoryTarget,
} from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { ArchiveStaging, DownloadCapability, StagedUpload } from "../skill/transfer/staging.js";
import { buildCaseFromRun, caseArchiveOf, RESERVED_CASE_NAMES } from "./case-from-run.js";
import {
  EVAL_CASE_OTHER_ORGANIZATION,
  EVAL_CASE_RUN_DENIED,
  EVAL_NOUN,
  EVAL_PUSH_DENIED,
  EVAL_TRANSFER_LANE_NOT_CONFIGURED,
  evalCaseExistsMessage,
  evalCaseReservedNameMessage,
  evalCaseRunNotEndedMessage,
  evalCaseVersionMessage,
} from "./constants.js";
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
  /** The composed credential binding: a rename refuses a credential that does not reach the eval's organization. */
  readonly credentialBinding: OrganizationAdmission;
}

/** Registers both eval services on the router (routes stage). */
export function registerEvalServices(router: ConnectRouter, deps: EvalControllerDeps): void {
  router.service(EvalCommandController, {
    push: (req, ctx) => push(deps, req, ctx),
    addCaseFromRun: (req, ctx) => addCaseFromRun(deps, req, ctx),
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
    buildCaseFromRun: (req, ctx) => buildCaseFromRunHandler(deps, req, ctx),
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
    return runPushChains(deps, reqCtx, undefined);
  });
}

/** The eval version an in-process push built its archive from. */
interface BuiltOnVersion {
  readonly id: string;
  readonly digest: string;
}

/**
 * One push attempt: the plan chain, then the install chain unless the plan
 * found the stored eval already this push. `builtOn` holds an in-process
 * push (addCaseFromRun) to the version its archive was built from: the
 * eval must still be that one at that version, else the attempt loses as
 * a lost swap does and its caller builds again on the new head.
 */
async function runPushChains(
  deps: EvalControllerDeps,
  reqCtx: RequestContext<PushDesc>,
  builtOn: BuiltOnVersion | undefined,
): Promise<Eval> {
  await newPipeline<PushDesc>("eval-push-plan", deps.logger)
    .addStep(newAuthorizeStep(EvalCommandController.method.push, deps.authorizer))
    .addStep(newValidateProtoStep())
    .addStep(newBuildInitialEvalStep<PushDesc>((input) => input))
    .addStep(newFindExistingBySlugStep(deps.store, evalPushBinding))
    .addStep(newAuthorizeResolvedTargetStep<PushDesc>(deps.authorizer, writeTargetsOf, "AuthorizeEvalWrite"))
    .addStep(newRefuseRenamedSlugStep())
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

  if (builtOn !== undefined) {
    holdToVersion(reqCtx, builtOn);
  }
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
}

/**
 * The stored eval the plan found must be the one the archive was built
 * from, at that version: gone, or another under its slug, is NotFound; a
 * version pushed meanwhile is a write conflict, retried on the new head.
 */
function holdToVersion(reqCtx: RequestContext<PushDesc>, builtOn: BuiltOnVersion): void {
  const existing = reqCtx.get(EXISTING_PUSHED_RESOURCE_KEY) as Eval | undefined;
  if (existing?.metadata?.id !== builtOn.id) {
    throw notFoundError("eval", builtOn.id);
  }
  if ((existing.status?.digest ?? "") !== builtOn.digest) {
    throw writeConflictError(ApiResourceKind.eval, reqCtx.input.org, reqCtx.input.slug);
  }
}

// ─── a case from a run ───────────────────────────────────────────────────

/** The phases a run has ended in: its events are the whole turn. */
const ENDED_RUN_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

/**
 * BuildCaseFromRun — the run's turn as a case archive (case-from-run.ts),
 * after can_view on the run, the permission its events and scores are read
 * under; refused while the run has not ended, and past what one answer
 * carries.
 */
async function buildCaseFromRunHandler(
  deps: EvalControllerDeps,
  req: BuildEvalCaseFromRunRequest,
  ctx: HandlerContext,
): Promise<EvalCaseArchive> {
  const caller = await validatedCaller(deps, EvalQueryController.method.buildCaseFromRun, req, ctx);
  refuseReservedName(req.caseName);
  const run = await viewableEndedRun(deps, caller, req.runId);
  return caseArchiveOf(await buildCaseFromRun(deps.store, deps.logger, { run, caseName: req.caseName, skill: req.skill, callerId: caller.identityId }));
}

/**
 * AddCaseFromRun — the run's turn built as a case, added to an eval of the
 * run's organization as a new version: the eval's current files and the
 * case, through the push's own chain (its can_edit question, its version
 * archive, its tag). The current version is read and the archive built in
 * each attempt, and the push held to that version, so a push landing
 * meanwhile makes the attempt run again on it rather than be overwritten.
 */
async function addCaseFromRun(deps: EvalControllerDeps, req: AddEvalCaseFromRunRequest, ctx: HandlerContext): Promise<Eval> {
  const caller = await validatedCaller(deps, EvalCommandController.method.addCaseFromRun, req, ctx);
  refuseReservedName(req.caseName);
  const run = await viewableEndedRun(deps, caller, req.runId);
  const runOrg = run.metadata?.org ?? "";
  // The request's rules require the reference; an organization it names must be the run's.
  const ref = req.eval ?? create(ApiResourceReferenceSchema);
  if (ref.org !== "" && ref.org !== runOrg) {
    throw failedPreconditionError(EVAL_CASE_OTHER_ORGANIZATION);
  }
  const target = await evalOfOrganization(deps, caller, ref, runOrg);
  const built = await buildCaseFromRun(deps.store, deps.logger, { run, caseName: req.caseName, skill: req.skill, callerId: caller.identityId });
  return runGuardedWrite(async () => {
    const head = await evalOrNotFound(deps, target.metadata?.id ?? "");
    // The push's own question, asked before a byte of the eval is read: a
    // caller who may not edit it learns nothing of what it holds.
    await authorizeResolvedResource(
      deps.authorizer,
      caller,
      { permission: IamPermission.can_edit, resourceKind: ApiResourceKind.eval, resourceId: head.metadata?.id ?? "" },
      EVAL_PUSH_DENIED,
    );
    const digest = head.status?.digest ?? "";
    const slug = head.metadata?.slug ?? "";
    let bytes: Uint8Array;
    try {
      bytes = await deps.artifactStorage.get(deps.artifactStorage.getStorageKey(digest));
    } catch (error) {
      throw archiveReadError(error, digest, "failed to load eval archive");
    }
    const { files } = openArchiveFiles(bytes, EVAL_NOUN);
    const prefix = `${built.caseName}/`;
    if (files.entries.some((entry) => entry.path === built.caseName || entry.path.startsWith(prefix))) {
      throw new ConnectError(evalCaseExistsMessage(built.caseName, slug), Code.AlreadyExists);
    }
    const artifact = writeArchive([...files.entries.map((entry) => ({ path: entry.path, bytes: files.read(entry.path) })), ...built.files]);
    const pushReq = create(PushEvalRequestSchema, {
      org: head.metadata?.org ?? "",
      slug,
      artifact,
      message: req.message !== "" ? req.message : evalCaseVersionMessage(built.caseName, req.runId),
      tag: req.tag,
    });
    return runPushChains(deps, new RequestContext(PushEvalRequestSchema, pushReq, caller, kindOf(ctx)), {
      id: head.metadata?.id ?? "",
      digest,
    });
  });
}

/** The request through its method's Authorize step and its proto rules; the caller it was made as. */
async function validatedCaller(
  deps: EvalControllerDeps,
  method: typeof EvalQueryController.method.buildCaseFromRun | typeof EvalCommandController.method.addCaseFromRun,
  req: BuildEvalCaseFromRunRequest | AddEvalCaseFromRunRequest,
  ctx: HandlerContext,
): Promise<CallerIdentity> {
  const caller = callerIdentityOf(ctx);
  const reqCtx = new RequestContext(method.input, req, caller, kindOf(ctx));
  await newPipeline(`eval-${method.localName}`, deps.logger)
    .addStep(newAuthorizeStep(method, deps.authorizer))
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);
  return caller;
}

/** A case name a suite's root keeps for itself (its mocks, its run output) is refused. */
function refuseReservedName(caseName: string): void {
  if (RESERVED_CASE_NAMES.has(caseName)) {
    throw invalidArgumentError(evalCaseReservedNameMessage(caseName));
  }
}

/** The run, once the caller may view it and it has ended. */
async function viewableEndedRun(deps: EvalControllerDeps, caller: CallerIdentity, runId: string): Promise<Run> {
  await authorizeResolvedResource(
    deps.authorizer,
    caller,
    { permission: IamPermission.can_view, resourceKind: ApiResourceKind.run, resourceId: runId },
    EVAL_CASE_RUN_DENIED,
  );
  let run: Run;
  try {
    run = await deps.store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("run", runId);
    }
    throw internalError(error, "failed to load run");
  }
  if (!ENDED_RUN_PHASES.has(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
    throw failedPreconditionError(evalCaseRunNotEndedMessage(runId));
  }
  return run;
}

/**
 * The eval the reference names in the run's organization: by slug there,
 * or by id when it is one of that organization's. An eval of another
 * organization named by id reads as one that is not there. One that is not
 * there is refused as a push naming it would be: a caller who may not
 * create evals in the organization hears the push's refusal, whether the
 * eval exists or not; only one who may create them hears it is not there,
 * which their push would show them by creating it.
 */
async function evalOfOrganization(
  deps: EvalControllerDeps,
  caller: CallerIdentity,
  ref: ApiResourceReference,
  org: string,
): Promise<Eval> {
  const name = ref.slug !== "" ? ref.slug : ref.id;
  try {
    // The ladder's read by id holds the eval to the organization given.
    return await loadByReferenceWithVersion(deps.store, evalVersionBinding, { ...ref, org, version: "" });
  } catch (error) {
    if (!(error instanceof ConnectError && error.code === Code.NotFound)) {
      throw error;
    }
  }
  await authorizeResolvedResource(
    deps.authorizer,
    caller,
    { permission: IamPermission.can_create_eval, resourceKind: ApiResourceKind.organization, resourceId: org },
    EVAL_PUSH_DENIED,
  );
  throw notFoundError("eval", name);
}

/** The eval's current row by id; NotFound once it is gone. */
async function evalOrNotFound(deps: EvalControllerDeps, id: string): Promise<Eval> {
  try {
    return await deps.store.getResource(ApiResourceKind.eval, id, EvalSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("eval", id);
    }
    throw internalError(error, "failed to load eval");
  }
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
    .addStep(newRefuseRenamedSlugStep())
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
      credentialBinding: deps.credentialBinding,
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
  // LoadExistingForDelete stashed the row the chain deleted.
  return reqCtx.get(EXISTING_RESOURCE_KEY) as Eval;
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

/**
 * The digest of the version a reference resolved to. Every stored version
 * has one; one without would name no archive, and its read answers
 * NotFound as a missing archive does.
 */
function digestOf(version: Eval): string {
  return version.status?.digest ?? "";
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
