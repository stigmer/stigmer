// Child organizations conformance: an organization may have child
// organizations, which its admins manage and never read.
// Domain: tenancy / organization, and authorization.
//
// A parent organization P creates a child C (`spec.parent_org`, with the
// parent's own identifier for it, `spec.external_id`). Nobody owns C: P's
// admins manage it (its settings, members, access, billing) and grant its
// people, but hold no role in it, so they read none of its sessions,
// agents or environments. A P admin who needs to look inside grants
// themselves a role in C, which C's access list shows. Everyone in C reads
// and runs what P shares at visibility_child_orgs; nobody in another
// parent's child does. A parent with children is not deleted. A
// PlatformClient of P mints user tokens into C.
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
import { makeAgent } from "../support/agents";
import { makeEnvironment } from "../support/environments";
import { organizationRole } from "../support/iampolicies";
import { uniqueName, uniqueOrg } from "../support/naming";
import {
  createPlatformClient,
  deletePlatformClient,
  mintUserToken,
} from "../support/platformclients";
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
  await on.clients.iamPolicyCommand.create(organizationRole(id, role, org));
  return { clients, id };
}

async function accessHoldersOf(
  as: ConformanceClients,
  org: string,
): Promise<ReadonlyArray<string>> {
  const access = await as.iamPolicyQuery.listResourceAccessByPrincipal({
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

describe("child organizations — managed by the parent, never read by it", () => {
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

  it("[rpc:SessionQueryController.get] a parent admin manages a child but cannot read its sessions, agents or environments", async (ctx) => {
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
    const agent = await customer.clients.agentCommand.create({
      ...makeAgent({ org: child.org, name: uniqueName("child-agent") }),
    });
    const agentId = agent.metadata?.id ?? "";
    fixtures.defer(() =>
      customer.clients.agentCommand.delete({ value: agentId }),
    );
    const environmentInput = makeEnvironment({
      org: child.org,
      name: uniqueName("child-env"),
    });
    const environment = await customer.clients.environmentCommand.create({
      ...environmentInput,
      metadata: {
        ...environmentInput.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      },
    });
    const environmentId = environment.metadata?.id ?? "";
    fixtures.defer(() =>
      customer.clients.environmentCommand.delete({ resourceId: environmentId }),
    );

    // Management: settings, members, access, billing's gate.
    const settings = await on.clients.organizationQuery.get({ value: child.org });
    expect(settings.metadata?.id).toBe(child.org);
    const updated = await on.clients.organizationCommand.update({
      apiVersion: ORGANIZATION_API_VERSION,
      kind: ORGANIZATION_KIND,
      metadata: {
        id: child.org,
        name: settings.metadata?.name ?? "",
        slug: settings.metadata?.slug ?? "",
      },
      spec: { description: "edited by the parent's admin" },
    });
    expect(updated.spec?.parentOrg, "the update keeps the parent").toBe(
      parent.org,
    );
    expect(updated.spec?.description).toBe("edited by the parent's admin");
    expect(await accessHoldersOf(on.clients, child.org)).toContain(
      customer.id,
    );

    // Reading: none of it.
    await expectGrpcCode(
      () => on.clients.sessionQuery.get({ value: sessionId }),
      Code.PermissionDenied,
      "the parent's admin reads the child's session",
    );
    await expectGrpcCode(
      () => on.clients.agentQuery.get({ value: agentId }),
      Code.PermissionDenied,
      "the parent's admin reads the child's agent",
    );
    await expectGrpcCode(
      () => on.clients.environmentQuery.get({ value: environmentId }),
      Code.PermissionDenied,
      "the parent's admin reads the child's org-visible environment",
    );
    // The child's own admin reads all three.
    expect(
      (await customer.clients.sessionQuery.get({ value: sessionId })).metadata
        ?.id,
    ).toBe(sessionId);
  });

  it("[rpc:IamPolicyCommandController.create] a parent admin who joins the child shows in its access list, and then reads", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const customer = await personWith(on, child.org, "member");
    const environmentInput = makeEnvironment({
      org: child.org,
      name: uniqueName("child-env"),
    });
    const environment = await customer.clients.environmentCommand.create({
      ...environmentInput,
      metadata: {
        ...environmentInput.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      },
    });
    const environmentId = environment.metadata?.id ?? "";
    fixtures.defer(() =>
      customer.clients.environmentCommand.delete({ resourceId: environmentId }),
    );
    const founder = await on.accountIdOf(on.clients);
    await expectGrpcCode(
      () => on.clients.environmentQuery.get({ value: environmentId }),
      Code.PermissionDenied,
      "before joining, the parent's admin reads nothing",
    );

    await on.clients.iamPolicyCommand.create(
      organizationRole(founder, "viewer", child.org),
    );
    expect(
      await accessHoldersOf(customer.clients, child.org),
      "the join is visible to the child's own people",
    ).toContain(founder);
    expect(
      (await on.clients.environmentQuery.get({ value: environmentId })).metadata
        ?.id,
    ).toBe(environmentId);
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
    // The parent's admin manages the child but not the child's children:
    // only the child's own admin reaches the one-level rule.
    const parentAdminTriesGrandchild = await refusalOf(() =>
      on.clients.organizationCommand.create({
        apiVersion: ORGANIZATION_API_VERSION,
        kind: ORGANIZATION_KIND,
        metadata: { name: uniqueOrg() },
        spec: { parentOrg: child.org },
      }),
    );
    expect(parentAdminTriesGrandchild.code).toBe(Code.PermissionDenied);
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

  it("[rpc:PlatformClientTokenController.mintUserToken] a PlatformClient of the parent mints into a child: the token works there and not in the parent", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    if (!target.capabilities.platformClientTokens) {
      return ctx.skip(
        "this target's enforcing lane mints no PlatformClient user tokens",
      );
    }
    const parent = await tenancy(on);
    const child = await childOf(on, parent);
    const client = await createPlatformClient(on.clients, {
      org: parent.org,
      name: uniqueName("child-pc"),
      signInRole: IamRole.member,
    });
    fixtures.defer(() => deletePlatformClient(on.clients, client.id));
    const asCustomer = on.clientsPresenting(
      await mintUserToken(on.clients, client.credentials, uniqueName("user"), {
        org: child.org,
      }),
    );
    const mine = await asCustomer.organizationQuery.findMyOrganizations({});
    expect(
      mine.entries.map((organization) => organization.metadata?.id),
      "the minted user is the child's member and is bound to it",
    ).toEqual([child.org]);
    const inChild = await asCustomer.environmentCommand.create(
      makeEnvironment({ org: child.org, name: uniqueName("child-env") }),
    );
    fixtures.defer(() =>
      asCustomer.environmentCommand.delete({
        resourceId: inChild.metadata?.id ?? "",
      }),
    );
    await expectGrpcCode(
      () =>
        asCustomer.environmentCommand.create(
          makeEnvironment({ org: parent.org, name: uniqueName("parent-env") }),
        ),
      Code.PermissionDenied,
      "a token minted into the child works nowhere else",
    );
    const rival = await tenancy(on);
    const rivalChild = await childOf(on, rival);
    await expectGrpcCode(
      () =>
        mintUserToken(on.clients, client.credentials, uniqueName("user"), {
          org: rivalChild.org,
        }),
      Code.InvalidArgument,
      "a PlatformClient mints into no other parent's child",
    );
  });
});
