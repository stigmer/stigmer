/**
 * The access move: a person who worked in an organization under one
 * sign-in (an email login) moves their access there to the account the
 * organization's SSO provider signs them in as. Two RPCs on the
 * identity-provider command service, the kind that owns SSO trust:
 *
 *   createAccessMove   asked while signed in the old way. It answers a
 *                      single-use ticket for this account and this
 *                      organization, ten minutes long, with what the move
 *                      will do (the library's move door previewed: the
 *                      access that moves, the My vault entries it deletes,
 *                      the automations that stop) and the open invitations
 *                      the account created there, which stop too;
 *   redeemAccessMove   asked once signed in through the organization's SSO
 *                      provider, as the account it made. The ticket's
 *                      account's access moves to the caller through the
 *                      library's move door, acting for the caller, so the
 *                      permission history records each change as moved and
 *                      names who received it.
 *
 * Why a ticket, and why it is the authorization. The two sessions belong
 * to one person but to two accounts, and neither credential can speak for
 * the other: the email session cannot act in an organization that requires
 * SSO, and the SSO session does not hold the email account. The ticket is
 * what the email session hands the SSO session in the same browser, as an
 * invitation's token is what an inviter hands an invitee. Only its hash is
 * kept (iam/access-move/store.ts); a console keeps the ticket out of every
 * URL and log, and the redeemer must be the organization's SSO account, so a
 * ticket alone moves nothing to anyone else.
 *
 * What never moves, by the door's own rule (@stigmer/server's
 * bootstrapMoveOrgAccess): an owner's access (owners are exempt from the
 * requirement and keep their own sign-in, so the ticket is refused), API
 * keys (credentials: the person makes new ones), anything outside the
 * organization, and the creation stamps that say who made a resource. The
 * old account's My vault there is deleted by its departure, which the
 * preview shows first.
 *
 * A move that stops partway (a fault between grants) leaves both accounts
 * holding what was granted so far; the same ticket redeems again while it
 * lasts and completes the move, and the ticket closes only once a move has
 * completed. Two redemptions racing on one ticket both complete the same
 * move.
 *
 * What the tests pin (__tests__/handlers.test.ts): the refusals of each
 * RPC (a non-person, a federated caller asking, an organization with no
 * SSO provider, nothing to move, an owner, an unknown, expired or
 * redeemed ticket, a redeemer the provider did not sign in), the hash kept
 * and never the ticket, the preview and invitations answered, the move
 * acting for the redeemer, and a second redeem completing an interrupted
 * move.
 */
import { createHash, randomBytes } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type {
  AccessMoveRequestSchema,
  AccessMoveResult,
  AccessMoveTicket,
  RedeemAccessMoveInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import {
  AccessMoveResultSchema,
  AccessMoveTicketSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import type { CallerIdentity, IdentityAccountStore, Logger, RequestContext } from "@stigmer/server";

import { rowRefusal } from "../invitation/handlers.js";
import type { InvitationStore } from "../invitation/store.js";
import type { IamPolicyGrantPathClient } from "../policy/grant-path-client.js";
import { requireLiveSsoProvider, ssoProviderInfoOf } from "../provider/sso-info.js";
import type { SsoProviderReads } from "../provider/sso-info.js";
import type { AccessMoveTicketStore } from "./store.js";

/** How long a ticket works. */
export const ACCESS_MOVE_TICKET_TTL_MS = 10 * 60 * 1000;

/** A caller that is not a person (a service account, a run, the platform's pipelines). */
export const ONLY_A_PERSON_MOVES_MESSAGE = "Only a person signed in as themselves can move their access";

/** createAccessMove asked by an account an SSO provider made. */
export const ALREADY_SSO_ACCOUNT_MESSAGE =
  "You signed in through an SSO provider; sign in the way you used before to move that account's access here";

/** createAccessMove asked by an account that holds nothing in the organization. */
export const NOTHING_TO_MOVE_MESSAGE = "You hold no access in this organization to move";

/** redeemAccessMove with a ticket that is unknown, expired or used. */
export const TICKET_NOT_VALID_MESSAGE = "This access move is no longer valid; start it again";

/** redeemAccessMove by anyone but the organization's SSO account. */
export function redeemThroughProviderMessage(providerDisplayName: string): string {
  return `Finish moving your access while signed in through ${providerDisplayName === "" ? "the organization's SSO provider" : providerDisplayName}`;
}

export interface AccessMoveDeps extends SsoProviderReads {
  readonly tickets: AccessMoveTicketStore;
  readonly accounts: Pick<IdentityAccountStore, "findById">;
  readonly policies: Pick<IamPolicyGrantPathClient, "bootstrapMoveOrgAccess">;
  readonly invitations: Pick<InvitationStore, "findIdsByOrg" | "findById">;
  readonly logger: Logger;
  /** Milliseconds since the epoch; a test passes its own clock. */
  readonly nowMs?: () => number;
}

/** createAccessMove's domain step. */
export async function createAccessMove(
  reqCtx: RequestContext<typeof AccessMoveRequestSchema>,
  deps: AccessMoveDeps,
): Promise<AccessMoveTicket> {
  const caller = requirePerson(reqCtx.callerIdentity);
  const org = reqCtx.input.org;
  const provider = await requireLiveSsoProvider(deps, org);
  const account = await deps.accounts.findById(caller.identityId);
  if (account === undefined) {
    throw new ConnectError(ONLY_A_PERSON_MOVES_MESSAGE, Code.PermissionDenied);
  }
  if (federatedProviderOf(account) !== "") {
    throw new ConnectError(ALREADY_SSO_ACCOUNT_MESSAGE, Code.FailedPrecondition);
  }
  // The door refuses an owner of the organization (FAILED_PRECONDITION).
  const preview = await deps.policies.bootstrapMoveOrgAccess(
    { fromIdentityAccountId: caller.identityId, toIdentityAccountId: "", org, previewOnly: true },
    caller.identityId,
  );
  if (preview.movedPolicies === 0) {
    throw new ConnectError(NOTHING_TO_MOVE_MESSAGE, Code.FailedPrecondition);
  }
  const invitationIds = await openInvitationsCreatedBy(deps, org, caller.identityId);
  const now = nowOf(deps);
  await sweepExpired(deps, now);
  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ACCESS_MOVE_TICKET_TTL_MS);
  await deps.tickets.insert({ tokenHash: hashOf(ticket), accountId: caller.identityId, org, expiresAt });
  deps.logger.info("access move ticket issued", {
    org,
    identityAccountId: caller.identityId,
    movedPolicies: String(preview.movedPolicies),
  });
  return create(AccessMoveTicketSchema, {
    ticket,
    expiresAt: timestampFromDate(expiresAt),
    org,
    provider: ssoProviderInfoOf(provider),
    preview,
    invitationIds: [...invitationIds],
  });
}

/** redeemAccessMove's domain step. */
export async function redeemAccessMove(
  reqCtx: RequestContext<typeof RedeemAccessMoveInputSchema>,
  deps: AccessMoveDeps,
): Promise<AccessMoveResult> {
  const caller = requirePerson(reqCtx.callerIdentity);
  const tokenHash = hashOf(reqCtx.input.ticket);
  const now = nowOf(deps);
  const ticket = await deps.tickets.findByHash(tokenHash);
  if (ticket === undefined || ticket.redeemedAt !== undefined || ticket.expiresAt.getTime() <= now.getTime()) {
    throw new ConnectError(TICKET_NOT_VALID_MESSAGE, Code.FailedPrecondition);
  }
  const provider = await requireLiveSsoProvider(deps, ticket.org);
  const account = await deps.accounts.findById(caller.identityId);
  if (account === undefined || federatedProviderOf(account) !== (provider.metadata?.id ?? "")) {
    throw new ConnectError(
      redeemThroughProviderMessage(provider.spec?.displayName ?? ""),
      Code.PermissionDenied,
    );
  }
  // Read before the move: the old account's role, which the creator check
  // of each invitation stands on, is gone once it has moved.
  const invitationIds = await openInvitationsCreatedBy(deps, ticket.org, ticket.accountId);
  const moved = await deps.policies.bootstrapMoveOrgAccess(
    {
      fromIdentityAccountId: ticket.accountId,
      toIdentityAccountId: caller.identityId,
      org: ticket.org,
      previewOnly: false,
    },
    caller.identityId,
  );
  await deps.tickets.markRedeemed(tokenHash, now);
  deps.logger.info("access moved to an SSO account", {
    org: ticket.org,
    fromIdentityAccountId: ticket.accountId,
    toIdentityAccountId: caller.identityId,
    movedPolicies: String(moved.movedPolicies),
  });
  return create(AccessMoveResultSchema, { org: ticket.org, moved, invitationIds: [...invitationIds] });
}

/** The provider an account was made by, its id; "" for an account no provider made. */
function federatedProviderOf(account: IdentityAccount): string {
  return account.spec?.identityProviderRef?.id ?? "";
}

function requirePerson(caller: CallerIdentity): CallerIdentity {
  if (caller.callerClass !== "user" || caller.identityId === "") {
    throw new ConnectError(ONLY_A_PERSON_MOVES_MESSAGE, Code.PermissionDenied);
  }
  return caller;
}

/** The organization's invitations `accountId` created that could still be redeemed. */
export async function openInvitationsCreatedBy(
  deps: Pick<AccessMoveDeps, "invitations">,
  org: string,
  accountId: string,
): Promise<ReadonlyArray<string>> {
  const open: string[] = [];
  for (const id of await deps.invitations.findIdsByOrg(org)) {
    const invitation = await deps.invitations.findById(id);
    if (
      invitation !== undefined &&
      invitation.status?.audit?.specAudit?.createdBy?.id === accountId &&
      rowRefusal(invitation) === undefined
    ) {
      open.push(id);
    }
  }
  return open;
}

/** The ticket as the table keys it: never the ticket itself. */
function hashOf(ticket: string): string {
  return createHash("sha256").update(ticket, "utf8").digest("hex");
}

function nowOf(deps: Pick<AccessMoveDeps, "nowMs">): Date {
  return new Date((deps.nowMs ?? Date.now)());
}

/** Best-effort: a failed sweep leaves expired rows for the next ticket's, and never refuses this one. */
async function sweepExpired(deps: AccessMoveDeps, now: Date): Promise<void> {
  try {
    await deps.tickets.deleteExpired(now);
  } catch (error) {
    deps.logger.warn("expired access move tickets were not swept", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
