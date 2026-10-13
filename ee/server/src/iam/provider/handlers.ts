/**
 * The IdentityProvider RPCs as extension services: the command side's
 * create, update, apply, rename and delete and the access move's two
 * (createAccessMove, redeemAccessMove), the query side's get,
 * getByReference, listByOrg, getSsoProvider and previewSsoRequirement. IdentityProvider is an enterprise-tier
 * kind open source registers no service for, so these are its only
 * handlers; every one runs the composition's unary chain (Authorize from
 * the proto annotation, then ValidateProto, then the lane's steps and its
 * domain step), Team's shape (team/handlers.ts).
 *
 * The chains are the OSS steps wherever a step's question is the
 * library's, and the provider's own only where the question reads this
 * table or the library's answer is not this kind's (steps.ts):
 *
 *   create          ResolveSlug → CheckDuplicate → BuildNewState (the
 *                   server's minted id, whatever the request carried: a
 *                   provider's id names the grant rows on it, so a chosen
 *                   one could name rows it never earned), then the
 *                   validation matrix
 *                   (validation.ts), the row, the verifier's invalidation
 *                   and the lifecycle driver's creation event
 *   update          LoadExisting → BuildUpdateState, then the matrix, the
 *                   row and the invalidation
 *                   (create and update then ask the switch's rules,
 *                   sso-required-steps.ts: a request that changes
 *                   `sso_required`, or whom a provider that requires it
 *                   trusts, also needs the organization's owners,
 *                   and one that turns it on the host's plan gate when it
 *                   fills one; and end their steps with GrowthGate when
 *                   the host fills the port, iam/growth-gate.ts, which an
 *                   update that only turns `sso_required` off passes, so
 *                   a refused write reaches neither the matrix's live
 *                   reads nor the row; apply reaches them through the arm
 *                   it runs)
 *   apply           AuthorizeResolvedTarget (`can_create_idp` on the
 *                   request's organization, create's own question and
 *                   copy) → ResolveSlug → LoadForApply decides; then
 *                   create with the original request, or update with the
 *                   resolved id. Both arms need the organization's admins,
 *                   so the first question refuses no one they would admit,
 *                   and a caller who is not one reads create's refusal
 *                   whether or not the slug exists: the two arms' copies
 *                   would otherwise say which. Each arm then runs its own
 *                   chain and authorizes as its own door (`apply` itself
 *                   carries no annotation). The
 *                   delegation runs after the deciding chain returns, as
 *                   the OSS apply does: inside its domain step, every
 *                   refusal would be logged by both pipelines.
 *   get             LoadTarget, then the row
 *   getByReference  LoadByReference → AuthorizeResolvedTarget, as `get`;
 *                   a missing slug or id is NOT_FOUND only to the
 *                   organization's admins, who see every provider it
 *                   holds, and `get`'s denial to anyone else
 *                   (reference-miss.ts), so the code never tells an
 *                   outsider whether a provider exists; the trust
 *                   configuration is what a caller must be allowed to see
 *   listByOrg       the organization's rows, narrowed by the list read
 *                   scope to what the caller could `get`
 *   getSsoProvider  public (the login page asks before anyone signs in);
 *                   the projection carries only what sign-in needs, and a
 *                   provider whose organization is gone or younger than it
 *                   answers as no provider (sso-info.ts, organization-links.ts
 *                   `orphanReason`): the slug may now be someone else's
 *   previewSsoRequirement
 *                   the organization's owners only (its annotation): who
 *                   would stop counting if the requirement were on
 *                   (requirement-preview.ts)
 *   createAccessMove, redeemAccessMove
 *                   skip lanes whose ticket is the authorization, as an
 *                   invitation's token is (iam/access-move/handlers.ts)
 *   rename          the library's rename chain over this table
 *                   (`renameResource`): RefuseServiceAccountCaller,
 *                   LoadForRename, RefuseBeingDeleted, ValidateNewSlug,
 *                   RenameName, PersistRenamed through `modifyById`, then
 *                   the verifier's invalidation; sign-in routes by issuer
 *                   and audience and federated accounts hold the
 *                   provider's id, so nobody's sign-in moves
 *   delete          LoadTarget, then the owners when the provider
 *                   requires sign-in through it (deleting it ends the
 *                   requirement), then the removal (removal.ts)
 *
 * Create follows the lifecycle contract every create chain follows: the
 * row is written first, then the creation event (the organization link;
 * the kind records no owner, so its organization's admins manage it); a
 * failed event fails the request with the row
 * in place, and the boot reconcile (iam/organization-links.ts) restores
 * the organization link, which is all an organization's admins need to
 * manage it. The verifier is told of every write as soon as the row
 * changes, so a failed event never leaves a provider the verifier ignores
 * until its cache expires.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type { ServiceImpl } from "@connectrpc/connect";
import type { OutboundFetch } from "@stigmer/outbound/egress";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceDeleteInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderCommandController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/command_pb";
import {
  IdentityProvidersSchema,
  UpdateIdentityProviderInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { IdentityProviderQueryController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/query_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type {
  Authorizer,
  ExtensionServiceRegistration,
  ListReadScope,
  Logger,
  NameTable,
  PipelineStep,
  RequestContext,
  ResourceAuthorizationLifecycle,
} from "@stigmer/server";
import type { ServiceAccountLookup } from "@stigmer/server";
import {
  callerIdentityOf,
  everyPathUpdate,
  internalError,
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
  newBuildNewStateStep,
  newBuildUpdateStateStep,
  runGuardedWrite,
  writeConflictError,
  EXISTING_RESOURCE_BYTES_KEY,
  newClaimNameStep,
  newResolveSlugStep,
  portRenameRows,
  releaseNameOnFailure,
  renameResource,
  resolveResourceCreatedEvent,
  restrictListByReadScope,
  EXISTING_RESOURCE_KEY,
  TARGET_RESOURCE_KEY,
  newRefuseServiceAccountCallerStep,
} from "@stigmer/server";

import { runUnaryChain, runUpdateChain } from "../../rpc/unary-chain.js";
import { deniedCopyOf } from "../reference-miss.js";
import type { OrganizationLookup } from "../organization-links.js";
import type { ProviderRemoval } from "./removal.js";
import {
  duplicateProviderError,
  findProviderByName,
  newRefuseRenamingDeletedProviderStep,
  newCheckDuplicateProviderStep,
  providerNameHolder,
  newLoadExistingProviderStep,
  newLoadProviderByReferenceStep,
  newLoadProviderForApplyStep,
  newLoadProviderStep,
  providerAt,
  providerForApply,
  withResolvedProviderId,
} from "./steps.js";
import { newGrowthGateStep, type GrowthGate } from "../growth-gate.js";
import { createAccessMove, redeemAccessMove } from "../access-move/handlers.js";
import type { AccessMoveDeps } from "../access-move/handlers.js";
import { previewSsoRequirement } from "./requirement-preview.js";
import type { RequirementPreviewDeps } from "./requirement-preview.js";
import { requireLiveSsoProvider, ssoProviderInfoOf } from "./sso-info.js";
import type { SsoProviderReads } from "./sso-info.js";
import {
  createSetsSsoRequired,
  newOwnersDecideSsoRequiredStep,
  newProviderUpdateGrowthGateStep,
  newSsoPlanGateStep,
  updateNeedsOwners,
  updateTurnsSsoRequiredOn,
} from "./sso-required-steps.js";
import type { SsoPlanGate } from "./sso-required-steps.js";
import type { IdentityProviderStore } from "./store.js";
import { normalizeIssuers, routeTakenError, ssoTakenError, validateProvider } from "./validation.js";

export interface IdentityProviderLaneDeps {
  readonly authorizer: Authorizer;
  readonly logger: Logger;
  readonly store: IdentityProviderStore;
  /** The server's one name table, where a provider's slug is claimed (steps.ts). */
  readonly names: NameTable;
  /** The egress-guarded fetch the matrix's live reads dial through (the composition's one). */
  readonly outboundFetch: OutboundFetch;
  /** The issuers the host's own sign-in lanes claim, which no provider may name. */
  readonly reservedIssuers: ReadonlyArray<string>;
  readonly removal: Pick<ProviderRemoval, "remove">;
  /** The composition's one lifecycle driver: creation grants through the grant path. */
  readonly lifecycle: Pick<ResourceAuthorizationLifecycle, "onResourceCreated">;
  /** The composition's one list read scope, the same instance the driver slot holds. */
  readonly listReadScope: ListReadScope;
  /** The federated verifier's issuer-cache invalidation, after every row write. */
  readonly invalidate: () => void;
  /**
   * The organization SSO discovery checks its provider still belongs to,
   * and the slug the delete's refusal names the provider's organization by.
   */
  readonly organizations: OrganizationLookup;
  /**
   * The identity-account port: whether the caller is an organization's
   * service account, which creates, changes and deletes no identity
   * provider (its sign-in role makes members; @stigmer/server's
   * refuse-service-account step).
   */
  readonly accounts: ServiceAccountLookup;
  /** The host's growth gate (iam/growth-gate.ts); absent, every create and update is allowed. */
  readonly growthGate?: GrowthGate;
  /**
   * Whether an organization's plan lets it require sign-in through its SSO
   * provider (sso-required-steps.ts); absent (self-hosted Enterprise, where
   * it is an edition feature), every organization may.
   */
  readonly ssoPlanGate?: SsoPlanGate;
  /** The access move's stores and reads (iam/access-move/handlers.ts). */
  readonly accessMove: Omit<AccessMoveDeps, keyof SsoProviderReads | "logger">;
  /** The owners' requirement preview's reads (requirement-preview.ts). */
  readonly requirementPreview: Omit<RequirementPreviewDeps, keyof SsoProviderReads | "accounts" | "invitations">;
}

type Commands = ServiceImpl<typeof IdentityProviderCommandController>;
type Queries = ServiceImpl<typeof IdentityProviderQueryController>;

const KIND = ApiResourceKind.identity_provider;

/** Apply's first refusal is create's own copy (the header's apply line says why). */
const APPLY_DENIED = deniedCopyOf(IdentityProviderCommandController.method.create);

export { NO_SSO_PROVIDER_MESSAGE } from "./sso-info.js";

/** The growth gate's step, last in create and update, when the host fills the port. */
function growthGateOf(
  deps: IdentityProviderLaneDeps,
): ReadonlyArray<PipelineStep<typeof IdentityProviderSchema>> {
  return deps.growthGate === undefined ? [] : [newGrowthGateStep(deps.growthGate)];
}

/** The update's growth step: an update that only turns the sign-in requirement off is never growth. */
function updateGrowthGateOf(
  deps: IdentityProviderLaneDeps,
): ReadonlyArray<PipelineStep<typeof IdentityProviderSchema>> {
  return deps.growthGate === undefined
    ? []
    : [
        newProviderUpdateGrowthGateStep<typeof IdentityProviderSchema>(deps.growthGate, (ctx) => ({
          stored: providerAt(ctx, EXISTING_RESOURCE_KEY),
          next: ctx.newState,
        })),
      ];
}

/** The plan gate's step, when the host fills the port, asked only when the request turns the requirement on. */
function ssoPlanGateOf(
  deps: IdentityProviderLaneDeps,
  turnsOn: (ctx: RequestContext<typeof IdentityProviderSchema>) => IdentityProvider | undefined,
): ReadonlyArray<PipelineStep<typeof IdentityProviderSchema>> {
  return deps.ssoPlanGate === undefined ? [] : [newSsoPlanGateStep(deps.ssoPlanGate, turnsOn)];
}

export function providerCommands(deps: IdentityProviderLaneDeps): Commands {
  const method = IdentityProviderCommandController.method;
  // A service account decides no sign-in path into the organization
  // (@stigmer/server's refuse-service-account step), on every write.
  const refuseServiceAccount = <Desc extends DescMessage>() =>
    newRefuseServiceAccountCallerStep<Desc>(
      "create, change or delete identity providers",
      deps.accounts,
    );
  const commands: Commands = {
    create: (input, ctx) =>
      runUnaryChain(
        { chain: "identity-provider-create", step: "CreateIdentityProvider" },
        method.create,
        input,
        ctx,
        deps,
        (reqCtx) => createProvider(reqCtx, deps),
        {
          kind: KIND,
          steps: [
            refuseServiceAccount(),
            newResolveSlugStep(),
            newCheckDuplicateProviderStep(deps.names, deps.store),
            newBuildNewStateStep(),
            newOwnersDecideSsoRequiredStep<typeof IdentityProviderSchema>(deps.authorizer, (ctx) =>
              createSetsSsoRequired(ctx.newState),
            ),
            ...ssoPlanGateOf(deps, (ctx) => createSetsSsoRequired(ctx.newState)),
            ...growthGateOf(deps),
            newClaimNameStep<typeof IdentityProviderSchema>(
              deps.names,
              KIND,
              providerNameHolder(deps.store),
            ),
          ],
        },
      ),
    // The guarded write (`@stigmer/server`'s pipeline/guarded-write.ts): a
    // rename or any other write between the load and the swap makes the
    // chain run again from a fresh read.
    update: (input, ctx) =>
      runGuardedWrite(() =>
        runUpdateChain(
          { chain: "identity-provider-update", step: "UpdateIdentityProvider" },
          method.update,
          IdentityProviderSchema,
          input,
          ctx,
          deps,
          (reqCtx) => updateProvider(reqCtx, deps),
          {
            kind: KIND,
            steps: [
              refuseServiceAccount(),
              newLoadExistingProviderStep(deps.store),
              newBuildUpdateStateStep(),
              newOwnersDecideSsoRequiredStep<typeof IdentityProviderSchema>(deps.authorizer, (ctx) =>
                updateNeedsOwners(providerAt(ctx, EXISTING_RESOURCE_KEY), ctx.newState),
              ),
              ...ssoPlanGateOf(deps, (ctx) =>
                updateTurnsSsoRequiredOn(providerAt(ctx, EXISTING_RESOURCE_KEY), ctx.newState),
              ),
              ...updateGrowthGateOf(deps),
            ],
          },
        ),
      ),
    apply: async (input, ctx) => {
      const existing = await runUnaryChain(
        { chain: "identity-provider-apply", step: "DecideApply" },
        method.apply,
        input,
        ctx,
        deps,
        (reqCtx) => Promise.resolve(providerForApply(reqCtx)),
        {
          kind: KIND,
          steps: [
            refuseServiceAccount(),
            newAuthorizeResolvedTargetStep(deps.authorizer, (reqCtx) => [
              {
                permission: IamPermission.can_create_idp,
                resourceKind: ApiResourceKind.organization,
                resourceId: reqCtx.input.metadata?.org ?? "",
                deniedMessage: APPLY_DENIED,
              },
            ]),
            newResolveSlugStep(),
            newLoadProviderForApplyStep(deps.names, deps.store),
          ],
        },
      );
      return existing === undefined
        ? commands.create(input, ctx)
        : commands.update(
            everyPathUpdate(UpdateIdentityProviderInputSchema, withResolvedProviderId(input, existing)),
            ctx,
          );
    },
    rename: async (input, ctx) => {
      const renamed = await renameResource(
        {
          method: method.rename,
          names: deps.names,
          rows: portRenameRows(IdentityProviderSchema, deps.store),
          authorizer: deps.authorizer,
          logger: deps.logger,
          beforeLoad: [refuseServiceAccount()],
          afterLoad: [newRefuseRenamingDeletedProviderStep(deps.store)],
        },
        input,
        callerIdentityOf(ctx),
        KIND,
      );
      deps.invalidate();
      return renamed;
    },
    delete: (input, ctx) =>
      runUnaryChain(
        { chain: "identity-provider-delete", step: "DeleteIdentityProvider" },
        method.delete,
        input,
        ctx,
        deps,
        async (reqCtx) => {
          const provider = providerAt(reqCtx, TARGET_RESOURCE_KEY);
          await deps.removal.remove(
            provider.metadata?.id ?? "",
            reqCtx.callerIdentity.identityId,
          );
          return provider;
        },
        {
          kind: KIND,
          steps: [
            refuseServiceAccount(),
            newLoadProviderStep(deps.store, (del) => del.resourceId),
            // Deleting a provider that requires sign-in through it ends the
            // requirement, which is the owners' to decide.
            newOwnersDecideSsoRequiredStep<typeof ApiResourceDeleteInputSchema>(deps.authorizer, (ctx) =>
              createSetsSsoRequired(providerAt(ctx, TARGET_RESOURCE_KEY)),
            ),
          ],
        },
      ),
    createAccessMove: (input, ctx) =>
      runUnaryChain(
        { chain: "identity-provider-create-access-move", step: "CreateAccessMove" },
        method.createAccessMove,
        input,
        ctx,
        deps,
        (reqCtx) => createAccessMove(reqCtx, accessMoveDepsOf(deps)),
      ),
    redeemAccessMove: (input, ctx) =>
      runUnaryChain(
        { chain: "identity-provider-redeem-access-move", step: "RedeemAccessMove" },
        method.redeemAccessMove,
        input,
        ctx,
        deps,
        (reqCtx) => redeemAccessMove(reqCtx, accessMoveDepsOf(deps)),
      ),
  };
  return commands;
}

/** The access move's dependencies, from the lane's. */
function accessMoveDepsOf(deps: IdentityProviderLaneDeps): AccessMoveDeps {
  return { ...deps.accessMove, store: deps.store, organizations: deps.organizations, logger: deps.logger };
}

export function providerQueries(deps: IdentityProviderLaneDeps): Queries {
  const method = IdentityProviderQueryController.method;
  return {
    get: (input, ctx) =>
      runUnaryChain(
        { chain: "identity-provider-get", step: "GetIdentityProvider" },
        method.get,
        input,
        ctx,
        deps,
        (reqCtx) => Promise.resolve(providerAt(reqCtx, TARGET_RESOURCE_KEY)),
        {
          kind: KIND,
          steps: [newLoadProviderStep(deps.store, (id) => id.value)],
        },
      ),
    getByReference: (input, ctx) =>
      runUnaryChain(
        { chain: "identity-provider-get-by-reference", step: "GetIdentityProviderByReference" },
        method.getByReference,
        input,
        ctx,
        deps,
        (reqCtx) => Promise.resolve(providerAt(reqCtx, TARGET_RESOURCE_KEY)),
        {
          kind: KIND,
          steps: [
            newLoadProviderByReferenceStep(deps.names, deps.store, deps.authorizer),
            newAuthorizeResolvedTargetStep(deps.authorizer, loadedTargetAsMethod(method.get)),
          ],
        },
      ),
    listByOrg: (input, ctx) =>
      runUnaryChain(
        { chain: "identity-provider-list-by-org", step: "ListIdentityProviders" },
        method.listByOrg,
        input,
        ctx,
        deps,
        async (reqCtx) => {
          const org = reqCtx.input.org;
          const visible = await restrictListByReadScope(
            deps.listReadScope,
            reqCtx.callerIdentity,
            KIND,
            await deps.store.findByOrg(org),
            org,
          );
          return create(IdentityProvidersSchema, { entries: visible });
        },
      ),
    getSsoProvider: (input, ctx) =>
      runUnaryChain(
        { chain: "identity-provider-get-sso-provider", step: "GetSsoProvider" },
        method.getSsoProvider,
        input,
        ctx,
        deps,
        async (reqCtx) => ssoProviderInfoOf(await requireLiveSsoProvider(deps, reqCtx.input.org)),
      ),
    previewSsoRequirement: (input, ctx) =>
      runUnaryChain(
        { chain: "identity-provider-preview-sso-requirement", step: "PreviewSsoRequirement" },
        method.previewSsoRequirement,
        input,
        ctx,
        deps,
        (reqCtx) =>
          previewSsoRequirement(reqCtx, {
            ...deps.requirementPreview,
            store: deps.store,
            organizations: deps.organizations,
            accounts: deps.accessMove.accounts,
            invitations: deps.accessMove.invitations,
          }),
      ),
  };
}

/**
 * The create's domain step: the matrix, the row, the invalidation, then
 * the creation event; ClaimName took the slug in the name table just
 * before, and a failure before the row landed lets it go. A slug or a
 * route a racing create claimed first answers the copy the chain's check
 * or the matrix would have.
 */
async function createProvider(
  reqCtx: RequestContext<typeof IdentityProviderCommandController.method.create.input>,
  deps: IdentityProviderLaneDeps,
): Promise<IdentityProvider> {
  return insertProvider(reqCtx, deps).catch(
    releaseNameOnFailure(deps.names, deps.logger, reqCtx),
  );
}

async function insertProvider(
  reqCtx: RequestContext<typeof IdentityProviderCommandController.method.create.input>,
  deps: IdentityProviderLaneDeps,
): Promise<IdentityProvider> {
  const provider = reqCtx.newState;
  normalizeIssuers(provider);
  await validateProvider(deps, provider, /* isUpdate */ false);
  const outcome = await deps.store.insert(provider);
  switch (outcome.kind) {
    case "inserted":
      break;
    case "slug-taken": {
      const winner = await findProviderByName(
        deps.names,
        deps.store,
        provider.metadata?.org ?? "",
        provider.metadata?.slug ?? "",
      );
      throw duplicateProviderError(winner ?? provider);
    }
    case "sso-taken":
      throw ssoTakenError(provider.metadata?.org ?? "");
    case "route-taken":
      throw routeTakenError(outcome.route);
    default: {
      const exhaustive: never = outcome;
      throw new Error(`unknown insert outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
  deps.invalidate();
  const event = resolveResourceCreatedEvent(KIND, provider, reqCtx.callerIdentity, deps.logger);
  if (event !== undefined) {
    try {
      await deps.lifecycle.onResourceCreated(event);
    } catch (error) {
      throw internalError(error, "failed to create authorization tuples");
    }
  }
  return provider;
}

/**
 * The update's domain step over BuildUpdateState's row (the request's
 * spec, name and labels on the stored id, slug, organization, visibility
 * and status): the matrix, the row, the invalidation.
 */
async function updateProvider(
  reqCtx: RequestContext<typeof IdentityProviderSchema>,
  deps: IdentityProviderLaneDeps,
): Promise<IdentityProvider> {
  const provider = reqCtx.newState;
  normalizeIssuers(provider);
  await validateProvider(deps, provider, /* isUpdate */ true);
  const outcome = await deps.store.swap(
    provider.metadata?.id ?? "",
    // LoadExisting runs first in this chain and keeps the bytes.
    reqCtx.get(EXISTING_RESOURCE_BYTES_KEY) as Uint8Array,
    provider,
  );
  switch (outcome.kind) {
    case "replaced":
      break;
    case "sso-taken":
      throw ssoTakenError(provider.metadata?.org ?? "");
    case "route-taken":
      throw routeTakenError(outcome.route);
    case "changed":
      throw writeConflictError(KIND, provider.metadata?.org ?? "", provider.metadata?.slug ?? "");
    default: {
      const exhaustive: never = outcome;
      throw new Error(`unknown replace outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
  deps.invalidate();
  return provider;
}

export function newIdentityProviderRegistrations(
  deps: IdentityProviderLaneDeps,
): ReadonlyArray<ExtensionServiceRegistration> {
  return [
    (router) => router.service(IdentityProviderCommandController, providerCommands(deps)),
    (router) => router.service(IdentityProviderQueryController, providerQueries(deps)),
  ];
}
