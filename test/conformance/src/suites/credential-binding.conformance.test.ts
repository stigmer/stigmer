// Credential binding conformance: a credential that names an organization
// works in that organization only.
// Domain: identity and authorization (every edition that signs callers in).
//
// One person holds a role in two organizations, A and B. A credential that
// names A — a user token a PlatformClient of A mints, or an API key limited
// to A — is refused in B even though the person holds a role there, works in
// A, and names A alone when asked which organizations it may see. A key
// limited to A cannot found an organization, cannot mint a key that speaks
// for the person everywhere (an empty organization becomes A), and cannot
// mint a key limited to B. A key may be limited only to an organization its
// owner can view.
//
// Every arm runs on the target's enforcing lane, where the server signs its
// callers in and keys authenticate: the primary on the cloud, open source's
// OIDC sibling on the local targets. The PlatformClient arms need a lane
// that mints user tokens (`platformClientTokens`); `checkAuthorization`
// needs a composed query engine (`authorizationQueries`). A target with no
// enforcing lane (the single-organization target, which binds trivially:
// it holds one organization) skips visibly.
//
// Out of scope: an identity provider's federated tokens, whose binding is
// the hosted edition's verifier and is proven by its own suites over a
// signed test issuer.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { API_KEY_API_VERSION, API_KEY_KIND, plaintextKeyOf } from "../support/apikeys";
import { makeEnvironment } from "../support/environments";
import { organizationRole, policyTriple, ref } from "../support/iampolicies";
import { uniqueName } from "../support/naming";
import {
  createPlatformClient,
  deletePlatformClient,
  mintUserToken,
} from "../support/platformclients";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";

let target: TargetProfile;
let lane: EnforcingLane | undefined;
let laneReason = "";
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  const enforcing = await enforcingLaneOf(target);
  if (enforcing.lane === undefined) {
    laneReason = enforcing.reason;
  } else {
    lane = enforcing.lane;
  }
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

async function tenancy(on: EnforcingLane): Promise<TenancyContext> {
  const context = await on.provisionTenancy();
  fixtures.defer(() => on.cleanupTenancy(context));
  return context;
}

// An Environment the founder creates in `org`, visible to the whole
// organization: a row of B every member reads, so only the binding can be
// what refuses a bound credential.
async function founderEnvironment(on: EnforcingLane, org: string): Promise<string> {
  const environment = makeEnvironment({ org, name: uniqueName("binding-env") });
  const created = await on.clients.environmentCommand.create({
    ...environment,
    metadata: { ...environment.metadata, visibility: ApiResourceVisibility.visibility_org },
  });
  const id = created.metadata?.id ?? "";
  fixtures.defer(() => on.clients.environmentCommand.delete({ resourceId: id }));
  return id;
}

// A key `owner` creates, limited to `org` ("" = everywhere), and the
// clients presenting it on the lane's server.
async function keyOf(
  on: EnforcingLane,
  owner: ConformanceClients,
  org: string,
): Promise<{ readonly id: string; readonly org: string; readonly clients: ConformanceClients }> {
  const created = await owner.apiKeyCommand.create({
    apiVersion: API_KEY_API_VERSION,
    kind: API_KEY_KIND,
    metadata: { name: uniqueName("binding-key") },
    spec: { boundOrg: org },
  });
  const id = created.metadata?.id ?? "";
  fixtures.defer(() => owner.apiKeyCommand.delete({ value: id }));
  return {
    id,
    org: created.spec?.boundOrg ?? "",
    clients: on.clientsPresenting(plaintextKeyOf(created)),
  };
}

// What every bound credential must show in B, and must still be able to do
// in A: create there, and see A alone among its organizations.
async function expectBoundTo(
  on: EnforcingLane,
  asBound: ConformanceClients,
  a: TenancyContext,
  b: TenancyContext,
): Promise<void> {
  const elsewhere = await founderEnvironment(on, b.org);
  await expectGrpcCode(
    () => asBound.environmentQuery.get({ value: elsewhere }),
    Code.PermissionDenied,
    "read a row of the other organization through a credential bound to A",
  );
  await expectGrpcCode(
    () =>
      asBound.environmentCommand.create(
        makeEnvironment({ org: b.org, name: uniqueName("binding-env") }),
      ),
    Code.PermissionDenied,
    "create in the other organization through a credential bound to A",
  );

  const inA = await asBound.environmentCommand.create(
    makeEnvironment({ org: a.org, name: uniqueName("binding-env") }),
  );
  fixtures.defer(() =>
    on.clients.environmentCommand.delete({ resourceId: inA.metadata?.id ?? "" }),
  );
  expect(inA.metadata?.org, "the bound credential still works in A").toBe(a.org);

  const mine = await asBound.organizationQuery.findMyOrganizations({});
  expect(
    mine.entries.map((organization) => organization.metadata?.id),
    "a bound credential sees its own organization alone",
  ).toEqual([a.org]);

  const permission = await asBound.iamPolicyQuery.checkMyPermission({
    resource: ref("environment", elsewhere),
    relation: "can_view",
  });
  expect(permission.isAuthorized, "checkMyPermission on B's row is false").toBe(false);
}

describe("credential binding — a credential that names an organization works there only", () => {
  it("[rpc:PlatformClientTokenController.mintUserToken] a PlatformClient user token works in its client's organization alone, though the user holds a role in another", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    if (!target.capabilities.platformClientTokens) {
      return ctx.skip("this target's enforcing lane mints no PlatformClient user tokens");
    }
    const a = await tenancy(on);
    const b = await tenancy(on);
    const client = await createPlatformClient(on.clients, {
      org: a.org,
      name: uniqueName("binding-pc"),
      signInRole: IamRole.member,
    });
    fixtures.defer(() => deletePlatformClient(on.clients, client.id));
    const asUser = on.clientsPresenting(
      await mintUserToken(on.clients, client.credentials, uniqueName("binding-user")),
    );
    const accountId = await on.accountIdOf(asUser);
    await on.clients.iamPolicyCommand.create(organizationRole(accountId, "member", b.org));

    await expectBoundTo(on, asUser, a, b);
  });

  it("[rpc:ApiKeyCommandController.create] a key limited to A is refused in B, works in A, and sees A alone", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const a = await tenancy(on);
    const b = await tenancy(on);
    const person = await on.provisionMember(a);
    await on.clients.iamPolicyCommand.create(
      organizationRole(await on.accountIdOf(person), "member", b.org),
    );
    const key = await keyOf(on, person, a.org);
    expect(key.org, "the key records the organization it is limited to").toBe(a.org);

    await expectBoundTo(on, key.clients, a, b);

    // The same person through a key limited to nothing reaches B: the
    // binding is the key's, not the person's.
    const everywhere = await keyOf(on, person, "");
    const elsewhere = await founderEnvironment(on, b.org);
    const read = await everywhere.clients.environmentQuery.get({ value: elsewhere });
    expect(read.metadata?.id).toBe(elsewhere);
  });

  it("[rpc:IamPolicyQueryController.checkAuthorization] a key limited to A gets false when it asks about a resource of B", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    if (!target.capabilities.authorizationQueries) {
      return ctx.skip("this target composes no authorization query engine");
    }
    const a = await tenancy(on);
    const b = await tenancy(on);
    const person = await on.provisionMember(a);
    const personId = await on.accountIdOf(person);
    await on.clients.iamPolicyCommand.create(organizationRole(personId, "member", b.org));
    const elsewhere = await founderEnvironment(on, b.org);
    const question = {
      policy: policyTriple({ kind: "identity_account", id: personId }, "can_view", {
        kind: "environment",
        id: elsewhere,
      }),
    };

    const unbound = await person.iamPolicyQuery.checkAuthorization(question);
    expect(unbound.isAuthorized, "the person may view B's row").toBe(true);
    const key = await keyOf(on, person, a.org);
    const bound = await key.clients.iamPolicyQuery.checkAuthorization(question);
    expect(bound.isAuthorized, "the key limited to A may not").toBe(false);
  });

  it("[rpc:OrganizationCommandController.create] a key limited to A cannot found an organization", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const a = await tenancy(on);
    const person = await on.provisionMember(a);
    const key = await keyOf(on, person, a.org);
    await expectGrpcCode(
      () =>
        key.clients.organizationCommand.create({
          apiVersion: "tenancy.stigmer.ai/v1",
          kind: "Organization",
          metadata: { name: uniqueName("bound-founded"), slug: uniqueName("bound-founded") },
          spec: {},
        }),
      Code.PermissionDenied,
      "found an organization through a key limited to A",
    );
  });

  it("[rpc:ApiKeyCommandController.create] a key limited to A mints only keys limited to A", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const a = await tenancy(on);
    const b = await tenancy(on);
    const person = await on.provisionMember(a);
    await on.clients.iamPolicyCommand.create(
      organizationRole(await on.accountIdOf(person), "member", b.org),
    );
    const key = await keyOf(on, person, a.org);

    const unlimited = await keyOf(on, key.clients, "");
    expect(
      unlimited.org,
      "a key asked for everywhere through a key limited to A is limited to A",
    ).toBe(a.org);

    await expectGrpcCode(
      () => keyOf(on, key.clients, b.org),
      Code.PermissionDenied,
      "mint a key limited to B through a key limited to A",
    );
  });

  it("[rpc:ApiKeyCommandController.delete] a key limited to A manages only keys limited to A: never its owner's unlimited key", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const a = await tenancy(on);
    const person = await on.provisionMember(a);
    const key = await keyOf(on, person, a.org);
    const everywhere = await keyOf(on, person, "");
    const sibling = await keyOf(on, person, a.org);

    await expectGrpcCode(
      () => key.clients.apiKeyCommand.delete({ value: everywhere.id }),
      Code.PermissionDenied,
      "delete the owner's unlimited key through a key limited to A",
    );
    await key.clients.apiKeyCommand.delete({ value: sibling.id });
    await expectGrpcCode(
      () => person.apiKeyQuery.get({ value: sibling.id }),
      Code.NotFound,
      "the key limited to A that the limited key deleted",
    );
  });

  it("[rpc:ApiKeyCommandController.create] a key can be limited only to an organization its owner can view", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const a = await tenancy(on);
    const notMine = await tenancy(on);
    const person = await on.provisionMember(a);
    await expectGrpcCode(
      () => keyOf(on, person, notMine.org),
      Code.PermissionDenied,
      "limit a key to an organization its owner holds no role in",
    );
  });
});
