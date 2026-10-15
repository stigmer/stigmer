// Child organizations conformance: an organization may have child
// organizations, and its admins are admins in every one of them.
// Domain: tenancy / organization, and authorization.
//
// A parent organization P creates a child C (`spec.parent_org`, with the
// parent's own identifier for it, `spec.external_id`). Nobody owns C: P's
// admins are its admins, with no joining step, the way a Stripe platform
// administers a connected account. They change its settings and grant its
// people, read and change its agents and shared vaults (saving a secret
// into one included), and what they make there is theirs while they are
// P's admins. A person's conversations stay private from them, as from
// C's own admins. Everyone in C reads and runs what P shares at
// visibility_child_orgs; nobody in another parent's child does. A parent
// with children is not deleted. A service account of P mints user tokens
// into C, and a token minted for one child works in no other organization.
//
// Every arm runs on the target's enforcing lane: the primary on the cloud,
// open source's OIDC sibling on the local targets, where the built-in
// Authorizer evaluates the model. A target with no enforcing lane (the
// single-organization target, which holds one organization and so has no
// child) skips visibly.
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { AGENT_API_VERSION, AGENT_KIND, makeAgent, makeAgentSpec } from "../support/agents";
import { makeSharedVault, myVaultTarget, setSecretsInput, vaultTarget } from "../support/vaults";
import { organizationRole } from "../support/grants";
import { uniqueName, uniqueOrg } from "../support/naming";
import {
  createMinter,
  deleteMinter,
  mintUserToken,
  setEmbedding,
} from "../support/user-tokens";
import { makeSession } from "../support/sessions";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";

const ORGANIZATION_API_VERSION = "tenancy.stigmer.ai/v1";
const ORGANIZATION_KIND = "Organization";

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

// A child of `parent`, created by the lane's founder (an owner of the
// parent, so one of its admins); deleted before its parent by the
// fixtures' reverse order.
async function childOf(
  on: EnforcingLane,
  parent: TenancyContext,
  externalId = uniqueName("cust"),
): Promise<{ readonly org: string; readonly externalId: string }> {
  const created = await on.clients.organizationCommand.create({
    apiVersion: ORGANIZATION_API_VERSION,
    kind: ORGANIZATION_KIND,
    metadata: { name: uniqueOrg() },
    spec: { parentOrg: parent.org, externalId },
  });
  const org = created.metadata?.id ?? "";
  fixtures.defer(() => on.clients.organizationCommand.delete({ value: org }));
  return { org, externalId };
}

// A fresh person holding exactly `role` in `org` and nothing else, granted
// by the founder: in a child, through the founder's management of it.
async function personWith(
  on: EnforcingLane,
  org: string,
  role: string,
): Promise<{ readonly clients: ConformanceClients; readonly id: string }> {
  const clients = await on.provisionIdentity();
  const id = await on.accountIdOf(clients);
  await on.clients.grantCommand.create(organizationRole(id, role, org));
  return { clients, id };
}

async function accessHoldersOf(
  as: ConformanceClients,
  org: string,
): Promise<ReadonlyArray<string>> {
  const access = await as.grantQuery.listResourceAccessByPrincipal({
    resource: { kind: "organization", id: org },
  });
  return access.entries.map((entry) => entry.principal?.id ?? "");
}

async function refusalOf(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the call to be refused");
}

describe("child organizations — the parent's admins are admins in every child", () => {
  it("[rpc:OrganizationCommandController.create] [rpc:OrganizationQueryController.getByExternalId] a parent's admin creates a child that nobody owns, and finds and lists it", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const founder = await on.accountIdOf(on.clients);

    expect(
      await accessHoldersOf(on.clients, child.org),
      "no creator owner: the child's access list is empty until the parent grants",
    ).toEqual([]);
    expect(founder).not.toBe("");

    const found = await on.clients.organizationQuery.getByExternalId({
      parentOrg: parent.org,
      externalId: child.externalId,
    });
    expect(found.metadata?.id).toBe(child.org);
    expect(found.spec?.parentOrg).toBe(parent.org);
    const listed = await on.clients.organizationQuery.listChildOrgs({
      org: parent.org,
    });
    expect(listed.entries.map((org) => org.metadata?.id)).toEqual([child.org]);
  });

  it("[rpc:AgentQueryController.get] a parent admin reads and changes a child's agents and shared vaults, not a person's conversation", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const customer = await personWith(on, child.org, "admin");

    const session = await customer.clients.sessionCommand.create(
      makeSession({ org: child.org, name: uniqueName("child-session") }),
    );
    const sessionId = session.metadata?.id ?? "";
    fixtures.defer(() =>
      customer.clients.sessionCommand.delete({ value: sessionId }),
    );
    const agentInput = makeAgent({ org: child.org, name: uniqueName("child-agent") });
    const agent = await customer.clients.agentCommand.create(agentInput);
    const agentId = agent.metadata?.id ?? "";
    fixtures.defer(() =>
      customer.clients.agentCommand.delete({ value: agentId }),
    );
    const vaultInput = makeSharedVault({
      org: child.org,
      name: uniqueName("child-vault"),
    });
    const vault = await customer.clients.vaultCommand.create({
      ...vaultInput,
      metadata: {
        ...vaultInput.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      },
    });
    const vaultId = vault.metadata?.id ?? "";
    fixtures.defer(() =>
      customer.clients.vaultCommand.delete({ resourceId: vaultId }),
    );

    // The child's settings and access.
    const settings = await on.clients.organizationQuery.get({ value: child.org });
    expect(settings.metadata?.id).toBe(child.org);
    const updated = await on.clients.organizationCommand.update({ resource: {
      apiVersion: ORGANIZATION_API_VERSION,
      kind: ORGANIZATION_KIND,
      metadata: {
        id: child.org,
        name: settings.metadata?.name ?? "",
        slug: settings.metadata?.slug ?? "",
      },
      spec: { description: "edited by the parent's admin" },
    }, updateMask: { paths: ["*"] } });
    expect(updated.spec?.parentOrg, "the update keeps the parent").toBe(
      parent.org,
    );
    expect(await accessHoldersOf(on.clients, child.org)).toContain(
      customer.id,
    );

    // What the child holds: read, and changed.
    expect(
      (await on.clients.agentQuery.get({ value: agentId })).metadata?.id,
      "the parent's admin reads the child's agent",
    ).toBe(agentId);
    const fixed = await on.clients.agentCommand.update({
      resource: {
        apiVersion: AGENT_API_VERSION,
        kind: AGENT_KIND,
        metadata: { id: agentId, name: agent.metadata?.name ?? "", org: child.org },
        spec: makeAgentSpec({ instructions: "Answer the customer's question exactly." }),
      },
      updateMask: { paths: ["*"] },
    });
    expect(fixed.spec?.instructions).toBe("Answer the customer's question exactly.");
    expect(
      (await on.clients.vaultQuery.get({ value: vaultId })).metadata?.id,
      "the parent's admin reads the child's org-visible shared vault",
    ).toBe(vaultId);

    // A person's conversation stays theirs.
    await expectGrpcCode(
      () => on.clients.sessionQuery.get({ value: sessionId }),
      Code.PermissionDenied,
      "the parent's admin reads the child's person's session",
    );
    expect(
      (await customer.clients.sessionQuery.get({ value: sessionId })).metadata
        ?.id,
    ).toBe(sessionId);
  });

  it("[rpc:VaultCommandController.setSecrets] a parent admin saves a secret into a child's shared vault", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const customer = await personWith(on, child.org, "admin");
    const vaultInput = makeSharedVault({
      org: child.org,
      name: uniqueName("child-keys"),
    });
    const vault = await customer.clients.vaultCommand.create({
      ...vaultInput,
      metadata: {
        ...vaultInput.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      },
    });
    const vaultId = vault.metadata?.id ?? "";
    fixtures.defer(() =>
      customer.clients.vaultCommand.delete({ resourceId: vaultId }),
    );
    await customer.clients.vaultCommand.setSecrets(
      setSecretsInput(vaultTarget(child.org, vaultId), {
        CUSTOMER_KEY: "the customer's",
      }),
    );
    const founder = await on.accountIdOf(on.clients);

    await on.clients.vaultCommand.setSecrets(
      setSecretsInput(vaultTarget(child.org, vaultId), {
        PARENT_KEY: "the parent's",
      }),
    );
    const kept = await customer.clients.vaultQuery.get({ value: vaultId });
    expect(Object.keys(kept.spec?.secrets ?? {}).sort()).toEqual([
      "CUSTOMER_KEY",
      "PARENT_KEY",
    ]);
    expect(kept.spec?.secrets?.CUSTOMER_KEY?.savedBy).toBe(customer.id);
    expect(kept.spec?.secrets?.PARENT_KEY?.savedBy).toBe(founder);
  });

  it("[rpc:GrantQueryController.listResourceAccessByPrincipal] an agent a parent's admin makes in a child lists them as its owner, and stops once they are no longer one of the parent's admins", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const integrator = await personWith(on, parent.org, "admin");
    const agent = await integrator.clients.agentCommand.create(
      makeAgent({ org: child.org, name: uniqueName("made-by-parent") }),
    );
    const agentId = agent.metadata?.id ?? "";
    fixtures.defer(() => on.clients.agentCommand.delete({ value: agentId }));
    const holders = async (): Promise<ReadonlyArray<string>> =>
      (
        await on.clients.grantQuery.listResourceAccessByPrincipal({
          resource: { kind: "agent", id: agentId },
        })
      ).entries.map((entry) => entry.principal?.id ?? "");

    expect(await holders()).toContain(integrator.id);
    expect(
      (await integrator.clients.agentQuery.get({ value: agentId })).metadata?.id,
    ).toBe(agentId);

    await on.clients.grantCommand.delete(
      organizationRole(integrator.id, "admin", parent.org),
    );
    expect(await holders()).not.toContain(integrator.id);
    await expectGrpcCode(
      () => integrator.clients.agentQuery.get({ value: agentId }),
      Code.PermissionDenied,
      "a former parent admin reads what they made in the child",
    );
  });

  it("[rpc:AgentQueryController.get] everyone in a child reads and runs what the parent shares with child organizations; another parent's child does not", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const rival = await tenancy(on);
    const rivalChild = await childOf(on, rival);
    const viewer = await personWith(on, child.org, "viewer");
    const outsider = await personWith(on, rivalChild.org, "member");

    const input = makeAgent({ org: parent.org, name: uniqueName("catalog") });
    const shared = await on.clients.agentCommand.create({
      ...input,
      metadata: {
        ...input.metadata,
        visibility: ApiResourceVisibility.visibility_child_orgs,
      },
    });
    const sharedId = shared.metadata?.id ?? "";
    fixtures.defer(() =>
      on.clients.agentCommand.delete({ value: sharedId }),
    );

    expect(
      (await viewer.clients.agentQuery.get({ value: sharedId })).metadata?.id,
      "a read-only viewer of the child reads the parent's shared agent",
    ).toBe(sharedId);
    await expectGrpcCode(
      () => outsider.clients.agentQuery.get({ value: sharedId }),
      Code.PermissionDenied,
      "another parent's child reads nothing this parent shares",
    );
  });

  it("[rpc:AgentCommandController.create] visibility_child_orgs is refused in a child, which has no children to share with", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const customer = await personWith(on, child.org, "admin");
    const input = makeAgent({ org: child.org, name: uniqueName("inert") });
    await expectGrpcCode(
      () =>
        customer.clients.agentCommand.create({
          ...input,
          metadata: {
            ...input.metadata,
            visibility: ApiResourceVisibility.visibility_child_orgs,
          },
        }),
      Code.FailedPrecondition,
      "a child shares nothing with child organizations",
    );
  });

  it("[rpc:OrganizationCommandController.create] child organizations are one level deep, and an external id is one child's", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    // The parent's admin, an admin of the child, meets the one-level rule
    // as the child's own admin does.
    const parentAdminTriesGrandchild = await refusalOf(() =>
      on.clients.organizationCommand.create({
        apiVersion: ORGANIZATION_API_VERSION,
        kind: ORGANIZATION_KIND,
        metadata: { name: uniqueOrg() },
        spec: { parentOrg: child.org },
      }),
    );
    expect(parentAdminTriesGrandchild.code).toBe(Code.FailedPrecondition);
    expect(
      parentAdminTriesGrandchild
        .findDetails(ErrorInfoSchema)
        .map((info) => info.reason),
    ).toEqual(["ORGANIZATION_PARENT_IS_CHILD"]);
    const childAdmin = await personWith(on, child.org, "admin");
    const grandchild = await refusalOf(() =>
      childAdmin.clients.organizationCommand.create({
        apiVersion: ORGANIZATION_API_VERSION,
        kind: ORGANIZATION_KIND,
        metadata: { name: uniqueOrg() },
        spec: { parentOrg: child.org },
      }),
    );
    expect(grandchild.code).toBe(Code.FailedPrecondition);
    expect(
      grandchild.findDetails(ErrorInfoSchema).map((info) => info.reason),
    ).toEqual(["ORGANIZATION_PARENT_IS_CHILD"]);
    const duplicate = await refusalOf(() =>
      on.clients.organizationCommand.create({
        apiVersion: ORGANIZATION_API_VERSION,
        kind: ORGANIZATION_KIND,
        metadata: { name: uniqueOrg() },
        spec: { parentOrg: parent.org, externalId: child.externalId },
      }),
    );
    expect(duplicate.code).toBe(Code.AlreadyExists);
  });

  it("[rpc:OrganizationQueryController.listChildOrgs] someone who does not manage the parent cannot create, find or list its children", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const member = await personWith(on, parent.org, "member");
    await expectGrpcCode(
      () =>
        member.clients.organizationQuery.listChildOrgs({ org: parent.org }),
      Code.PermissionDenied,
      "a member of the parent lists its children",
    );
    await expectGrpcCode(
      () =>
        member.clients.organizationQuery.getByExternalId({
          parentOrg: parent.org,
          externalId: child.externalId,
        }),
      Code.PermissionDenied,
      "a member of the parent finds a child",
    );
    await expectGrpcCode(
      () =>
        member.clients.organizationCommand.create({
          apiVersion: ORGANIZATION_API_VERSION,
          kind: ORGANIZATION_KIND,
          metadata: { name: uniqueOrg() },
          spec: { parentOrg: parent.org },
        }),
      Code.PermissionDenied,
      "a member of the parent creates a child",
    );
    await expectGrpcCode(
      () => member.clients.organizationQuery.get({ value: child.org }),
      Code.PermissionDenied,
      "a member of the parent reads a child's settings",
    );
  });

  it("[rpc:OrganizationCommandController.delete] a parent with children is not deleted", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    await childOf(on, parent);
    const refused = await refusalOf(() =>
      on.clients.organizationCommand.delete({ value: parent.org }),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(
      refused.findDetails(ErrorInfoSchema).map((info) => info.reason),
    ).toEqual(["ORGANIZATION_HAS_CHILDREN"]);
  });

  it("[rpc:TokenService.mintUserToken] the parent's service account mints into a child: the token works there, and neither in the parent nor in a sibling child", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    if (!target.capabilities.userTokens) {
      return ctx.skip(
        "this target's enforcing lane mints no user tokens",
      );
    }
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const minter = await createMinter(on.clients, {
      org: parent.org,
      name: uniqueName("child-minter"),
    });
    fixtures.defer(() => deleteMinter(on.clients, minter.accountId));
    await setEmbedding(on.clients, parent.org, { signInRole: IamRole.member });
    const asMinter = on.clientsPresenting(minter.key);
    const asCustomer = on.clientsPresenting(
      await mintUserToken(asMinter, child.org, uniqueName("user")),
    );
    const mine = await asCustomer.organizationQuery.listMine({});
    expect(
      mine.entries.map((organization) => organization.metadata?.id),
      "the minted user is the child's member and is bound to it",
    ).toEqual([child.org]);
    const inChild = await asCustomer.vaultCommand.setSecrets(
      setSecretsInput(myVaultTarget(child.org), { CHILD_KEY: "child" }),
    );
    fixtures.defer(() =>
      asCustomer.vaultCommand.delete({
        resourceId: inChild.metadata?.id ?? "",
      }),
    );
    await expectGrpcCode(
      () =>
        asCustomer.vaultCommand.setSecrets(
          setSecretsInput(myVaultTarget(parent.org), { PARENT_KEY: "parent" }),
        ),
      Code.PermissionDenied,
      "a token minted into the child works nowhere else",
    );
    const sibling = await childOf(on, parent);
    await expectGrpcCode(
      () =>
        asCustomer.vaultCommand.setSecrets(
          setSecretsInput(myVaultTarget(sibling.org), { SIBLING_KEY: "sibling" }),
        ),
      Code.PermissionDenied,
      "a token minted into one child works in no sibling",
    );
    const rival = await tenancy(on);
    const rivalChild = await childOf(on, rival);
    await expectGrpcCode(
      () => mintUserToken(asMinter, rivalChild.org, uniqueName("user")),
      Code.PermissionDenied,
      "a service account mints into no other parent's child",
    );
  });
});
