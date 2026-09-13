// Conformance suite for the IamPolicy domain (20260913.01 — the ROW half
// served ONCE by @stigmer/server in every edition: one grant and revoke
// path, the row-driven access lists and counts, revokeOrgAccess,
// checkMyPermission with one definition; the cloud composition serves it
// over its own table through the store driver and mirrors every row to an
// OpenFGA tuple through the two lifecycle hooks).
// Domain: iam / iampolicy.
//
// Drives IamPolicyCommandController + IamPolicyQueryController through the
// raw proto stubs and asserts the cross-edition contract. Every shared arm
// cites the cloud handler line it was read from (stigmer-cloud
// iam/policy/handlers.ts at cee0058e9), because this file is written
// BEFORE its first run against the shipped cloud: the oracle run is the
// S3 readout's first act (T01_1_review.md Q-OR-11 as amended 2026-09-13),
// and a cell that disagrees there is classified, never patched here.
//
// The caller is the organization's creator on every target — the local
// operator, the cloud's PlatformClient-minted primary — so it holds
// `owner` on every organization this file creates (the built-in role
// lifecycle in open source, the tuple driver on cloud; both honour the
// kind's DIRECT attribution) and with it can_grant_access. The principal of
// the grant arms is a SYNTHETIC account id no account holds: neither
// edition checks a principal's existence (Q-OR-14 — OpenFGA references by
// string; the public-viewer wildcard has no row), so the grant is a real,
// ruled behaviour everywhere and needs no second real caller. Real people,
// display fields and the membership rules are the sibling lane's.
//
// What runs on every target:
//   - the creator is listed as `owner`, not inherited, with the display
//     fields whoAmI answers (never literals: the local operator has no
//     email unless STIGMER_OPERATOR_EMAIL was set, and the harness leaves
//     it unset);
//   - create is idempotent by the derived id; a role change is delete then
//     create; getPrincipalResourceRoles and getPrincipalsCount follow the
//     rows; revokeOrgAccess empties one principal's rows on one
//     organization;
//   - get answers the row and the byte-pinned NOT_FOUND copy; delete of an
//     absent triple answers the default instance (Java's contract);
//   - a grant on a kind whose kind_meta lists no roles is INVALID_ARGUMENT
//     with the system-managed copy in EVERY edition — the proto is read
//     before any edition scope (Q-OR-3 as refined 2026-09-13);
//   - the three system RPCs are PERMISSION_DENIED for a wire user with the
//     annotation's copy (Q-OR-7);
//   - checkMyPermission: can_view_access on the organization is true for
//     its owner; a platform permission is false for an ordinary caller in
//     every edition (open source: an enterprise-tiered kind is never held,
//     Q-OR-8 arm 1 — the settings navigation stays hidden; cloud:
//     platform#operator is not the caller); an unknown permission is
//     INVALID_ARGUMENT — PREDICTED RED on the 3.15.0 oracle, which
//     surfaces the OpenFGA 400 as INTERNAL (handlers.ts L430-451), and
//     green after the re-point: the matrix's red→green cell, kept on
//     purpose.
//
// Flagged arms (`describe.skipIf` on a capability, never a target name):
//   - perResourceGrants: a grant on an agent is admitted where true and
//     UNIMPLEMENTED with the edition sentence where false (the scope);
//     checkMyPermission(can_grant_access) on an agent is false where false
//     (Q-OR-5: the console hides the grant controls through the gate it
//     already has);
//   - authorizationQueries: the three tuple-half RPCs and a contextual
//     checkMyPermission answer where true and are UNIMPLEMENTED with the
//     edition sentence where false, never INTERNAL.
//
// The OIDC sibling lane (Q-OR-6; spawnSibling, the 20260911.11 shape): a
// second open-source server in the OIDC posture against the harness's
// local issuer, booted WITH STIGMER_OPERATOR_EMAIL so the operator-email
// rule has a subject. It proves the membership rules — roles that exist
// without an administrator: a provisioned caller who creates an
// organization owns it (the lifecycle path); one who creates it
// idp-shaped and provisions after owns it too (the heal path); a later
// arrival is a member; a creator of a blueprint before provisioning is an
// admin after; the operator's email is an admin; a revoked member who
// provisions again holds nothing. Each arm on its own organization. Where
// no sibling can be spawned the arms skip VISIBLY with the target's reason.
//
// No separate trusted-local block: on `local` the creator IS the
// operator, so the shared arms are the trusted-local proof.
//
// Deliberately OUT of this suite: how the id is derived (server-internal;
// the domain's unit suites pin it); the cloud's positive tuple behaviour
// (the composition's own tests); the operator's boot-time ownership of
// pre-existing organizations (needs a restart; unit-pinned); revoking an
// organization's last owner (plan finding 3, a product rule nobody owns
// yet); the two listAuthorized*Ids' authorization contract (slice 1's,
// S1 finding 7).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import {
  startLocalOidcIssuer,
  type LocalOidcIssuer,
} from "../harness/local-oidc-issuer";
import { makeAgent } from "../support/agents";
import { freshSubject } from "../support/identityaccounts";
import {
  AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
  BOOTSTRAP_POLICY_DENIED_MESSAGE,
  BOOTSTRAP_REVOKE_ORG_ACCESS_DENIED_MESSAGE,
  CLEANUP_RESOURCE_POLICIES_DENIED_MESSAGE,
  ORGANIZATION_ROLES,
  PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE,
  noGrantableRolesMessage,
  organizationRole,
  policyNotFoundMessage,
  policyTriple,
  ref,
  roleNotGrantableMessage,
  syntheticAccountId,
  unknownPermissionMessage,
} from "../support/iampolicies";
import { uniqueName } from "../support/naming";
import {
  createTarget,
  type SiblingServer,
  type TargetProfile,
} from "../targets";

const ORGANIZATION_API_VERSION = "tenancy.stigmer.ai/v1";
const ORGANIZATION_KIND = "Organization";
// An agent id shaped like a real one; no such agent exists on any target.
const ABSENT_AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzz";

let target: TargetProfile;
let clients: ConformanceClients;
const capabilities = createTarget().capabilities;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

// An organization the caller creates and therefore owns; deleted at the end
// of the arm so its rows (and on cloud, their tuples) go with it. The id IS
// the slug — the one kind whose id is not minted.
async function createOwnedOrganization(
  using: ConformanceClients = clients,
  tracker: FixtureTracker = fixtures,
): Promise<string> {
  const org = await using.organizationCommand.create({
    apiVersion: ORGANIZATION_API_VERSION,
    kind: ORGANIZATION_KIND,
    metadata: { name: uniqueName("roles-org") },
  });
  const id = org.metadata?.id ?? "";
  expect(id, "the organization was created").not.toBe("");
  tracker.defer(() => using.organizationCommand.delete({ value: id }));
  return id;
}

async function rolesOf(
  accountId: string,
  organizationId: string,
  using: ConformanceClients = clients,
): Promise<ReadonlyArray<string>> {
  const roles = await using.iamPolicyQuery.getPrincipalResourceRoles({
    principal: ref("identity_account", accountId),
    resource: ref("organization", organizationId),
  });
  return roles.roles.map((role) => role.code);
}

describe("IamPolicy conformance — the creator owns the organization", () => {
  it("lists the creator as owner, not inherited, with the display fields whoAmI answers", async () => {
    const me = await clients.identityAccountQuery.whoAmI({});
    const org = await createOwnedOrganization();

    // handlers.ts L279-304: authorize can_view_access on the resource, then
    // the row-driven hierarchy walk and the grouped access list.
    const access = await clients.iamPolicyQuery.listResourceAccessByPrincipal({
      resource: ref("organization", org),
    });
    const mine = access.entries.find(
      (entry) => entry.principal?.id === me.metadata?.id,
    );
    expect(mine, "the creator has an entry").toBeDefined();
    expect(mine?.roles.map((grant) => grant.role?.code)).toContain("owner");
    expect(mine?.roles.every((grant) => !grant.isInherited)).toBe(true);
    expect(mine?.principal?.email).toBe(me.spec?.email ?? "");

    // handlers.ts L331-348: distinct principals holding an assignable role.
    const count = await clients.iamPolicyQuery.getPrincipalsCount({
      orgId: org,
      principalKind: "identity_account",
    });
    expect(count.count).toBe(1);
  });
});

describe("IamPolicy conformance — grants on the organization, the Members page's RPCs", () => {
  it("create is idempotent: the same triple twice answers one policy, one row, one counted principal", async () => {
    const org = await createOwnedOrganization();
    const member = syntheticAccountId();
    const spec = organizationRole(member, "member", org);

    // handlers.ts L111-121 → service.createPolicy: a held triple answers
    // the existing row (the cloud's app-level check; open source's primary
    // key by derived id).
    const first = await clients.iamPolicyCommand.create(spec);
    const second = await clients.iamPolicyCommand.create(spec);

    expect(first.metadata?.id).toMatch(/^iamp_[0-9a-z]+$/);
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(first.spec).toEqual(spec);
    expect(await rolesOf(member, org)).toEqual(["member"]);
    const count = await clients.iamPolicyQuery.getPrincipalsCount({
      orgId: org,
      principalKind: "identity_account",
    });
    expect(count.count, "the creator and the member").toBe(2);
  });

  it("a role change is delete then create, and the roles follow", async () => {
    const org = await createOwnedOrganization();
    const member = syntheticAccountId();
    const created = await clients.iamPolicyCommand.create(
      organizationRole(member, "member", org),
    );

    // handlers.ts L123-139: find by spec, authorize, delete; answers the row.
    const deleted = await clients.iamPolicyCommand.delete(
      organizationRole(member, "member", org),
    );
    await clients.iamPolicyCommand.create(
      organizationRole(member, "admin", org),
    );

    expect(deleted.metadata?.id).toBe(created.metadata?.id);
    expect(await rolesOf(member, org)).toEqual(["admin"]);
  });

  it("every kind_meta role of the organization is grantable; a role it does not list is INVALID_ARGUMENT with the byte-pinned copy", async () => {
    const org = await createOwnedOrganization();
    const person = syntheticAccountId();
    for (const role of ORGANIZATION_ROLES) {
      await clients.iamPolicyCommand.create(
        organizationRole(person, role, org),
      );
    }
    expect([...(await rolesOf(person, org))].sort()).toEqual(
      [...ORGANIZATION_ROLES].sort(),
    );

    // handlers.ts L413-419.
    const error = await expectGrpcCode(
      () =>
        clients.iamPolicyCommand.create(
          organizationRole(person, "editor", org),
        ),
      Code.InvalidArgument,
      "a role the organization's kind_meta does not list",
    );
    expect(error.rawMessage).toBe(
      roleNotGrantableMessage("editor", "organization", ORGANIZATION_ROLES),
    );
  });

  it("revokeOrgAccess empties one principal's rows on one organization and touches nothing else", async () => {
    const org = await createOwnedOrganization();
    const other = await createOwnedOrganization();
    const person = syntheticAccountId();
    const bystander = syntheticAccountId();
    await clients.iamPolicyCommand.create(
      organizationRole(person, "admin", org),
    );
    await clients.iamPolicyCommand.create(
      organizationRole(person, "viewer", org),
    );
    await clients.iamPolicyCommand.create(
      organizationRole(person, "member", other),
    );
    await clients.iamPolicyCommand.create(
      organizationRole(bystander, "member", org),
    );

    // handlers.ts L164-179 → service.revokeOrgAccess.
    await clients.iamPolicyCommand.revokeOrgAccess({
      identityAccountId: person,
      organizationId: org,
    });

    expect(await rolesOf(person, org)).toEqual([]);
    expect(await rolesOf(person, other)).toEqual(["member"]);
    expect(await rolesOf(bystander, org)).toEqual(["member"]);
  });

  it("get answers the row by id, and the byte-pinned NOT_FOUND copy for an unknown id", async () => {
    const org = await createOwnedOrganization();
    const created = await clients.iamPolicyCommand.create(
      organizationRole(syntheticAccountId(), "member", org),
    );

    // handlers.ts L205-218: load, then authorize on the row's resource.
    const got = await clients.iamPolicyQuery.get({
      value: created.metadata?.id ?? "",
    });
    expect(got.spec).toEqual(created.spec);

    const error = await expectGrpcCode(
      () =>
        clients.iamPolicyQuery.get({
          value: "iamp_00000000000000000000000000",
        }),
      Code.NotFound,
      "get for an unknown policy id",
    );
    expect(error.rawMessage).toBe(
      policyNotFoundMessage("iamp_00000000000000000000000000"),
    );
  });

  it("delete of an absent triple answers the default instance — Java's contract", async () => {
    const org = await createOwnedOrganization();

    // handlers.ts L124-129: no row, no error, the empty message.
    const deleted = await clients.iamPolicyCommand.delete(
      organizationRole(syntheticAccountId(), "member", org),
    );
    expect(deleted.metadata?.id ?? "").toBe("");
  });

  it("a grant on a kind whose kind_meta lists no roles is INVALID_ARGUMENT with the system-managed copy in every edition", async () => {
    // The target is the caller's OWN account so the authorization check
    // passes on cloud too (identity_account#can_grant_access: owner, and a
    // person owns their account): the refusal under test is the role
    // check's, handlers.ts L399-412, which reads kind_meta — the same
    // proto both editions read, so no edition sentence belongs here.
    const me = await clients.identityAccountQuery.whoAmI({});
    const error = await expectGrpcCode(
      () =>
        clients.iamPolicyCommand.create(
          policyTriple(
            { kind: "identity_account", id: syntheticAccountId() },
            "viewer",
            { kind: "identity_account", id: me.metadata?.id ?? "" },
          ),
        ),
      Code.InvalidArgument,
      "a grant on an identity account",
    );
    expect(error.rawMessage).toBe(noGrantableRolesMessage("identity_account"));
  });
});

describe("IamPolicy conformance — the three system RPCs refuse a wire user (Q-OR-7)", () => {
  it.each([
    [
      "bootstrapPolicy",
      (org: string) =>
        clients.iamPolicyCommand.bootstrapPolicy(
          policyTriple({ kind: "organization", id: org }, "organization", {
            kind: "agent",
            id: ABSENT_AGENT,
          }),
        ),
      BOOTSTRAP_POLICY_DENIED_MESSAGE,
    ],
    [
      "cleanupResourcePolicies",
      (org: string) =>
        clients.iamPolicyCommand.cleanupResourcePolicies(
          ref("organization", org),
        ),
      CLEANUP_RESOURCE_POLICIES_DENIED_MESSAGE,
    ],
    [
      "bootstrapRevokeOrgAccess",
      (org: string) =>
        clients.iamPolicyCommand.bootstrapRevokeOrgAccess({
          identityAccountId: syntheticAccountId(),
          organizationId: org,
        }),
      BOOTSTRAP_REVOKE_ORG_ACCESS_DENIED_MESSAGE,
    ],
  ] as const)(
    "%s is PERMISSION_DENIED with the annotation's copy",
    async (name, call, copy) => {
      // The annotation's static target is platform:stigmer#can_bootstrap_iam
      // (command.proto); on cloud FGA denies it for a non-operator
      // (handlers.ts L141-192 → authorize.ts L70-72), in open source the
      // admission guard refuses every wire user — same code, same copy.
      const org = await createOwnedOrganization();
      const error = await expectGrpcCode(
        () => call(org),
        Code.PermissionDenied,
        `${name} from a wire user`,
      );
      expect(error.rawMessage).toBe(copy);
    },
  );
});

describe("IamPolicy conformance — checkMyPermission has one definition (Q-OR-8)", () => {
  it("can_view_access on an organization the caller owns is true", async () => {
    const org = await createOwnedOrganization();
    const result = await clients.iamPolicyQuery.checkMyPermission({
      resource: ref("organization", org),
      relation: "can_view_access",
    });
    expect(result.isAuthorized).toBe(true);
  });

  it("a platform permission is false for an ordinary caller in every edition — the operator-only settings navigation stays hidden", async () => {
    // Open source: `platform` is enterprise-tiered, so nobody holds a
    // permission on it there (arm 1). Cloud: platform#operator is not the
    // conformance user (fga/model/platform.fga). The console's
    // useSettingsNavGroups asks exactly this, fail-closed.
    const result = await clients.iamPolicyQuery.checkMyPermission({
      resource: ref("platform", "stigmer"),
      relation: "can_manage_model_pricing",
    });
    expect(result.isAuthorized).toBe(false);
  });

  it("an unknown permission is INVALID_ARGUMENT, quoted (predicted red on the 3.15.0 oracle: INTERNAL from the FGA 400)", async () => {
    const org = await createOwnedOrganization();
    const error = await expectGrpcCode(
      () =>
        clients.iamPolicyQuery.checkMyPermission({
          resource: ref("organization", org),
          relation: "can_fly",
        }),
      Code.InvalidArgument,
      "checkMyPermission with a relation that is no IamPermission",
    );
    expect(error.rawMessage).toBe(unknownPermissionMessage("can_fly"));
  });
});

describe.skipIf(capabilities.perResourceGrants)(
  "IamPolicy conformance — organization-only grants (the open-source scope)",
  () => {
    it("a grant on an agent is UNIMPLEMENTED with the edition sentence, never INVALID_ARGUMENT or INTERNAL", async () => {
      const error = await expectGrpcCode(
        () =>
          clients.iamPolicyCommand.create(
            policyTriple(
              { kind: "identity_account", id: syntheticAccountId() },
              "viewer",
              { kind: "agent", id: ABSENT_AGENT },
            ),
          ),
        Code.Unimplemented,
        "a grant on an agent with organization-only scope",
      );
      expect(error.rawMessage).toBe(PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE);
    });

    it("checkMyPermission(can_grant_access) on an agent is false — the console hides the grant controls (Q-OR-5)", async () => {
      const result = await clients.iamPolicyQuery.checkMyPermission({
        resource: ref("agent", ABSENT_AGENT),
        relation: "can_grant_access",
      });
      expect(result.isAuthorized).toBe(false);
    });
  },
);

describe.skipIf(!capabilities.perResourceGrants)(
  "IamPolicy conformance — per-resource grants (the composed scope)",
  () => {
    it("a grant on an agent the caller owns is admitted and revoked through the same path", async () => {
      const org = await createOwnedOrganization();
      const agent = await clients.agentCommand.create(
        makeAgent({ org, name: uniqueName("shared-agent") }),
      );
      const agentId = agent.metadata?.id ?? "";
      fixtures.defer(() => clients.agentCommand.delete({ value: agentId }));
      const viewer = syntheticAccountId();
      const grant = policyTriple(
        { kind: "identity_account", id: viewer },
        "viewer",
        { kind: "agent", id: agentId },
      );

      const created = await clients.iamPolicyCommand.create(grant);
      expect(created.spec).toEqual(grant);
      const roles = await clients.iamPolicyQuery.getPrincipalResourceRoles({
        principal: ref("identity_account", viewer),
        resource: ref("agent", agentId),
      });
      expect(roles.roles.map((role) => role.code)).toEqual(["viewer"]);

      const deleted = await clients.iamPolicyCommand.delete(grant);
      expect(deleted.metadata?.id).toBe(created.metadata?.id);
    });

    it("checkMyPermission(can_grant_access) on an agent the caller's organization owns is the Authorizer's answer: true", async () => {
      const org = await createOwnedOrganization();
      const agent = await clients.agentCommand.create(
        makeAgent({ org, name: uniqueName("owned-agent") }),
      );
      const agentId = agent.metadata?.id ?? "";
      fixtures.defer(() => clients.agentCommand.delete({ value: agentId }));

      const result = await clients.iamPolicyQuery.checkMyPermission({
        resource: ref("agent", agentId),
        relation: "can_grant_access",
      });
      expect(result.isAuthorized).toBe(true);
    });
  },
);

describe.skipIf(capabilities.authorizationQueries)(
  "IamPolicy conformance — no authorization query engine composed",
  () => {
    // Inputs that pass the boundary validator so the refusal under test is
    // the handler's: the capability is consulted before any lookup.
    it.each([
      [
        "checkAuthorization",
        (me: string, org: string) =>
          clients.iamPolicyQuery.checkAuthorization({
            policy: organizationRole(me, "admin", org),
          }),
      ],
      [
        "listAuthorizedResourceIds",
        (me: string, _org: string) =>
          clients.iamPolicyQuery.listAuthorizedResourceIds({
            principal: ref("identity_account", me),
            resourceKind: "organization",
            relation: "can_view",
          }),
      ],
      [
        "listAuthorizedPrincipalIds",
        (_me: string, org: string) =>
          clients.iamPolicyQuery.listAuthorizedPrincipalIds({
            resource: ref("organization", org),
            principalKind: "identity_account",
            relation: "can_view",
          }),
      ],
      [
        "checkMyPermission with contextual policies",
        (me: string, org: string) =>
          clients.iamPolicyQuery.checkMyPermission({
            resource: ref("organization", org),
            relation: "can_view",
            contextualPolicies: [organizationRole(me, "viewer", org)],
          }),
      ],
    ] as const)(
      "%s is UNIMPLEMENTED with the edition sentence, never INTERNAL",
      async (name, call) => {
        const me =
          (await clients.identityAccountQuery.whoAmI({})).metadata?.id ?? "";
        const org = await createOwnedOrganization();
        const error = await expectGrpcCode(
          () => call(me, org),
          Code.Unimplemented,
          `${name} with no query engine`,
        );
        expect(error.rawMessage).toContain(
          AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
        );
      },
    );
  },
);

describe.skipIf(!capabilities.authorizationQueries)(
  "IamPolicy conformance — the tuple-half queries (the composed engine)",
  () => {
    it("checkAuthorization answers the caller's own ownership; listAuthorized*Ids see the same graph", async () => {
      const me =
        (await clients.identityAccountQuery.whoAmI({})).metadata?.id ?? "";
      const org = await createOwnedOrganization();

      // handlers.ts L233-246: a user may check only themselves.
      const own = await clients.iamPolicyQuery.checkAuthorization({
        policy: organizationRole(me, "owner", org),
      });
      expect(own.isAuthorized).toBe(true);

      // handlers.ts L248-277 (no authorization on either, Java parity).
      const resources = await clients.iamPolicyQuery.listAuthorizedResourceIds({
        principal: ref("identity_account", me),
        resourceKind: "organization",
        relation: "owner",
      });
      expect(resources.resourceIds).toContain(org);
      const principals =
        await clients.iamPolicyQuery.listAuthorizedPrincipalIds({
          resource: ref("organization", org),
          principalKind: "identity_account",
          relation: "owner",
        });
      expect(principals.principalIds).toContain(me);
    });

    it("checkMyPermission carrying contextual policies is answered by the engine, not refused", async () => {
      const me =
        (await clients.identityAccountQuery.whoAmI({})).metadata?.id ?? "";
      const org = await createOwnedOrganization();

      // handlers.ts L220-231: the contextual rows ride into the FGA check.
      // The owner is a viewer by the ladder, so the answer is true whether
      // or not the row is considered; the arm pins that the lane is SERVED
      // here (its open-source twin above pins the refusal).
      const contextual = await clients.iamPolicyQuery.checkMyPermission({
        resource: ref("organization", org),
        relation: "can_view_access",
        contextualPolicies: [organizationRole(me, "viewer", org)],
      });
      expect(contextual.isAuthorized).toBe(true);
    });
  },
);

describe("IamPolicy conformance — the membership rules on an OIDC sibling (Q-OR-6)", () => {
  const OPERATOR_EMAIL = "operator@conformance.example.com";
  let issuer: LocalOidcIssuer | undefined;
  let sibling: SiblingServer | undefined;
  const siblingFixtures = new FixtureTracker();

  beforeAll(async () => {
    if (target.spawnSibling === undefined) return;
    issuer = await startLocalOidcIssuer();
    sibling = await target.spawnSibling({
      env: {
        STIGMER_OIDC_ISSUER: issuer.issuer,
        STIGMER_OIDC_AUDIENCE: issuer.audience,
        // The operator-email rule needs a subject; under the OIDC posture
        // no operator account is ensured (20260911.11 A2), so this only
        // names who becomes admin on arrival.
        STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
      },
      readinessBearer: await issuer.mint({
        sub: freshSubject(),
        email: "readiness@example.com",
      }),
    });
  });

  afterEach(async () => {
    await siblingFixtures.cleanup();
  });

  afterAll(async () => {
    await sibling?.teardown();
    await issuer?.close();
  });

  interface SiblingLane {
    readonly issuer: LocalOidcIssuer;
    readonly sibling: SiblingServer;
  }

  function siblingOrSkip(ctx: { skip: (note?: string) => never }): SiblingLane {
    if (issuer === undefined || sibling === undefined) {
      ctx.skip(
        target.spawnSiblingUnavailable?.() ??
          "the target cannot spawn a sibling server",
      );
    }
    return { issuer, sibling };
  }

  // A fresh person on the sibling: their clients, and a `provision` that
  // answers the account id the server derived for them (the suite reads
  // it from provisionMyAccount rather than deriving it — the id is the
  // server's business).
  async function newPerson(lane: SiblingLane, email: string) {
    const asPerson = lane.sibling.clientsPresenting(
      await lane.issuer.mint({ sub: freshSubject(), email }),
    );
    const provision = async (): Promise<string> =>
      (await asPerson.identityAccountCommand.provisionMyAccount({})).metadata
        ?.id ?? "";
    return { asPerson, provision };
  }

  it("a provisioned caller who creates an organization owns it — the built-in role lifecycle", async (ctx) => {
    const lane = siblingOrSkip(ctx);
    const founder = await newPerson(lane, "founder@example.com");
    const founderId = await founder.provision();

    const org = await createOwnedOrganization(
      founder.asPerson,
      siblingFixtures,
    );

    expect(await rolesOf(founderId, org, founder.asPerson)).toEqual(["owner"]);
  });

  it("a caller who creates an organization idp-shaped and provisions after owns it — the creator-stamp heal", async (ctx) => {
    const lane = siblingOrSkip(ctx);
    const founder = await newPerson(lane, "early-founder@example.com");

    // Not yet provisioned: the verifier admits the subject idp-shaped, the
    // permissive Authorizer lets it create, and the lifecycle's guard
    // writes nothing because no account exists (Q-OR-6a).
    const org = await createOwnedOrganization(
      founder.asPerson,
      siblingFixtures,
    );
    const founderId = await founder.provision();

    expect(await rolesOf(founderId, org, founder.asPerson)).toEqual(["owner"]);
  });

  it("a later arrival is a member of the organizations that already exist", async (ctx) => {
    const lane = siblingOrSkip(ctx);
    const founder = await newPerson(lane, "founder-2@example.com");
    await founder.provision();
    const org = await createOwnedOrganization(
      founder.asPerson,
      siblingFixtures,
    );

    const newcomer = await newPerson(lane, "newcomer@example.com");
    const newcomerId = await newcomer.provision();

    expect(await rolesOf(newcomerId, org, newcomer.asPerson)).toEqual([
      "member",
    ]);
  });

  it("a caller who created a blueprint before provisioning is an admin after — nobody loses access on upgrade", async (ctx) => {
    const lane = siblingOrSkip(ctx);
    const founder = await newPerson(lane, "founder-3@example.com");
    await founder.provision();
    const org = await createOwnedOrganization(
      founder.asPerson,
      siblingFixtures,
    );

    const author = await newPerson(lane, "author@example.com");
    const agent = await author.asPerson.agentCommand.create(
      makeAgent({ org, name: uniqueName("legacy-agent") }),
    );
    const agentId = agent.metadata?.id ?? "";
    siblingFixtures.defer(() =>
      author.asPerson.agentCommand.delete({ value: agentId }),
    );
    const authorId = await author.provision();

    expect(await rolesOf(authorId, org, author.asPerson)).toEqual(["admin"]);
  });

  it("the operator's email is an admin on arrival", async (ctx) => {
    const lane = siblingOrSkip(ctx);
    const founder = await newPerson(lane, "founder-4@example.com");
    await founder.provision();
    const org = await createOwnedOrganization(
      founder.asPerson,
      siblingFixtures,
    );

    const operator = await newPerson(lane, OPERATOR_EMAIL);
    const operatorId = await operator.provision();

    expect(await rolesOf(operatorId, org, operator.asPerson)).toEqual([
      "admin",
    ]);
  });

  it("a revoked member who provisions again holds nothing — the rules run on the call that created the account", async (ctx) => {
    const lane = siblingOrSkip(ctx);
    const founder = await newPerson(lane, "founder-5@example.com");
    const founderId = await founder.provision();
    const org = await createOwnedOrganization(
      founder.asPerson,
      siblingFixtures,
    );
    const member = await newPerson(lane, "revoked@example.com");
    const memberId = await member.provision();
    expect(await rolesOf(memberId, org, member.asPerson)).toEqual(["member"]);

    await founder.asPerson.iamPolicyCommand.revokeOrgAccess({
      identityAccountId: memberId,
      organizationId: org,
    });
    const again = await member.provision();

    expect(again).toBe(memberId);
    expect(await rolesOf(memberId, org, member.asPerson)).toEqual([]);
    expect(await rolesOf(founderId, org, founder.asPerson)).toEqual(["owner"]);
  });
});
