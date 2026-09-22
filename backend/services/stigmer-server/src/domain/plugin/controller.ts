/**
 * Plugin controller — the Plugin kind's command and query sides. A plugin
 * is the unit of install: `push` reads an Agent Plugins archive and
 * materialises skills, MCP servers, an agent and workflows in the
 * organization as the installing caller (push.ts holds the steps and the
 * install discipline); `delete` removes them through their own chains;
 * `updateVisibility` moves the plugin and every member together;
 * `listMembers` derives membership from the label on the children;
 * `getByReference` and `listVersions` are the shared content-addressed
 * version steps bound to the plugin's digest and manifest version.
 *
 * Wiring mirrors the skill controller's: the store and the archive store
 * are required; the transfer lane is an OPTIONAL modelled state (absent,
 * createArtifactUploadUrl answers FailedPrecondition and push accepts
 * inline bytes only); the materializer is a lazy provider because the
 * in-process clients it rides exist only after the routes this controller
 * is registered in.
 *
 * Proven by __tests__/plugin.test.ts (composed-server round-trips) and
 * plugin.conformance.test.ts (CONFORMANCE_TARGET=local, local-postgres).
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import {
  ListPluginMembersResponseSchema,
  ListPluginVersionsResponseSchema,
  PluginArtifactUploadUrlSchema,
  PluginMemberSchema,
  PluginVersionEntrySchema,
  PushPluginRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type {
  CreatePluginArtifactUploadUrlRequest,
  ListPluginMembersResponse,
  ListPluginVersionsInput,
  ListPluginVersionsResponse,
  PluginArtifactUploadUrl,
  PluginId,
  PluginVersionEntry,
  PushPluginRequest,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

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
import { newValidateVisibilityUpdateStep } from "../../pipeline/steps/validate-visibility.js";
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
import type { VersionHistoryBinding } from "../../pipeline/steps/version-history.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { Store } from "../../store/interface.js";
import { uploadUrl } from "../skill/transfer/handler.js";
import type { UploadSlots } from "../skill/transfer/slots.js";
import { TRANSFER_LANE_NOT_CONFIGURED } from "./constants.js";
import type { PluginMaterializerProvider } from "./materialize/ports.js";
import { findMembers } from "./members.js";
import type { Member } from "./members.js";
import {
  PLUGIN_CONVERGED_KEY,
  PLUGIN_KEY,
  EXISTING_PLUGIN_KEY,
  newArchiveCurrentPluginStep,
  newBuildInitialPluginStep,
  newCheckAndStoreArtifactStep,
  newFinalizePluginStatusStep,
  newFindExistingPluginBySlugStep,
  newGateAndHashArchiveStep,
  newGeneratePluginIdIfNeededStep,
  newGuardPluginVisibilityStep,
  newIndexPluginSearchStep,
  newMaterializeMembersStep,
  newParseOverlayDocumentsStep,
  newPlanMaterializationStep,
  newPluginPushAuthorizationTuplesStep,
  newPopulatePluginFieldsStep,
  newReadPluginPackageStep,
  newRemoveDroppedMembersStep,
  newResolveConvergenceStep,
  newSanitizePluginMetadataStep,
  newStorePluginStep,
  orderForDeletion,
  pluginLiveTag,
} from "./push.js";
import { pluginSearchExtractor } from "./search-extractor.js";

/** The transfer lane's controller-side pair; the slots are the skill lane's (one upload surface). */
export interface PluginTransferLaneDeps {
  readonly slots: UploadSlots;
  readonly baseUrl: string;
}

export interface PluginControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly authorizer: Authorizer;
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly artifactStorage: ContentAddressedArchiveStore;
  readonly materializerProvider: PluginMaterializerProvider;
  readonly transferLane?: PluginTransferLaneDeps;
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
  });
  router.service(PluginQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    listMembers: (id, ctx) => listMembers(deps, id, ctx),
    listVersions: (req, ctx) => listVersions(deps, req, ctx),
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
        deps.transferLane?.slots,
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
    .addStep(newParseOverlayDocumentsStep())
    .addStep(newSanitizePluginMetadataStep(deps.authorizer))
    .addStep(newPlanMaterializationStep(deps.store, deps.authorizer))
    .addStep(newGuardPluginVisibilityStep())
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
    .addStep(newCheckAndStoreArtifactStep(deps.artifactStorage))
    .addStep(newPopulatePluginFieldsStep())
    .addStep(newArchiveCurrentPluginStep(deps.store, deps.logger))
    .addStep(newStorePluginStep(deps.store, "StorePlugin"))
    .addStep(
      newMaterializeMembersStep(
        deps.store,
        deps.materializerProvider,
        deps.logger,
      ),
    )
    .addStep(
      newRemoveDroppedMembersStep(
        deps.store,
        deps.materializerProvider,
        deps.logger,
      ),
    )
    .addStep(newFinalizePluginStatusStep())
    .addStep(newStorePluginStep(deps.store, "StorePluginReady"))
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
 * Mints a short-lived, single-use upload URL over the shared slots; an
 * over-limit declaration is refused with the limit BEFORE any bytes move.
 */
async function createArtifactUploadUrl(
  deps: PluginControllerDeps,
  req: CreatePluginArtifactUploadUrlRequest,
  ctx: HandlerContext,
): Promise<PluginArtifactUploadUrl> {
  const lane = deps.transferLane;
  if (lane === undefined) {
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
  let minted: { ref: string; ttlMs: number };
  try {
    minted = lane.slots.mint(Number(req.sizeBytes));
  } catch (error) {
    throw internalError(error, "failed to mint upload reference");
  }
  return create(PluginArtifactUploadUrlSchema, {
    url: uploadUrl(lane.baseUrl, minted.ref),
    artifactUploadRef: minted.ref,
    ttlSeconds: Math.trunc(minted.ttlMs / 1000),
  });
}

// ─── updateVisibility ────────────────────────────────────────────────────

const UPDATE_VISIBILITY_PLUGIN_KEY = "updateVisibilityPlugin";
type UpdateVisibilityDesc =
  typeof PluginCommandController.method.updateVisibility.input;

/**
 * A targeted metadata update on the plugin, then the same level on every
 * member through its kind's own updateVisibility door, in-process as the
 * caller. Load runs before level validation so NOT_FOUND wins.
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
      newFanOutVisibilityToMembersStep(deps.store, deps.materializerProvider),
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

/** Loads the plugin by resource_id; ANY load failure → NotFound. */
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
      } catch {
        throw notFoundError("plugin", ctx.input.resourceId);
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

/** The plugin's level, applied to every member through its own door. */
function newFanOutVisibilityToMembersStep(
  store: Store,
  materializerProvider: PluginMaterializerProvider,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "FanOutVisibilityToMembers",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const plugin = ctx.get(UPDATE_VISIBILITY_PLUGIN_KEY) as Plugin;
      const members = await membersOf(store, plugin);
      const materializer = materializerProvider();
      for (const member of members) {
        await materializer.updateVisibility(
          member.kind,
          member.id,
          ctx.input.visibility,
          ctx.callerIdentity,
        );
      }
    },
  };
}

// ─── delete ──────────────────────────────────────────────────────────────

type DeleteDesc = typeof PluginCommandController.method.delete.input;
const DELETE_MEMBERS_KEY = "deletePluginMembers";

/**
 * Delete — refuses while a resource outside the plugin references a
 * member, then removes members through their own chains (agent first,
 * then the rest in reverse materialisation order), then the head.
 * Children first so a failure leaves a plugin whose remaining members are
 * still listed; a retry converges. Returns the deleted plugin.
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
    .addStep(newGuardMembersUnreferencedStep(deps.store))
    .addStep(
      newCascadeDeleteMembersStep(deps.materializerProvider, deps.logger),
    )
    .addStep(
      newDeleteVersionArchivesStep(deps.store, deps.logger, {
        stepName: "DeletePluginArchives",
        noun: "plugin",
      }),
    )
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
      new Error("deleted plugin not found in context"),
      "deleted plugin not found in context",
    );
  }
  return deleted as Plugin;
}

/**
 * GuardMembersUnreferenced — a user's own agent or workflow that
 * references a member blocks the uninstall, naming the referrers: a
 * dangling `skill_ref` found at the next session is the worse outcome.
 * Members referencing each other are the plugin's business and pass.
 */
function newGuardMembersUnreferencedStep(
  store: Store,
): PipelineStep<DeleteDesc> {
  return {
    name: "GuardMembersUnreferenced",
    async execute(ctx: RequestContext<DeleteDesc>): Promise<void> {
      const plugin = ctx.get(EXISTING_RESOURCE_KEY) as Plugin;
      const members = await membersOf(store, plugin);
      ctx.set(DELETE_MEMBERS_KEY, members);
      if (members.length === 0) {
        return;
      }
      const org = plugin.metadata?.org ?? "";
      const memberKeys = new Set(
        members.map((member) => `${member.kind}:${member.slug}`),
      );
      const memberIds = new Set(members.map((member) => member.id));
      const referrers: string[] = [];
      for (const { kind, schema, noun } of [
        { kind: ApiResourceKind.agent, schema: AgentSchema, noun: "agent" },
        {
          kind: ApiResourceKind.workflow,
          schema: WorkflowSchema,
          noun: "workflow",
        },
      ]) {
        let rows: Uint8Array[];
        try {
          rows = await store.listResources(kind);
        } catch (error) {
          throw internalError(
            error,
            `failed to list ${noun}s for the plugin reference check`,
          );
        }
        for (const raw of rows) {
          const resource = fromBinary(schema, raw);
          const metadata = metadataOf(resource);
          if (
            metadata === undefined ||
            metadata.org !== org ||
            memberIds.has(metadata.id)
          ) {
            continue;
          }
          const hit = collectSpecReferences(schema, resource).some(
            (ref) =>
              (ref.org === "" || ref.org === org) &&
              memberKeys.has(`${ref.kind}:${ref.slug}`),
          );
          if (hit) {
            referrers.push(`${noun} '${metadata.slug}'`);
          }
        }
      }
      if (referrers.length > 0) {
        throw failedPreconditionError(
          `plugin '${plugin.metadata?.slug ?? ""}' is still used by ${referrers.sort().join(", ")}; ` +
            "detach them from the plugin's skills and servers first",
        );
      }
    },
  };
}

/** CascadeDeleteMembers — every member through its own delete chain, agent first. */
function newCascadeDeleteMembersStep(
  materializerProvider: PluginMaterializerProvider,
  logger: Logger,
): PipelineStep<DeleteDesc> {
  return {
    name: "CascadeDeleteMembers",
    async execute(ctx: RequestContext<DeleteDesc>): Promise<void> {
      const plugin = ctx.get(EXISTING_RESOURCE_KEY) as Plugin;
      const members = ctx.get(DELETE_MEMBERS_KEY) as Member[];
      const materializer = materializerProvider();
      for (const member of orderForDeletion(members)) {
        await materializer.deleteByKind(
          member.kind,
          member.id,
          ctx.callerIdentity,
        );
      }
      if (members.length > 0) {
        logger.info("Deleted plugin members", {
          pluginId: plugin.metadata?.id ?? "",
          members: members.map(
            (member) => `${ApiResourceKind[member.kind]}:${member.slug}`,
          ),
        });
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

/** Where a plugin keeps its hash and its tag, and how its history renders. */
const pluginVersionBinding: VersionHistoryBinding<
  typeof PluginSchema,
  ListVersionsDesc,
  PluginVersionEntry,
  ListPluginVersionsResponse
> = {
  kind: ApiResourceKind.plugin,
  schema: PluginSchema,
  noun: "plugin",
  headHashOf: (plugin) => plugin.status?.digest ?? "",
  liveTagOf: pluginLiveTag,
  input: (req) => req,
  mapEntry: (plugin, isCurrent, tag) => {
    const entry = create(PluginVersionEntrySchema, { isCurrent, tag });
    if (plugin.status !== undefined) {
      entry.digest = plugin.status.digest;
      entry.artifactStorageKey = plugin.status.artifactStorageKey;
      const specAudit = plugin.status.audit?.specAudit;
      if (specAudit !== undefined) {
        entry.pushedAt = specAudit.updatedAt ?? specAudit.createdAt;
        entry.pushedBy = specAudit.updatedBy ?? specAudit.createdBy;
      }
    }
    if (plugin.metadata?.version !== undefined) {
      entry.message = plugin.metadata.version.message;
    }
    return entry;
  },
  response: (versions, nextPageToken, totalCount) =>
    create(ListPluginVersionsResponseSchema, {
      versions,
      nextPageToken,
      totalCount,
    }),
};

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

const LIST_MEMBERS_RESPONSE_KEY = "listMembersResponse";

/** ListMembers — the four label scans, in materialisation order. */
async function listMembers(
  deps: PluginControllerDeps,
  id: PluginId,
  ctx: HandlerContext,
): Promise<ListPluginMembersResponse> {
  const reqCtx = new RequestContext(
    PluginQueryController.method.listMembers.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof PluginQueryController.method.listMembers.input>(
    "plugin-list-members",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        PluginQueryController.method.listMembers,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, PluginSchema))
    .addStep({
      name: "ListPluginMembers",
      async execute(stepCtx): Promise<void> {
        const plugin = stepCtx.get(TARGET_RESOURCE_KEY) as Plugin;
        const members = await membersOf(deps.store, plugin);
        stepCtx.set(
          LIST_MEMBERS_RESPONSE_KEY,
          create(ListPluginMembersResponseSchema, {
            members: members.map((member) =>
              create(PluginMemberSchema, {
                kind: member.kind,
                id: member.id,
                slug: member.slug,
                name: member.name,
              }),
            ),
          }),
        );
      },
    })
    .build()
    .execute(reqCtx);
  return reqCtx.get(LIST_MEMBERS_RESPONSE_KEY) as ListPluginMembersResponse;
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

async function membersOf(store: Store, plugin: Plugin): Promise<Member[]> {
  try {
    return await findMembers(
      store,
      plugin.metadata?.id ?? "",
      plugin.metadata?.org ?? "",
    );
  } catch (error) {
    throw internalError(error, "failed to list plugin members");
  }
}

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
