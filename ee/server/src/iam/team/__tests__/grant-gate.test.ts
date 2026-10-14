/**
 * The team grant gate over an in-memory store and a recording query
 * engine. Pins:
 *   - a person shared a resource: the resource's organization is its scope
 *     link; someone who is not one of that organization's viewers is
 *     FAILED_PRECONDITION, asked as `identity_account:<p> viewer
 *     organization:<org>`; a viewer passes; a resource no organization
 *     holds, an organization role and a structural principal ask nothing;
 *   - a team grant: a team that does not exist and a team whose
 *     organization is not the resource's answer one FAILED_PRECONDITION
 *     with one copy, which names only the id the caller sent (never the
 *     team's name or organization); the organization question is asked as
 *     `organization:<team org> organization <resource>`; the resource's
 *     own organization passes;
 *   - a membership grant asks the viewer question first, so an account of
 *     another organization is refused as not a member whatever its kind;
 *     one of the organization's own service accounts is then
 *     FAILED_PRECONDITION as a service account;
 *   - a membership grant: someone who is not one of the team's
 *     organization's viewers is FAILED_PRECONDITION, asked as
 *     `identity_account:<p> viewer organization:<team org>`; a viewer
 *     passes; a team that does not exist is NOT_FOUND;
 *   - both membership refusals name the organization by its slug, read
 *     from the organization lookup; one the lookup no longer answers, by
 *     its id;
 *   - an engine fault is the engine's error, never a refusal.
 *
 * Organizations are named by id everywhere the gate reads or asks (the
 * stored team, the scope link, the engine), as the server stores them.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AuthorizationQueryEngine, GrantStore } from "@stigmer/server";
import { RequestContext } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { GrantSchema } from "@stigmer/protos/ai/stigmer/iam/grant/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import type { GrantSpec } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import {
  ApiResourceRefSchema,
  GrantSpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";

import type { OrganizationLookup } from "../../organization-links.js";
import { newOrganizationGrantGateStep } from "../grant-gate.js";
import { InMemoryTeamStore, storedTeam } from "./in-memory-team-store.js";

function spec(
  principal: { kind: string; id: string; relation?: string },
  relation: string,
  resource: { kind: string; id: string },
): GrantSpec {
  return create(GrantSpecSchema, {
    principal: create(ApiResourceRefSchema, principal),
    relation,
    resource: create(ApiResourceRefSchema, resource),
  });
}

/** Acme's id, as its create minted it; its slug is `acme`. */
const ACME_ID = "org_acme";

/** The organization lookup: Acme alone, by its id. */
const organizations: Pick<OrganizationLookup, "find"> = {
  find: (orgId) =>
    Promise.resolve(
      orgId === ACME_ID ? { createdAt: undefined, name: "Acme", slug: "acme", logoUrl: "", parentOrg: "" } : undefined,
    ),
};

/** The accounts a member add may name: `ci` is Acme's service account; anyone else is a person. */
const ACCOUNTS: ReadonlyMap<string, IdentityAccount> = new Map([
  [
    "ci",
    create(IdentityAccountSchema, {
      metadata: { id: "ci", org: ACME_ID, name: "ci-deploy" },
      spec: {
        idpId: `stgm_sa|${ACME_ID}|0f`,
        provisioningMode: IdentityAccountProvisioningMode.service_account,
      },
    }),
  ],
  [
    "vic",
    create(IdentityAccountSchema, {
      metadata: { id: "vic" },
      spec: { idpId: "auth0|vic", provisioningMode: IdentityAccountProvisioningMode.direct },
    }),
  ],
]);

interface Asked {
  readonly user: string;
  readonly relation: string;
  readonly object: string;
}

function rig(
  answer: (asked: Asked) => boolean | Error = () => true,
  plan?: { allowsTeams(orgId: string): Promise<boolean> },
  /** Each resource's organization, as its scope link names it: `kind:id` → org. */
  organizationOf: Readonly<Record<string, string>> = {},
) {
  const teams = new InMemoryTeamStore();
  const scopes: Pick<GrantStore, "findScopeTuple"> = {
    findScopeTuple: (kind, id) => {
      const org = organizationOf[`${kind}:${id}`];
      return Promise.resolve(
        org === undefined
          ? undefined
          : create(GrantSchema, {
              spec: spec({ kind: "organization", id: org }, "organization", { kind, id }),
            }),
      );
    },
  };
  const asked: Asked[] = [];
  const queries: Pick<AuthorizationQueryEngine, "check"> = {
    check: (grant) => {
      const question = {
        user: `${grant.principal?.kind ?? ""}:${grant.principal?.id ?? ""}`,
        relation: grant.relation,
        object: `${grant.resource?.kind ?? ""}:${grant.resource?.id ?? ""}`,
      };
      asked.push(question);
      const result = answer(question);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  const step = newOrganizationGrantGateStep({
    teams,
    queries,
    scopes,
    organizations,
    accounts: { findById: (id) => Promise.resolve(ACCOUNTS.get(id)) },
    ...(plan === undefined ? {} : { plan }),
  });
  const run = (input: GrantSpec) =>
    step.execute(
      new RequestContext(
        GrantSpecSchema,
        input,
        { identityId: "ida_admin", callerClass: "user", issuer: "", rawToken: "" },
        ApiResourceKind.api_resource_kind_unknown,
      ),
    );
  return { teams, asked, run };
}

async function refusal(work: Promise<unknown> | void): Promise<ConnectError> {
  try {
    await work;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

describe("a resource shared with a person", () => {
  const share = spec({ kind: "identity_account", id: "vic" }, "viewer", { kind: "agent", id: "agt_1" });

  it("refuses someone who is not one of the resource's organization's viewers", async () => {
    const r = rig(() => false, undefined, { "agent:agt_1": ACME_ID });
    const refused = await refusal(r.run(share));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "identity account 'vic' is not a member of organization 'acme'; add them to the organization before sharing its resources with them",
    );
    expect(r.asked).toEqual([
      { user: "identity_account:vic", relation: "viewer", object: `organization:${ACME_ID}` },
    ]);
  });

  it("passes one of the organization's viewers", async () => {
    const r = rig(() => true, undefined, { "agent:agt_1": ACME_ID });
    await r.run(share);
    expect(r.asked).toEqual([
      { user: "identity_account:vic", relation: "viewer", object: `organization:${ACME_ID}` },
    ]);
  });

  it("asks nothing for a resource no organization holds, an organization role, or a structural principal", async () => {
    const r = rig(() => false);
    await r.run(share);
    await r.run(spec({ kind: "identity_account", id: "vic" }, "member", { kind: "organization", id: ACME_ID }));
    await r.run(spec({ kind: "organization", id: ACME_ID }, "organization", { kind: "agent", id: "agt_1" }));
    expect(r.asked).toEqual([]);
  });
});

describe("a grant to a team", () => {
  const share = spec(
    { kind: "team", id: "tm_sre", relation: "member" },
    "viewer",
    { kind: "agent", id: "agt_1" },
  );

  it("answers a team that does not exist and another organization's team with one code and one copy", async () => {
    const missing = rig();
    const onMissing = await refusal(missing.run(share));
    expect(missing.asked).toEqual([]);

    const crossing = rig(() => false);
    await crossing.teams.insert(storedTeam({ id: "tm_sre", org: "other", slug: "sre", name: "SRE" }));
    const onCrossing = await refusal(crossing.run(share));
    expect(crossing.asked).toEqual([
      { user: "organization:other", relation: "organization", object: "agent:agt_1" },
    ]);

    for (const refused of [onMissing, onCrossing]) {
      expect(refused.code).toBe(Code.FailedPrecondition);
      expect(refused.rawMessage).toBe(
        "team 'tm_sre' is not a team of this resource's organization, and a team can be granted only on its own organization's resources",
      );
    }
  });

  it("names neither another organization's team nor that organization in its refusal", async () => {
    const r = rig(() => false);
    await r.teams.insert(storedTeam({ id: "tm_sre", org: "other", slug: "sre", name: "SRE" }));
    const refused = await refusal(r.run(share));
    expect(refused.rawMessage).not.toMatch(/SRE|other/);
  });

  it("passes a team of the resource's organization", async () => {
    const r = rig(() => true);
    await r.teams.insert(storedTeam({ id: "tm_sre", org: ACME_ID, slug: "sre" }));
    await r.run(share);
    expect(r.asked).toEqual([
      { user: `organization:${ACME_ID}`, relation: "organization", object: "agent:agt_1" },
    ]);
  });
});

describe("adding someone to a team", () => {
  const join = spec({ kind: "identity_account", id: "vic" }, "member", { kind: "team", id: "tm_sre" });

  it("refuses the organization's own service account: a team is a group of people", async () => {
    const r = rig(() => true);
    await r.teams.insert(storedTeam({ id: "tm_sre", org: ACME_ID, slug: "sre" }));

    const refused = await refusal(
      r.run(spec({ kind: "identity_account", id: "ci" }, "member", { kind: "team", id: "tm_sre" })),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "identity account 'ci' is a service account; a team is a group of the organization's people, so share resources with the service account directly",
    );
    expect(r.asked).toEqual([
      { user: "identity_account:ci", relation: "viewer", object: `organization:${ACME_ID}` },
    ]);
  });

  it("refuses another organization's service account as not a member, never telling its kind", async () => {
    const r = rig(() => false);
    await r.teams.insert(storedTeam({ id: "tm_sre", org: ACME_ID, slug: "sre" }));

    const refused = await refusal(
      r.run(spec({ kind: "identity_account", id: "ci" }, "member", { kind: "team", id: "tm_sre" })),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "identity account 'ci' is not a member of organization 'acme'; add them to the organization before adding them to one of its teams",
    );
  });

  it("refuses someone who is not one of the organization's viewers", async () => {
    const r = rig(() => false);
    await r.teams.insert(storedTeam({ id: "tm_sre", org: ACME_ID, slug: "sre" }));

    const refused = await refusal(r.run(join));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "identity account 'vic' is not a member of organization 'acme'; add them to the organization before adding them to one of its teams",
    );
    expect(r.asked).toEqual([
      { user: "identity_account:vic", relation: "viewer", object: `organization:${ACME_ID}` },
    ]);
  });

  it("names an organization the lookup no longer answers by its id", async () => {
    const r = rig(() => false);
    await r.teams.insert(storedTeam({ id: "tm_sre", org: "org_gone", slug: "sre" }));

    const refused = await refusal(r.run(join));
    expect(refused.rawMessage).toBe(
      "identity account 'vic' is not a member of organization 'org_gone'; add them to the organization before adding them to one of its teams",
    );
  });

  it("refuses a member add in an organization whose plan lacks teams, before any engine read", async () => {
    const r = rig(() => true, { allowsTeams: () => Promise.resolve(false) });
    await r.teams.insert(storedTeam({ id: "tm_sre", org: ACME_ID, slug: "sre" }));

    const refused = await refusal(r.run(join));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      `Organization '${ACME_ID}' is on a plan without teams; it keeps its existing teams. Upgrade its plan to create a team or add a member.`,
    );
    expect(refused.findDetails(ErrorInfoSchema).map((info) => [info.reason, info.domain, info.metadata])).toEqual([
      ["PLAN_UPGRADE_REQUIRED", "stigmer.ai", { feature: "teams", org: ACME_ID }],
    ]);
    expect(r.asked).toEqual([]);
  });

  it("never plan-gates a grant naming a team as the principal", async () => {
    const r = rig(() => true, { allowsTeams: () => Promise.resolve(false) });
    await r.teams.insert(storedTeam({ id: "tm_sre", org: ACME_ID, slug: "sre" }));
    await r.run(spec({ kind: "team", id: "tm_sre", relation: "member" }, "viewer", { kind: "agent", id: "agt_1" }));
    expect(r.asked).toHaveLength(1);
  });

  it("passes one of the organization's viewers", async () => {
    const r = rig(() => true);
    await r.teams.insert(storedTeam({ id: "tm_sre", org: ACME_ID, slug: "sre" }));
    await r.run(join);
    expect(r.asked).toHaveLength(1);
  });

  it("refuses a team that does not exist", async () => {
    const r = rig();
    const refused = await refusal(r.run(join));
    expect(refused.code).toBe(Code.NotFound);
  });
});

describe("an engine fault", () => {
  it("is the engine's error, never a refusal", async () => {
    const r = rig(() => new ConnectError("OpenFGA is unavailable", Code.Unavailable));
    await r.teams.insert(storedTeam({ id: "tm_sre", org: ACME_ID, slug: "sre" }));

    const failed = await refusal(
      r.run(spec({ kind: "identity_account", id: "vic" }, "member", { kind: "team", id: "tm_sre" })),
    );
    expect(failed.code).toBe(Code.Unavailable);
  });
});
