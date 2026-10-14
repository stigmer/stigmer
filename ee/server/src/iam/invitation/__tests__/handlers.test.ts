/**
 * The Invitation RPCs over a router transport with the serving chain's
 * identity stamp (the FederationIssuer and Team suites' idiom), an
 * in-memory store, a recording authorizer, and recording lifecycle, list
 * scope, grant-path and organization fakes. A host's composed suites prove
 * the same lane over the real model; this one pins the lane's own
 * decisions, in the order a reviewer would ask:
 *
 *   - create mints the id itself whatever the request carried, stamps the
 *     audit, issues a token, writes the row, then fires the creation event
 *     (the organization link; the kind records no owner); it is authorized
 *     as `can_grant_access` on the organization, and an owner link also
 *     asks `can_assign_roles` there, refusing with the library's owner
 *     copy; its business rules answer the lane's pinned copy before any
 *     row; a failed event is INTERNAL with the row in place;
 *   - get authorizes `can_view` on the invitation itself, never on its
 *     organization; list answers only what the list read scope allows,
 *     newest first, a page at a time through the library's page loop: a
 *     positive size answers that page and a token that continues it, 0
 *     answers the default page of 50, never every row, a token is refused
 *     for another
 *     organization, and a caller the scope refuses every row gets an empty
 *     page with a token after examining a bounded number of rows;
 *   - revoke asks `can_edit` on the invitation the request names before
 *     it reads the row, with the lane's copy, so a caller who may not
 *     revoke it is refused alike whether or not the id exists; it is
 *     idempotent, and an unknown id is NOT_FOUND to a caller who may
 *     revoke, as is one deleted between the load and the revoke;
 *   - create refuses an organization's service account, writing nothing;
 *   - redeem admits a person only: every other caller class, a service
 *     account's included, is refused PERMISSION_DENIED before the token is
 *     even looked up;
 *   - redeem refuses a revoked, expired or used-up link, one whose
 *     organization is gone or younger than it, and one whose creator could
 *     no longer create it (no `can_grant_access` on the organization, no
 *     `can_assign_roles` for an owner link, or no creator recorded), before
 *     any grant; a member
 *     is ALREADY_EXISTS; a grant refused for a reason keeps its code, an
 *     unexpected fault is INTERNAL without its cause;
 *   - redeem records before it grants: a lost slot grants and revokes
 *     nothing and answers the honest copy, so a double-clicked single-use
 *     link, or a second link of the same role losing its own last slot,
 *     leaves the person's role in place; a failed grant releases its own
 *     record (count, ledger and latch restored), a release that finds
 *     nothing to undo is logged, and a release that fails too is INTERNAL,
 *     logged for a hand;
 *   - an app user, whose minted token the library binds to the
 *     organization it is for, redeems only into that organization;
 *   - the preview answers the organization's display and the link's
 *     validity, asking what redeem asks before it grants, so a link whose
 *     creator can no longer grant its role previews invalid with redeem's
 *     copy; it degrades to the row's own validity when the organization
 *     read faults, and when the creator's standing cannot be read, with a
 *     warning logged.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
  type Interceptor,
} from "@connectrpc/connect";
import type {
  Authorizer,
  AuthzCheck,
  ListEntryMeta,
  ListReadScope,
  Logger,
  ResourceCreatedEvent,
} from "@stigmer/server";
import {
  boundOrgOf,
  callerIdentityKey,
  createLogger,
  OWNER_ASSIGNMENT_DENIED_MESSAGE,
} from "@stigmer/server";
import { describe, expect, it, vi } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApiResourceAuditActorSchema,
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import type { GrantSpec } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import {
  InvitationSchema,
  InvitationStatusSchema,
} from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationCommandController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/command_pb";
import { InvitationState } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/enum_pb";
import { InvitationQueryController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/query_pb";
import { InvitationSpecSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/spec_pb";
import { IamPermission, IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { OrganizationFacts } from "../../organization-links.js";
import type { GrantPathClient } from "../../grant/grant-path-client.js";
import {
  BOUND_CREDENTIAL_REDEEMS_ELSEWHERE,
  newInvitationRegistrations,
  type InvitationLaneDeps,
} from "../handlers.js";
import { InMemoryInvitationStore } from "./in-memory-invitation-store.js";

const CALLER = "ida_caller";
/** Who made a stored row, unless a case records another or none. */
const CREATOR = "ida_creator";
const DAY_MS = 24 * 60 * 60 * 1000;
const ORG_CREATED = new Date("2026-09-01T00:00:00Z");

const silent: Logger = createLogger({ level: "error", pretty: false, write: () => {} });

function identityInterceptor(
  callerClass: string,
  boundOrg: string | undefined,
  mintedBy: string | undefined,
): Interceptor {
  return (next) => (request) => {
    request.contextValues.set(callerIdentityKey, {
      identityId: CALLER,
      callerClass,
      issuer: "https://issuer.invalid",
      rawToken: "tok",
      ...(boundOrg === undefined ? {} : { boundOrg }),
      ...(mintedBy === undefined ? {} : { mintedBy }),
    });
    return next(request);
  };
}

const acme: OrganizationFacts = {
  createdAt: ORG_CREATED,
  name: "Acme Corp",
  slug: "acme",
  parentOrg: "",
  logoUrl: "https://acme.test/logo.png",
};

interface Rig {
  readonly commands: ReturnType<typeof createClient<typeof InvitationCommandController>>;
  readonly queries: ReturnType<typeof createClient<typeof InvitationQueryController>>;
  readonly store: InMemoryInvitationStore;
  readonly checks: AuthzCheck[];
  readonly created: ResourceCreatedEvent[];
  readonly granted: GrantSpec[];
  /** Whom each grant and revoke acted for. */
  readonly actingFor: Array<string | undefined>;
  readonly revokedOrgAccess: string[];
  readonly revoked: string[];
  /** The role rows standing, as `<principal>#<relation>@<resource>`: a grant adds its triple once, a revoke removes it. */
  readonly held: Set<string>;
  readonly offered: ListEntryMeta[][];
  /** The creator-standing questions redeem asked, as `<relation> <principal>`. */
  readonly creatorChecks: string[];
}

function rig(
  options: {
    decide?: (check: AuthzCheck) => "allow" | "deny";
    onCreated?: () => Promise<void>;
    onGrant?: () => Promise<void>;
    organization?: (org: string) => Promise<OrganizationFacts | undefined>;
    listable?: (id: string) => boolean;
    /** The serving chain's stamp; a person (`user`) unless a case says otherwise. */
    callerClass?: string;
    /** The organization the caller's credential is bound to; none unless a case says otherwise. */
    boundOrg?: string;
    /** The service account that minted the caller's token; none unless a case says otherwise. */
    mintedBy?: string;
    /** What the engine answers about a row's creator; every relation held unless a case says otherwise. */
    creatorHolds?: (relation: string) => boolean;
    /** A fault the engine answers every creator question with, over `creatorHolds`. */
    creatorFault?: Error;
    /** Where the lane's warnings go, when a case reads them; silent otherwise. */
    warnings?: string[];
    /** Where the lane's errors go, when a case reads them; silent otherwise. */
    errors?: string[];
  } = {},
): Rig {
  const creatorChecks: string[] = [];
  const store = new InMemoryInvitationStore();
  const checks: AuthzCheck[] = [];
  const created: ResourceCreatedEvent[] = [];
  const granted: GrantSpec[] = [];
  /** Whom each grant and revoke was made acting for, in call order. */
  const actingFor: Array<string | undefined> = [];
  const revokedOrgAccess: string[] = [];
  const revoked: string[] = [];
  const held = new Set<string>();
  const offered: ListEntryMeta[][] = [];
  const triple = (spec: GrantSpec): string =>
    `${spec.principal?.id}#${spec.relation}@${spec.resource?.id}`;
  const authorizer: Authorizer = {
    authorize: (_caller, check) => {
      checks.push(check);
      const decision = options.decide?.(check) ?? "allow";
      return Promise.resolve(
        decision === "allow" ? { kind: "allow" } : { kind: "deny", reason: "" },
      );
    },
  };
  const unused = (): Promise<never> => Promise.reject(new Error("not a lane this suite drives"));
  const grants: GrantPathClient = {
    bootstrapGrant: unused,
    create: async (spec, as) => {
      await options.onGrant?.();
      granted.push(spec);
      actingFor.push(as);
      held.add(triple(spec));
      return create(GrantSchema, { spec });
    },
    delete: (spec, as) => {
      actingFor.push(as);
      revoked.push(triple(spec));
      held.delete(triple(spec));
      return Promise.resolve(create(GrantSchema, { spec }));
    },
    cleanupResourceGrants: unused,
    bootstrapRevokeOrgAccess: (account, org) => {
      revokedOrgAccess.push(`${account}@${org}`);
      return Promise.resolve();
    },
  };
  const listReadScope: ListReadScope = {
    authorizedResourceIds: () => Promise.reject(new Error("the invitation list restricts, never enumerates")),
    restrictListEntries: (_caller, _kind, entries) => {
      offered.push([...entries]);
      const allowed = options.listable ?? (() => true);
      return Promise.resolve(new Set(entries.map((e) => e.id).filter(allowed)));
    },
  };
  const deps: InvitationLaneDeps = {
    // Nobody here is a service account: the refusal reads a person.
    accounts: { findById: () => Promise.resolve(undefined) },
    authorizer,
    logger:
      options.warnings === undefined && options.errors === undefined
        ? silent
        : createLogger({
            level: options.warnings === undefined ? "error" : "warn",
            pretty: false,
            write: (line: string) => void (options.warnings ?? options.errors)?.push(line),
          }),
    store,
    grants: grants,
    lifecycle: {
      onResourceCreated: async (event) => {
        await options.onCreated?.();
        created.push(event);
      },
    },
    listReadScope,
    // The library's rule for an organization: an unbound caller acts in
    // every one, a bound caller in its own alone.
    credentialBinding: {
      admitsOrganization: (caller, org) => {
        const bound = boundOrgOf(caller);
        return bound === undefined || bound === org;
      },
    },
    organizations: {
      find: options.organization ?? ((org) => Promise.resolve(org === "acme" ? acme : undefined)),
    },
    authorizationQueries: {
      check: (grant) => {
        creatorChecks.push(`${grant.relation} ${grant.principal?.id ?? ""}`);
        if (options.creatorFault !== undefined) {
          return Promise.reject(options.creatorFault);
        }
        return Promise.resolve(options.creatorHolds?.(grant.relation) ?? true);
      },
    },
  };
  const transport = createRouterTransport(
    (router) => {
      for (const register of newInvitationRegistrations(deps)) {
        register(router);
      }
    },
    {
      router: {
        interceptors: [
          identityInterceptor(options.callerClass ?? "user", options.boundOrg, options.mintedBy),
        ],
      },
    },
  );
  return {
    commands: createClient(InvitationCommandController, transport),
    queries: createClient(InvitationQueryController, transport),
    store,
    checks,
    created,
    granted,
    actingFor,
    revokedOrgAccess,
    revoked,
    held,
    offered,
    creatorChecks,
  };
}

/** The message the generated SDK client sends for an invitation. */
function request(
  spec: { role?: IamRole; expiresInMs?: number; maxRedemptions?: number } = {},
  id = "",
): Invitation {
  return create(InvitationSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Invitation",
    metadata: create(ApiResourceMetadataSchema, { id, name: "engineering-link", org: "acme" }),
    spec: create(InvitationSpecSchema, {
      role: spec.role ?? IamRole.viewer,
      maxRedemptions: spec.maxRedemptions ?? 0,
      expiresAt: timestampFromDate(new Date(Date.now() + (spec.expiresInMs ?? 7 * DAY_MS))),
      label: "Engineering",
    }),
  });
}

/** A stored row, as a create would have written it. */
function stored(
  options: {
    id?: string;
    token?: string;
    state?: InvitationState;
    maxRedemptions?: number;
    redemptionCount?: number;
    expiresInMs?: number;
    createdAt?: Date;
    org?: string;
    role?: IamRole;
    /** The creator the audit records; `""` records none. */
    creator?: string;
  } = {},
): Invitation {
  const creator = options.creator ?? CREATOR;
  const createdAt = timestampFromDate(options.createdAt ?? new Date(ORG_CREATED.getTime() + DAY_MS));
  return create(InvitationSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Invitation",
    metadata: create(ApiResourceMetadataSchema, {
      id: options.id ?? "inv_stored",
      name: "stored",
      org: options.org ?? "acme",
    }),
    spec: create(InvitationSpecSchema, {
      role: options.role ?? IamRole.member,
      maxRedemptions: options.maxRedemptions ?? 0,
      expiresAt: timestampFromDate(new Date(Date.now() + (options.expiresInMs ?? 7 * DAY_MS))),
    }),
    status: create(InvitationStatusSchema, {
      token: options.token ?? "StoredToken",
      state: options.state ?? InvitationState.active,
      redemptionCount: options.redemptionCount ?? 0,
      audit: create(ApiResourceAuditSchema, {
        specAudit: create(ApiResourceAuditInfoSchema, {
          createdAt,
          updatedAt: createdAt,
          ...(creator === "" ? {} : { createdBy: create(ApiResourceAuditActorSchema, { id: creator }) }),
        }),
      }),
    }),
  });
}

async function failure(work: Promise<unknown>): Promise<ConnectError> {
  try {
    await work;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a ConnectError");
}

/** Everything but the membership probe is allowed; the caller is no member. */
const outsider = (check: AuthzCheck): "allow" | "deny" =>
  check.permission === IamPermission.can_view && check.resourceKind === ApiResourceKind.organization
    ? "deny"
    : "allow";

describe("create", () => {
  it("mints the id itself, stamps the audit, issues a token, writes the row, then fires the link and no owner", async () => {
    const r = rig();
    const invitation = await r.commands.create(request({}, "inv_chosen_by_the_caller"));

    const id = invitation.metadata?.id ?? "";
    expect(id).toMatch(/^inv_[0-9a-z]{26}$/);
    expect(invitation.status?.token).toMatch(/^[0-9A-Za-z]{16,22}$/);
    expect(invitation.status?.state).toBe(InvitationState.active);
    expect(invitation.status?.redemptionCount).toBe(0);
    expect(invitation.status?.audit?.specAudit?.createdAt).toBeDefined();
    expect(r.store.rows.has(id)).toBe(true);
    expect(r.store.rows.has("inv_chosen_by_the_caller")).toBe(false);

    expect(r.checks[0]).toMatchObject({
      permission: IamPermission.can_grant_access,
      resourceKind: ApiResourceKind.organization,
      resourceId: "acme",
    });
    expect(r.created).toHaveLength(1);
    expect(r.created[0]).toMatchObject({
      kind: ApiResourceKind.invitation,
      resourceId: id,
      orgId: "acme",
      ownerAttribution: OwnerAttributionType.NONE,
    });
  });

  it("refuses an organization's service account PERMISSION_DENIED, writing no row: it never decides who belongs", async () => {
    const r = rig({ callerClass: "service_account" });
    const refused = await failure(r.commands.create(request({})));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(
      "a service account cannot create invitations; an organization admin must do it",
    );
    expect(r.store.rows.size).toBe(0);
    expect(r.created).toHaveLength(0);
  });

  it("an owner link needs an owner's authority: an admin is refused with the owner copy and no row, an owner makes it", async () => {
    const admin = rig({ decide: (check) => (check.permission === IamPermission.can_assign_roles ? "deny" : "allow") });
    const refused = await failure(admin.commands.create(request({ role: IamRole.owner })));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(OWNER_ASSIGNMENT_DENIED_MESSAGE);
    expect(admin.checks.at(-1)).toEqual({
      permission: IamPermission.can_assign_roles,
      resourceKind: ApiResourceKind.organization,
      resourceId: "acme",
    });
    expect(admin.store.rows.size).toBe(0);
    expect(admin.created).toHaveLength(0);

    const owner = rig();
    const link = await owner.commands.create(request({ role: IamRole.owner }));
    expect(link.spec?.role).toBe(IamRole.owner);

    const other = rig();
    await other.commands.create(request({ role: IamRole.admin }));
    expect(other.checks.map((check) => check.permission)).not.toContain(IamPermission.can_assign_roles);
  });

  it.each([
    ["an expiry in the past", { expiresInMs: -DAY_MS }, "Invitation expiration must be in the future"],
    ["an expiry past 30 days", { expiresInMs: 31 * DAY_MS }, "Invitation expiration cannot exceed 30 days from now"],
    ["a negative redemption limit", { maxRedemptions: -1 }, "max_redemptions must be 0 (unlimited) or a positive integer"],
  ])("refuses %s with the lane's copy before any row", async (_name, spec, copy) => {
    const r = rig();
    const error = await failure(r.commands.create(request(spec)));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe(copy);
    expect(r.store.rows.size).toBe(0);
    expect(r.created).toHaveLength(0);
  });

  it("refuses a role organizations do not grant, naming the ones they do", async () => {
    const r = rig();
    const error = await failure(r.commands.create(request({ role: IamRole.participant })));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toMatch(/^Role 'participant' cannot be granted on organizations\. Grantable roles: \[/);
  });

  it("answers a failed creation event INTERNAL with the row in place", async () => {
    const r = rig({ onCreated: () => Promise.reject(new Error("engine unreachable at 10.0.0.9")) });
    const error = await failure(r.commands.create(request()));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to create authorization tuples");
    expect(r.store.rows.size).toBe(1);
  });
});

describe("get and list", () => {
  it("get authorizes can_view on the invitation itself, and an unknown id is NOT_FOUND once authorized", async () => {
    const r = rig();
    await r.store.save(stored({ id: "inv_a" }));

    const invitation = await r.queries.get({ value: "inv_a" });
    expect(invitation.status?.token).toBe("StoredToken");
    expect(r.checks[0]).toMatchObject({
      permission: IamPermission.can_view,
      resourceKind: ApiResourceKind.invitation,
      resourceId: "inv_a",
    });

    const missing = await failure(r.queries.get({ value: "inv_missing" }));
    expect(missing.code).toBe(Code.NotFound);
  });

  it("get refuses with the annotation's copy before reading the row", async () => {
    const r = rig({ decide: () => "deny" });
    await r.store.save(stored({ id: "inv_a" }));
    const error = await failure(r.queries.get({ value: "inv_a" }));
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("unauthorized to view invitation");
  });

  it("list offers the organization's rows to the list read scope and answers only what it allows", async () => {
    const r = rig({ listable: (id) => id === "inv_visible" });
    await r.store.save(stored({ id: "inv_visible", token: "t1" }));
    await r.store.save(stored({ id: "inv_hidden", token: "t2" }));
    await r.store.save(stored({ id: "inv_elsewhere", token: "t3", org: "globex" }));

    const listed = await r.queries.list({ org: "acme" });
    expect(listed.entries.map((entry) => entry.metadata?.id)).toEqual(["inv_visible"]);
    expect(r.offered[0]?.map((entry) => entry.id).sort()).toEqual(["inv_hidden", "inv_visible"]);
    expect(r.checks[0]).toMatchObject({
      permission: IamPermission.can_view_access,
      resourceKind: ApiResourceKind.organization,
      resourceId: "acme",
    });
  });
});

describe("list's pages", () => {
  /** `count` rows of acme, `inv_00` the oldest, a minute apart. */
  async function seed(r: Rig, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `inv_${String(i).padStart(2, "0")}`;
      ids.push(id);
      await r.store.save(
        stored({ id, token: `t${i}`, createdAt: new Date(ORG_CREATED.getTime() + DAY_MS + i * 60_000) }),
      );
    }
    return ids.reverse();
  }

  it("answers a page and a token that continues it, newest first", async () => {
    const r = rig();
    const newestFirst = await seed(r, 5);

    const read: string[] = [];
    let pageToken = "";
    const tokens: string[] = [];
    do {
      const page = await r.queries.list({ org: "acme", pageSize: 2, pageToken });
      read.push(...page.entries.map((entry) => entry.metadata?.id ?? ""));
      pageToken = page.nextPageToken;
      tokens.push(pageToken);
    } while (pageToken !== "");
    expect(read).toEqual(newestFirst);
    expect(tokens.map((token) => token !== "")).toEqual([true, true, false]);
  });

  it("answers the default page of 50 and a token at size 0, never every row", async () => {
    const r = rig();
    const newestFirst = await seed(r, 55);

    const first = await r.queries.list({ org: "acme", pageSize: 0, pageToken: "" });
    expect(first.entries.map((entry) => entry.metadata?.id)).toEqual(newestFirst.slice(0, 50));
    expect(first.nextPageToken).not.toBe("");
    const rest = await r.queries.list({ org: "acme", pageSize: 0, pageToken: first.nextPageToken });
    expect(rest.entries.map((entry) => entry.metadata?.id)).toEqual(newestFirst.slice(50));
    expect(rest.nextPageToken).toBe("");
  });

  it("walks only the invitations carrying every label named, a page at a time", async () => {
    const r = rig();
    const labels = { group: "on-call", tier: "gold" };
    const plan: Record<string, string>[] = [{}, labels, { group: "on-call" }, { ...labels, extra: "x" }];
    for (const [i, invitationLabels] of plan.entries()) {
      const invitation = stored({ id: `inv_lbl_${i}`, token: `lbl${i}`, createdAt: new Date(ORG_CREATED.getTime() + DAY_MS + i * 60_000) });
      invitation.metadata!.labels = invitationLabels;
      await r.store.save(invitation);
    }
    const read: string[] = [];
    let pageToken = "";
    do {
      const page = await r.queries.list({ org: "acme", labels, pageSize: 1, pageToken });
      expect(page.entries.length).toBeLessThanOrEqual(1);
      read.push(...page.entries.map((row) => row.metadata?.id ?? ""));
      pageToken = page.nextPageToken;
    } while (pageToken !== "");
    expect(read).toEqual(["inv_lbl_3", "inv_lbl_1"]);
  });

  it("refuses a token issued for another organization's list", async () => {
    const r = rig();
    await seed(r, 3);
    const { nextPageToken } = await r.queries.list({ org: "acme", pageSize: 1, pageToken: "" });

    const error = await failure(r.queries.list({ org: "globex", pageSize: 1, pageToken: nextPageToken }));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("page_token was issued for a different request");
  });

  it("gives a caller the scope refuses every row an empty page with a token, examining a bounded number of rows", async () => {
    const r = rig({ listable: () => false });
    await seed(r, 120);

    const page = await r.queries.list({ org: "acme", pageSize: 2, pageToken: "" });
    expect(page.entries).toEqual([]);
    expect(page.nextPageToken).not.toBe("");
    const examined = r.offered.reduce((sum, batch) => sum + batch.length, 0);
    expect(examined).toBe(100);
  });
});

describe("revoke", () => {
  it("refuses a caller who may not revoke with the lane's copy whether or not the id exists, asking once before any read", async () => {
    const r = rig({ decide: (check) => (check.permission === IamPermission.can_edit ? "deny" : "allow") });
    await r.store.save(stored({ id: "inv_a" }));
    for (const id of ["inv_a", "inv_missing"]) {
      const error = await failure(r.commands.revoke({ value: id }));
      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe("unauthorized to revoke invitations in this organization");
    }
    expect(r.checks).toEqual([
      { permission: IamPermission.can_edit, resourceKind: ApiResourceKind.invitation, resourceId: "inv_a" },
      { permission: IamPermission.can_edit, resourceKind: ApiResourceKind.invitation, resourceId: "inv_missing" },
    ]);
    expect(r.store.rows.get("inv_a")?.status?.state).toBe(InvitationState.active);
  });

  it("revokes, and revoking again is a no-op; an unknown id is NOT_FOUND to a caller who may revoke", async () => {
    const r = rig();
    await r.store.save(stored({ id: "inv_a" }));
    expect((await r.commands.revoke({ value: "inv_a" })).status?.state).toBe(InvitationState.revoked);
    expect((await r.commands.revoke({ value: "inv_a" })).status?.state).toBe(InvitationState.revoked);
    const missing = await failure(r.commands.revoke({ value: "inv_missing" }));
    expect(missing.code).toBe(Code.NotFound);
  });
});

describe("revoke, racing a delete", () => {
  it("is NOT_FOUND when the invitation is deleted between the load and the revoke", async () => {
    const r = rig();
    await r.store.save(stored({ id: "inv_a" }));
    const revoke = r.store.revoke.bind(r.store);
    r.store.revoke = async (id: string) => {
      await r.store.deleteById(id);
      return revoke(id);
    };
    const missing = await failure(r.commands.revoke({ value: "inv_a" }));
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe("Invitation not found: inv_a");
  });
});

describe("redeem", () => {
  it("records the redemption, then grants the invitation's role to the caller on its organization", async () => {
    const countAtGrant: Array<number | undefined> = [];
    const r: Rig = rig({
      decide: outsider,
      onGrant: async () => {
        countAtGrant.push((await r.store.findById("inv_a"))?.status?.redemptionCount);
      },
    });
    await r.store.save(stored({ id: "inv_a", token: "Go" }));

    const redeemed = await r.commands.redeem({ token: "Go" });
    expect(redeemed.status?.redemptionCount).toBe(1);
    expect(countAtGrant, "the redemption is recorded before the grant").toEqual([1]);
    expect(r.granted).toHaveLength(1);
    expect(r.granted[0]?.principal).toMatchObject({ kind: "identity_account", id: CALLER });
    expect(r.granted[0]?.relation).toBe("member");
    expect(r.granted[0]?.resource).toMatchObject({ kind: "organization", id: "acme" });
    expect(
      r.actingFor,
      "the grant acts for the inviter, who decided it, never the redeemer",
    ).toEqual([CREATOR]);
  });

  // Only `user` redeems: open source's own non-person classes, a class a
  // host mints for a lane of its own (a host's guest lane, say,
  // `guest`), and one no host has minted yet are all refused alike.
  it.each(["internal", "machine", "runner", "guest", "service_account", "any-host-lane"])(
    "refuses a %s caller PERMISSION_DENIED before the token is looked up, granting and recording nothing",
    async (callerClass) => {
      const r = rig({ decide: outsider, callerClass });
      await r.store.save(stored({ id: "inv_a", token: "Go" }));
      const lookups = vi.spyOn(r.store, "findByToken");

      for (const token of ["Go", "nope"]) {
        const error = await failure(r.commands.redeem({ token }));
        expect(error.code).toBe(Code.PermissionDenied);
        expect(error.rawMessage).toBe("an invitation is redeemed by a person signed in to their own account");
      }
      expect(lookups).not.toHaveBeenCalled();
      expect(r.checks).toHaveLength(0);
      expect(r.granted).toHaveLength(0);
      expect((await r.store.findById("inv_a"))?.status?.redemptionCount).toBe(0);
    },
  );

  it("admits an app user only into the organization its token is for", async () => {
    const globex: OrganizationFacts = { ...acme, name: "Globex", slug: "globex" };
    const organization = (org: string): Promise<OrganizationFacts | undefined> =>
      Promise.resolve(org === "acme" ? acme : org === "globex" ? globex : undefined);
    // The shape the library's user-token verifier stamps: a person whose
    // token names its minting service account and is bound to one organization.
    const r = rig({ decide: outsider, organization, boundOrg: "globex", mintedBy: "ida_globex_minter" });
    await r.store.save(stored({ id: "inv_acme", token: "Acme" }));
    await r.store.save(stored({ id: "inv_globex", token: "Globex", org: "globex" }));

    const elsewhere = await failure(r.commands.redeem({ token: "Acme" }));
    expect(elsewhere.code).toBe(Code.PermissionDenied);
    expect(elsewhere.rawMessage).toBe(BOUND_CREDENTIAL_REDEEMS_ELSEWHERE);
    expect(r.granted).toHaveLength(0);
    expect((await r.store.findById("inv_acme"))?.status?.redemptionCount).toBe(0);

    expect((await r.commands.redeem({ token: "Globex" })).status?.redemptionCount).toBe(1);
    expect([...r.held]).toEqual([`${CALLER}#member@globex`]);
  });

  it("refuses a credential bound to another organization once the link is valid, before the membership check, granting nothing", async () => {
    const r = rig({ decide: outsider, boundOrg: "globex" });
    await r.store.save(stored({ id: "inv_a", token: "Go" }));
    const error = await failure(r.commands.redeem({ token: "Go" }));
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(BOUND_CREDENTIAL_REDEEMS_ELSEWHERE);
    expect(r.checks).toHaveLength(0);
    expect(r.granted).toHaveLength(0);

    const own = rig({ decide: outsider, boundOrg: "acme" });
    await own.store.save(stored({ id: "inv_a", token: "Go" }));
    expect((await own.commands.redeem({ token: "Go" })).status?.redemptionCount).toBe(1);
  });

  it.each([
    ["revoked", { state: InvitationState.revoked }, "This invitation has been revoked"],
    ["expired", { expiresInMs: -DAY_MS }, "This invitation has expired"],
    ["used up", { maxRedemptions: 1, redemptionCount: 1 }, "This invitation has reached its maximum number of uses"],
  ])("refuses a %s link with its own copy before any grant", async (_name, row, copy) => {
    const r = rig({ decide: outsider });
    await r.store.save(stored({ token: "Go", ...row }));
    const error = await failure(r.commands.redeem({ token: "Go" }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(copy);
    expect(r.granted).toHaveLength(0);
  });

  it.each([
    ["whose organization is gone", () => Promise.resolve(undefined)],
    [
      "older than its organization (the slug was freed and taken again)",
      () => Promise.resolve({ ...acme, createdAt: new Date(ORG_CREATED.getTime() + 2 * DAY_MS) }),
    ],
  ])("refuses a link %s before any grant", async (_name, organization) => {
    const r = rig({ decide: outsider, organization });
    await r.store.save(stored({ token: "Go" }));
    const error = await failure(r.commands.redeem({ token: "Go" }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe("This invitation is no longer valid");
    expect(r.granted).toHaveLength(0);
  });

  it.each([
    ["no longer grants in the organization", IamRole.member, (relation: string) => relation !== "can_grant_access", "", ["can_grant_access ida_creator"]],
    ["of an owner link is no longer an owner", IamRole.owner, (relation: string) => relation !== "can_assign_roles", "", ["can_grant_access ida_creator", "can_assign_roles ida_creator"]],
    ["was never recorded", IamRole.member, () => true, "none", []],
  ])("refuses a link whose creator %s, before any grant", async (_name, role, creatorHolds, noCreator, asked) => {
    const r = rig({ decide: outsider, creatorHolds });
    await r.store.save(stored({ token: "Go", role, ...(noCreator === "none" ? { creator: "" } : {}) }));
    const error = await failure(r.commands.redeem({ token: "Go" }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(
      "This invitation is no longer valid: the person who created it can no longer grant its role",
    );
    expect(r.creatorChecks).toEqual(asked);
    expect(r.granted).toHaveLength(0);
  });

  it("redeems an owner link while its creator is still an owner, asking both of the creator", async () => {
    const r = rig({ decide: outsider });
    await r.store.save(stored({ token: "Go", role: IamRole.owner }));
    await r.commands.redeem({ token: "Go" });
    expect(r.creatorChecks).toEqual(["can_grant_access ida_creator", "can_assign_roles ida_creator"]);
    expect(r.granted.map((spec) => spec.relation)).toEqual(["owner"]);
  });

  it("answers an unknown token NOT_FOUND and a member ALREADY_EXISTS, before any grant", async () => {
    const r = rig();
    expect((await failure(r.commands.redeem({ token: "nope" }))).code).toBe(Code.NotFound);
    await r.store.save(stored({ token: "Go" }));
    const member = await failure(r.commands.redeem({ token: "Go" }));
    expect(member.code).toBe(Code.AlreadyExists);
    expect(member.rawMessage).toBe("You are already a member of this organization");
    expect(r.granted).toHaveLength(0);
  });

  it("keeps a grant refusal's own code, and answers an unexpected fault INTERNAL without its cause", async () => {
    const refused = rig({
      decide: outsider,
      onGrant: () =>
        Promise.reject(new ConnectError("role not grantable here", Code.InvalidArgument)),
    });
    await refused.store.save(stored({ token: "Go" }));
    const reason = await failure(refused.commands.redeem({ token: "Go" }));
    expect(reason.code).toBe(Code.InvalidArgument);
    expect(reason.rawMessage).toBe("role not grantable here");

    const faulted = rig({
      decide: outsider,
      onGrant: () => Promise.reject(new Error("connection refused by 10.0.0.9:5432")),
    });
    await faulted.store.save(stored({ token: "Go" }));
    const fault = await failure(faulted.commands.redeem({ token: "Go" }));
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).not.toContain("10.0.0.9");
  });

  it("grants and revokes nothing when it loses the last slot, and answers the honest copy", async () => {
    const r = rig({ decide: outsider });
    await r.store.save(stored({ token: "Go", maxRedemptions: 1 }));
    r.store.loseNextRace = true;

    const error = await failure(r.commands.redeem({ token: "Go" }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe("This invitation has reached its maximum number of uses");
    expect(r.granted).toHaveLength(0);
    expect(r.revoked).toEqual([]);
    expect(r.revokedOrgAccess).toEqual([]);
  });

  it("keeps the person's role when a double-clicked single-use link is redeemed twice at once", async () => {
    const r = rig({ decide: outsider });
    await r.store.save(stored({ id: "inv_a", token: "Go", maxRedemptions: 1 }));

    const outcomes = await Promise.allSettled([
      r.commands.redeem({ token: "Go" }),
      r.commands.redeem({ token: "Go" }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === "rejected");
    expect(ConnectError.from(refused?.status === "rejected" ? refused.reason : undefined).rawMessage).toBe(
      "This invitation has reached its maximum number of uses",
    );
    const row = await r.store.findById("inv_a");
    expect(row?.status?.redemptions.map((entry) => entry.identityAccountId)).toEqual([CALLER]);
    expect([...r.held], "the recorded redeemer still holds the role").toEqual([`${CALLER}#member@acme`]);
    expect(r.revoked).toEqual([]);
  });

  it("keeps the person's role when a second link of the same role loses its own last slot", async () => {
    const r = rig({ decide: outsider });
    await r.store.save(stored({ id: "inv_a", token: "First", maxRedemptions: 1 }));
    await r.store.save(stored({ id: "inv_b", token: "Second", maxRedemptions: 1 }));

    // The second redemption read the membership before the first grant
    // landed, so it passes the check; then it loses its own last slot.
    await r.commands.redeem({ token: "First" });
    r.store.loseNextRace = true;
    await failure(r.commands.redeem({ token: "Second" }));

    expect([...r.held]).toEqual([`${CALLER}#member@acme`]);
    expect(r.revoked).toEqual([]);
  });

  it("releases its own record when the grant is refused, restoring the count, the ledger and the latch", async () => {
    const r = rig({
      decide: outsider,
      onGrant: () => Promise.reject(new ConnectError("role not grantable here", Code.InvalidArgument)),
    });
    await r.store.save(stored({ id: "inv_a", token: "Go", maxRedemptions: 1 }));

    const error = await failure(r.commands.redeem({ token: "Go" }));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("role not grantable here");
    const row = await r.store.findById("inv_a");
    expect(row?.status?.redemptionCount).toBe(0);
    expect(row?.status?.redemptions).toEqual([]);
    expect(row?.status?.state).toBe(InvitationState.active);
  });

  it("keeps the grant's refusal and warns when the failed grant finds no redemption to release", async () => {
    const warnings: string[] = [];
    const r: Rig = rig({
      decide: outsider,
      warnings,
      // The organization's delete removed the row between record and grant.
      onGrant: async () => {
        await r.store.deleteById("inv_a");
        throw new ConnectError("role not grantable here", Code.InvalidArgument);
      },
    });
    await r.store.save(stored({ id: "inv_a", token: "Go", maxRedemptions: 1 }));

    const error = await failure(r.commands.redeem({ token: "Go" }));
    expect(error.code).toBe(Code.InvalidArgument);
    expect(warnings.join("\n")).toContain("a failed grant found no redemption to release");
    expect(warnings.join("\n")).toContain("inv_a");
  });

  it("answers INTERNAL and logs for a hand when the release fails after a failed grant", async () => {
    const errors: string[] = [];
    const r = rig({
      decide: outsider,
      errors,
      onGrant: () => Promise.reject(new ConnectError("role not grantable here", Code.InvalidArgument)),
    });
    await r.store.save(stored({ id: "inv_a", token: "Go", maxRedemptions: 1 }));
    r.store.failNextRelease = new Error("connection refused by 10.0.0.9:5432");

    const error = await failure(r.commands.redeem({ token: "Go" }));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("Failed to record invitation redemption");
    expect(errors.join("\n")).toContain(
      "releasing a redemption FAILED after its grant failed — reconcile manually",
    );
    expect(errors.join("\n")).toContain("inv_a");
  });
});

describe("getByToken", () => {
  it("answers the organization's display and the link's validity, asking nobody's permission", async () => {
    const r = rig({ decide: () => "deny" });
    await r.store.save(stored({ token: "Go" }));
    const preview = await r.queries.getByToken({ token: "Go" });
    expect(preview.orgName).toBe("Acme Corp");
    expect(preview.orgSlug).toBe("acme");
    expect(preview.orgLogoUrl).toBe("https://acme.test/logo.png");
    expect(preview.role).toBe(IamRole.member);
    expect(preview.isValid).toBe(true);
    expect(preview.invalidReason).toBe("");
    expect(r.checks).toHaveLength(0);
    expect(r.creatorChecks).toEqual(["can_grant_access ida_creator"]);
  });

  it("says a link whose creator can no longer grant its role is invalid, with redeem's copy", async () => {
    const r = rig({ creatorHolds: (relation) => relation !== "can_grant_access" });
    await r.store.save(stored({ token: "Go" }));
    const preview = await r.queries.getByToken({ token: "Go" });
    expect(preview.isValid).toBe(false);
    expect(preview.invalidReason).toBe(
      "This invitation is no longer valid: the person who created it can no longer grant its role",
    );
  });

  it("degrades to the row's own validity, and warns, when the creator's standing cannot be read", async () => {
    const warnings: string[] = [];
    const r = rig({ creatorFault: new Error("OpenFGA check answered 503"), warnings });
    await r.store.save(stored({ token: "Go" }));
    const preview = await r.queries.getByToken({ token: "Go" });
    expect(preview.isValid).toBe(true);
    expect(preview.invalidReason).toBe("");
    expect(warnings.join("\n")).toContain("could not verify its creator's standing");
  });

  it("says a link of a gone organization is no longer valid", async () => {
    const r = rig({ organization: () => Promise.resolve(undefined) });
    await r.store.save(stored({ token: "Go" }));
    const preview = await r.queries.getByToken({ token: "Go" });
    expect(preview.isValid).toBe(false);
    expect(preview.invalidReason).toBe("This invitation is no longer valid");
    expect(preview.orgName).toBe("acme");
  });

  it("degrades to the row's own validity and the organization's id when the organization read faults", async () => {
    const r = rig({ organization: () => Promise.reject(new Error("transport not wired")) });
    await r.store.save(stored({ token: "Go", state: InvitationState.revoked }));
    const preview = await r.queries.getByToken({ token: "Go" });
    expect(preview.isValid).toBe(false);
    expect(preview.invalidReason).toBe("This invitation has been revoked");
    expect(preview.orgName).toBe("acme");
  });
});
