/**
 * Pins access-history.ts at the handler level, over a router transport
 * with fakes (the controller.test.ts shape), so every arm of
 * `listAccessHistory` is proven without booting a server; the composed
 * proof over a licensed server and Postgres is Enterprise's
 * enterprise-access-history.postgres.test.ts.
 *
 * Fakes: the domain's in-memory IamPolicyStore (support.ts), which keeps a
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
 *   - a store fault is INTERNAL with a static message.
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
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { AccessHistoryEntry } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  AccessChange,
  AccessChangeCause,
  ApiResourceRefViewSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
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
import { fakeIdentityAccountStore } from "../../identityaccount/__tests__/support.js";
import {
  CAUSE_ON_WIRE,
  causeOnWire,
  listAccessHistory,
} from "../access-history.js";
import type { PolicyChangeCause, PolicyChangeRecord } from "../change.js";
import { ACCESS_HISTORY_UNIMPLEMENTED_MESSAGE, policyIdFor } from "../constants.js";
import { newAccountDisplayResolver } from "../display-resolver.js";
import type { IamPolicyStore } from "../store.js";
import { fakeIamPolicyStore, orgRole, triple } from "./support.js";

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
  readonly query: Client<typeof IamPolicyQueryController>;
  readonly checks: AuthzCheck[];
  readonly policies: ReturnType<typeof fakeIamPolicyStore>;
  /** Writes a row with its change record, as the grant path does. */
  grant(spec: IamPolicySpec, record?: Partial<PolicyChangeRecord>): Promise<void>;
  revoke(spec: IamPolicySpec, record?: Partial<PolicyChangeRecord>): Promise<void>;
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
  policies?: IamPolicyStore;
} = {}): Promise<Harness> {
  const policies = fakeIamPolicyStore();
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
      return Promise.resolve(options.decision ?? { kind: "allow" });
    },
  };
  const displayResolver = newAccountDisplayResolver(accounts);
  const transport = createRouterTransport(
    (router) => {
      router.service(IamPolicyQueryController, {
        listAccessHistory: (input, ctx) =>
          listAccessHistory(
            {
              policies: options.policies ?? policies,
              authorizer,
              principalDisplay: teams,
              gateSteps: new Map(
                options.gate === undefined
                  ? []
                  : [["iam-policy-list-access-history:pre-read", [options.gate]]],
              ),
              edition: options.edition ?? ServerEdition.enterprise,
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
  const recordOf = (record?: Partial<PolicyChangeRecord>): PolicyChangeRecord => ({
    actor: { id: ANA, callerClass: "user" },
    cause: "grant",
    organizationId: ACME,
    ...record,
  });
  const rowOf = (spec: IamPolicySpec) =>
    create(IamPolicySchema, { metadata: { id: policyIdFor(spec) }, spec });
  return {
    query: createClient(IamPolicyQueryController, transport),
    checks,
    policies,
    grant: (spec, record) => policies.save(rowOf(spec), recordOf(record)),
    revoke: (spec, record) =>
      policies.deleteById(policyIdFor(spec), recordOf({ cause: "revoke", ...record })),
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
    const known: PolicyChangeCause = "left_organization";
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
    const base = fakeIamPolicyStore();
    const policies: IamPolicyStore = {
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
    const h = await harness({ gate, policies });
    const error = await rejection(h.query.listAccessHistory({ org: ACME }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(h.checks).toHaveLength(1);
    expect(reads).toEqual([]);

    const denied = await harness({ gate, policies, decision: { kind: "deny", reason: "not an admin" } });
    expect((await rejection(denied.query.listAccessHistory({ org: ACME }))).code).toBe(
      Code.PermissionDenied,
    );
  });

  it("refuses a page size above the most a page holds", async () => {
    const h = await harness();
    const error = await rejection(h.query.listAccessHistory({ org: ACME, pageSize: 101 }));
    expect(error.code).toBe(Code.InvalidArgument);
  });

  it("answers a store fault as INTERNAL with a static message", async () => {
    const base = fakeIamPolicyStore();
    const policies: IamPolicyStore = {
      ...base,
      listChanges: () => Promise.reject(new Error("connection reset by peer")),
    };
    const h = await harness({ policies });
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
