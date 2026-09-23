// The enforcing lane's two builders — see TargetProfile.enforcingLane.
// Domain: conformance harness.
//
// An authorization arm needs one thing the trusted-local primary cannot
// give it: a server whose Authorizer enforces the model, with several real
// people on it. The cloud's primary IS that server; open source becomes it
// in the OIDC posture (STIGMER_OIDC_ISSUER set, no unit registering its own
// Authorizer — the built-in Authorizer, directory and list scope of
// `@stigmer/server`). This module builds the same `EnforcingLane` over
// either, so an arm is written once and runs against both:
//
//   - newPrimaryEnforcingLane: a view over a target whose primary enforces
//     (cloud). People come from the target's own provisioning; the founder
//     is the target's primary caller.
//   - newSiblingEnforcingLane: an open-source sibling booted in the OIDC
//     posture against the harness's local issuer (the 20260911.11 shape the
//     identityaccount and iampolicy suites already use), with a founder the
//     issuer mints and the server provisions.
//
// What the two hide from the arms:
//
//   - How a person exists. Cloud: a PlatformClient-minted user token whose
//     `sub` becomes the account id. Sibling: an issuer-minted access token
//     for a fresh subject, then `provisionMyAccount` — the console's first
//     sign-in, over the wire.
//   - What a newcomer holds. Cloud: nothing. Open source: 20260913.01's
//     membership rules make every later arrival a MEMBER of every
//     organization that already exists. `provisionIdentity` therefore
//     revokes the newcomer on every organization the founder can see
//     (`findMyOrganizations` as the founder, then `revokeOrgAccess`), and
//     `provisionMember(t)` spares `t` — so "no grant" and "exactly member"
//     are literally true on both lanes, and the arms that create an
//     organization outside `provisionTenancy` (they exist) still meet a
//     real outsider. A revoked member is a state 2b proved ("holds
//     nothing"), not a contrivance.
//   - How "exactly this role" is reached. Roles are additive in the model
//     (an admin who is also a member is an admin), so the lane grants the
//     role and REMOVES `member` when the two differ — the pure
//     `exactRoleSteps` below, unit-tested.
//
// The lane deliberately has no teardown: the target owns its lifetime
// (LocalTarget memoizes the sibling lane and stops it with the primary).
import { create } from "@bufbuild/protobuf";
import type { IamPolicySpec } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import {
  ApiResourceRefSchema,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type {
  DirectLoginTenant,
  EnforcingLane,
  OrganizationRole,
  SiblingServer,
  SpawnSiblingOptions,
  TenancyContext,
} from "../targets/target";
import { uniqueName, uniqueOrg } from "../support/naming";

import type { ConformanceClients, PresentingOptions } from "./clients";
import {
  startLocalOidcIssuer,
  type LocalOidcIssuer,
} from "./local-oidc-issuer";

const ORGANIZATION_API_VERSION = "tenancy.stigmer.ai/v1";
const ORGANIZATION_KIND = "Organization";

// `identity_account:<accountId>` holds `<role>` on `organization:<orgId>` —
// the Members-page grant, as IamPolicyCommandController.create and .delete
// both take it. The resource id is the organization's ID (its FGA object),
// which for this one kind equals its slug.
export function organizationRoleGrant(
  organizationId: string,
  accountId: string,
  role: OrganizationRole,
): IamPolicySpec {
  if (organizationId === "" || accountId === "") {
    throw new Error(
      "organizationRoleGrant needs a non-empty organization id and account id",
    );
  }
  return create(IamPolicySpecSchema, {
    principal: create(ApiResourceRefSchema, {
      kind: "identity_account",
      id: accountId,
    }),
    relation: role,
    resource: create(ApiResourceRefSchema, {
      kind: "organization",
      id: organizationId,
    }),
  });
}

// One grant or revoke the lane performs to move a person who holds exactly
// `member` to exactly `role`.
export interface RoleStep {
  readonly op: "grant" | "revoke";
  readonly role: OrganizationRole;
}

// From "exactly member" to "exactly `role`": nothing for member; otherwise
// grant the role FIRST (so the person is never role-less mid-way, which
// matters when the founder's own grant path is the one being exercised),
// then revoke member. Pure; the lanes execute it.
export function exactRoleSteps(
  role: OrganizationRole,
): ReadonlyArray<RoleStep> {
  if (role === "member") return [];
  return [
    { op: "grant", role },
    { op: "revoke", role: "member" },
  ];
}

// The organizations a newcomer is revoked on: every one the founder holds,
// minus the one they are meant to keep. Pure; order preserved so a failure
// names a deterministic organization.
export function organizationsToRevoke(
  founderOrganizationIds: ReadonlyArray<string>,
  spare: string | undefined,
): ReadonlyArray<string> {
  return founderOrganizationIds.filter((id) => id !== "" && id !== spare);
}

// The account id behind a set of clients — their own whoAmI. The server
// chooses the id (cloud: the token's `sub`; open source: derived from the
// subject), so the lane never computes it.
async function whoAmIId(clients: ConformanceClients): Promise<string> {
  const me = await clients.identityAccountQuery.whoAmI({});
  const id = me.metadata?.id ?? "";
  if (id === "") {
    throw new Error(
      "whoAmI answered no account id; the caller is not provisioned",
    );
  }
  return id;
}

// The founder moves a member to exactly `role` on the organization.
async function applyExactRole(
  founder: ConformanceClients,
  organizationId: string,
  accountId: string,
  role: OrganizationRole,
): Promise<void> {
  for (const step of exactRoleSteps(role)) {
    const grant = organizationRoleGrant(organizationId, accountId, step.role);
    if (step.op === "grant") {
      await founder.iamPolicyCommand.create(grant);
    } else {
      await founder.iamPolicyCommand.delete(grant);
    }
  }
}

// --- the primary lane (cloud) -----------------------------------------------

// What a target whose primary enforces must lend the lane. The target's own
// provisioning is the source of people; the lane adds only what the target
// contract does not say — a person with exactly one role, and the account
// id behind a set of clients.
export interface PrimaryEnforcingLaneDeps {
  readonly clients: ConformanceClients;
  provisionTenancy(): Promise<TenancyContext>;
  cleanupTenancy(context: TenancyContext): Promise<void>;
  provisionIdentity(): Promise<ConformanceClients>;
  provisionMember(tenancy: TenancyContext): Promise<ConformanceClients>;
  // The organization id behind a tenancy this target provisioned — on
  // cloud the id and the slug differ, and the grant names the id.
  organizationIdOf(tenancy: TenancyContext): string;
  // Present where the harness holds the platform tenant's key.
  readonly directLoginTenant: DirectLoginTenant | undefined;
  clientsPresenting(
    bearerToken: string,
    options?: PresentingOptions,
  ): ConformanceClients;
}

export function newPrimaryEnforcingLane(
  deps: PrimaryEnforcingLaneDeps,
): EnforcingLane {
  const lane: EnforcingLane = {
    clients: deps.clients,
    provisionTenancy: () => deps.provisionTenancy(),
    cleanupTenancy: (context) => deps.cleanupTenancy(context),
    provisionIdentity: () => deps.provisionIdentity(),
    provisionMember: (tenancy) => deps.provisionMember(tenancy),
    async provisionWithRole(tenancy, role) {
      const member = await deps.provisionMember(tenancy);
      await applyExactRole(
        deps.clients,
        deps.organizationIdOf(tenancy),
        await whoAmIId(member),
        role,
      );
      return member;
    },
    accountIdOf: whoAmIId,
    clientsPresenting: (bearerToken, options) =>
      deps.clientsPresenting(bearerToken, options),
  };
  const tenant = deps.directLoginTenant;
  if (tenant !== undefined) {
    lane.unprovisionedCaller = async () =>
      deps.clientsPresenting(
        tenant.mint({ subject: `auth0|${uniqueName("lane-unprovisioned")}` }),
      );
  }
  return lane;
}

// --- the sibling lane (open source in the OIDC posture) --------------------

export interface SiblingEnforcingLaneDeps {
  spawnSibling(options: SpawnSiblingOptions): Promise<SiblingServer>;
}

// The lane plus the one thing the target needs and the arms must not see.
export interface SiblingEnforcingLane {
  readonly lane: EnforcingLane;
  // Stops the sibling and the issuer. The target calls it from teardown().
  close(): Promise<void>;
}

// Auth0's subject shape for a database user; unique per call so no run ever
// meets a row a previous run left behind (the identityaccount suite's rule).
function freshSubject(prefix: string): string {
  return `auth0|${uniqueName(prefix)}`;
}

export async function newSiblingEnforcingLane(
  deps: SiblingEnforcingLaneDeps,
): Promise<SiblingEnforcingLane> {
  const issuer: LocalOidcIssuer = await startLocalOidcIssuer();
  let sibling: SiblingServer;
  try {
    sibling = await deps.spawnSibling({
      env: {
        STIGMER_OIDC_ISSUER: issuer.issuer,
        STIGMER_OIDC_AUDIENCE: issuer.audience,
        // Deliberately NO STIGMER_OPERATOR_EMAIL: the operator-email rule
        // would make one person an admin of every organization, and this
        // lane's people hold exactly what the arms gave them. The
        // membership-rules block of the iampolicy suite keeps its own
        // sibling for that rule.
      },
      // The readiness gate presents a subject nobody else uses; under the
      // posture it is admitted idp-shaped and provisions nothing.
      readinessBearer: await issuer.mint({
        sub: freshSubject("lane-readiness"),
        email: "lane-readiness@conformance.example.com",
      }),
    });
  } catch (error) {
    await issuer.close();
    throw error;
  }

  // A fresh person: minted by the issuer, provisioned by the server — the
  // console's first sign-in over the wire. Under 2b's rules they arrive as
  // a member of every organization that exists at this moment.
  async function newPerson(
    prefix: string,
  ): Promise<{ clients: ConformanceClients; id: string }> {
    const clients = sibling.clientsPresenting(
      await issuer.mint({
        sub: freshSubject(prefix),
        email: `${uniqueName(prefix)}@conformance.example.com`,
      }),
    );
    const provisioned = await clients.identityAccountCommand.provisionMyAccount(
      {},
    );
    const id = provisioned.metadata?.id ?? "";
    if (id === "") {
      throw new Error(
        "provisionMyAccount answered no account id on the sibling",
      );
    }
    return { clients, id };
  }

  const founder = await newPerson("lane-founder");

  async function founderOrganizationIds(): Promise<ReadonlyArray<string>> {
    const mine = await founder.clients.organizationQuery.findMyOrganizations(
      {},
    );
    return mine.entries.map((entry) => entry.metadata?.id ?? "");
  }

  // Revoke the newcomer on every organization the founder holds but
  // `spare`, so what remains is exactly the arms' intent.
  async function revokeEverywhereBut(
    accountId: string,
    spare: string | undefined,
  ): Promise<void> {
    for (const organizationId of organizationsToRevoke(
      await founderOrganizationIds(),
      spare,
    )) {
      await founder.clients.iamPolicyCommand.revokeOrgAccess({
        identityAccountId: accountId,
        organizationId,
      });
    }
  }

  const lane: EnforcingLane = {
    clients: founder.clients,
    async provisionTenancy() {
      const created = await founder.clients.organizationCommand.create({
        apiVersion: ORGANIZATION_API_VERSION,
        kind: ORGANIZATION_KIND,
        metadata: { name: uniqueOrg() },
      });
      const id = created.metadata?.id ?? "";
      if (id === "") {
        throw new Error("organization create on the sibling answered no id");
      }
      // An organization's id IS its slug (the one kind whose id is not
      // minted), so the tenancy's `org` names both.
      return { org: id };
    },
    async cleanupTenancy(context) {
      await founder.clients.organizationCommand.delete({ value: context.org });
    },
    async provisionIdentity() {
      const person = await newPerson("lane-outsider");
      await revokeEverywhereBut(person.id, undefined);
      return person.clients;
    },
    async provisionMember(tenancy) {
      const person = await newPerson("lane-member");
      await revokeEverywhereBut(person.id, tenancy.org);
      return person.clients;
    },
    async provisionWithRole(tenancy, role) {
      const person = await newPerson(`lane-${role}`);
      await revokeEverywhereBut(person.id, tenancy.org);
      await applyExactRole(founder.clients, tenancy.org, person.id, role);
      return person.clients;
    },
    accountIdOf: whoAmIId,
    clientsPresenting: (bearerToken, options) =>
      sibling.clientsPresenting(bearerToken, options),
    async unprovisionedCaller() {
      return sibling.clientsPresenting(
        await issuer.mint({
          sub: freshSubject("lane-unprovisioned"),
          email: `${uniqueName("lane-unprovisioned")}@conformance.example.com`,
        }),
      );
    },
  };

  return {
    lane,
    async close() {
      await sibling.teardown();
      await issuer.close();
    },
  };
}
