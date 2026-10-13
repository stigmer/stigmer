/**
 * Pins the access move (../handlers.ts): a person's access in one
 * organization moves from the account another sign-in made to the account
 * the organization's SSO provider made, by a single-use ticket.
 *
 *   - createAccessMove answers a ticket for the caller and the organization,
 *     ten minutes long, with the library door's preview, the invitations
 *     the caller created there and the provider to sign in through; only
 *     the ticket's hash is kept, and expired tickets are swept;
 *   - only a person's own sign-in session may ask or redeem: never an API
 *     key, a request the server composes, or a credential bound to another
 *     organization (a leaked key must not move its owner's access);
 *   - it refuses a caller that is not a person, an account a provider made,
 *     an organization with no SSO provider, and a caller with nothing to
 *     move; the door's owner refusal reaches the caller unchanged;
 *   - redeemAccessMove moves the ticket's account's access to the caller
 *     through the door, acting for the caller, and closes the ticket;
 *   - it refuses an unknown, expired or redeemed ticket, and a redeemer the
 *     organization's provider did not make, leaving the ticket usable;
 *   - a move that stopped partway redeems again with the same ticket;
 *   - the first account to redeem a ticket holds it: another account the
 *     same provider made is refused before anything moves.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageInitShape } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { MoveOrgAccessResult } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { MoveOrgAccessResultSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import {
  AccessMoveRequestSchema,
  RedeemAccessMoveInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/enum_pb";
import type { CallerIdentity } from "@stigmer/server";
import { createLogger, RequestContext } from "@stigmer/server";

import type { MoveOrgAccessRequest } from "../../policy/grant-path-client.js";
import { InMemoryProviderStore, storedProvider } from "../../provider/__tests__/in-memory-provider-store.js";
import { NO_SSO_PROVIDER_MESSAGE } from "../../provider/sso-info.js";
import {
  ACCESS_MOVE_TICKET_TTL_MS,
  ALREADY_SSO_ACCOUNT_MESSAGE,
  NOTHING_TO_MOVE_MESSAGE,
  ONLY_A_PERSON_MOVES_MESSAGE,
  TICKET_NOT_VALID_MESSAGE,
  createAccessMove,
  redeemAccessMove,
  redeemThroughProviderMessage,
} from "../handlers.js";
import type { AccessMoveDeps } from "../handlers.js";
import { newInMemoryTicketStore } from "./in-memory-ticket-store.js";
import type { InMemoryTicketStore } from "./in-memory-ticket-store.js";

const ACME = "org_acme";
const EMAIL = "ida_raj_email";
const SSO = "ida_raj_sso";
const STRANGER_SSO = "ida_other_sso";
/** Another account Acme's provider made: someone else's. */
const COLLEAGUE_SSO = "ida_mia_sso";
const NOW = new Date("2026-10-13T12:00:00Z");

const silent = createLogger({ level: "error", pretty: false, write: () => {} });

function account(id: string, providerId = ""): IdentityAccount {
  return create(IdentityAccountSchema, {
    metadata: { id },
    spec: {
      idpId: `sub|${id}`,
      ...(providerId === "" ? {} : { identityProviderRef: { id: providerId, org: ACME } }),
    },
  });
}

function invitation(id: string, createdBy: string, state = InvitationState.active): Invitation {
  return create(InvitationSchema, {
    metadata: { id, org: ACME },
    status: { state, audit: { specAudit: { createdBy: { id: createdBy } } } },
  });
}

function preview(moved: number): MoveOrgAccessResult {
  return create(MoveOrgAccessResultSchema, {
    movedPolicies: moved,
    myVaultEntries: ["GITHUB_TOKEN"],
    automations: [{ kind: "schedule", id: "sch_1", slug: "nightly", name: "Nightly" }],
  });
}

interface Rig {
  readonly deps: AccessMoveDeps;
  readonly tickets: InMemoryTicketStore;
  readonly moves: Array<{ readonly move: MoveOrgAccessRequest; readonly actingFor: string | undefined }>;
  now: Date;
  /** What the door answers next: a result or a fault. */
  door: (move: MoveOrgAccessRequest) => Promise<MoveOrgAccessResult>;
}

async function rig(options: { readonly sso?: boolean } = {}): Promise<Rig> {
  const providers = new InMemoryProviderStore();
  if (options.sso !== false) {
    await providers.insert(storedProvider({ id: "idp_acme", org: ACME, slug: "acme-okta", isSso: true }));
  }
  const accounts = [
    account(EMAIL),
    account(SSO, "idp_acme"),
    account(STRANGER_SSO, "idp_elsewhere"),
    account(COLLEAGUE_SSO, "idp_acme"),
  ];
  const invitations = [
    invitation("inv_open", EMAIL),
    invitation("inv_revoked", EMAIL, InvitationState.revoked),
    invitation("inv_ana", "ida_ana"),
  ];
  const tickets = newInMemoryTicketStore();
  const moves: Rig["moves"] = [];
  const knobs: Pick<Rig, "now" | "door"> = { now: NOW, door: () => Promise.resolve(preview(3)) };
  const deps: AccessMoveDeps = {
    store: providers,
    organizations: {
      find: () =>
        Promise.resolve({
          createdAt: new Date("2026-01-01T00:00:00Z"),
          name: "Acme",
          slug: "acme",
          logoUrl: "",
          parentOrg: "",
        }),
    },
    tickets,
    accounts: { findById: (id) => Promise.resolve(accounts.find((held) => held.metadata?.id === id)) },
    policies: {
      bootstrapMoveOrgAccess: (move, actingFor) => {
        moves.push({ move, actingFor });
        return knobs.door(move);
      },
    },
    invitations: {
      findIdsByOrg: () => Promise.resolve(invitations.map((held) => held.metadata?.id ?? "")),
      findById: (id) => Promise.resolve(invitations.find((held) => held.metadata?.id === id)),
    },
    logger: silent,
    nowMs: () => knobs.now.getTime(),
  };
  return Object.assign(knobs, { deps, tickets, moves });
}

function person(identityId: string, callerClass = "user"): CallerIdentity {
  return { identityId, callerClass, issuer: "", rawToken: "" };
}

function context<Desc extends DescMessage>(
  schema: Desc,
  init: MessageInitShape<Desc>,
  caller: CallerIdentity,
): RequestContext<Desc> {
  return new RequestContext(schema, create(schema, init), caller, ApiResourceKind.identity_provider);
}

function ask(r: Rig, caller: CallerIdentity, org = ACME) {
  return createAccessMove(context(AccessMoveRequestSchema, { org }, caller), r.deps);
}

function redeem(r: Rig, caller: CallerIdentity, ticket: string) {
  return redeemAccessMove(context(RedeemAccessMoveInputSchema, { ticket }, caller), r.deps);
}

async function refusal(work: Promise<unknown>): Promise<ConnectError> {
  try {
    await work;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

const hashOf = (ticket: string) => createHash("sha256").update(ticket, "utf8").digest("hex");

describe("createAccessMove", () => {
  it("answers a ticket for the caller and the organization, with what the move will do, keeping only its hash", async () => {
    const r = await rig();
    const ticket = await ask(r, person(EMAIL));
    expect(ticket.org).toBe(ACME);
    expect(ticket.provider?.displayName).toBe("acme-okta");
    expect(ticket.preview?.movedPolicies).toBe(3);
    expect(ticket.preview?.myVaultEntries).toEqual(["GITHUB_TOKEN"]);
    expect(ticket.invitationIds).toEqual(["inv_open"]);
    expect(timestampDate(ticket.expiresAt!).getTime()).toBe(NOW.getTime() + ACCESS_MOVE_TICKET_TTL_MS);
    expect(r.moves).toEqual([
      { move: { fromIdentityAccountId: EMAIL, toIdentityAccountId: "", org: ACME, previewOnly: true }, actingFor: EMAIL },
    ]);
    expect([...r.tickets.rows.keys()]).toEqual([hashOf(ticket.ticket)]);
    expect(r.tickets.rows.get(hashOf(ticket.ticket))).toMatchObject({ accountId: EMAIL, org: ACME });
  });

  it("issues the ticket when the sweep of expired ones fails, and says so in the log", async () => {
    const r = await rig();
    r.deps.tickets.deleteExpired = () => Promise.reject(new Error("tickets table locked"));
    const warned: string[] = [];
    const deps = {
      ...r.deps,
      logger: createLogger({ level: "warn", pretty: false, write: (line: string) => void warned.push(line) }),
    };
    const ticket = await createAccessMove(context(AccessMoveRequestSchema, { org: ACME }, person(EMAIL)), deps);
    expect(r.tickets.rows.has(hashOf(ticket.ticket))).toBe(true);
    expect(warned.join("\n")).toContain("expired access move tickets were not swept");
  });

  it("sweeps tickets that expired", async () => {
    const r = await rig();
    await r.tickets.insert({ tokenHash: "old", accountId: EMAIL, org: ACME, expiresAt: new Date(NOW.getTime() - 1) });
    await ask(r, person(EMAIL));
    expect(r.tickets.rows.has("old")).toBe(false);
  });

  it.each([
    ["a service account", person(EMAIL, "service_account"), Code.PermissionDenied, ONLY_A_PERSON_MOVES_MESSAGE],
    ["an API key", { ...person(EMAIL), rawToken: "stk_leaked" }, Code.PermissionDenied, ONLY_A_PERSON_MOVES_MESSAGE],
    ["a credential bound to another organization", { ...person(EMAIL), boundOrg: "org_globex" }, Code.PermissionDenied, ONLY_A_PERSON_MOVES_MESSAGE],
    ["a request the server composes", { ...person(EMAIL), origin: "in-process" as const }, Code.PermissionDenied, ONLY_A_PERSON_MOVES_MESSAGE],
    ["an account an SSO provider made", person(SSO), Code.FailedPrecondition, ALREADY_SSO_ACCOUNT_MESSAGE],
    ["an account this server does not hold", person("ida_gone"), Code.PermissionDenied, ONLY_A_PERSON_MOVES_MESSAGE],
  ])("refuses %s", async (_case, caller, code, copy) => {
    const r = await rig();
    const error = await refusal(ask(r, caller));
    expect(error.code).toBe(code);
    expect(error.rawMessage).toBe(copy);
    expect(r.tickets.rows.size).toBe(0);
  });

  it("refuses an organization with no SSO provider, with the copy that names none", async () => {
    const r = await rig({ sso: false });
    const error = await refusal(ask(r, person(EMAIL)));
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe(NO_SSO_PROVIDER_MESSAGE);
  });

  it("refuses a caller with nothing to move, and passes the door's owner refusal through", async () => {
    const r = await rig();
    r.door = () => Promise.resolve(preview(0));
    const nothing = await refusal(ask(r, person(EMAIL)));
    expect(nothing.code).toBe(Code.FailedPrecondition);
    expect(nothing.rawMessage).toBe(NOTHING_TO_MOVE_MESSAGE);

    r.door = () => Promise.reject(new ConnectError("an owner keeps their own sign-in", Code.FailedPrecondition));
    const owner = await refusal(ask(r, person(EMAIL)));
    expect(owner.code).toBe(Code.FailedPrecondition);
    expect(r.tickets.rows.size).toBe(0);
  });
});

describe("redeemAccessMove", () => {
  it("moves the ticket's account's access to the caller, acting for the caller, and closes the ticket", async () => {
    const r = await rig();
    const ticket = await ask(r, person(EMAIL));
    r.moves.length = 0;
    const result = await redeem(r, person(SSO), ticket.ticket);
    expect(result.org).toBe(ACME);
    expect(result.moved?.movedPolicies).toBe(3);
    expect(result.invitationIds).toEqual(["inv_open"]);
    expect(r.moves).toEqual([
      { move: { fromIdentityAccountId: EMAIL, toIdentityAccountId: SSO, org: ACME, previewOnly: false }, actingFor: SSO },
    ]);
    const closed = await refusal(redeem(r, person(SSO), ticket.ticket));
    expect(closed.code).toBe(Code.FailedPrecondition);
    expect(closed.rawMessage).toBe(TICKET_NOT_VALID_MESSAGE);
  });

  it("refuses an unknown or expired ticket", async () => {
    const r = await rig();
    expect((await refusal(redeem(r, person(SSO), "not-a-ticket"))).rawMessage).toBe(TICKET_NOT_VALID_MESSAGE);
    const ticket = await ask(r, person(EMAIL));
    r.now = new Date(NOW.getTime() + ACCESS_MOVE_TICKET_TTL_MS);
    expect((await refusal(redeem(r, person(SSO), ticket.ticket))).rawMessage).toBe(TICKET_NOT_VALID_MESSAGE);
  });

  it("refuses an API key or a credential bound elsewhere as the redeemer, even one the provider's account made", async () => {
    const r = await rig();
    const ticket = await ask(r, person(EMAIL));
    r.moves.length = 0;
    for (const caller of [{ ...person(SSO), rawToken: "stk_sso_key" }, { ...person(SSO), boundOrg: "org_globex" }]) {
      const error = await refusal(redeem(r, caller, ticket.ticket));
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(ONLY_A_PERSON_MOVES_MESSAGE);
    }
    expect(r.moves).toEqual([]);
    expect((await redeem(r, { ...person(SSO), boundOrg: ACME }, ticket.ticket)).moved?.movedPolicies).toBe(3);
  });

  it("refuses a redeemer the organization's provider did not make, and the ticket stays usable", async () => {
    const r = await rig();
    const ticket = await ask(r, person(EMAIL));
    r.moves.length = 0;
    for (const caller of [person(EMAIL), person(STRANGER_SSO)]) {
      const error = await refusal(redeem(r, caller, ticket.ticket));
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(redeemThroughProviderMessage("acme-okta"));
    }
    expect(r.moves).toEqual([]);
    expect((await redeem(r, person(SSO), ticket.ticket)).moved?.movedPolicies).toBe(3);
  });

  it("redeems again after a move that stopped partway, and closes only once it completed", async () => {
    const r = await rig();
    const ticket = await ask(r, person(EMAIL));
    r.door = () => Promise.reject(new ConnectError("tuple store unavailable", Code.Internal));
    expect((await refusal(redeem(r, person(SSO), ticket.ticket))).code).toBe(Code.Internal);
    expect(r.tickets.rows.get(hashOf(ticket.ticket))?.redeemedAt).toBeUndefined();
    r.door = (move) => Promise.resolve(preview(move.previewOnly ? 0 : 3));
    expect((await redeem(r, person(SSO), ticket.ticket)).moved?.movedPolicies).toBe(3);
    expect(r.tickets.rows.get(hashOf(ticket.ticket))?.redeemedAt).toEqual(NOW);
  });

  it("belongs to its first redeemer: another account the provider made is refused before anything moves", async () => {
    const r = await rig();
    const ticket = await ask(r, person(EMAIL));
    r.door = () => Promise.reject(new ConnectError("tuple store unavailable", Code.Internal));
    await refusal(redeem(r, person(SSO), ticket.ticket));
    r.door = () => Promise.resolve(preview(3));
    r.moves.length = 0;
    const taken = await refusal(redeem(r, person(COLLEAGUE_SSO), ticket.ticket));
    expect(taken.code).toBe(Code.FailedPrecondition);
    expect(taken.rawMessage).toBe(TICKET_NOT_VALID_MESSAGE);
    expect(r.moves).toEqual([]);
    expect((await redeem(r, person(SSO), ticket.ticket)).moved?.movedPolicies).toBe(3);
  });
});
