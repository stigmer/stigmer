/**
 * Channel controller (ChannelCommandController + ChannelQueryController): a
 * way people reach an agent. A web channel is a hosted chat link with its
 * own audience, embed origins, visitor-facing messages, the vaults guest
 * runs use and a rotatable link token; a Slack or WhatsApp channel is the
 * connection binding an agent to a messaging-platform workspace, whose
 * identity and credentials are produced by the provider install flow and
 * live in status, so a declarative apply can never clobber them. Channel
 * operations never modify the referenced agent. A channel's org is the
 * billing org and the credentials org, and it must be its agent's.
 *
 * Install posture (open source, a deliberate divergence): initiateInstall
 * and completeInstall validate, load the channel (byte-identical NOT_FOUND
 * with cloud's LoadChannel step), refuse a web channel (it has nothing to
 * install), then refuse FailedPrecondition: this edition has no webhook
 * receiver and no delivery runtime, so an installed channel could never
 * serve traffic. Nothing is persisted on that path. A composition with a
 * delivery runtime registers a ChannelRuntime driver (channel-runtime.ts)
 * and the final refuse line becomes a delegation instead; everything
 * before it is posture-independent. The messaging and conversation runtime
 * surfaces live in message.ts and conversation.ts.
 *
 * NOT search-indexed by design (the kind declares not_search_indexed: a
 * channel is configuration reached through its agent, not a library
 * artifact), so no index steps appear in any chain. An agent's delete
 * removes its channels (cascade.ts); a channel's delete cascades nothing.
 *
 * Every chain opens with Authorize. create asks can_manage_audience on the
 * referenced agent, then can_create_channel (AuthorizeResolvedTarget);
 * create and delete run the shared tuple-lifecycle steps against the
 * composed lifecycle; getByReference authorizes the loaded channel as `get`
 * would; listByAgent and list narrow through the composed list read scope.
 * The public profile read skips the Authorizer through is_public, and the
 * member read asks can_view on the loaded channel's organization
 * (AuthorizeMemberAudience). Both profile reads take the channel's id, the
 * one identity a hosted chat link carries, and answer only for a web
 * channel. Per-RPC posture: docs/authorization-coverage.md.
 *
 * Proven by channel.conformance.test.ts (CONFORMANCE_TARGET=local),
 * __tests__/channel.test.ts, __tests__/web-channel.test.ts and
 * __tests__/store-faults.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelCommandController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import {
  ChannelListSchema,
  UpdateChannelInputSchema,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/io_pb";
import type {
  ChannelAgentProfile,
  ChannelId,
  ChannelList,
  CompleteChannelInstallInput,
  GetChannelAgentProfileRequest,
  InitiateChannelInstallInput,
  InitiateChannelInstallOutput,
  ListChannelsByAgentRequest,
  ListChannelsRequest,
  RotateChannelLinkInput,
  UpdateChannelInput,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/io_pb";
import {
  ChannelStatusSchema,
  WebChannelStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/status_pb";
import type {
  ApiResourceReference,
  RenameInput,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceAuditSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

import type { Logger } from "../../boot/logger.js";
import type { CredentialBinding } from "../../extensions/credential-binding.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ListReadScope } from "../../extensions/list-read-scope.js";
import { restrictListByReadScope } from "../../extensions/list-read-scope.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
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
import { newGuardReservedLabelsStep } from "../../pipeline/steps/guard-reserved-labels.js";
import {
  newBuildNewStateStep,
  setAuditFieldsForUpdate,
} from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  newDeleteResourceStep,
  newExtractResourceIdStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  matchesAllLabels,
  sortedLabels,
} from "../../pipeline/steps/helpers.js";
import {
  decodeOrSkip,
  listPageFingerprint,
  readListPage,
} from "../../pipeline/steps/list-page.js";
import type { ListPageRequest } from "../../pipeline/steps/list-page.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
} from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import {
  newNormalizeReferencesStep,
  newValidateReferencesStep,
} from "../../pipeline/steps/references.js";
import {
  newCleanupGrantsStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newClaimNameStep, newReleaseNamesStep, releaseNameOnFailure } from "../../pipeline/steps/names.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { renameResource, storeRenameRows } from "../../pipeline/steps/rename.js";
import { runGuardedWrite } from "../../pipeline/guarded-write.js";
import { everyPathUpdate, updateContext } from "../../pipeline/steps/update-input.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { ListIndexQuery } from "../../store/list-index.js";
import type { Store } from "../../store/interface.js";
import type { ModelCatalogProvider } from "../../modelcatalog/model-catalog-provider.js";
import { newVaultAttachmentsStep } from "../vault/attachments.js";
import type { VaultAttachmentOptions } from "../vault/attachments.js";
import { channelAdmitsAnyone, newResolveChannelAudienceStep } from "./audience.js";
import { newEnsureChannelAgentStillExistsStep } from "./cascade.js";
import type { ChannelRuntime } from "./channel-runtime.js";
import {
  INSTALL_NOT_APPLICABLE_MESSAGE,
  INSTALL_UNAVAILABLE_MESSAGE,
  ROTATE_LINK_NOT_APPLICABLE_MESSAGE,
} from "./constants.js";
import { channelListIndex } from "./list-index.js";
import {
  RESOLVED_CHANNEL_KEY,
  buildChannelAgentProfile,
  generateLinkToken,
  linkNotFound,
  linkTokenAllowed,
  linkTokenOf,
  loadLinkedChannel,
  newAuthorizeMemberAudienceStep,
  newInitInstallStateStep,
  newResolveChannelDefaultsStep,
  newTeardownChannelRuntimeStep,
  newValidateChannelUpdateStep,
  resolveChannelCreateTargets,
} from "./steps.js";

export interface ChannelControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /**
   * The composed credential binding: the persist and rename backstops
   * refuse a credential that does not reach the row's organization
   * (pipeline/steps/refuse-bound-elsewhere.ts).
   */
  readonly credentialBinding: CredentialBinding;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly modelRegistry: ModelCatalogProvider;
  /**
   * The composed channel delivery runtime, or undefined on the storing
   * edition (channel-runtime.ts, the serving seam).
   * Explicitly `| undefined` rather than optional: every construction
   * site states which posture it composes.
   */
  readonly channelRuntime: ChannelRuntime | undefined;
  /** The composed list read scope — list/listByAgent narrow through it; undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
}

/** A channel's runs have no person: each asks the account that attached each vault. */
const CHANNEL_VAULT_ATTACHMENTS: VaultAttachmentOptions<typeof ChannelSchema> = {
  surface: "a channel",
  attachers: {
    get: (row) => row.status?.vaultAttachers,
    set: (row, attachers) => {
      (row.status ??= create(ChannelStatusSchema)).vaultAttachers = attachers;
    },
  },
};

/** Registers both channel resource services on the router (routes stage). */
export function registerChannelServices(
  router: ConnectRouter,
  deps: ChannelControllerDeps,
): void {
  router.service(ChannelCommandController, {
    apply: (channel, ctx) => apply(deps, channel, ctx),
    create: (channel, ctx) => createChannel(deps, channel, ctx),
    update: (input, ctx) => update(deps, input, ctx),
    rename: (input, ctx) => rename(deps, input, ctx),
    rotateLink: (input, ctx) => rotateLink(deps, input, ctx),
    initiateInstall: (input, ctx) => initiateInstall(deps, input, ctx),
    completeInstall: (input, ctx) => completeInstall(deps, input, ctx),
    delete: (channelId, ctx) => deleteChannel(deps, channelId, ctx),
  });
  router.service(ChannelQueryController, {
    get: (channelId, ctx) => get(deps, channelId, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    listByAgent: (req, ctx) => listByAgent(deps, req, ctx),
    list: (req, ctx) => list(deps, req, ctx),
    getAgentProfile: (req, ctx) => getAgentProfile(deps, req, ctx),
    getAgentProfileForMember: (req, ctx) => getAgentProfileForMember(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create. ResolveChannelAudience writes a web channel's omitted audience
 * out before validation reads the spec. ResolveChannelDefaults names a
 * nameless channel `<agent slug>-<type>`, so CheckDuplicate caps the
 * nameless channels of one type at one per agent. InitInstallState runs
 * after BuildNewState so the status wipe cannot erase a Slack or WhatsApp
 * channel's pending_install. EnsureChannelAgentStillExists closes the race
 * with the agent's delete (cascade.ts).
 */
async function createChannel(
  deps: ChannelControllerDeps,
  channel: Channel,
  ctx: HandlerContext,
): Promise<Channel> {
  const reqCtx = new RequestContext(
    ChannelSchema,
    channel,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelSchema>("channel-create", deps.logger)
    .addStep(
      newAuthorizeStep(ChannelCommandController.method.create, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newNormalizeReferencesStep(deps.store))
    .addStep(newResolveChannelAudienceStep())
    .addStep(newValidateVisibilityStep())
    .addStep(
      newResolveChannelDefaultsStep(
        deps.store,
        deps.modelRegistry,
        deps.channelRuntime,
      ),
    )
    // Before the duplicate check and the install state (steps.ts,
    // resolveChannelCreateTargets).
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        resolveChannelCreateTargets,
      ),
    )
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newGuardReservedLabelsStep(deps.authorizer))
    .addStep(newInitInstallStateStep())
    .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
    .addStep(newVaultAttachmentsStep(deps.store, deps.authorizer, CHANNEL_VAULT_ATTACHMENTS))
    .addStep(newClaimNameStep(deps.store, ApiResourceKind.channel))
    .addStep(newPersistStep(deps.store, deps.credentialBinding))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .addStep(newEnsureChannelAgentStillExistsStep(deps))
    .build()
    .execute(reqCtx)
    .catch(releaseNameOnFailure(deps.store, deps.logger, reqCtx));
  return reqCtx.newState;
}

/**
 * Update. The spec is replaced wholesale (declarative semantics); status is
 * preserved verbatim, which keeps a web channel's link token and a Slack or
 * WhatsApp channel's install facts immune to declarative clobber (rotateLink
 * and the install flow are their writers).
 */
async function update(
  deps: ChannelControllerDeps,
  input: UpdateChannelInput,
  ctx: HandlerContext,
): Promise<Channel> {
  return runGuardedWrite(async () => {
    const reqCtx = updateContext(
      ChannelSchema,
      input,
      callerIdentityOf(ctx),
      kindOf(ctx),
    );
    await newPipeline<typeof ChannelSchema>("channel-update", deps.logger)
      .addStep(
        newAuthorizeStep(
          ChannelCommandController.method.update,
          deps.authorizer,
          input,
        ),
      )
      .addStep(newResolveSlugStep({ update: true }))
      .addStep(newLoadExistingStep(deps.store))
      .addStep(newBuildUpdateStateStep())
      .addStep(newValidateProtoStep({ of: "state" }))
      // After BuildUpdateState, which rebuilds the state from the request.
      .addStep(newNormalizeReferencesStep(deps.store))
      .addStep(
        newValidateChannelUpdateStep(
          deps.store,
          deps.modelRegistry,
          deps.channelRuntime,
        ),
      )
      .addStep(newResolveChannelAudienceStep())
      .addStep(newGuardReservedLabelsStep(deps.authorizer))
      .addStep(newValidateReferencesStep(deps.store, deps.authorizer))
      .addStep(newVaultAttachmentsStep(deps.store, deps.authorizer, CHANNEL_VAULT_ATTACHMENTS))
      .addStep(newPersistStep(deps.store, deps.credentialBinding))
      .build()
      .execute(reqCtx);
    return reqCtx.newState;
  });
}

/**
 * Apply — kubectl-style create-or-update. Delegates with the pipeline's
 * cloned state: a nameless manifest legitimately omits both name and slug,
 * and the defaulted slug and name (from ResolveChannelDefaults), the
 * normalized agent_ref and the populated id (from LoadForApply) live only
 * on the clone. Defaults resolution runs before routing so the existence
 * check sees the defaulted slug and the same-org invariant fails loudly
 * first; the create pipeline re-running it is harmless (resolution is
 * idempotent).
 */
async function apply(
  deps: ChannelControllerDeps,
  channel: Channel,
  ctx: HandlerContext,
): Promise<Channel> {
  const reqCtx = new RequestContext(
    ChannelSchema,
    channel,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelSchema>("channel-apply", deps.logger)
    .addStep(
      newAuthorizeStep(ChannelCommandController.method.apply, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newNormalizeReferencesStep(deps.store))
    .addStep(newResolveChannelAudienceStep())
    .addStep(
      newResolveChannelDefaultsStep(
        deps.store,
        deps.modelRegistry,
        deps.channelRuntime,
      ),
    )
    .addStep(newResolveSlugStep())
    .addStep(newLoadForApplyStep(deps.store))
    .build()
    .execute(reqCtx);

  const shouldCreate = reqCtx.get(SHOULD_CREATE_KEY);
  /* v8 ignore next -- @preserve: LoadForApply sets the flag or throws, so only a chain built wrong reaches this */
  if (typeof shouldCreate !== "boolean") {
    throw internalError(
      new Error("apply pipeline did not set shouldCreate flag"),
      "apply operation failed to determine create vs update",
    );
  }
  const resolved = reqCtx.newState;
  return shouldCreate
    ? createChannel(deps, resolved, ctx)
    : update(deps, everyPathUpdate(UpdateChannelInputSchema, resolved), ctx);
}

/**
 * Rename — the only writer of a channel's slug (pipeline/steps/rename.ts):
 * the name moves, then the live row's slug; the old slug keeps leading to
 * it for reading for 30 days. A web channel's chat link names its id and
 * does not change.
 */
async function rename(
  deps: ChannelControllerDeps,
  input: RenameInput,
  ctx: HandlerContext,
): Promise<Channel> {
  return renameResource(
    {
      method: ChannelCommandController.method.rename,
      names: deps.store,
      rows: storeRenameRows(deps.store, ApiResourceKind.channel, ChannelSchema),
      authorizer: deps.authorizer,
      credentialBinding: deps.credentialBinding,
      logger: deps.logger,
    },
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
}

// ---------------------------------------------------------------------------
// rotateLink: this handler is a web channel's link token's sole writer;
// clients never supply it. The token lives in status, not spec, so manifest
// applies can never wipe it and silently fail open to the plain link.
// ---------------------------------------------------------------------------

const ROTATE_CHANNEL_KEY = "rotateLinkChannel";

type RotateDesc = typeof ChannelCommandController.method.rotateLink.input;

async function rotateLink(
  deps: ChannelControllerDeps,
  input: RotateChannelLinkInput,
  ctx: HandlerContext,
): Promise<Channel> {
  const reqCtx = new RequestContext(
    ChannelCommandController.method.rotateLink.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<RotateDesc>("channel-rotate-link", deps.logger)
    .addStep(
      newAuthorizeStep(
        ChannelCommandController.method.rotateLink,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadChannelForLinkRotationStep(deps.store))
    .addStep(newRotateLinkTokenStep())
    .addStep(newPersistChannelForLinkRotationStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(ROTATE_CHANNEL_KEY) as Channel;
}

/**
 * Loads the channel by resource_id; a missing one answers NotFound, a store
 * fault Internal, and a Slack or WhatsApp channel, which has no link,
 * FailedPrecondition.
 */
function newLoadChannelForLinkRotationStep(
  store: Store,
): PipelineStep<RotateDesc> {
  return {
    name: "LoadChannelForLinkRotation",
    async execute(ctx: RequestContext<RotateDesc>): Promise<void> {
      let channel: Channel;
      try {
        channel = await store.getResource(
          ctx.apiResourceKind,
          ctx.input.resourceId,
          ChannelSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Channel", ctx.input.resourceId);
        }
        throw internalError(error, "failed to load channel");
      }
      if (channel.spec?.type.case !== "web") {
        throw failedPreconditionError(ROTATE_LINK_NOT_APPLICABLE_MESSAGE);
      }
      ctx.set(ROTATE_CHANNEL_KEY, channel);
    },
  };
}

/**
 * Sets the web channel's link token to fresh entropy, preserving the rest
 * of status and stamping the StatusAudit slot, the same status-preserving
 * discipline as the update pipeline.
 */
function newRotateLinkTokenStep(): PipelineStep<RotateDesc> {
  return {
    name: "RotateLinkToken",
    execute(ctx: RequestContext<RotateDesc>): void {
      const channel = ctx.get(ROTATE_CHANNEL_KEY) as Channel;
      // An entropy failure is practically unreachable, but its copy is
      // contract.
      let token: string;
      try {
        token = generateLinkToken();
      } catch (error) {
        throw internalError(error, "failed to rotate channel link");
      }
      const status = (channel.status ??= create(ChannelStatusSchema));
      status.typeStatus = {
        case: "web",
        value: create(WebChannelStatusSchema, { linkToken: token }),
      };
      setAuditFieldsForUpdate(
        ChannelSchema,
        channel,
        "status_audit",
        ctx.callerIdentity,
      );
    },
  };
}

/**
 * Saves the rotated token and its status audit onto the live row inside
 * the store's atomic write, so an update that landed since the load stays.
 * The written row replaces the loaded one under the key.
 */
function newPersistChannelForLinkRotationStep(
  store: Store,
): PipelineStep<RotateDesc> {
  return {
    name: "PersistChannelForLinkRotation",
    async execute(ctx: RequestContext<RotateDesc>): Promise<void> {
      const channel = ctx.get(ROTATE_CHANNEL_KEY) as Channel;
      const id = channel.metadata?.id ?? "";
      let written: Channel;
      try {
        written = await store.updateResource(
          ctx.apiResourceKind,
          id,
          ChannelSchema,
          (row) => {
            const status = (row.status ??= create(ChannelStatusSchema));
            status.typeStatus = {
              case: "web",
              value: create(WebChannelStatusSchema, { linkToken: linkTokenOf(channel) }),
            };
            const audit = (status.audit ??= create(ApiResourceAuditSchema));
            audit.statusAudit = channel.status?.audit?.statusAudit;
          },
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError("Channel", id);
        }
        throw internalError(error, "failed to save channel");
      }
      ctx.set(ROTATE_CHANNEL_KEY, written);
    },
  };
}

// ---------------------------------------------------------------------------
// Install lane. Input validation is Layer-1 (the transport interceptor chain
// validates every request); the channel is loaded first so the NOT_FOUND
// contract is identical to cloud's LoadChannel step in both postures, and
// only the final step splits: refuse or delegate (channel-runtime.ts). With
// no runtime composed nothing is persisted; a composed runtime owns the
// install flow end to end.
// ---------------------------------------------------------------------------

async function initiateInstall(
  deps: ChannelControllerDeps,
  input: InitiateChannelInstallInput,
  ctx: HandlerContext,
): Promise<InitiateChannelInstallOutput> {
  const channel = await loadChannelForInstall(deps, ctx, input.resourceId);
  // can_edit after the load (#224 discipline): a missing id answers
  // NOT_FOUND for everyone; only an existing channel can produce the
  // annotation's denial. Enforced at the open-source lane so every
  // composed runtime receives a pre-authorized caller.
  await authorizeDirect(
    ChannelCommandController.method.initiateInstall,
    deps.authorizer,
    callerIdentityOf(ctx),
    input,
  );
  return installRuntime(deps, channel).installs.initiateInstall(
    channel,
    input,
    callerIdentityOf(ctx),
  );
}

/**
 * CompleteInstall — the same load-then-authorize contract; on the storing
 * edition a completion can only be reached with a state token from a
 * successful initiate, which it never issues.
 */
async function completeInstall(
  deps: ChannelControllerDeps,
  input: CompleteChannelInstallInput,
  ctx: HandlerContext,
): Promise<Channel> {
  const channel = await loadChannelForInstall(deps, ctx, input.resourceId);
  await authorizeDirect(
    ChannelCommandController.method.completeInstall,
    deps.authorizer,
    callerIdentityOf(ctx),
    input,
  );
  return installRuntime(deps, channel).installs.completeInstall(
    channel,
    input,
    callerIdentityOf(ctx),
  );
}

/**
 * The runtime an authorized install delegates to: a web channel has
 * nothing to install, and with no runtime composed the open-source
 * refusal stands.
 */
function installRuntime(
  deps: ChannelControllerDeps,
  channel: Channel,
): ChannelRuntime {
  if (channel.spec?.type.case === "web") {
    throw failedPreconditionError(INSTALL_NOT_APPLICABLE_MESSAGE);
  }
  if (deps.channelRuntime === undefined) {
    throw failedPreconditionError(INSTALL_UNAVAILABLE_MESSAGE);
  }
  return deps.channelRuntime;
}

/**
 * Loads the install target: cloud's LoadChannel NOT_FOUND, verbatim, for a
 * missing channel; a store fault answers Internal. Returns the loaded
 * channel so a composed runtime receives it without a second load (the
 * load-then-X contract stays open-source-owned).
 */
async function loadChannelForInstall(
  deps: ChannelControllerDeps,
  ctx: HandlerContext,
  resourceId: string,
): Promise<Channel> {
  try {
    return await deps.store.getResource(
      kindOf(ctx),
      resourceId,
      ChannelSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("Channel", resourceId);
    }
    throw internalError(error, "failed to load channel");
  }
}

/**
 * Delete — the channel's full teardown; disabling (update with
 * enabled=false) is the configuration-preserving pause. On the storing
 * edition there is no teardown cascade: a Slack or WhatsApp channel's
 * runtime state cannot exist because the install flow never runs. A
 * composed runtime splices its cascade (TeardownChannelRuntime: sealed
 * channel credentials, pending deliveries) between the load and the row
 * delete, so dependent runtime state dies before the row.
 */
async function deleteChannel(
  deps: ChannelControllerDeps,
  channelId: ChannelId,
  ctx: HandlerContext,
): Promise<Channel> {
  const reqCtx = new RequestContext(
    ChannelCommandController.method.delete.input,
    channelId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  const pipeline = newPipeline<
    typeof ChannelCommandController.method.delete.input
  >("channel-delete", deps.logger)
    .addStep(
      newAuthorizeStep(ChannelCommandController.method.delete, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newExtractResourceIdStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ChannelSchema));
  if (deps.channelRuntime !== undefined) {
    pipeline.addStep(newTeardownChannelRuntimeStep(deps.channelRuntime));
  }
  await pipeline
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newReleaseNamesStep(deps.store, deps.logger, ApiResourceKind.channel))
    .addStep(newCleanupGrantsStep(deps.authorizationLifecycle, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  /* v8 ignore next -- @preserve: LoadExistingForDelete sets the channel or throws, so only a chain built wrong reaches this */
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted channel not found in context"),
      "deleted channel not found in context",
    );
  }
  return deleted as Channel;
}

/** Get — LoadTarget by id-wrapper input (ChannelId). */
async function get(
  deps: ChannelControllerDeps,
  channelId: ChannelId,
  ctx: HandlerContext,
): Promise<Channel> {
  const reqCtx = new RequestContext(
    ChannelQueryController.method.get.input,
    channelId,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelQueryController.method.get.input>(
    "channel-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(ChannelQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, ChannelSchema))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Channel;
}

/** GetByReference — org/slug lookup. */
async function getByReference(
  deps: ChannelControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<Channel> {
  const reqCtx = new RequestContext(
    ChannelQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof ChannelQueryController.method.getByReference.input
  >("channel-get-by-reference", deps.logger)
    .addStep(
      newAuthorizeStep(
        ChannelQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, ChannelSchema))
    .addStep(
      newAuthorizeResolvedTargetStep(
        deps.authorizer,
        loadedTargetAsMethod(ChannelQueryController.method.get),
      ),
    )
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as Channel;
}

const CHANNEL_LIST_KEY = "channelList";

/**
 * ListByAgent — one page of one agent's channels of every type, optionally
 * org-scoped. This is how the agent's console tabs and the CLI find an
 * agent's channels regardless of their slugs. A nonexistent agent yields
 * an empty list, not an error. The org filter is contract parity, not
 * authorization: a multi-org caller asking for one org's channels must not
 * see another org's channels of the same agent.
 */
async function listByAgent(
  deps: ChannelControllerDeps,
  req: ListChannelsByAgentRequest,
  ctx: HandlerContext,
): Promise<ChannelList> {
  const reqCtx = new RequestContext(
    ChannelQueryController.method.listByAgent.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelQueryController.method.listByAgent.input>(
    "channel-list-by-agent",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        ChannelQueryController.method.listByAgent,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadChannelsByAgentStep(deps.store, deps.logger, deps.listReadScope))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(CHANNEL_LIST_KEY);
  /* v8 ignore next -- @preserve: LoadChannelsByAgent sets the list or throws, so only a chain built wrong reaches this */
  if (result === undefined) {
    throw internalError(
      new Error("channel list not found in context"),
      "channel list not found in context",
    );
  }
  return result as ChannelList;
}

/**
 * LoadChannelsByAgent — one page of the channels whose spec.agent_ref
 * holds the agent's id (the index's `agent` key), so a channel of an agent
 * since deleted never lists under a new agent of the same name.
 */
function newLoadChannelsByAgentStep(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
): PipelineStep<typeof ChannelQueryController.method.listByAgent.input> {
  return {
    name: "LoadChannelsByAgent",
    async execute(
      ctx: RequestContext<typeof ChannelQueryController.method.listByAgent.input>,
    ): Promise<void> {
      const req = ctx.input;
      // The org and agent filters are indexed predicates in both editions;
      // the scope narrows the agent's channels last (the scope is the last
      // per-row predicate).
      ctx.set(
        CHANNEL_LIST_KEY,
        await readChannelPage(store, logger, listReadScope, ctx.callerIdentity, req, {
          query: {
            org: req.org,
            anyKey: [{ name: "agent", value: req.agentId }],
          },
          fingerprint: {
            lane: "channel.listByAgent",
            agentId: req.agentId,
            org: req.org,
          },
        }),
      );
    },
  };
}

const LIST_RESULT_KEY = "listResult";

/** List — one page of an org's channels, labels filter (AND semantics), newest first. */
async function list(
  deps: ChannelControllerDeps,
  req: ListChannelsRequest,
  ctx: HandlerContext,
): Promise<ChannelList> {
  const reqCtx = new RequestContext(
    ChannelQueryController.method.list.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelQueryController.method.list.input>(
    "channel-list",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(ChannelQueryController.method.list, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListByOrgAndLabelsStep(deps.store, deps.logger, deps.listReadScope))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_RESULT_KEY);
  /* v8 ignore next -- @preserve: ListByOrgAndLabels sets the list or throws, so only a chain built wrong reaches this */
  if (result === undefined) {
    throw internalError(
      new Error("channel list not found in context"),
      "channel list not found in context",
    );
  }
  return result as ChannelList;
}

/** ListByOrgAndLabels — one page of the org's channels, warn-and-skip rows. */
function newListByOrgAndLabelsStep(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
): PipelineStep<typeof ChannelQueryController.method.list.input> {
  return {
    name: "ListByOrgAndLabels",
    async execute(
      ctx: RequestContext<typeof ChannelQueryController.method.list.input>,
    ): Promise<void> {
      const { org } = ctx.input;
      // The org is an indexed predicate and the labels a per-row filter,
      // in both editions; the scope narrows the org's rows last (the scope
      // is the last per-row predicate).
      ctx.set(
        LIST_RESULT_KEY,
        await readChannelPage(store, logger, listReadScope, ctx.callerIdentity, ctx.input, {
          query: { org },
          fingerprint: { lane: "channel.list", org },
        }),
      );
    },
  };
}

/** The two list lanes' shared read: one page, the request's labels as each row's keep, the scope last, as a ChannelList. */
async function readChannelPage(
  store: Store,
  logger: Logger,
  listReadScope: ListReadScope | undefined,
  caller: CallerIdentity,
  request: ListPageRequest & { readonly labels: Readonly<Record<string, string>> },
  lane: {
    readonly query: ListIndexQuery<"agent">;
    readonly fingerprint: Readonly<Record<string, unknown>>;
  },
): Promise<ChannelList> {
  const page = await readListPage({
    store,
    declaration: channelListIndex,
    query: lane.query,
    request,
    fingerprint: listPageFingerprint({
      ...lane.fingerprint,
      labels: sortedLabels(request.labels),
    }),
    decode: decodeOrSkip(ChannelSchema, {
      logger,
      message: "Failed to unmarshal channel, skipping",
    }),
    keep: (channel: Channel) =>
      matchesAllLabels(channel.metadata?.labels ?? {}, request.labels),
    scope: (channels) =>
      restrictListByReadScope(
        listReadScope,
        caller,
        ApiResourceKind.channel,
        channels,
        "",
      ),
    failure: "failed to list channels",
  });
  return create(ChannelListSchema, {
    entries: page.entries,
    nextPageToken: page.nextPageToken,
  });
}

// ---------------------------------------------------------------------------
// The profile lanes. getAgentProfile is the anonymous resolution path for
// the hosted chat page; visitors resolve a chat link to the trimmed
// ChannelAgentProfile, never the full Agent, whose spec carries the system
// prompt. getAgentProfileForMember is the tokenless authenticated twin: in
// open source the one principal is the organization, so membership always
// holds and it resolves any enabled web channel, with one exception
// mirrored from cloud (below). Both take the channel's id, the one identity
// a hosted chat link carries, and answer only for a web channel.
// ---------------------------------------------------------------------------

const AGENT_PROFILE_KEY = "channelAgentProfile";

type ProfileDesc = typeof ChannelQueryController.method.getAgentProfile.input;
type MemberProfileDesc =
  typeof ChannelQueryController.method.getAgentProfileForMember.input;

async function getAgentProfile(
  deps: ChannelControllerDeps,
  req: GetChannelAgentProfileRequest,
  ctx: HandlerContext,
): Promise<ChannelAgentProfile> {
  const reqCtx = new RequestContext(
    ChannelQueryController.method.getAgentProfile.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<ProfileDesc>("channel-get-agent-profile", deps.logger)
    .addStep(
      newAuthorizeStep(
        ChannelQueryController.method.getAgentProfile,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadChannelForProfileStep(deps.store))
    .addStep(newProjectAgentProfileStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(AGENT_PROFILE_KEY) as ChannelAgentProfile;
}

async function getAgentProfileForMember(
  deps: ChannelControllerDeps,
  req: ChannelId,
  ctx: HandlerContext,
): Promise<ChannelAgentProfile> {
  const reqCtx = new RequestContext(
    ChannelQueryController.method.getAgentProfileForMember.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<MemberProfileDesc>(
    "channel-get-agent-profile-for-member",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        ChannelQueryController.method.getAgentProfileForMember,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    // The link names only the channel, so membership is asked of the
    // loaded channel's organization (steps.ts, AuthorizeMemberAudience).
    .addStep(newLoadChannelForMemberProfileStep(deps.store))
    .addStep(newAuthorizeMemberAudienceStep(deps.authorizer))
    .addStep(newProjectMemberAgentProfileStep(deps.store))
    .build()
    .execute(reqCtx);
  return reqCtx.get(AGENT_PROFILE_KEY) as ChannelAgentProfile;
}

/**
 * Loads the web channel by the id the link carries, for the anonymous path
 * (steps.ts, loadLinkedChannel): a missing channel, another type and a
 * channel whose organization is gone answer the uniform refusal. An empty
 * id never reaches it; ValidateProto refuses it first.
 */
function newLoadChannelForProfileStep(store: Store): PipelineStep<ProfileDesc> {
  return {
    name: "LoadChannelForProfile",
    async execute(ctx: RequestContext<ProfileDesc>): Promise<void> {
      ctx.set(RESOLVED_CHANNEL_KEY, await loadLinkedChannel(store, ctx.input.channelId));
    },
  };
}

/** The member path's loader — the same load, the same refusal. */
function newLoadChannelForMemberProfileStep(
  store: Store,
): PipelineStep<MemberProfileDesc> {
  return {
    name: "LoadChannelForMemberProfile",
    async execute(ctx: RequestContext<MemberProfileDesc>): Promise<void> {
      ctx.set(RESOLVED_CHANNEL_KEY, await loadLinkedChannel(store, ctx.input.value));
    },
  };
}

/**
 * Gates on spec.enabled, the audience, and the live link token, then
 * projects the trimmed public profile. A disabled channel, an org-audience
 * channel, and a locked link with a wrong or absent token are all
 * indistinguishable from a nonexistent channel: a rotated (killed) link
 * must look exactly like one that never existed, and a members-only link
 * must leak nothing to non-members (they resolve via
 * getAgentProfileForMember instead). Check order: exists, enabled,
 * audience, token.
 */
function newProjectAgentProfileStep(store: Store): PipelineStep<ProfileDesc> {
  return {
    name: "ProjectAgentProfile",
    async execute(ctx: RequestContext<ProfileDesc>): Promise<void> {
      const channel = ctx.get(RESOLVED_CHANNEL_KEY) as Channel;
      const req = ctx.input;
      if (channel.spec?.enabled !== true) {
        throw linkNotFound(req.channelId);
      }
      // Only a channel whose owner chose public reaches an anonymous
      // reader; an omitted audience means the organization (audience.ts).
      if (!channelAdmitsAnyone(channel.spec)) {
        throw linkNotFound(req.channelId);
      }
      if (!linkTokenAllowed(req.linkToken, linkTokenOf(channel))) {
        throw linkNotFound(req.channelId);
      }
      ctx.set(AGENT_PROFILE_KEY, await buildChannelAgentProfile(store, channel));
    },
  };
}

/**
 * The member path's projection: gates on spec.enabled and refuses
 * token-locked public-audience links: this tokenless path must not reveal a
 * killed (rotated) link's profile; such links resolve only through
 * getAgentProfile with the matching token. Org-audience links are
 * unaffected; their gate is membership, not the link token.
 */
function newProjectMemberAgentProfileStep(
  store: Store,
): PipelineStep<MemberProfileDesc> {
  return {
    name: "ProjectMemberAgentProfile",
    async execute(ctx: RequestContext<MemberProfileDesc>): Promise<void> {
      const channel = ctx.get(RESOLVED_CHANNEL_KEY) as Channel;
      if (channel.spec?.enabled !== true) {
        throw linkNotFound(ctx.input.value);
      }
      if (channelAdmitsAnyone(channel.spec) && linkTokenOf(channel) !== "") {
        throw linkNotFound(ctx.input.value);
      }
      ctx.set(AGENT_PROFILE_KEY, await buildChannelAgentProfile(store, channel));
    },
  };
}
