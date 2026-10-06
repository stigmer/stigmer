// Credential binding conformance: a credential that names an organization
// works in that organization only.
// Domain: identity and authorization (every edition that signs callers in).
//
// One person holds a role in two organizations, A and B. A credential that
// names A — a user token a PlatformClient of A mints, or an API key limited
// to A — is refused in B even though the person holds a role there, works in
// A, and names A alone when asked which organizations it may see. A key
// limited to A cannot found an organization other than a child of A, which
// it then manages (settings and members, never the child's rows), cannot mint a key that speaks
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
import {
  API_KEY_API_VERSION,
  API_KEY_KIND,
  plaintextKeyOf,
} from "../support/apikeys";
import { agentRefOf, makeAgent } from "../support/agents";
import { makeAgentExecution } from "../support/agentruns";
import { makeEnvironment } from "../support/environments";
import { makeMcpServer } from "../support/mcpservers";
import { makeWorkflow } from "../support/workflows";
import { makeWorkflowExecution } from "../support/workflowruns";
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

// The handler seats' refusals, byte-pinned in the server
// (domain/organization/steps.ts, domain/apikey/steps.ts), so an unrelated
// PERMISSION_DENIED cannot stand in for the binding's.
const BOUND_CREDENTIAL_CREATES_NO_ORGANIZATION_MESSAGE =
  "this credential is limited to one organization and cannot create another, except a child of that organization; sign in as yourself to create an organization";
const BOUND_ELSEWHERE_MESSAGE =
  "this credential is bound to another organization";
const API_KEY_BOUND_ELSEWHERE_MESSAGE =
  "this credential is limited to one organization, so it can only create API keys limited to that organization";

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

// A child organization of `parent`, which the founder creates and manages;
// deleted before its parent by the fixtures' reverse order.
async function childTenancy(
  on: EnforcingLane,
  parent: TenancyContext,
): Promise<TenancyContext> {
  const created = await on.clients.organizationCommand.create({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: uniqueName("binding-child") },
    spec: { parentOrg: parent.org },
  });
  const org = created.metadata?.id ?? "";
  fixtures.defer(() => on.clients.organizationCommand.delete({ value: org }));
  return { org };
}

// A fresh person holding exactly `role` in `tenancy`, granted by the
// founder: the membership rules give nobody a role in a child.
async function personIn(
  on: EnforcingLane,
  tenancy: TenancyContext,
  role: string,
): Promise<ConformanceClients> {
  const person = await on.provisionIdentity();
  await on.clients.iamPolicyCommand.create(
    organizationRole(await on.accountIdOf(person), role, tenancy.org),
  );
  return person;
}

// An Environment the founder creates in `org`, visible to the whole
// organization: a row of B every member reads, so only the binding can be
// what refuses a bound credential.
async function founderEnvironment(
  on: EnforcingLane,
  org: string,
): Promise<string> {
  const environment = makeEnvironment({ org, name: uniqueName("binding-env") });
  const created = await on.clients.environmentCommand.create({
    ...environment,
    metadata: {
      ...environment.metadata,
      visibility: ApiResourceVisibility.visibility_org,
    },
  });
  const id = created.metadata?.id ?? "";
  fixtures.defer(() =>
    on.clients.environmentCommand.delete({ resourceId: id }),
  );
  return id;
}

// A key `owner` creates, limited to `org` ("" = everywhere), and the
// clients presenting it on the lane's server.
async function keyOf(
  on: EnforcingLane,
  owner: ConformanceClients,
  org: string,
): Promise<{
  readonly id: string;
  readonly org: string;
  readonly clients: ConformanceClients;
}> {
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
    async () => {
      const leaked = await asBound.environmentCommand.create(
        makeEnvironment({ org: b.org, name: uniqueName("binding-env") }),
      );
      fixtures.defer(() =>
        on.clients.environmentCommand.delete({
          resourceId: leaked.metadata?.id ?? "",
        }),
      );
      return leaked;
    },
    Code.PermissionDenied,
    "create in the other organization through a credential bound to A",
  );

  const inA = await asBound.environmentCommand.create(
    makeEnvironment({ org: a.org, name: uniqueName("binding-env") }),
  );
  fixtures.defer(() =>
    on.clients.environmentCommand.delete({
      resourceId: inA.metadata?.id ?? "",
    }),
  );
  expect(inA.metadata?.org, "the bound credential still works in A").toBe(
    a.org,
  );

  const mine = await asBound.organizationQuery.findMyOrganizations({});
  expect(
    mine.entries.map((organization) => organization.metadata?.id),
    "a bound credential sees its own organization alone",
  ).toEqual([a.org]);

  const permission = await asBound.iamPolicyQuery.checkMyPermission({
    resource: ref("environment", elsewhere),
    relation: "can_view",
  });
  expect(permission.isAuthorized, "checkMyPermission on B's row is false").toBe(
    false,
  );
}

describe("credential binding — a credential that names an organization works there only", () => {
  it("[rpc:PlatformClientTokenController.mintUserToken] a PlatformClient user token works in its client's organization alone, though the user holds a role in another", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    if (!target.capabilities.platformClientTokens) {
      return ctx.skip(
        "this target's enforcing lane mints no PlatformClient user tokens",
      );
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
      await mintUserToken(
        on.clients,
        client.credentials,
        uniqueName("binding-user"),
      ),
    );
    const accountId = await on.accountIdOf(asUser);
    await on.clients.iamPolicyCommand.create(
      organizationRole(accountId, "member", b.org),
    );
    // The control: the user does hold a role in B, so every refusal below is
    // the binding's and not a missing grant.
    const accessToB =
      await on.clients.iamPolicyQuery.listResourceAccessByPrincipal({
        resource: { kind: "organization", id: b.org },
      });
    expect(
      accessToB.entries.some((entry) => entry.principal?.id === accountId),
      "the user is on B's access list",
    ).toBe(true);

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
    expect(key.org, "the key records the organization it is limited to").toBe(
      a.org,
    );

    await expectBoundTo(on, key.clients, a, b);

    // The same person through a key limited to nothing reaches B: the
    // binding is the key's, not the person's.
    const everywhere = await keyOf(on, person, "");
    const elsewhere = await founderEnvironment(on, b.org);
    const read = await everywhere.clients.environmentQuery.get({
      value: elsewhere,
    });
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
    await on.clients.iamPolicyCommand.create(
      organizationRole(personId, "member", b.org),
    );
    const elsewhere = await founderEnvironment(on, b.org);
    const question = {
      policy: policyTriple(
        { kind: "identity_account", id: personId },
        "can_view",
        {
          kind: "environment",
          id: elsewhere,
        },
      ),
    };

    const unbound = await person.iamPolicyQuery.checkAuthorization(question);
    expect(unbound.isAuthorized, "the person may view B's row").toBe(true);
    const key = await keyOf(on, person, a.org);
    const bound = await key.clients.iamPolicyQuery.checkAuthorization(question);
    expect(bound.isAuthorized, "the key limited to A may not").toBe(false);
  });

  it("[rpc:IamPolicyQueryController.checkMyPermission] a key limited to A gets false when it asks, with contextual policies, about a resource of B", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    if (!target.capabilities.authorizationQueries) {
      return ctx.skip("this target composes no authorization query engine");
    }
    const a = await tenancy(on);
    const b = await tenancy(on);
    const person = await on.provisionMember(a);
    const personId = await on.accountIdOf(person);
    await on.clients.iamPolicyCommand.create(
      organizationRole(personId, "member", b.org),
    );
    const elsewhere = await founderEnvironment(on, b.org);
    // Any contextual policy routes the question to the query engine (the
    // lane the binding must also cover); this one changes no answer.
    const question = {
      resource: ref("environment", elsewhere),
      relation: "can_view",
      contextualPolicies: [
        policyTriple({ kind: "identity_account", id: personId }, "member", {
          kind: "organization",
          id: a.org,
        }),
      ],
    };

    const unbound = await person.iamPolicyQuery.checkMyPermission(question);
    expect(unbound.isAuthorized, "the person may view B's row").toBe(true);
    const key = await keyOf(on, person, a.org);
    const bound = await key.clients.iamPolicyQuery.checkMyPermission(question);
    expect(bound.isAuthorized, "the key limited to A may not").toBe(false);
  });

  it("[rpc:OrganizationCommandController.create] a key limited to A cannot found an organization", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const a = await tenancy(on);
    const person = await on.provisionMember(a);
    const key = await keyOf(on, person, a.org);
    const refused = await expectGrpcCode(
      async () => {
        const leaked = await key.clients.organizationCommand.create({
          apiVersion: "tenancy.stigmer.ai/v1",
          kind: "Organization",
          metadata: {
            name: uniqueName("bound-founded"),
            slug: uniqueName("bound-founded"),
          },
          spec: {},
        });
        fixtures.defer(() =>
          person.organizationCommand.delete({
            value: leaked.metadata?.id ?? "",
          }),
        );
        return leaked;
      },
      Code.PermissionDenied,
      "found an organization through a key limited to A",
    );
    expect(refused.rawMessage).toBe(
      BOUND_CREDENTIAL_CREATES_NO_ORGANIZATION_MESSAGE,
    );
  });

  it("[rpc:OrganizationCommandController.create] a key limited to A creates and manages a child of A, and reads none of the child's rows", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const a = await tenancy(on);
    const key = await keyOf(on, on.clients, a.org);
    const child = await key.clients.organizationCommand.create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: uniqueName("bound-child") },
      spec: { parentOrg: a.org, externalId: uniqueName("cust") },
    });
    const childOrg = child.metadata?.id ?? "";
    fixtures.defer(() =>
      on.clients.organizationCommand.delete({ value: childOrg }),
    );
    const listed = await key.clients.organizationQuery.listChildOrgs({
      org: a.org,
    });
    expect(listed.entries.map((org) => org.metadata?.id)).toEqual([childOrg]);
    const customer = await on.provisionIdentity();
    const customerId = await on.accountIdOf(customer);
    await key.clients.iamPolicyCommand.create(
      organizationRole(customerId, "admin", childOrg),
    );
    // The child's own admin writes an org-visible row there: the founder,
    // who manages the child, holds no role in it.
    const environment = makeEnvironment({
      org: childOrg,
      name: uniqueName("binding-env"),
    });
    const created = await customer.environmentCommand.create({
      ...environment,
      metadata: {
        ...environment.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      },
    });
    const inChild = created.metadata?.id ?? "";
    fixtures.defer(() =>
      customer.environmentCommand.delete({ resourceId: inChild }),
    );
    await expectGrpcCode(
      () => key.clients.environmentQuery.get({ value: inChild }),
      Code.PermissionDenied,
      "read a child's row through a key limited to its parent",
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

    const elsewhere = await expectGrpcCode(
      () => keyOf(on, key.clients, b.org),
      Code.PermissionDenied,
      "mint a key limited to B through a key limited to A",
    );
    expect(elsewhere.rawMessage).toBe(API_KEY_BOUND_ELSEWHERE_MESSAGE);
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

  it("[rpc:WorkflowRunCommandController.create] a key limited to A files no run and opens no connect in B, even with A's own workflow, agent or MCP server", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const a = await tenancy(on);
    const b = await tenancy(on);
    const person = await on.provisionMember(a);
    await on.clients.iamPolicyCommand.create(
      organizationRole(await on.accountIdOf(person), "member", b.org),
    );
    const key = await keyOf(on, person, a.org);
    const orgVisible = { visibility: ApiResourceVisibility.visibility_org };

    const workflowInput = makeWorkflow({
      org: a.org,
      name: uniqueName("binding-wf"),
    });
    const workflow = await on.clients.workflowCommand.create({
      ...workflowInput,
      metadata: { ...workflowInput.metadata, ...orgVisible },
    });
    fixtures.defer(() =>
      on.clients.workflowCommand.delete({ value: workflow.metadata?.id ?? "" }),
    );
    const agentInput = makeAgent({
      org: a.org,
      name: uniqueName("binding-agent"),
    });
    const agent = await on.clients.agentCommand.create({
      ...agentInput,
      metadata: { ...agentInput.metadata, ...orgVisible },
    });
    fixtures.defer(() =>
      on.clients.agentCommand.delete({ value: agent.metadata?.id ?? "" }),
    );
    const serverInput = makeMcpServer({
      org: a.org,
      name: uniqueName("binding-mcp"),
    });
    const server = await on.clients.mcpServerCommand.create({
      ...serverInput,
      metadata: { ...serverInput.metadata, ...orgVisible },
    });
    fixtures.defer(() =>
      on.clients.mcpServerCommand.delete({
        resourceId: server.metadata?.id ?? "",
      }),
    );

    const workflowRun = await expectGrpcCode(
      () =>
        key.clients.workflowExecutionCommand.create(
          makeWorkflowExecution({
            org: b.org,
            name: uniqueName("binding-wex"),
            workflowId: workflow.metadata?.id ?? "",
          }),
        ),
      Code.PermissionDenied,
      "file a workflow run in B through a key limited to A",
    );
    expect(workflowRun.rawMessage).toBe(BOUND_ELSEWHERE_MESSAGE);

    const agentRun = await expectGrpcCode(
      () =>
        key.clients.agentExecutionCommand.create(
          makeAgentExecution({
            org: b.org,
            name: uniqueName("binding-aex"),
            agentRef: agentRefOf(agent),
            message: "Say hello.",
          }),
        ),
      Code.PermissionDenied,
      "file an agent run in B through a key limited to A",
    );
    expect(agentRun.rawMessage).toBe(BOUND_ELSEWHERE_MESSAGE);

    const connect = await expectGrpcCode(
      () =>
        key.clients.mcpServerCommand.connect({
          mcpServerId: server.metadata?.id ?? "",
          org: b.org,
        }),
      Code.PermissionDenied,
      "connect in B through a key limited to A",
    );
    expect(connect.rawMessage).toBe(BOUND_ELSEWHERE_MESSAGE);
  });

  it("[rpc:McpServerCommandController.connect] a key limited to A connects, in A, to an MCP server A's parent B shares with its children exactly as its person does", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const b = await tenancy(on);
    const a = await childTenancy(on, b);
    const person = await personIn(on, a, "member");
    const key = await keyOf(on, person, a.org);
    const serverInput = makeMcpServer({
      org: b.org,
      name: uniqueName("binding-shared-mcp"),
    });
    const shared = await on.clients.mcpServerCommand.create({
      ...serverInput,
      metadata: {
        ...serverInput.metadata,
        visibility: ApiResourceVisibility.visibility_child_orgs,
      },
    });
    fixtures.defer(() =>
      on.clients.mcpServerCommand.delete({
        resourceId: shared.metadata?.id ?? "",
      }),
    );

    // Connecting is how an MCP server runs, the one path the model opens
    // across organizations: the binding adds nothing to it, so the limited
    // key gets exactly its person's answer, whatever the model and the
    // engine make of that answer on this target.
    const outcomeOf = (as: ConformanceClients) =>
      as.mcpServerCommand
        .connect({ mcpServerId: shared.metadata?.id ?? "", org: a.org })
        .then(
          () => "connected",
          (error: unknown) =>
            `${String((error as { code?: unknown }).code)} ${(error as { rawMessage?: string }).rawMessage ?? ""}`,
        );
    expect(
      await outcomeOf(key.clients),
      "the limited key's answer is its person's",
    ).toBe(await outcomeOf(person));
  });

  it("[rpc:WorkflowRunCommandController.create] a run filed in A cannot name B's workflow: its run credential, bound to A, could not read it", async (ctx) => {
    if (lane === undefined) return ctx.skip(laneReason);
    const on = lane;
    const a = await tenancy(on);
    const b = await tenancy(on);
    const person = await on.provisionMember(a);
    await on.clients.iamPolicyCommand.create(
      organizationRole(await on.accountIdOf(person), "member", b.org),
    );
    const workflowInput = makeWorkflow({
      org: b.org,
      name: uniqueName("binding-wf-b"),
    });
    const workflow = await on.clients.workflowCommand.create({
      ...workflowInput,
      metadata: {
        ...workflowInput.metadata,
        visibility: ApiResourceVisibility.visibility_org,
      },
    });
    fixtures.defer(() =>
      on.clients.workflowCommand.delete({ value: workflow.metadata?.id ?? "" }),
    );

    const refused = await expectGrpcCode(
      () =>
        person.workflowExecutionCommand.create(
          makeWorkflowExecution({
            org: a.org,
            name: uniqueName("binding-wex-cross"),
            workflowId: workflow.metadata?.id ?? "",
          }),
        ),
      Code.FailedPrecondition,
      "file a run in A of B's organization-visible workflow",
    );
    expect(refused.rawMessage).toContain(
      "a run uses only what its own organization can read",
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
