// Role enforcement conformance: what each organization role may do, on the
// wire, with real people — the same cells on every ENFORCING LANE
// (targets/target.ts): the cloud's primary behind OpenFGA, and on the
// managed local targets an open-source sibling in the OIDC posture behind
// the built-in Authorizer, directory and list scope of `@stigmer/server`.
// One file, three servers (cloud, sqlite, Postgres): the cross-edition
// contract that the roles mean the same thing wherever Stigmer runs.
//
// The cells are chosen by CLASS, not as a Cartesian product: the model's
// relations are proven line by line by the cloud's own OpenFGA store tests
// (pinned in the server's authorization suite), so what the wire has to
// prove is the RPC→relation binding and the answer a real person hears —
// per RPC, per rung, once. Every cell here is true of the cloud by the
// model; a red on any lane is a divergence between editions, never a cell
// to re-stage.
//
//   - Blueprints (agent, workflow, skill, mcp_server — the visibility-axis
//     kinds): owner and admin edit and delete both a private and an
//     org-visible row (`can_edit`/`can_delete` are the creator OR
//     `admin from organization`); a member reads org-visible and is refused
//     private (`can_view: viewer`, where org-visible derives
//     `organization#viewer` and private derives nobody but the creator); a
//     viewer reads org-visible only; neither edits; a member may not create
//     (`can_create_agent/workflow/skill: admin`); an outsider — a person
//     with no role on the organization — is PERMISSION_DENIED on an
//     existing row and NOT_FOUND on a missing id (the Authorizer's
//     existence probe: a missing target is never dressed as a denial).
//     `McpServer.create` takes the same admin bar (`can_create_mcp_server`)
//     since the annotation and the model line landed; before that a member
//     authored MCP servers in both editions, and this suite pinned the
//     admission by name so the line's arrival flipped it visibly.
//   - Personal rows (a session, an environment, an API key): the person's
//     own; another member and the organization's ADMIN are refused on
//     `get`, and every list — theirs, the admin's — omits the row. The
//     admin arm is the oracle the cloud's model gives: an admin manages the
//     organization's blueprints and members and never reads a member's
//     conversations, keys or environments.
//   - The organization: `find` is UNIMPLEMENTED on every enforcing lane (the
//     cloud leaves it unrouted; the built-in directory refuses enumeration);
//     `findMyOrganizations` is the caller's organizations — a member of one
//     of two sees one; `checkMyPermission(can_edit, organization)` is false
//     for a member and true for an admin (the console's gates read exactly
//     this).
//   - The platform: `checkMyPermission(can_view_provider_standing,
//     platform:stigmer)` is false for an owner — no organization role holds
//     a platform capability — and the retired public level is refused for
//     an owner as an invalid level, gated for nobody.
//   - An unprovisioned caller — admitted idp-shaped, no account — may not
//     create a blueprint (the sign-in flow's first RPC is provisionMyAccount,
//     not a write). Where the lane cannot mint one the cell skips VISIBLY.
//
// Deliberately OUT of this suite: memories (every open-source memory row
// carries an empty subject today and is nobody's under enforcement — the
// runner entry fills it); executions and instances (a Class A target
// stages no run, and the instance create lane is the parent's finding);
// the run gate (run-gate.conformance.test.ts), list isolation for an
// outsider (list-read-scoping), the direct handlers
// (direct-handler-authorization) and the IamPolicy RPCs (iampolicy) — each
// rides the same lane in its own file; the per-RPC refusal copy, pinned
// where each RPC's contract lives (this suite asserts the CODE, the
// question being who may, not what the sentence says).
import { Code } from "@connectrpc/connect";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import {
  makeAgent,
  makeAgentSpec,
  AGENT_API_VERSION,
  AGENT_KIND,
} from "../support/agents";
import { makeEnvironment } from "../support/environments";
import { ref } from "../support/iampolicies";
import {
  makeMcpServer,
  makeMcpServerSpec,
  MCPSERVER_API_VERSION,
  MCPSERVER_KIND,
} from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { makeSkillArtifact } from "../support/skills";
import { makeWorkflow } from "../support/workflows";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";

let target: TargetProfile;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  enforcing = await enforcingLaneOf(target);
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
  if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
  return enforcing.lane;
}

// The people of one organization, provisioned once per block: the founder
// (its owner) and one person per other rung, plus an outsider who holds
// nothing on it. A block's arms share them; the rows are per arm.
interface Cast {
  readonly org: string;
  readonly tenancy: TenancyContext;
  readonly owner: ConformanceClients;
  readonly admin: ConformanceClients;
  readonly member: ConformanceClients;
  readonly viewer: ConformanceClients;
  readonly outsider: ConformanceClients;
}

async function castOf(lane: EnforcingLane): Promise<Cast> {
  const tenancy = await lane.provisionTenancy();
  return {
    org: tenancy.org,
    tenancy,
    owner: lane.clients,
    admin: await lane.provisionWithRole(tenancy, "admin"),
    member: await lane.provisionMember(tenancy),
    viewer: await lane.provisionWithRole(tenancy, "viewer"),
    outsider: await lane.provisionIdentity(),
  };
}

const PRIVATE = ApiResourceVisibility.visibility_private;
const ORG_VISIBLE = ApiResourceVisibility.visibility_org;

// One blueprint kind as the wire offers it: how a row is created at a
// visibility, read, edited and deleted. `edit` is whatever mutation the
// kind's `can_edit` guards — `update` where the kind has one, and
// `updateVisibility` for skills, which are pushed, never updated.
interface BlueprintKind {
  readonly name: string;
  create(
    using: ConformanceClients,
    org: string,
    visibility: ApiResourceVisibility,
  ): Promise<string>;
  get(using: ConformanceClients, id: string): Promise<unknown>;
  edit(using: ConformanceClients, id: string): Promise<unknown>;
  delete(using: ConformanceClients, id: string): Promise<unknown>;
}

const BLUEPRINT_KINDS: ReadonlyArray<BlueprintKind> = [
  {
    name: "agent",
    async create(using, org, visibility) {
      const input = makeAgent({ org, name: uniqueName("role-agent") });
      input.metadata = { ...input.metadata, visibility };
      const created = await using.agentCommand.create(input);
      return created.metadata!.id;
    },
    get: (using, id) => using.agentQuery.get({ value: id }),
    edit: (using, id) =>
      using.agentCommand.update({
        apiVersion: AGENT_API_VERSION,
        kind: AGENT_KIND,
        metadata: { id, name: uniqueName("role-agent-renamed") },
        spec: makeAgentSpec({ description: "edited by a role" }),
      }),
    delete: (using, id) => using.agentCommand.delete({ value: id }),
  },
  {
    name: "workflow",
    async create(using, org, visibility) {
      const input = makeWorkflow({ org, name: uniqueName("role-wf") });
      input.metadata = { ...input.metadata, visibility };
      const created = await using.workflowCommand.create(input);
      return created.metadata!.id;
    },
    get: (using, id) => using.workflowQuery.get({ value: id }),
    // A workflow's `update` is a full-envelope replace; the visibility flip
    // is the one mutation every workflow admits without a new document.
    edit: (using, id) =>
      using.workflowCommand.updateVisibility({
        resourceId: id,
        visibility: ORG_VISIBLE,
      }),
    delete: (using, id) => using.workflowCommand.delete({ value: id }),
  },
  {
    name: "skill",
    async create(using, org, visibility) {
      const pushed = await using.skillCommand.push({
        org,
        artifact: makeSkillArtifact({ name: uniqueName("role-skill") }),
      });
      const id = pushed.metadata!.id;
      if (pushed.metadata?.visibility !== visibility) {
        await using.skillCommand.updateVisibility({
          resourceId: id,
          visibility,
        });
      }
      return id;
    },
    get: (using, id) => using.skillQuery.get({ value: id }),
    edit: (using, id) =>
      using.skillCommand.updateVisibility({
        resourceId: id,
        visibility: ORG_VISIBLE,
      }),
    delete: (using, id) => using.skillCommand.delete({ value: id }),
  },
  {
    name: "mcp_server",
    async create(using, org, visibility) {
      const input = makeMcpServer({ org, name: uniqueName("role-mcp") });
      input.metadata = { ...input.metadata, visibility };
      const created = await using.mcpServerCommand.create(input);
      return created.metadata!.id;
    },
    get: (using, id) => using.mcpServerQuery.get({ value: id }),
    edit: (using, id) =>
      using.mcpServerCommand.update({
        apiVersion: MCPSERVER_API_VERSION,
        kind: MCPSERVER_KIND,
        metadata: { id, name: uniqueName("role-mcp-renamed") },
        spec: makeMcpServerSpec({ description: "edited by a role" }),
      }),
    delete: (using, id) => using.mcpServerCommand.delete({ resourceId: id }),
  },
];

// A row the founder creates and the arm's end deletes as the founder.
async function seed(
  kind: BlueprintKind,
  cast: Cast,
  visibility: ApiResourceVisibility,
): Promise<string> {
  const id = await kind.create(cast.owner, cast.org, visibility);
  fixtures.defer(() => kind.delete(cast.owner, id).catch(() => undefined));
  return id;
}

describe("role enforcement — blueprints: who may read, edit, delete and create", () => {
  let cast: Cast | undefined;

  beforeAll(async () => {
    if (enforcing.lane === undefined) return;
    cast = await castOf(enforcing.lane);
  });

  function castOrSkip(ctx: { skip: (note?: string) => never }): Cast {
    laneOrSkip(ctx);
    if (cast === undefined) ctx.skip("the block's people were not provisioned");
    return cast;
  }

  describe.each(BLUEPRINT_KINDS)("$name", (kind) => {
    it("a member reads an org-visible row and is refused a private one", async (ctx) => {
      const c = castOrSkip(ctx);
      const shared = await seed(kind, c, ORG_VISIBLE);
      const hidden = await seed(kind, c, PRIVATE);

      await kind.get(c.member, shared);
      await expectGrpcCode(
        () => kind.get(c.member, hidden),
        Code.PermissionDenied,
        `member get on a private ${kind.name}`,
      );
    });

    it("a viewer reads an org-visible row, is refused a private one, and edits neither", async (ctx) => {
      const c = castOrSkip(ctx);
      const shared = await seed(kind, c, ORG_VISIBLE);
      const hidden = await seed(kind, c, PRIVATE);

      await kind.get(c.viewer, shared);
      await expectGrpcCode(
        () => kind.get(c.viewer, hidden),
        Code.PermissionDenied,
        `viewer get on a private ${kind.name}`,
      );
      await expectGrpcCode(
        () => kind.edit(c.viewer, shared),
        Code.PermissionDenied,
        `viewer edit on an org-visible ${kind.name}`,
      );
    });

    it("a member may not edit or delete an org-visible row someone else created", async (ctx) => {
      const c = castOrSkip(ctx);
      const shared = await seed(kind, c, ORG_VISIBLE);

      await expectGrpcCode(
        () => kind.edit(c.member, shared),
        Code.PermissionDenied,
        `member edit on an org-visible ${kind.name}`,
      );
      await expectGrpcCode(
        () => kind.delete(c.member, shared),
        Code.PermissionDenied,
        `member delete on an org-visible ${kind.name}`,
      );
      // Still there for its creator: a denied write is side-effect free.
      await kind.get(c.owner, shared);
    });

    it("an admin edits and deletes rows the founder created, private ones included", async (ctx) => {
      const c = castOrSkip(ctx);
      const hidden = await seed(kind, c, PRIVATE);

      await kind.get(c.admin, hidden);
      await kind.edit(c.admin, hidden);
      await kind.delete(c.admin, hidden);
      await expectGrpcCode(
        () => kind.get(c.owner, hidden),
        Code.NotFound,
        `the founder's get after the admin's delete of a ${kind.name}`,
      );
    });

    it("an outsider is refused an existing row and told a missing id does not exist", async (ctx) => {
      const c = castOrSkip(ctx);
      const shared = await seed(kind, c, ORG_VISIBLE);

      await expectGrpcCode(
        () => kind.get(c.outsider, shared),
        Code.PermissionDenied,
        `outsider get on an existing ${kind.name}`,
      );
      await expectGrpcCode(
        () => kind.get(c.outsider, `${kind.name}_role_enforcement_missing`),
        Code.NotFound,
        `outsider get on a missing ${kind.name}`,
      );
    });

    it("a member may not create — can_create is the admin's", async (ctx) => {
      const c = castOrSkip(ctx);
      await expectGrpcCode(
        () => kind.create(c.member, c.org, PRIVATE),
        Code.PermissionDenied,
        `member create of a ${kind.name}`,
      );
    });
  });
});

// A personal kind as the wire offers it: created BY a member, read by id,
// listed. The organization's admin and another member are strangers to it.
interface PersonalKind {
  readonly name: string;
  create(using: ConformanceClients, cast: Cast): Promise<string>;
  get(using: ConformanceClients, id: string): Promise<unknown>;
  listIds(
    using: ConformanceClients,
    org: string,
  ): Promise<ReadonlyArray<string>>;
  delete(using: ConformanceClients, id: string): Promise<unknown>;
}

const PERSONAL_KINDS: ReadonlyArray<PersonalKind> = [
  {
    name: "session",
    // On an ORG-visible agent the founder created, so the member's session
    // create passes the run gate (`agent_instance.can_execute` reaches
    // `organization#viewer`); the session itself is the member's.
    async create(using, cast) {
      const agent = await cast.owner.agentCommand.create(
        (() => {
          const input = makeAgent({
            org: cast.org,
            name: uniqueName("role-session-agent"),
          });
          input.metadata = { ...input.metadata, visibility: ORG_VISIBLE };
          return input;
        })(),
      );
      fixtures.defer(() =>
        cast.owner.agentCommand
          .delete({ value: agent.metadata!.id })
          .catch(() => undefined),
      );
      const session = await using.sessionCommand.create(
        makeSession({
          org: cast.org,
          name: uniqueName("role-session"),
          agentInstanceId: agent.status!.defaultInstanceId,
          subject: "a member's conversation",
        }),
      );
      return session.metadata!.id;
    },
    get: (using, id) => using.sessionQuery.get({ value: id }),
    listIds: async (using) =>
      (await using.sessionQuery.list({})).entries.map(
        (s) => s.metadata?.id ?? "",
      ),
    delete: (using, id) => using.sessionCommand.delete({ value: id }),
  },
  {
    name: "environment",
    async create(using, cast) {
      const created = await using.environmentCommand.create(
        makeEnvironment({ org: cast.org, name: uniqueName("role-env") }),
      );
      return created.metadata!.id;
    },
    get: (using, id) => using.environmentQuery.get({ value: id }),
    listIds: async (using, org) =>
      (await using.environmentQuery.list({ org })).items.map(
        (e) => e.metadata?.id ?? "",
      ),
    delete: (using, id) => using.environmentCommand.delete({ resourceId: id }),
  },
  {
    name: "api_key",
    async create(using, cast) {
      const created = await using.apiKeyCommand.create({
        apiVersion: "iam.stigmer.ai/v1",
        kind: "ApiKey",
        metadata: { name: uniqueName("role-key"), org: cast.org },
        spec: {},
      });
      return created.metadata!.id;
    },
    get: (using, id) => using.apiKeyQuery.get({ value: id }),
    listIds: async (using) =>
      (await using.apiKeyQuery.findAll({})).entries.map(
        (k) => k.metadata?.id ?? "",
      ),
    delete: (using, id) => using.apiKeyCommand.delete({ value: id }),
  },
];

describe("role enforcement — personal rows: a member's own, and nobody else's, the admin included", () => {
  let cast: Cast | undefined;

  beforeAll(async () => {
    if (enforcing.lane === undefined) return;
    cast = await castOf(enforcing.lane);
  });

  function castOrSkip(ctx: { skip: (note?: string) => never }): Cast {
    laneOrSkip(ctx);
    if (cast === undefined) ctx.skip("the block's people were not provisioned");
    return cast;
  }

  describe.each(PERSONAL_KINDS)("$name", (kind) => {
    it("the member reads and lists their own row; another member and the admin are refused and do not list it", async (ctx) => {
      const c = castOrSkip(ctx);
      const id = await kind.create(c.member, c);
      fixtures.defer(() => kind.delete(c.member, id).catch(() => undefined));

      await kind.get(c.member, id);
      expect(
        await kind.listIds(c.member, c.org),
        `the member's own ${kind.name} list`,
      ).toContain(id);

      await expectGrpcCode(
        () => kind.get(c.viewer, id),
        Code.PermissionDenied,
        `another person's get on a member's ${kind.name}`,
      );
      expect(
        await kind.listIds(c.viewer, c.org),
        `another person's ${kind.name} list`,
      ).not.toContain(id);

      await expectGrpcCode(
        () => kind.get(c.admin, id),
        Code.PermissionDenied,
        `the admin's get on a member's ${kind.name}`,
      );
      expect(
        await kind.listIds(c.admin, c.org),
        `the admin's ${kind.name} list`,
      ).not.toContain(id);
    });
  });
});

describe("role enforcement — the organization: enumeration, membership, the console's gate", () => {
  it("find is UNIMPLEMENTED on every enforcing lane — no role enumerates organizations", async (ctx) => {
    const lane = laneOrSkip(ctx);
    // `org` is required by protovalidate and ignored by find (organizations
    // are the top-level scope) — the organization suite's placeholder.
    await expectGrpcCode(
      () =>
        lane.clients.organizationQuery.find({
          org: "conformance",
          pageSize: 10,
        }),
      Code.Unimplemented,
      "find on an enforcing lane",
    );
  });

  it("findMyOrganizations is the caller's organizations: a member of one of two sees one", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const first = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(first).catch(() => undefined));
    const member = await lane.provisionMember(first);
    // Founded AFTER the member arrived, so no arrival rule can have made
    // them part of it.
    const second = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(second).catch(() => undefined));

    const theirs = (
      await member.organizationQuery.findMyOrganizations({})
    ).entries.map((o) => o.metadata?.id ?? "");
    expect(theirs, "the member's organizations").toContain(first.org);
    expect(theirs, "the member's organizations").not.toContain(second.org);

    const founders = (
      await lane.clients.organizationQuery.findMyOrganizations({})
    ).entries.map((o) => o.metadata?.id ?? "");
    expect(founders, "the founder's organizations").toEqual(
      expect.arrayContaining([first.org, second.org]),
    );
  });

  it("checkMyPermission(can_edit, organization) is false for a member and true for an admin", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const tenancy = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(tenancy).catch(() => undefined));
    const member = await lane.provisionMember(tenancy);
    const admin = await lane.provisionWithRole(tenancy, "admin");

    const asMember = await member.iamPolicyQuery.checkMyPermission({
      resource: ref("organization", tenancy.org),
      relation: "can_edit",
    });
    expect(asMember.isAuthorized, "a member editing the organization").toBe(
      false,
    );

    const asAdmin = await admin.iamPolicyQuery.checkMyPermission({
      resource: ref("organization", tenancy.org),
      relation: "can_edit",
    });
    expect(asAdmin.isAuthorized, "an admin editing the organization").toBe(
      true,
    );
  });
});

describe("role enforcement — the platform: no organization role holds a platform capability", () => {
  it("checkMyPermission(can_view_provider_standing, platform:stigmer) is false for an owner", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const result = await lane.clients.iamPolicyQuery.checkMyPermission({
      resource: ref("platform", "stigmer"),
      relation: "can_view_provider_standing",
    });
    expect(result.isAuthorized).toBe(false);
  });

  it("the retired public level is refused for an owner as an invalid level — gated for nobody", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const tenancy = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(tenancy).catch(() => undefined));

    const input = makeAgent({
      org: tenancy.org,
      name: uniqueName("role-public-agent"),
    });
    input.metadata = {
      ...input.metadata,
      visibility: ApiResourceVisibility.visibility_public,
    };
    const err = await expectGrpcCode(
      () => lane.clients.agentCommand.create(input),
      Code.InvalidArgument,
      "an owner creating an agent at the retired public level",
    );
    expect(err.message).toContain(
      "agent resources cannot be set to visibility_public. " +
        "Supported visibility levels: visibility_private, visibility_org, visibility_platform.",
    );
  });
});

describe("role enforcement — an unprovisioned caller writes nothing", () => {
  it("an admitted subject with no account may not create a blueprint", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const mintStranger = lane.unprovisionedCaller;
    if (mintStranger === undefined) {
      return ctx.skip(
        "the lane cannot mint an admitted subject with no account",
      );
    }
    const tenancy = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(tenancy).catch(() => undefined));
    const stranger = await mintStranger();

    const input = makeAgent({
      org: tenancy.org,
      name: uniqueName("role-stranger-agent"),
    });
    input.metadata = { ...input.metadata, visibility: ORG_VISIBLE };
    await expectGrpcCode(
      () => stranger.agentCommand.create(input),
      Code.PermissionDenied,
      "an unprovisioned caller creating an agent",
    );
  });
});
