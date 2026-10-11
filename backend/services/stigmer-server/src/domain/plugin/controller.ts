/**
 * Plugin controller — the Plugin kind's command and query sides. A plugin
 * is one thing: `push` reads an Agent Plugins archive and stores the
 * plugin with what it holds in its status, and creates nothing else
 * (push.ts holds the steps); `delete` is refused while an agent lists it;
 * `updateVisibility` moves the plugin alone; `listTools` lists one of its
 * servers' tools now, through a runner (list-tools.ts);
 * `getByReference` and `listVersions` are the shared content-addressed
 * version steps bound to the plugin's digest and manifest version;
 * `getArtifact` and `getArtifactDownloadUrl` hand the runner the archive a
 * plugin was installed from, so it can mount a plugin a turn lists (the
 * skill controller's pair, over the plugin store).
 *
 * Wiring mirrors the skill controller's: the store and the archive store
 * are required; the transfer lane is an OPTIONAL modelled state (absent,
 * createArtifactUploadUrl answers FailedPrecondition and push accepts
 * inline bytes only).
 *
 * Proven by __tests__/plugin.test.ts (composed-server round-trips),
 * __tests__/store-faults.test.ts and plugin.conformance.test.ts
 * (CONFORMANCE_TARGET=local, local-postgres).
 */
import { posix } from "node:path";

import { create, fromBinary } from "@bufbuild/protobuf";
import type { OutboundFetch } from "@stigmer/outbound/egress";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import {
  GetArtifactResponseSchema,
  PluginArtifactDownloadUrlSchema,
  PluginArtifactUploadUrlSchema,
  PushPluginRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type {
  CreatePluginArtifactUploadUrlRequest,
  GetArtifactRequest,
  GetArtifactResponse,
  ListPluginToolsInput,
  ListPluginToolsOutput,
  ListPluginVersionsInput,
  ListPluginVersionsResponse,
  PluginArtifactDownloadUrl,
  PluginArtifactUploadUrl,
  PluginId,
  PushPluginRequest,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { ArtifactNotFoundError } from "../../archive/content-store.js";
import type { ContentAddressedArchiveStore } from "../../archive/content-store.js";
import { MAX_ZIP_SIZE } from "../../archive/limits.js";
import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import {
  newCleanupIamPoliciesStep,
  newRecordVisibilityBeforeUpdateStep,
  newUpdateVisibilityTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
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
import { collectSpecReferences } from "../../pipeline/steps/references.js";
import { newResolveArtifactSourceStep } from "../../pipeline/steps/resolve-artifact-source.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import {
  newRefuseChildOrgsVisibilityInChildUpdateStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import { newDeleteVersionArchivesStep } from "../../pipeline/steps/version-archive.js";
import {
  LIST_VERSIONS_RESPONSE_KEY,
  newLoadAndMapVersionsStep,
  newLoadByReferenceWithVersionStep,
  newResolveBySlugForVersionsStep,
  versionHistoryTarget,
} from "../../pipeline/steps/version-history.js";
import {
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../../pipeline/steps/authorize-resolved-target.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type {
  ArchiveStaging,
  DownloadCapability,
  StagedUpload,
} from "../skill/transfer/staging.js";
import {
  PLUGIN_ARTIFACT_KEY_PREFIX,
  TRANSFER_LANE_NOT_CONFIGURED,
} from "./constants.js";
import { listTools } from "./list-tools.js";
import type { PluginToolsDeps } from "./list-tools.js";
import {
  PLUGIN_CONVERGED_KEY,
  PLUGIN_KEY,
  EXISTING_PLUGIN_KEY,
  newArchiveCurrentPluginStep,
  newBuildInitialPluginStep,
  newCheckAndStoreArtifactStep,
  newFindExistingPluginBySlugStep,
  newGateAndHashArchiveStep,
  newGeneratePluginIdIfNeededStep,
  newGuardPluginVisibilityStep,
  newIndexPluginSearchStep,
  newPlanPluginStatusStep,
  newPluginPushAuthorizationTuplesStep,
  newPopulatePluginFieldsStep,
  newProbeServerSignInsStep,
  newReadPluginPackageStep,
  newResolveConvergenceStep,
  newStorePluginStep,
} from "./push.js";
import { pluginVersionBinding } from "./versions.js";
import { pluginSearchExtractor } from "./search-extractor.js";
import {
  newCascadeDeletePluginEvalsStep,
  newSweepPluginEvalsAfterDeleteStep,
} from "../plugin-eval/cascade.js";
import type { PluginEvalCascadeDeps } from "../plugin-eval/cascade.js";

export interface PluginControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly artifactStorage: ContentAddressedArchiveStore;
  /** The one fetch install's sign-in probe dials a plugin's server addresses with, under the edition's egress policy. */
  readonly outboundFetch: OutboundFetch;
  /** The skill lane's staging port (one upload surface for every archive); absent, the lane answers FailedPrecondition. */
  readonly staging?: ArchiveStaging;
  /** The tools listing's lane: a runner reaches the server as the caller. */
  readonly tools: PluginToolsDeps;
  /** The plugin's evals, removed by its delete (domain/plugin-eval/cascade.ts); absent, the delete removes none. */
  readonly pluginEvals?: PluginEvalCascadeDeps;
}

/** Registers both plugin services on the router (routes stage). */
export function registerPluginServices(
  router: ConnectRouter,
  deps: PluginControllerDeps,
): void {
  router.service(PluginCommandController, {
    push: (req, ctx) => push(deps, req, ctx),
    createArtifactUploadUrl: (req, ctx) =>
      createArtifactUploadUrl(deps, req, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    delete: (id, ctx) => deletePlugin(deps, id, ctx),
    listTools: (input: ListPluginToolsInput, ctx): Promise<ListPluginToolsOutput> =>
      listTools(deps.tools, input, callerIdentityOf(ctx)),
  });
  router.service(PluginQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    listVersions: (req, ctx) => listVersions(deps, req, ctx),
    getArtifact: (req, ctx) => getArtifact(deps, req, ctx),
    getArtifactDownloadUrl: (req, ctx) =>
      getArtifactDownloadUrl(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

// ─── push ────────────────────────────────────────────────────────────────

/**
 * Push — the plan chain, then the install chain unless the plan found the
 * stored plugin already converged (push.ts holds the shape). Returns the
 * head from context: the pipeline's message type is the request.
 */
async function push(
  deps: PluginControllerDeps,
  req: PushPluginRequest,
  ctx: HandlerContext,
): Promise<Plugin> {
  const reqCtx = new RequestContext(
    PushPluginRequestSchema,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PushPluginRequestSchema>(
    "plugin-push-plan",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(PluginCommandController.method.push, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(
      newResolveArtifactSourceStep<typeof PushPluginRequestSchema>(
        deps.staging,
        {
          source: (input) => ({
            artifact: input.artifact,
            artifactUploadRef: input.artifactUploadRef,
          }),
          laneNotConfigured: TRANSFER_LANE_NOT_CONFIGURED,
        },
      ),
    )
    .addStep(newGateAndHashArchiveStep())
    .addStep(newReadPluginPackageStep())
    .addStep(newBuildInitialPluginStep())
    .addStep(newFindExistingPluginBySlugStep(deps.store))
    .addStep(newGeneratePluginIdIfNeededStep())
    .addStep(newPlanPluginStatusStep())
    .addStep(newGuardPluginVisibilityStep(deps.store))
    .addStep(newResolveConvergenceStep())
    .build()
    .execute(reqCtx);

  if (reqCtx.get(PLUGIN_CONVERGED_KEY) === true) {
    return reqCtx.get(EXISTING_PLUGIN_KEY) as Plugin;
  }

  await newPipeline<typeof PushPluginRequestSchema>(
    "plugin-push-install",
    deps.logger,
  )
    .addStep(
      newProbeServerSignInsStep({
        outboundFetch: deps.outboundFetch,
        logger: deps.logger,
      }),
    )
    .addStep(newCheckAndStoreArtifactStep(deps.artifactStorage))
    .addStep(newPopulatePluginFieldsStep())
    .addStep(newArchiveCurrentPluginStep(deps.store, deps.logger))
    .addStep(newStorePluginStep(deps.store, "StorePlugin"))
    .addStep(
      newPluginPushAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(newIndexPluginSearchStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(PLUGIN_KEY) as Plugin;
}

// ─── createArtifactUploadUrl ─────────────────────────────────────────────

/**
 * Mints a short-lived, single-use upload URL through the shared staging
 * port; an over-limit declaration is refused with the limit BEFORE any
 * bytes move.
 */
async function createArtifactUploadUrl(
  deps: PluginControllerDeps,
  req: CreatePluginArtifactUploadUrlRequest,
  ctx: HandlerContext,
): Promise<PluginArtifactUploadUrl> {
  const staging = deps.staging;
  if (staging === undefined) {
    throw failedPreconditionError(TRANSFER_LANE_NOT_CONFIGURED);
  }
  const reqCtx = new RequestContext(
    PluginCommandController.method.createArtifactUploadUrl.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof PluginCommandController.method.createArtifactUploadUrl.input
  >("plugin-create-artifact-upload-url", deps.logger)
    .addStep(
      newAuthorizeStep(
        PluginCommandController.method.createArtifactUploadUrl,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);

  if (req.sizeBytes > BigInt(MAX_ZIP_SIZE)) {
    throw invalidArgumentError(
      `plugin archive size ${req.sizeBytes} bytes exceeds the ${MAX_ZIP_SIZE}-byte (100MB) archive limit`,
    );
  }
  let minted: StagedUpload;
  try {
    minted = await staging.mint(Number(req.sizeBytes));
  } catch (error) {
    throw internalError(error, "failed to mint upload reference");
  }
  return create(PluginArtifactUploadUrlSchema, {
    url: minted.url,
    artifactUploadRef: minted.ref,
    ttlSeconds: Math.trunc(minted.ttlMs / 1000),
  });
}

// ─── updateVisibility ────────────────────────────────────────────────────

const UPDATE_VISIBILITY_PLUGIN_KEY = "updateVisibilityPlugin";
type UpdateVisibilityDesc =
  typeof PluginCommandController.method.updateVisibility.input;

/**
 * A targeted metadata update on the plugin. Load runs before level
 * validation so NOT_FOUND wins.
 */
async function updateVisibility(
  deps: PluginControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<Plugin> {
  const reqCtx = new RequestContext(
    PluginCommandController.method.updateVisibility.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>(
    "plugin-update-visibility",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        PluginCommandController.method.updateVisibility,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadPluginByIdStep(deps.store, UPDATE_VISIBILITY_PLUGIN_KEY))
    .addStep(newRecordVisibilityBeforeUpdateStep(UPDATE_VISIBILITY_PLUGIN_KEY))
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newRefuseChildOrgsVisibilityInChildUpdateStep(deps.store, UPDATE_VISIBILITY_PLUGIN_KEY))
    .addStep(newSetPluginVisibilityStep())
    .addStep(
      newPersistPluginStep(
        deps.store,
        UPDATE_VISIBILITY_PLUGIN_KEY,
        "PersistPluginForVisibilityUpdate",
      ),
    )
    .addStep(
      newUpdateVisibilityTuplesStep(
        deps.authorizationLifecycle,
        UPDATE_VISIBILITY_PLUGIN_KEY,
      ),
    )
    .addStep(
      newIndexPluginStep(
        deps.store,
        deps.logger,
        UPDATE_VISIBILITY_PLUGIN_KEY,
        "IndexPluginAfterVisibilityUpdate",
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(UPDATE_VISIBILITY_PLUGIN_KEY) as Plugin;
}

/** Loads the plugin by resource_id; a missing one answers NotFound, a store fault Internal. */
function newLoadPluginByIdStep(
  store: Store,
  key: string,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadPluginForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      let plugin: Plugin;
      try {
        plugin = await store.getResource(
          ctx.apiResourceKind,
          ctx.input.resourceId,
          PluginSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("plugin", ctx.input.resourceId);
        }
        throw internalError(error, "failed to load plugin");
      }
      ctx.set(key, plugin);
    },
  };
}

/** Sets metadata.visibility and stamps the StatusAudit slot (#540). */
function newSetPluginVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetPluginVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const plugin = ctx.get(UPDATE_VISIBILITY_PLUGIN_KEY) as Plugin;
      if (plugin.metadata !== undefined) {
        plugin.metadata.visibility = ctx.input.visibility;
      }
      setAuditFieldsForUpdate(
        PluginSchema,
        plugin,
        "status_audit",
        ctx.callerIdentity,
      );
    },
  };
}

// ─── delete ──────────────────────────────────────────────────────────────

type DeleteDesc = typeof PluginCommandController.method.delete.input;

/**
 * Delete — refuses while an agent of the organization lists the plugin,
 * then removes it, its archived versions, its grants and its search entry.
 * A conversation that lists it fails its next turn naming it, as one that
 * names a deleted agent does. Returns the deleted plugin.
 */
async function deletePlugin(
  deps: PluginControllerDeps,
  id: PluginId,
  ctx: HandlerContext,
): Promise<Plugin> {
  const reqCtx = new RequestContext(
    PluginCommandController.method.delete.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<DeleteDesc>("plugin-delete", deps.logger)
    .addStep(
      newAuthorizeStep(PluginCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, PluginSchema))
    .addStep(newGuardPluginUnlistedStep(deps.store))
    .addStep(newCascadeDeletePluginEvalsStep<DeleteDesc>(deps.pluginEvals))
    .addStep(
      newDeleteVersionArchivesStep(deps.store, deps.logger, {
        stepName: "DeletePluginArchives",
        noun: "plugin",
      }),
    )
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newSweepPluginEvalsAfterDeleteStep<DeleteDesc>(deps.pluginEvals))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted plugin not found in context"),
      "deleted plugin not found in context",
    );
  }
  return deleted as Plugin;
}

/**
 * GuardPluginUnlisted — an agent of the plugin's organization that lists
 * the plugin blocks the uninstall, naming the agents: an agent whose next
 * turn is refused for a plugin that is gone is the worse outcome. The scan
 * covers the plugin's own organization (stigmer#1956).
 */
function newGuardPluginUnlistedStep(store: Store): PipelineStep<DeleteDesc> {
  return {
    name: "GuardPluginUnlisted",
    async execute(ctx: RequestContext<DeleteDesc>): Promise<void> {
      const plugin = ctx.get(EXISTING_RESOURCE_KEY) as Plugin;
      const org = plugin.metadata?.org ?? "";
      const slug = plugin.metadata?.slug ?? "";
      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.agent);
      } catch (error) {
        throw internalError(
          error,
          "failed to list agents for the plugin reference check",
        );
      }
      const referrers: string[] = [];
      for (const raw of rows) {
        const agent = fromBinary(AgentSchema, raw);
        const metadata = metadataOf(agent);
        if (metadata === undefined || metadata.org !== org) {
          continue;
        }
        const lists = collectSpecReferences(AgentSchema, agent).some(
          (ref) =>
            ref.kind === ApiResourceKind.plugin &&
            ref.slug === slug &&
            (ref.org === "" || ref.org === org),
        );
        if (lists) {
          referrers.push(`agent '${metadata.slug}'`);
        }
      }
      if (referrers.length > 0) {
        throw failedPreconditionError(
          `plugin '${slug}' is still used by ${referrers.sort().join(", ")}; remove it from their plugins first`,
        );
      }
    },
  };
}

// ─── queries ─────────────────────────────────────────────────────────────

async function get(
  deps: PluginControllerDeps,
  id: PluginId,
  ctx: HandlerContext,
): Promise<Plugin> {
  const reqCtx = new RequestContext(
    PluginQueryController.method.get.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PluginQueryController.method.get.input>(
    "plugin-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(PluginQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, PluginSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Plugin;
}

type ListVersionsDesc = typeof PluginQueryController.method.listVersions.input;


/**
 * GetByReference — slug + org with the version ladder, then can_view on
 * the RESOLVED plugin (the input carries no id, so the annotation skips
 * and the handler authorizes mid-chain, the ListVersions pattern).
 */
async function getByReference(
  deps: PluginControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Plugin> {
  const reqCtx = new RequestContext(
    PluginQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PluginQueryController.method.getByReference.input>(
    "plugin-get-by-reference",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        PluginQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(
      newLoadByReferenceWithVersionStep(
        deps.store,
        pluginVersionBinding,
        "LoadPluginByReference",
      ),
    )
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(PluginQueryController.method.get),
        "AuthorizeResolvedPlugin",
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Plugin;
}

/**
 * GetArtifact — a plugin archive's bytes by storage key over gRPC (≤10MB
 * messages; larger archives ride the download-URL lane). Authorization is
 * skipped by proto config: the content-hash storage key is the capability
 * token, as for the skill archive. A key outside the plugin store's own
 * prefix is not found, so this read never reaches another kind's archives
 * on the shared driver.
 */
async function getArtifact(
  deps: PluginControllerDeps,
  req: GetArtifactRequest,
  ctx: HandlerContext,
): Promise<GetArtifactResponse> {
  const reqCtx = new RequestContext(
    PluginQueryController.method.getArtifact.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PluginQueryController.method.getArtifact.input>(
    "plugin-get-artifact",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        PluginQueryController.method.getArtifact,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);

  let artifact: Uint8Array;
  try {
    artifact = await deps.artifactStorage.get(pluginStorageKey(req));
  } catch (error) {
    throw artifactReadError(error, req, "failed to load plugin artifact");
  }
  return create(GetArtifactResponseSchema, { artifact });
}

/**
 * GetArtifactDownloadUrl — the transfer-lane twin of GetArtifact: stats
 * (never loads) the archive, then asks the shared staging port for its
 * capability URL. ttl_seconds is the floor of the URL's validity, as on
 * the skill lane.
 */
async function getArtifactDownloadUrl(
  deps: PluginControllerDeps,
  req: GetArtifactRequest,
  ctx: HandlerContext,
): Promise<PluginArtifactDownloadUrl> {
  const staging = deps.staging;
  if (staging === undefined) {
    throw failedPreconditionError(TRANSFER_LANE_NOT_CONFIGURED);
  }

  const reqCtx = new RequestContext(
    PluginQueryController.method.getArtifactDownloadUrl.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof PluginQueryController.method.getArtifactDownloadUrl.input
  >("plugin-get-artifact-download-url", deps.logger)
    .addStep(
      newAuthorizeStep(
        PluginQueryController.method.getArtifactDownloadUrl,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .build()
    .execute(reqCtx);

  let size: number;
  try {
    size = await deps.artifactStorage.size(pluginStorageKey(req));
  } catch (error) {
    throw artifactReadError(error, req, "failed to stat plugin artifact");
  }

  let capability: DownloadCapability;
  try {
    capability = await staging.downloadUrl(req.artifactStorageKey);
  } catch (error) {
    throw internalError(error, "failed to mint plugin artifact download URL");
  }

  return create(PluginArtifactDownloadUrlSchema, {
    url: capability.url,
    ttlSeconds: Math.trunc(capability.ttlMs / 1000),
    sizeBytes: BigInt(size),
  });
}

/**
 * The requested key when it is the plugin store's own; otherwise a key that
 * reads as not found. A key must already be in normal form, so a `..`
 * segment cannot climb out of `plugins/` into another kind's archives on a
 * store that resolves keys as paths.
 */
function pluginStorageKey(req: GetArtifactRequest): string {
  const key = req.artifactStorageKey;
  if (!key.startsWith(PLUGIN_ARTIFACT_KEY_PREFIX) || posix.normalize(key) !== key || key.split("/").includes("..")) {
    throw new ArtifactNotFoundError(req.artifactStorageKey);
  }
  return req.artifactStorageKey;
}

/** A missing archive is NotFound naming the key; any other failure is an infrastructure fault. */
function artifactReadError(
  error: unknown,
  req: GetArtifactRequest,
  message: string,
): ConnectError {
  if (error instanceof ArtifactNotFoundError) {
    return new ConnectError(
      `plugin artifact not found: ${req.artifactStorageKey}`,
      Code.NotFound,
    );
  }
  return internalError(error, message);
}

/** ListVersions — resolve by slug, authorize the resolved plugin, map audit records, paginate. */
async function listVersions(
  deps: PluginControllerDeps,
  req: ListPluginVersionsInput,
  ctx: HandlerContext,
): Promise<ListPluginVersionsResponse> {
  const reqCtx = new RequestContext(
    PluginQueryController.method.listVersions.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ListVersionsDesc>("plugin-list-versions", deps.logger)
    .addStep(
      newAuthorizeStep(
        PluginQueryController.method.listVersions,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(
      newResolveBySlugForVersionsStep(
        deps.store,
        pluginVersionBinding,
        "ResolvePluginBySlug",
      ),
    )
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        versionHistoryTarget(
          ApiResourceKind.plugin,
          "unauthorized to view plugin version history",
        ),
        "AuthorizeResolvedPlugin",
      ),
    )
    .addStep(
      newLoadAndMapVersionsStep(
        deps.store,
        pluginVersionBinding,
        "LoadAndMapVersions",
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(LIST_VERSIONS_RESPONSE_KEY) as ListPluginVersionsResponse;
}

// ─── shared helpers ──────────────────────────────────────────────────────

function newPersistPluginStep<Desc extends UpdateVisibilityDesc>(
  store: Store,
  key: string,
  stepName: string,
): PipelineStep<Desc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const plugin = ctx.get(key) as Plugin;
      try {
        await store.saveResource(
          ctx.apiResourceKind,
          plugin.metadata?.id ?? "",
          PluginSchema,
          plugin,
        );
      } catch (error) {
        throw internalError(error, "failed to save plugin");
      }
    },
  };
}

/** Re-indexes after a change (visibility is indexed); best-effort. */
function newIndexPluginStep<Desc extends UpdateVisibilityDesc>(
  store: Store,
  logger: Logger,
  key: string,
  stepName: string,
): PipelineStep<Desc> {
  return {
    name: stepName,
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const plugin = ctx.get(key) as Plugin;
      const entry = pluginSearchExtractor.getSearchIndexEntry(plugin);
      if (entry === undefined) {
        return;
      }
      try {
        await store.upsertSearchIndex(
          ctx.apiResourceKind,
          plugin.metadata?.id ?? "",
          entry,
        );
      } catch (error) {
        logger.warn(`${stepName}: failed (best-effort)`, {
          id: plugin.metadata?.id ?? "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
