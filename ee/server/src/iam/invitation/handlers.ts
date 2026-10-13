/**
 * The Invitation RPCs as extension services: create, revoke and redeem on
 * the command side; get, listByOrg and the public getByToken preview on
 * the query side. Invitation is an enterprise-tier kind open source
 * registers no service for, so these are its only handlers; every one
 * runs the composition's unary chain (Authorize from the proto annotation,
 * then ValidateProto, then the lane's steps and its domain step), the
 * shape Team and IdentityProvider run.
 *
 * An invitation is its organization's administrative resource
 * (`invitation.fga` in the model `@stigmer/server` ships: the
 * organization's current admins view and edit it, and nobody else; the
 * kind records no owner, so a creator who loses admin loses the link).
 * Its token is the credential a redeemer
 * presents, and it rides the row, so the two reads that return rows are
 * the token's only readers and answer exactly what the model says:
 *
 *   create      BuildNewState (the server's minted id, whatever the
 *               request carried), then the validation, an
 *               owner's authority for an owner link, the token, the row
 *               and the lifecycle driver's creation event (the
 *               organization link); a failed event fails the request with
 *               the row in place,
 *               and the boot reconcile (iam/organization-links.ts)
 *               restores the organization link, which is all the
 *               organization's admins need
 *   revoke      Authorize (`can_edit` on the invitation the request names,
 *               from the proto annotation, before the row is read, so a
 *               caller who may not revoke it is refused alike whether or
 *               not it exists) → LoadTarget, then the state; idempotent
 *   redeem      THE TOKEN IS THE AUTHORIZATION (skip by the proto), for
 *               a person only: RefuseNonPersonCaller (steps.ts)
 *               before anything is read, then the
 *               load by token, the validity arms, the organization check,
 *               the creator's standing, a credential limited to another
 *               organization refused (the composition's credential
 *               binding: such a credential joins nothing), the membership
 *               check, then the guarded atomic redemption (store.ts)
 *               before the grant; a lost slot has granted nothing and
 *               refuses with the honest copy re-read from the row, and a
 *               failed grant releases its own record
 *   get         Authorize (`can_view` on the invitation) → LoadTarget
 *   listByOrg   the organization's rows, newest first, a page at a time
 *               through the library's page loop (`readPage`, over the
 *               store's keyset read), each page narrowed by the list read
 *               scope to the ones the caller could `get`; `page_size` 0
 *               answers every row, as on every paged lane
 *   getByToken  public (the invite page asks before anyone signs in): the
 *               organization's display fields and the link's validity,
 *               never the token or the redemption ledger; valid means
 *               redeem would not refuse it for the row, its organization
 *               or its creator's standing
 *
 * An invitation redeems only into the organization it was created in. A
 * row whose organization is gone, or one older than its organization (an
 * organization made before ids were minted, whose id was a slug a deleted
 * organization's successor could take), is refused by the same rule the
 * organization-link reconcile keeps (`orphanReason`).
 * The organization delete removes the organization's invitations
 * (removal.ts); the check covers a row that outlived its organization
 * anyway.
 *
 * An invitation grants with its creator's authority, so it carries no role
 * its creator could not grant directly, then or now. Create asks
 * `can_assign_roles` on the organization for an owner link (only its owners
 * hold it), with `@stigmer/server`'s owner-rule copy. Redeem runs as the
 * server itself, past every caller check, so it asks the creator's standing
 * instead: the creator recorded in the row's audit must still hold
 * `can_grant_access` on the organization, and `can_assign_roles` too for
 * an owner link. A link whose creator was demoted, or left, or was never
 * recorded, stops redeeming.
 *
 * Redeem records before it grants. Two redemptions by one person of one
 * role share one policy row (the grant path finds a grant by its triple),
 * and both pass the membership check before either grant lands. With the
 * grant first, the one that lost the slot (a double-clicked single-use
 * link, or a second link that lost its own last slot) would revoke the row
 * the winner's recorded redemption stands on, leaving the person recorded
 * as the link's redeemer with no role and the link spent. With the record
 * first, a lost slot has granted nothing, so nothing is undone and no row
 * is shared with an undo. A grant that fails releases its own record
 * (store.ts) and answers the grant's own error. A grant that faulted after
 * its row landed (the grant path keeps the row when its hook throws) is
 * released too, as the milder failure: the row's tuple heals through the
 * next duplicate grant and the boot backfill, and the person is a member
 * whose seat went uncounted. Only a release that fails after a failed
 * grant can still leave a recorded redemption without its role; it is
 * logged for a hand and answers INTERNAL. The order has one visible cost:
 * between a record and its release, a single-use link reads as used, so
 * someone else who redeems it in that moment is refused for a link that
 * then reopens. They can try again; a person stranded without their role
 * could not.
 *
 * Refusals are ConnectErrors and pass through the chain byte for byte;
 * any other fault is the pipeline's sanitized INTERNAL, its cause logged
 * and never on the wire. The refusal sentences are pinned: clients match
 * on them.
 */
import { randomBytes } from "node:crypto";

import { clone, create, fromBinary } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ServiceImpl } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceRefSchema,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import {
  InvitationSchema,
  InvitationStatusSchema,
} from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationCommandController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/command_pb";
import { InvitationState } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/enum_pb";
import type { InvitationPreview } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/io_pb";
import {
  InvitationPreviewSchema,
  InvitationsSchema,
} from "@stigmer/protos/ai/stigmer/iam/invitation/v1/io_pb";
import { InvitationQueryController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/query_pb";
import { IamPermission, IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type {
  AuthorizationQueryEngine,
  Authorizer,
  AuthzRefusal,
  CallerIdentity,
  CredentialBinding,
  ExtensionServiceRegistration,
  ListReadScope,
  Logger,
  RequestContext,
  ResourceAuthorizationLifecycle,
} from "@stigmer/server";
import type { ServiceAccountLookup } from "@stigmer/server";
import {
  deniedError,
  internalError,
  listPageFingerprint,
  OWNER_ASSIGNMENT_DENIED_MESSAGE,
  newBuildNewStateStep,
  newRefuseServiceAccountCallerStep,
  permissionDeniedWithReasonError,
  readPage,
  resolveResourceCreatedEvent,
  restrictListByReadScope,
  TARGET_RESOURCE_KEY,
} from "@stigmer/server";

import { runUnaryChain } from "../../rpc/unary-chain.js";
import { orphanReason } from "../organization-links.js";
import type { OrganizationFacts, OrganizationLookup } from "../organization-links.js";
import type { IamPolicyGrantPathClient } from "../policy/grant-path-client.js";
import { grantableRolesFor } from "../policy/roles.js";
import {
  invitationAt,
  newLoadInvitationStep,
  newRefuseNonPersonCallerStep,
} from "./steps.js";
import type { InvitationStore } from "./store.js";

const KIND = ApiResourceKind.invitation;

const MAX_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

/** A credential limited to one organization redeeming another's invitation. */
export const BOUND_CREDENTIAL_REDEEMS_ELSEWHERE =
  "This credential is limited to another organization, so it cannot accept this invitation; sign in as yourself to accept it";

/** A link whose creator could no longer create it (the module header's last paragraph). */
const CREATOR_NO_LONGER_GRANTS =
  "This invitation is no longer valid: the person who created it can no longer grant its role";

export interface InvitationLaneDeps {
  readonly authorizer: Authorizer;
  readonly logger: Logger;
  readonly store: InvitationStore;
  readonly policies: IamPolicyGrantPathClient;
  /** The composition's one lifecycle driver: creation grants through the grant path. */
  readonly lifecycle: Pick<ResourceAuthorizationLifecycle, "onResourceCreated">;
  /** The composition's one list read scope, the same instance the driver slot holds. */
  readonly listReadScope: ListReadScope;
  /** One read of an organization: its creation time for the redemption check, its display for the preview. */
  readonly organizations: OrganizationLookup;
  /** The engine's point questions about someone other than the caller: the creator's standing at redemption. */
  readonly authorizationQueries: Pick<AuthorizationQueryEngine, "check">;
  /**
   * The composition's credential binding: redeem is authorized by its token,
   * not the Authorizer, so a credential limited to one organization is
   * refused here when the invitation is another's.
   */
  readonly credentialBinding: Pick<CredentialBinding, "admitsOrganization" | "signInRefusal">;
  /** The identity-account port: whether the caller is a service account, which invites nobody. */
  readonly accounts: ServiceAccountLookup;
}

type Commands = ServiceImpl<typeof InvitationCommandController>;
type Queries = ServiceImpl<typeof InvitationQueryController>;

export function invitationCommands(deps: InvitationLaneDeps): Commands {
  const method = InvitationCommandController.method;
  return {
    create: (input, ctx) =>
      runUnaryChain(
        { chain: "invitation-create", step: "CreateInvitation" },
        method.create,
        input,
        ctx,
        deps,
        (reqCtx) => createInvitation(reqCtx, deps),
        {
          kind: KIND,
          // A service account never decides who belongs to the
          // organization (@stigmer/server's refusal, the one its
          // membership RPCs splice).
          steps: [
            newRefuseServiceAccountCallerStep("create invitations", deps.accounts),
            newBuildNewStateStep(),
          ],
        },
      ),
    revoke: (input, ctx) =>
      runUnaryChain(
        { chain: "invitation-revoke", step: "RevokeInvitation" },
        method.revoke,
        input,
        ctx,
        deps,
        async (reqCtx) => {
          const invitation = invitationAt(reqCtx, TARGET_RESOURCE_KEY);
          if (invitation.status?.state === InvitationState.revoked) {
            return invitation; // idempotent no-op
          }
          const revoked = clone(InvitationSchema, invitation);
          if (revoked.status !== undefined) {
            revoked.status.state = InvitationState.revoked;
          }
          await deps.store.update(revoked);
          return revoked;
        },
        {
          kind: KIND,
          steps: [newLoadInvitationStep(deps.store, (id) => id.value)],
        },
      ),
    redeem: (input, ctx) =>
      runUnaryChain(
        { chain: "invitation-redeem", step: "RedeemInvitation" },
        method.redeem,
        input,
        ctx,
        deps,
        (reqCtx) => redeemInvitation(reqCtx, deps),
        { kind: KIND, steps: [newRefuseNonPersonCallerStep()] },
      ),
  };
}

export function invitationQueries(deps: InvitationLaneDeps): Queries {
  const method = InvitationQueryController.method;
  return {
    get: (input, ctx) =>
      runUnaryChain(
        { chain: "invitation-get", step: "GetInvitation" },
        method.get,
        input,
        ctx,
        deps,
        (reqCtx) => Promise.resolve(invitationAt(reqCtx, TARGET_RESOURCE_KEY)),
        {
          kind: KIND,
          steps: [newLoadInvitationStep(deps.store, (id) => id.value)],
        },
      ),
    listByOrg: (input, ctx) =>
      runUnaryChain(
        { chain: "invitation-list-by-org", step: "ListInvitations" },
        method.listByOrg,
        input,
        ctx,
        deps,
        async (reqCtx) => {
          const { org, pageSize, pageToken } = reqCtx.input;
          const page = await readPage<Invitation>({
            source: (after, limit) => deps.store.pageByOrg(org, after, limit),
            request: { pageSize, pageToken },
            fingerprint: listPageFingerprint({ org }),
            decode: (data) => fromBinary(InvitationSchema, data),
            scope: (rows) =>
              restrictListByReadScope(deps.listReadScope, reqCtx.callerIdentity, KIND, rows, org),
            failure: "failed to list invitations",
          });
          return create(InvitationsSchema, {
            entries: page.entries,
            nextPageToken: page.nextPageToken,
          });
        },
      ),
    getByToken: (input, ctx) =>
      runUnaryChain(
        { chain: "invitation-get-by-token", step: "PreviewInvitation" },
        method.getByToken,
        input,
        ctx,
        deps,
        (reqCtx) => previewInvitation(reqCtx.input.token, deps),
      ),
  };
}

export function newInvitationRegistrations(
  deps: InvitationLaneDeps,
): ReadonlyArray<ExtensionServiceRegistration> {
  return [
    (router) => router.service(InvitationCommandController, invitationCommands(deps)),
    (router) => router.service(InvitationQueryController, invitationQueries(deps)),
  ];
}

/**
 * The create's domain step over BuildNewState's row (the minted id, the
 * stamped audit): the validation, the token and the lifecycle, the row,
 * then the creation event.
 */
async function createInvitation(
  reqCtx: RequestContext<typeof InvitationCommandController.method.create.input>,
  deps: InvitationLaneDeps,
): Promise<Invitation> {
  const invitation = reqCtx.newState;
  validateInvitationSpec(invitation);
  if (invitation.spec?.role === IamRole.owner) {
    await refuseUnlessOwner(deps.authorizer, reqCtx.callerIdentity, invitation.metadata?.org ?? "");
  }
  invitation.apiVersion = "iam.stigmer.ai/v1";
  invitation.kind = "Invitation";
  // BuildNewState stamped the audit into the status; the lane's own
  // fields join it rather than replace it.
  const status = invitation.status ?? create(InvitationStatusSchema);
  status.token = generateInvitationToken();
  status.state = InvitationState.active;
  status.redemptionCount = 0;
  status.redemptions = [];
  invitation.status = status;
  await deps.store.save(invitation);
  const event = resolveResourceCreatedEvent(KIND, invitation, reqCtx.callerIdentity, deps.logger);
  if (event !== undefined) {
    try {
      await deps.lifecycle.onResourceCreated(event);
    } catch (error) {
      throw internalError(error, "failed to create authorization tuples");
    }
  }
  return invitation;
}

/**
 * The redemption, for a caller the chain has already admitted as a person:
 * the row by token, its validity, its organization, the caller's standing,
 * then the record before the grant (store.ts holds the guarded atomic
 * write and its release).
 */
async function redeemInvitation(
  reqCtx: RequestContext<typeof InvitationCommandController.method.redeem.input>,
  deps: InvitationLaneDeps,
): Promise<Invitation> {
  const caller = reqCtx.callerIdentity;
  const invitation = await deps.store.findByToken(reqCtx.input.token);
  if (invitation === undefined) {
    throw new ConnectError("Invitation not found", Code.NotFound);
  }
  const invitationId = invitation.metadata?.id ?? "";
  const org = invitation.metadata?.org ?? "";

  const refusal =
    rowRefusal(invitation) ??
    organizationRefusal(invitation, await deps.organizations.find(org));
  if (refusal !== undefined) {
    throw new ConnectError(refusal, Code.FailedPrecondition);
  }
  if (!(await creatorCouldStillCreate(deps.authorizationQueries, invitation, org))) {
    throw new ConnectError(CREATOR_NO_LONGER_GRANTS, Code.FailedPrecondition);
  }

  refuseBoundElsewhere(deps.credentialBinding, caller, org);
  await refuseRequiredSignIn(deps.credentialBinding, caller, org);
  await refuseExistingMember(deps.authorizer, caller, org);

  // Record before grant: a lost slot then has nothing to undo, so no
  // redemption ever revokes a role row another one stands on (the header).
  const redeemedAt = new Date();
  const recorded = await deps.store.recordRedemption(invitationId, caller.identityId, redeemedAt);
  if (recorded.kind === "refused") {
    const current = await deps.store.findById(invitationId);
    const currentState = current?.status?.state ?? InvitationState.invitation_state_unspecified;
    throw new ConnectError(
      refusalReason(
        currentState === InvitationState.active ? InvitationState.fully_redeemed : currentState,
      ),
      Code.FailedPrecondition,
    );
  }

  const role = create(IamPolicySpecSchema, {
    principal: create(ApiResourceRefSchema, {
      kind: "identity_account",
      id: caller.identityId,
    }),
    relation: IamRole[invitation.spec?.role ?? IamRole.iam_role_unspecified],
    resource: create(ApiResourceRefSchema, { kind: "organization", id: org }),
  });
  // The inviter decided this grant; the redeemer only accepted it. So the
  // grant acts for the inviter, and the permission history never reads as
  // a person granting themselves a role.
  const inviter = invitation.status?.audit?.specAudit?.createdBy?.id ?? "";
  try {
    await deps.policies.create(role, inviter);
  } catch (grantError) {
    try {
      const released = await deps.store.releaseRedemption(invitationId, caller.identityId, redeemedAt);
      if (released.kind === "absent") {
        // The row, or this redemption's entry, went away between the
        // record and the release (a delete, a hand edit): nothing to undo,
        // but the trace is what finds a ledger that disagrees.
        deps.logger.warn("a failed grant found no redemption to release", {
          invitationId,
          caller: caller.identityId,
          org,
        });
      }
    } catch (releaseError) {
      deps.logger.error(
        "releasing a redemption FAILED after its grant failed — reconcile manually",
        {
          invitationId,
          caller: caller.identityId,
          org,
          grantError: grantError instanceof Error ? grantError.message : String(grantError),
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        },
      );
      throw new ConnectError("Failed to record invitation redemption", Code.Internal);
    }
    throw grantError;
  }
  return recorded.invitation; // the persisted post-image, truthful under interleaving
}

/**
 * The unauthenticated preview: display fields and validity only, where
 * valid asks what redeem asks before it grants (the row, its
 * organization, its creator's standing), so the page never calls a link
 * valid that redeem refuses. Each read degrades when it faults: the
 * organization's to its id for display, and either one to the validity
 * the remaining answers give, so the page stays serveable; the redemption
 * itself fails closed on the same fault. An unknown token asks nothing.
 */
async function previewInvitation(
  token: string,
  deps: InvitationLaneDeps,
): Promise<InvitationPreview> {
  const invitation = await deps.store.findByToken(token);
  if (invitation === undefined) {
    throw new ConnectError("Invitation not found", Code.NotFound);
  }
  const org = invitation.metadata?.org ?? "";
  let organization: OrganizationFacts | undefined;
  let organizationKnown = true;
  try {
    organization = await deps.organizations.find(org);
  } catch (error) {
    organizationKnown = false;
    deps.logger.warn("invitation preview could not read its organization; showing the row's own validity", {
      org,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const reason =
    rowRefusal(invitation) ??
    (organizationKnown ? organizationRefusal(invitation, organization) : undefined) ??
    (await previewCreatorRefusal(invitation, org, deps));
  return create(InvitationPreviewSchema, {
    orgName: organization?.name !== undefined && organization.name !== "" ? organization.name : org,
    orgSlug: organization?.slug !== undefined && organization.slug !== "" ? organization.slug : org,
    orgLogoUrl: organization?.logoUrl ?? "",
    role: invitation.spec?.role ?? IamRole.iam_role_unspecified,
    expiresAt: invitation.spec?.expiresAt,
    label: invitation.spec?.label ?? "",
    isValid: reason === undefined,
    invalidReason: reason ?? "",
  });
}

/** The creator's-standing arm of the preview, degrading to no refusal when the engine faults. */
async function previewCreatorRefusal(
  invitation: Invitation,
  org: string,
  deps: InvitationLaneDeps,
): Promise<string | undefined> {
  try {
    return (await creatorCouldStillCreate(deps.authorizationQueries, invitation, org))
      ? undefined
      : CREATOR_NO_LONGER_GRANTS;
  } catch (error) {
    deps.logger.warn("invitation preview could not verify its creator's standing; showing the row's own validity", {
      org,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// The validation and helper arms.
// ---------------------------------------------------------------------------

/**
 * The single source of redemption-refusal copy, shared by the redemption,
 * its lost-race arm and the preview so the three never drift.
 */
function refusalReason(state: InvitationState): string {
  switch (state) {
    case InvitationState.revoked:
      return "This invitation has been revoked";
    case InvitationState.fully_redeemed:
      return "This invitation has reached its maximum number of uses";
    case InvitationState.expired:
      return "This invitation has expired";
    default:
      return "This invitation is no longer valid";
  }
}

/** Why the row itself cannot be redeemed (its state, expiry or uses), or undefined. */
export function rowRefusal(invitation: Invitation): string | undefined {
  const state = invitation.status?.state;
  if (state !== InvitationState.active) {
    return refusalReason(state ?? InvitationState.invitation_state_unspecified);
  }
  const expiresAt = invitation.spec?.expiresAt;
  if (expiresAt !== undefined && timestampDate(expiresAt).getTime() <= Date.now()) {
    return refusalReason(InvitationState.expired);
  }
  const maxRedemptions = invitation.spec?.maxRedemptions ?? 0;
  if (maxRedemptions > 0 && (invitation.status?.redemptionCount ?? 0) >= maxRedemptions) {
    return refusalReason(InvitationState.fully_redeemed);
  }
  return undefined;
}

/**
 * Why the row may not open the organization it names, or undefined: the
 * organization is gone, or younger than the row (its slug was freed and
 * taken again), or the row carries no creation time to compare.
 */
function organizationRefusal(
  invitation: Invitation,
  organization: OrganizationFacts | undefined,
): string | undefined {
  return orphanReason(invitation, organization) === undefined
    ? undefined
    : refusalReason(InvitationState.invitation_state_unspecified);
}

/** An owner link needs an owner's authority: `can_assign_roles` on the organization. */
async function refuseUnlessOwner(
  authorizer: Authorizer,
  caller: CallerIdentity,
  org: string,
): Promise<void> {
  const decision = await authorizer.authorize(caller, {
    permission: IamPermission.can_assign_roles,
    resourceKind: ApiResourceKind.organization,
    resourceId: org,
  });
  switch (decision.kind) {
    case "allow":
      return;
    case "deny":
      throw deniedError(decision, OWNER_ASSIGNMENT_DENIED_MESSAGE);
    case "not-found":
      throw new ConnectError(OWNER_ASSIGNMENT_DENIED_MESSAGE, Code.PermissionDenied);
    case "unavailable":
      throw internalError(decision.cause, "failed to verify the owner role");
    default: {
      const exhaustive: never = decision;
      throw new Error(`unknown decision ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Whether the invitation's creator could create it now: `can_grant_access`
 * on its organization, and `can_assign_roles` too for an owner link. A row
 * that records no creator cannot be vouched for.
 */
async function creatorCouldStillCreate(
  queries: Pick<AuthorizationQueryEngine, "check">,
  invitation: Invitation,
  org: string,
): Promise<boolean> {
  const creator = invitation.status?.audit?.specAudit?.createdBy?.id ?? "";
  if (creator === "") {
    return false;
  }
  const needs =
    invitation.spec?.role === IamRole.owner
      ? [IamPermission.can_grant_access, IamPermission.can_assign_roles]
      : [IamPermission.can_grant_access];
  for (const permission of needs) {
    const holds = await queries.check(
      create(IamPolicySpecSchema, {
        principal: create(ApiResourceRefSchema, { kind: "identity_account", id: creator }),
        relation: IamPermission[permission],
        resource: create(ApiResourceRefSchema, { kind: "organization", id: org }),
      }),
      [],
    );
    if (!holds) {
      return false;
    }
  }
  return true;
}

/**
 * Refuses a caller whose credential is bound to another organization than
 * the invitation's (the composition's credential binding: such a
 * credential joins nothing). Asked after the link's own validity, which
 * reads the same for every caller and which the public preview answers
 * anyway.
 */
function refuseBoundElsewhere(
  binding: Pick<CredentialBinding, "admitsOrganization">,
  caller: CallerIdentity,
  org: string,
): void {
  if (!binding.admitsOrganization(caller, org)) {
    throw new ConnectError(BOUND_CREDENTIAL_REDEEMS_ELSEWHERE, Code.PermissionDenied);
  }
}

/**
 * Refuses a person the organization's sign-in rule refuses (an
 * organization that requires sign-in through its SSO provider, redeemed by
 * an account another sign-in made), with the rule's own reason, before
 * anything is written: a role granted to that account could never be used
 * there. Asked after the binding, before membership, which the rule's
 * refusal would otherwise read as "not a member".
 */
async function refuseRequiredSignIn(
  binding: Pick<CredentialBinding, "signInRefusal">,
  caller: CallerIdentity,
  org: string,
): Promise<void> {
  let refusal: AuthzRefusal | undefined;
  try {
    refusal = await binding.signInRefusal(caller, org);
  } catch (error) {
    throw internalError(error, "failed to verify the organization's sign-in requirement");
  }
  if (refusal !== undefined) {
    throw permissionDeniedWithReasonError(refusal.message, {
      reason: refusal.reason,
      metadata: refusal.metadata,
    });
  }
}

/** `can_view` is the lowest organization permission: any existing role trips it. */
async function refuseExistingMember(
  authorizer: Authorizer,
  caller: CallerIdentity,
  org: string,
): Promise<void> {
  const decision = await authorizer.authorize(caller, {
    permission: IamPermission.can_view,
    resourceKind: ApiResourceKind.organization,
    resourceId: org,
  });
  switch (decision.kind) {
    case "allow":
      throw new ConnectError("You are already a member of this organization", Code.AlreadyExists);
    case "deny":
    case "not-found":
      return;
    case "unavailable":
      throw internalError(decision.cause, "failed to verify organization membership");
    default: {
      const exhaustive: never = decision;
      throw new Error(`unknown decision ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The create's business rules, with the lane's pinned copy. */
function validateInvitationSpec(invitation: Invitation): void {
  const spec = invitation.spec;
  const role = spec?.role ?? IamRole.iam_role_unspecified;
  if (role === IamRole.iam_role_unspecified) {
    throw new ConnectError("Invitation role is required", Code.InvalidArgument);
  }
  const grantable = grantableRolesFor(ApiResourceKind.organization);
  if (!grantable.includes(role)) {
    const allowed = grantable.map((entry) => IamRole[entry]).join(", ");
    throw new ConnectError(
      `Role '${IamRole[role]}' cannot be granted on organizations. ` +
        `Grantable roles: [${allowed}]`,
      Code.InvalidArgument,
    );
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = Number(spec?.expiresAt?.seconds ?? 0n);
  if (expiresAtSeconds <= nowSeconds) {
    throw new ConnectError("Invitation expiration must be in the future", Code.InvalidArgument);
  }
  if (expiresAtSeconds - nowSeconds > MAX_EXPIRY_SECONDS) {
    throw new ConnectError(
      "Invitation expiration cannot exceed 30 days from now",
      Code.InvalidArgument,
    );
  }
  if ((spec?.maxRedemptions ?? 0) < 0) {
    throw new ConnectError(
      "max_redemptions must be 0 (unlimited) or a positive integer",
      Code.InvalidArgument,
    );
  }
}

/**
 * 16 random bytes (128-bit entropy), Base62-encoded: no ambiguous
 * characters, selectable with a double click.
 */
export function generateInvitationToken(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let value = BigInt(`0x${randomBytes(16).toString("hex")}`);
  if (value === 0n) {
    return "0";
  }
  let token = "";
  while (value > 0n) {
    token = alphabet[Number(value % 62n)] + token;
    value /= 62n;
  }
  return token;
}
