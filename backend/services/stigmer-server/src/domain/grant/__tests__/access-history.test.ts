/**
 * Pins access-history.ts at the handler level, over a router transport
 * with fakes (the controller.test.ts shape), so every arm of
 * `listAccessHistory` is proven without booting a server; the composed
 * proof over a licensed server and Postgres is Enterprise's
 * enterprise-access-history.postgres.test.ts.
 *
 * Fakes: the domain's in-memory GrantStore (support.ts), which keeps a
 * history as a store composed above open source does, written through its
 * own `save` and `deleteById` with change records; the identity-account
 * fake for the people; a stub principal display for a team; a recording
 * Authorizer; a stamping interceptor for the caller.
 *
 * What the arms pin:
 *   - the cause enum and change.ts's union are twins, both ways, and a
 *     cause this binary does not know reads as unspecified;
 *   - the chain's order: Authorize (can_view_access_history on the
 *     organization) before the open-source refusal, which answers
 *     UNIMPLEMENTED with the house sentence; the gate slot after both and
 *     before any read;
 *   - the read: newest first, or oldest first after a number; every
 *     person and grantee named at read time, an unknown account by its id;
 *     the role as the access list renders it; the resource as a reference;
 *   - the pages: the token only while more entries exist, every entry once
 *     across a walk in either direction, the default and maximum sizes,
 *     and the refusals of a token that is not this request's;
 *   - a store fault is INTERNAL with a static message;
 *   - retention: every page carries the window and the organization's
 *     oldest kept number (its true oldest for a parent's admin too), and
 *     a pass between the page and the oldest read never reports a
 *     returned entry as removed.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import type { Client, Interceptor } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import type { AccessHistoryEntry } from "@stigmer/protos/ai/stigmer/iam/grant/v1/io_pb";
import {
  AccessChange,
  AccessChangeCause,
  ApiResourceRefViewSchema,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/io_pb";
import { GrantQueryController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/query_pb";
import type { GrantSpec } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer, AuthzCheck, AuthzDecision } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { PrincipalDisplay } from "../../../extensions/principal-display.js";
import { createApiResourceInterceptor } from "../../../pipeline/interceptors/apiresource.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import type { PipelineStep } from "../../../pipeline/pipeline.js";
import { LIST_PAGE_MAX_SIZE } from "../../../pipeline/steps/list-page.js";
import { fakeIdentityAccountStore } from "../../identityaccount/__tests__/support.js";
import {
  CAUSE_ON_WIRE,
  causeOnWire,
  listAccessHistory,
} from "../access-history.js";
import type { GrantChangeCause, GrantChangeRecord } from "../change.js";
import { ACCESS_HISTORY_UNIMPLEMENTED_MESSAGE, grantIdFor } from "../constants.js";
import { newAccountDisplayResolver } from "../display-resolver.js";
import type { GrantStore } from "../store.js";
import { fakeGrantStore, orgRole, triple } from "./support.js";

const silent = createLogger({ level: "error", pretty: false, write: () => {} });

const ANA = "ida_ana";
const RAJ = "ida_raj";
const GONE = "ida_gone";
const ACME = "org_acme";

const ana: CallerIdentity = {
  identityId: ANA,
  callerClass: "user",
  issuer: "https://issuer.example",
  rawToken: "opaque",
};

function stampCaller(identity: CallerIdentity): Interceptor {
  return (next) => (request) => {
    request.contextValues.set(callerIdentityKey, identity);
    return next(request);
  };
}

interface Harness {
  readonly query: Client<typeof GrantQueryController>;
  readonly checks: AuthzCheck[];
  readonly grants: ReturnType<typeof fakeGrantStore>;
  /** Writes a row with its change record, as the grant path does. */
  grant(spec: GrantSpec, record?: Partial<GrantChangeRecord>): Promise<void>;
  revoke(spec: GrantSpec, record?: Partial<GrantChangeRecord>): Promise<void>;
}

const teams: PrincipalDisplay = {
  resolve: (kind, ids) =>
    Promise.resolve(
      new Map(
        kind === ApiResourceKind.team
          ? ids
              .filter((id) => id === "tm_core")
              .map((id) => [id, create(ApiResourceRefViewSchema, { kind: "team", id, name: "Core" })])
          : [],
      ),
    ),
};

async function harness(options: {
  edition?: ServerEdition;
  decision?: AuthzDecision;
  gate?: PipelineStep<DescMessage>;
  grants?: GrantStore;
  principalDisplay?: PrincipalDisplay;
  /** The answer to `can_view` on the organization: who sees what it holds (a parent's admin does not). */
  canView?: AuthzDecision;
  /** The composition's access-history window; undefined keeps everything. */
  retentionDays?: number;
} = {}): Promise<Harness> {
  const grants = fakeGrantStore();
  const accounts = fakeIdentityAccountStore();
  for (const [id, firstName, lastName] of [
    [ANA, "Ana", "Silva"],
    [RAJ, "Raj", "Patel"],
  ] as const) {
    await accounts.save(
      create(IdentityAccountSchema, {
        metadata: { id, name: `${firstName.toLowerCase()}@acme.example` },
        spec: {
          idpId: `auth0|${id}`,
          email: `${firstName.toLowerCase()}@acme.example`,
          firstName,
          lastName,
          provisioningMode: IdentityAccountProvisioningMode.direct,
        },
      }),
    );
  }
  const checks: AuthzCheck[] = [];
  const authorizer: Authorizer = {
    authorize(_caller, check) {
      checks.push(check);
      if (check.permission === IamPermission.can_view) {
        return Promise.resolve(options.canView ?? { kind: "allow" });
      }
      return Promise.resolve(options.decision ?? { kind: "allow" });
    },
  };
  const displayResolver = newAccountDisplayResolver(accounts);
  const transport = createRouterTransport(
    (router) => {
      router.service(GrantQueryController, {
        listAccessHistory: (input, ctx) =>
          listAccessHistory(
            {
              grants: options.grants ?? grants,
              authorizer,
              principalDisplay: options.principalDisplay ?? teams,
              gateSteps: new Map(
                options.gate === undefined
                  ? []
                  : [["grant-list-access-history:pre-read", [options.gate]]],
              ),
              edition: options.edition ?? ServerEdition.enterprise,
              retentionDays: options.retentionDays,
              logger: silent,
            },
            displayResolver,
            input,
            ctx,
          ),
      });
    },
    {
      router: {
        interceptors: [createApiResourceInterceptor(), stampCaller(ana)],
      },
    },
  );
  const recordOf = (record?: Partial<GrantChangeRecord>): GrantChangeRecord => ({
    actor: { id: ANA, callerClass: "user" },
    cause: "grant",
    organizationId: ACME,
    ...record,
  });
  const rowOf = (spec: GrantSpec) =>
    create(GrantSchema, { metadata: { id: grantIdFor(spec) }, spec });
  return {
    query: createClient(GrantQueryController, transport),
    checks,
    grants,
    grant: (spec, record) => grants.save(rowOf(spec), recordOf(record)),
    revoke: (spec, record) =>
      grants.deleteById(grantIdFor(spec), recordOf({ cause: "revoke", ...record })),
  };
}

function sequences(entries: ReadonlyArray<AccessHistoryEntry>): number[] {
  return entries.map((entry) => Number(entry.sequence));
}

async function rejection(promise: Promise<unknown>): Promise<ConnectError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe("the cause enum and the stored causes", () => {
  it("name each other both ways, value for value", () => {
    for (const [stored, wire] of Object.entries(CAUSE_ON_WIRE)) {
      expect(AccessChangeCause[wire], stored).toBe(stored);
    }
    const wireNames = Object.values(AccessChangeCause)
      .filter((value): value is AccessChangeCause => typeof value === "number")
      .filter((value) => value !== AccessChangeCause.access_change_cause_unspecified)
      .map((value) => AccessChangeCause[value]);
    expect(wireNames.sort()).toEqual(Object.keys(CAUSE_ON_WIRE).sort());
  });

  it("reads a cause this binary does not know as unspecified", () => {
    expect(causeOnWire("a_cause_from_a_later_binary")).toBe(
      AccessChangeCause.access_change_cause_unspecified,
    );
    expect(causeOnWire("toString")).toBe(AccessChangeCause.access_change_cause_unspecified);
    const known: GrantChangeCause = "left_organization";
    expect(causeOnWire(known)).toBe(AccessChangeCause.left_organization);
  });
});

describe("listAccessHistory's chain", () => {
  it("authorizes can_view_access_history on the organization, then refuses on open source", async () => {
    const h = await harness({ edition: ServerEdition.oss });
    const error = await rejection(h.query.listAccessHistory({ org: ACME }));
    expect(error.code).toBe(Code.Unimplemented);
    expect(error.rawMessage).toBe(ACCESS_HISTORY_UNIMPLEMENTED_MESSAGE);
    expect(h.checks).toEqual([
      expect.objectContaining({
        permission: IamPermission.can_view_access_history,
        resourceKind: ApiResourceKind.organization,
        resourceId: ACME,
      }),
    ]);
  });

  it("refuses a caller the Authorizer denies before it says which edition this is", async () => {
    const h = await harness({ edition: ServerEdition.oss, decision: { kind: "deny", reason: "not an admin" } });
    const error = await rejection(h.query.listAccessHistory({ org: ACME }));
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("unauthorized to view the access history");
  });

  it("runs the gate slot after authorizing and before any read", async () => {
    const reads: string[] = [];
    const base = fakeGrantStore();
    const grants: GrantStore = {
      ...base,
      listChanges: (org, page) => {
        reads.push(org);
        return base.listChanges(org, page);
      },
    };
    const gate: PipelineStep<DescMessage> = {
      name: "RefuseByPlan",
      execute: () => {
        throw new ConnectError("the plan does not include the access history", Code.FailedPrecondition);
      },
    };
    const h = await harness({ gate, grants });
    const error = await rejection(h.query.listAccessHistory({ org: ACME }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(h.checks).toHaveLength(1);
    expect(reads).toEqual([]);

    const denied = await harness({ gate, grants, decision: { kind: "deny", reason: "not an admin" } });
    expect((await rejection(denied.query.listAccessHistory({ org: ACME }))).code).toBe(
      Code.PermissionDenied,
    );
  });

  it("reads a page size above the most a page holds as that most", async () => {
    const limits: number[] = [];
    const base = fakeGrantStore();
    const grants: GrantStore = {
      ...base,
      listChanges: (org, page) => {
        limits.push(page.limit);
        return base.listChanges(org, page);
      },
    };
    const h = await harness({ grants });
    await h.query.listAccessHistory({ org: ACME, pageSize: 101 });
    // The page, then the oldest kept entry.
    expect(limits).toEqual([LIST_PAGE_MAX_SIZE + 1, 1]);
  });

  it("answers a fault naming the people as INTERNAL with a static message", async () => {
    const h = await harness({ principalDisplay: { resolve: () => Promise.reject(new Error("team store down")) } });
    await h.grant(triple({ kind: "team", id: "tm_core", relation: "member" }, "viewer", { kind: "agent", id: "agt_1" }));
    const error = await rejection(h.query.listAccessHistory({ org: ACME }));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to name the access history");
  });

  it("answers a store fault as INTERNAL with a static message", async () => {
    const base = fakeGrantStore();
    const grants: GrantStore = {
      ...base,
      listChanges: () => Promise.reject(new Error("connection reset by peer")),
    };
    const h = await harness({ grants });
    const error = await rejection(h.query.listAccessHistory({ org: ACME }));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to read the access history");
  });
});

describe("listAccessHistory's read", () => {
  it("tells the story newest first, every person and grantee named at read time", async () => {
    const h = await harness();
    const agent = { kind: "agent", id: "agt_billing" };
    await h.grant(orgRole(RAJ, "member", ACME));
    await h.grant(triple({ kind: "identity_account", id: RAJ }, "editor", agent));
    await h.grant(triple({ kind: "team", id: "tm_core", relation: "member" }, "viewer", agent));
    await h.grant(triple({ kind: "organization", id: ACME }, "organization", agent), {
      cause: "structural",
      actor: { id: GONE, callerClass: "internal" },
    });
    await h.revoke(orgRole(RAJ, "member", ACME), { cause: "organization_access_revoked" });

    const page = await h.query.listAccessHistory({ org: ACME });
    expect(sequences(page.entries)).toEqual([5, 4, 3, 2, 1]);
    expect(page.nextPageToken).toBe("");

    const [removed, structural, team, editor, member] = page.entries;
    expect(removed).toMatchObject({
      change: AccessChange.revoked,
      cause: AccessChangeCause.organization_access_revoked,
      actorClass: "user",
      actor: { kind: "identity_account", id: ANA, name: "Ana Silva", email: "ana@acme.example" },
      principal: { kind: "identity_account", id: RAJ, name: "Raj Patel", relation: "" },
      role: { code: "member" },
      resource: { org: "", kind: ApiResourceKind.organization, id: ACME },
    });
    expect(removed?.role?.name).not.toBe("");
    expect(editor).toMatchObject({
      change: AccessChange.granted,
      cause: AccessChangeCause.grant,
      role: { code: "editor" },
      resource: { org: ACME, kind: ApiResourceKind.agent, id: "agt_billing" },
    });
    expect(team?.principal).toMatchObject({ kind: "team", id: "tm_core", name: "Core", relation: "member" });
    expect(structural).toMatchObject({
      cause: AccessChangeCause.structural,
      actorClass: "internal",
      actor: { kind: "", id: GONE, name: "" },
      principal: { kind: "organization", id: ACME, name: ACME },
      role: { id: "organization", code: "organization", name: "" },
    });
    expect(member?.cause).toBe(AccessChangeCause.grant);
    const times = page.entries.map((entry) => timestampDate(entry.occurredAt!).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("shows a parent's admin only the entries about the organization itself, in short pages that keep their token", async () => {
    const h = await harness({ canView: { kind: "deny", reason: "a parent's admin" } });
    const agent = { kind: "agent", id: "agt_private" };
    await h.grant(orgRole(RAJ, "member", ACME));
    await h.grant(triple({ kind: "identity_account", id: RAJ }, "editor", agent));
    await h.grant(triple({ kind: "identity_account", id: ANA }, "owner", agent));
    await h.revoke(orgRole(RAJ, "member", ACME), { cause: "organization_access_revoked" });

    const first = await h.query.listAccessHistory({ org: ACME, pageSize: 2 });
    expect(sequences(first.entries)).toEqual([4]);
    expect(first.nextPageToken).not.toBe("");
    const second = await h.query.listAccessHistory({ org: ACME, pageSize: 2, pageToken: first.nextPageToken });
    expect(sequences(second.entries)).toEqual([1]);
    expect(second.nextPageToken).toBe("");
    for (const entry of [...first.entries, ...second.entries]) {
      expect(entry.resource).toMatchObject({ kind: ApiResourceKind.organization, id: ACME });
    }
    expect(h.checks.filter((check) => check.permission === IamPermission.can_view)).toEqual([
      expect.objectContaining({ resourceKind: ApiResourceKind.organization, resourceId: ACME }),
      expect.objectContaining({ resourceKind: ApiResourceKind.organization, resourceId: ACME }),
    ]);

    const follow = await h.query.listAccessHistory({ org: ACME, afterSequence: 0n });
    expect(sequences(follow.entries)).toEqual([1, 4]);
  });

  it("answers an outage deciding what the caller may see as INTERNAL, never a smaller history", async () => {
    const h = await harness({ canView: { kind: "unavailable", cause: new Error("engine down") } });
    await h.grant(orgRole(RAJ, "member", ACME));
    const error = await rejection(h.query.listAccessHistory({ org: ACME }));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to authorize the access history");
  });

  it("reads only the organization asked about", async () => {
    const h = await harness();
    await h.grant(orgRole(RAJ, "member", ACME));
    await h.grant(orgRole(RAJ, "member", "org_beta"), { organizationId: "org_beta" });
    expect(sequences((await h.query.listAccessHistory({ org: ACME })).entries)).toEqual([1]);
    expect((await h.query.listAccessHistory({ org: "org_gamma" })).entries).toEqual([]);
  });

  it("walks newest first a page at a time, every entry once, the token only while more remain", async () => {
    const h = await harness();
    for (let n = 1; n <= 5; n += 1) {
      await h.grant(orgRole(`ida_${n}`, "member", ACME));
    }
    const seen: number[] = [];
    let token = "";
    let pages = 0;
    do {
      const page = await h.query.listAccessHistory({ org: ACME, pageSize: 2, pageToken: token });
      seen.push(...sequences(page.entries));
      token = page.nextPageToken;
      pages += 1;
    } while (token !== "");
    expect(seen).toEqual([5, 4, 3, 2, 1]);
    expect(pages).toBe(3);

    const exact = await h.query.listAccessHistory({ org: ACME, pageSize: 5 });
    expect(sequences(exact.entries)).toEqual([5, 4, 3, 2, 1]);
    expect(exact.nextPageToken).toBe("");
  });

  it("follows oldest first after a number, and a later follow read picks up exactly what came since", async () => {
    const h = await harness();
    for (let n = 1; n <= 3; n += 1) {
      await h.grant(orgRole(`ida_${n}`, "member", ACME));
    }
    const first = await h.query.listAccessHistory({ org: ACME, afterSequence: 0n, pageSize: 2 });
    expect(sequences(first.entries)).toEqual([1, 2]);
    const second = await h.query.listAccessHistory({
      org: ACME,
      afterSequence: 0n,
      pageSize: 2,
      pageToken: first.nextPageToken,
    });
    expect(sequences(second.entries)).toEqual([3]);
    expect(second.nextPageToken).toBe("");

    await h.revoke(orgRole("ida_1", "member", ACME));
    await h.grant(orgRole("ida_4", "member", ACME));
    const later = await h.query.listAccessHistory({ org: ACME, afterSequence: 3n });
    expect(sequences(later.entries)).toEqual([4, 5]);
    expect(later.entries.map((entry) => entry.change)).toEqual([AccessChange.revoked, AccessChange.granted]);
    expect((await h.query.listAccessHistory({ org: ACME, afterSequence: 5n })).entries).toEqual([]);
  });

  it("returns 50 entries when the request names no size", async () => {
    const h = await harness();
    for (let n = 1; n <= 51; n += 1) {
      await h.grant(orgRole(`ida_${n}`, "member", ACME));
    }
    const page = await h.query.listAccessHistory({ org: ACME });
    expect(page.entries).toHaveLength(50);
    expect(page.entries[0]?.sequence).toBe(51n);
    expect(page.nextPageToken).not.toBe("");
  });

  it("refuses a token that is malformed or was issued for another request", async () => {
    const h = await harness();
    for (let n = 1; n <= 3; n += 1) {
      await h.grant(orgRole(`ida_${n}`, "member", ACME));
    }
    const newest = await h.query.listAccessHistory({ org: ACME, pageSize: 1 });
    const garbage = await rejection(h.query.listAccessHistory({ org: ACME, pageToken: "not-a-token" }));
    expect(garbage.code).toBe(Code.InvalidArgument);
    expect(garbage.rawMessage).toBe("invalid page_token");
    // A token whose number no 64-bit sequence holds is refused as the
    // caller's input, never read into a store fault.
    const issued = JSON.parse(Buffer.from(newest.nextPageToken, "base64url").toString("utf8")) as Record<string, unknown>;
    const beyond = Buffer.from(JSON.stringify({ ...issued, s: "9999999999999999999" })).toString("base64url");
    const outOfRange = await rejection(h.query.listAccessHistory({ org: ACME, pageSize: 1, pageToken: beyond }));
    expect(outOfRange.code).toBe(Code.InvalidArgument);
    expect(outOfRange.rawMessage).toBe("invalid page_token");

    for (const other of [
      { org: "org_beta", pageToken: newest.nextPageToken },
      { org: ACME, afterSequence: 0n, pageToken: newest.nextPageToken },
    ]) {
      const error = await rejection(h.query.listAccessHistory(other));
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe("page_token was issued for a different request");
    }
    const resized = await h.query.listAccessHistory({
      org: ACME,
      pageSize: 2,
      pageToken: newest.nextPageToken,
    });
    expect(sequences(resized.entries)).toEqual([2, 1]);
  });
});

describe("listAccessHistory's retention", () => {
  const LATER = new Date(Date.now() + 60_000);

  it("says on every page how long the history is kept and the oldest number the organization holds", async () => {
    const h = await harness({ retentionDays: 365 });
    for (let n = 1; n <= 4; n += 1) {
      await h.grant(orgRole(`ida_${n}`, "member", ACME));
    }
    await h.grants.pruneChanges(LATER, 2);

    const newest = await h.query.listAccessHistory({ org: ACME, pageSize: 1 });
    expect(sequences(newest.entries)).toEqual([4]);
    expect(newest.oldestSequence).toBe(3n);
    expect(newest.retentionDays).toBe(365);
    const follow = await h.query.listAccessHistory({ org: ACME, afterSequence: 1n });
    expect(sequences(follow.entries)).toEqual([3, 4]);
    expect(follow.oldestSequence).toBe(3n);
    expect(follow.retentionDays).toBe(365);
  });

  it("answers one past the last number when retention removed every entry, so a tool learns what it lost", async () => {
    const h = await harness({ retentionDays: 365 });
    for (let n = 1; n <= 3; n += 1) {
      await h.grant(orgRole(`ida_${n}`, "member", ACME));
    }
    await h.grants.pruneChanges(LATER, 10);

    const follow = await h.query.listAccessHistory({ org: ACME, afterSequence: 1n });
    expect(follow.entries).toEqual([]);
    expect(follow.oldestSequence).toBe(4n);
    expect((await h.query.listAccessHistory({ org: ACME })).oldestSequence).toBe(4n);
    await h.grant(orgRole("ida_4", "member", ACME));
    expect((await h.query.listAccessHistory({ org: ACME, afterSequence: 1n })).oldestSequence).toBe(4n);
  });

  it("never reports a change that commits while the page reads the oldest entry as removed", async () => {
    const base = fakeGrantStore();
    const recordOf: GrantChangeRecord = { actor: { id: ANA, callerClass: "user" }, cause: "grant", organizationId: ACME };
    const rowOf = (n: number) => {
      const spec = orgRole(`ida_${n}`, "member", ACME);
      return create(GrantSchema, { metadata: { id: grantIdFor(spec) }, spec });
    };
    let grantDuringOldestRead = true;
    const grants: GrantStore = {
      ...base,
      listChanges: async (org, page) => {
        const changes = await base.listChanges(org, page);
        if (grantDuringOldestRead && page.limit === 1 && "after" in page && page.after === 0n) {
          grantDuringOldestRead = false;
          await base.save(rowOf(4), recordOf);
        }
        return changes;
      },
    };
    for (let n = 1; n <= 3; n += 1) {
      await base.save(rowOf(n), recordOf);
    }
    await base.pruneChanges(LATER, 10);
    const h = await harness({ grants, retentionDays: 365 });

    const page = await h.query.listAccessHistory({ org: ACME, afterSequence: 1n });
    expect(page.entries).toEqual([]);
    expect(page.oldestSequence).toBe(4n);
  });

  it("says 0 for both when no window is declared and the organization holds nothing", async () => {
    const h = await harness();
    const page = await h.query.listAccessHistory({ org: ACME });
    expect(page.entries).toEqual([]);
    expect(page.oldestSequence).toBe(0n);
    expect(page.retentionDays).toBe(0);
  });

  it("gives a parent's admin the organization's true oldest number, whatever the page leaves out", async () => {
    const h = await harness({ canView: { kind: "deny", reason: "a parent's admin" }, retentionDays: 30 });
    await h.grant(triple({ kind: "identity_account", id: RAJ }, "editor", { kind: "agent", id: "agt_private" }));
    await h.grant(orgRole(RAJ, "member", ACME));
    const page = await h.query.listAccessHistory({ org: ACME, afterSequence: 0n });
    expect(sequences(page.entries)).toEqual([2]);
    expect(page.oldestSequence).toBe(1n);
  });

  it("never reports an entry the page returned as removed when a pass runs between the page and the oldest read", async () => {
    const base = fakeGrantStore();
    let pruneAfterPage = true;
    const grants: GrantStore = {
      ...base,
      listChanges: async (org, page) => {
        const changes = await base.listChanges(org, page);
        if (pruneAfterPage && page.limit > 1) {
          pruneAfterPage = false;
          await base.pruneChanges(LATER, 2);
        }
        return changes;
      },
    };
    const h = await harness({ grants, retentionDays: 7 });
    const recordOf = (organizationId: string): GrantChangeRecord => ({
      actor: { id: ANA, callerClass: "user" },
      cause: "grant",
      organizationId,
    });
    for (let n = 1; n <= 3; n += 1) {
      const spec = orgRole(`ida_${n}`, "member", ACME);
      await base.save(create(GrantSchema, { metadata: { id: grantIdFor(spec) }, spec }), recordOf(ACME));
    }

    const page = await h.query.listAccessHistory({ org: ACME, afterSequence: 0n });
    expect(sequences(page.entries)).toEqual([1, 2, 3]);
    expect(page.oldestSequence).toBe(1n);
    expect((await base.listChanges(ACME, { limit: 1, after: 0n })).map((change) => change.sequence)).toEqual([3n]);
    const next = await h.query.listAccessHistory({ org: ACME, afterSequence: 0n });
    expect(next.oldestSequence).toBe(3n);
  });

  it("answers a fault reading the oldest kept entry as INTERNAL with a static message", async () => {
    const base = fakeGrantStore();
    const grants: GrantStore = {
      ...base,
      listChanges: (org, page) =>
        page.limit === 1 && "after" in page && page.after === 0n
          ? Promise.reject(new Error("connection reset by peer"))
          : base.listChanges(org, page),
    };
    const h = await harness({ grants });
    const error = await rejection(h.query.listAccessHistory({ org: ACME }));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to read the access history");
  });
});
