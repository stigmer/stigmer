// Conformance suite for the AgentInstance domain.
// Domain: agentic / agentinstance — the "Instance" layer of the Template ->
// Instance -> Execution pattern: binds an Agent template (spec.agent_id) to an
// ordered list of Environment refs merged at execution start. Sessions run
// against an AgentInstance (Session.spec.agent_instance_id).
//
// Drives AgentInstanceCommandController + AgentInstanceQueryController through
// the raw proto stubs and asserts the contract: CRUD round-trips, apply
// create/update branching, getByAgent listing incl. the auto-provisioned
// default instance and org scoping, org-wide list with AND-semantics label
// filtering, the visibility matrix (private/org/public; platform unsupported),
// and spec-first negative paths (environment_refs kind is CEL-pinned to
// environment).
//
// Parent-load on create is pinned (stigmer#645, ruled and fixed): unknown
// spec.agent_id -> NotFound in BOTH editions. Cross-org creation is
// deliberately NOT pinned: it is legitimate for agent instances (the
// marketplace case — an org publishes an agent, a consumer org instantiates
// it) but cloud gates it behind FGA can_create_instance while OSS, with no
// authorization layer, allows it — a real edition divergence, unlike
// WorkflowInstance's same-org rule which both editions enforce.
//
// Deliberately NOT asserted, with rulings pending:
//   - spec.agent_id immutability on update: the proto docs claim it, but
//     NEITHER edition enforces it (generic full-spec-replacement update) —
//     stigmer#646 holds the ruling. Only genuinely mutable fields are updated.
//
// The parent Agent's default-instance machinery (provisioning, the
// updateVisibility guard, cascade-only-the-default on agent delete) is
// asserted from the Agent domain's suite; here the default instance only
// appears as a required member of getByAgent results.
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { makeAgent } from "../support/agents";
import {
  AGENT_INSTANCE_API_VERSION,
  AGENT_INSTANCE_KIND,
  makeAgentInstance,
  makeAgentInstanceSpec,
} from "../support/agentinstances";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
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

// A parent Agent template for instances to bind to. Agent delete (deferred)
// cascades only its OWN default instance and spares user-created ones, so
// every user instance defers its own delete.
async function provisionAgent(org: string) {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agt") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

async function createInstance(
  org: string,
  agentId: string,
  name: string,
  labels?: Record<string, string>,
) {
  const init = makeAgentInstance({ org, name, agentId });
  if (labels) init.metadata = { name, org, labels };
  const instance = await clients.agentInstanceCommand.create(init);
  fixtures.defer(() => clients.agentInstanceCommand.delete({ value: instance.metadata!.id }));
  return instance;
}

describe("AgentInstance conformance — CRUD & identity", () => {
  it("create assigns an ain_ id, echoes the spec, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const name = uniqueName("agi");

    const created = await createInstance(org, agent.metadata!.id, name);

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^ain_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.agentId).toBe(agent.metadata?.id);
    expect(created.spec?.description).toBe("conformance fixture");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
    // Instances are not blueprint kinds: unspecified visibility defaults to
    // private — explicitly persisted, never the proto zero value.
    expect(created.metadata?.visibility, "visibility defaults to private").toBe(
      ApiResourceVisibility.visibility_private,
    );
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createInstance(org, agent.metadata!.id, uniqueName("agi"));

    const fetched = await clients.agentInstanceQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(AgentInstanceSchema, created, fetched, "create vs get");
  });

  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const name = uniqueName("agi");

    const first = await clients.agentInstanceCommand.apply(
      makeAgentInstance({ org, name, agentId: agent.metadata!.id, description: "v1" }),
    );
    fixtures.defer(() => clients.agentInstanceCommand.delete({ value: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.agentInstanceCommand.apply(
      makeAgentInstance({ org, name, agentId: agent.metadata!.id, description: "v2" }),
    );

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("v2");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update replaces mutable spec fields but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createInstance(org, agent.metadata!.id, uniqueName("agi"));
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    // The same agent_id is resubmitted: whether a DIFFERENT parent ref is
    // rejected is unpinned — the proto docs claim immutability but neither
    // edition enforces it (stigmer#646 holds that ruling).
    const updated = await clients.agentInstanceCommand.update({
      apiVersion: AGENT_INSTANCE_API_VERSION,
      kind: AGENT_INSTANCE_KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: makeAgentInstanceSpec({ agentId: agent.metadata!.id, description: "after" }),
    });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.spec?.description).toBe("after");
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await clients.agentInstanceCommand.create(
      makeAgentInstance({ org, name: uniqueName("agi"), agentId: agent.metadata!.id }),
    );
    const { id } = created.metadata!;

    const deleted = await clients.agentInstanceCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.agentInstanceQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.agentInstanceQuery.get({ value: "ain_doesnotexist" }),
      Code.NotFound,
      "get missing id",
    ));

  it("getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createInstance(org, agent.metadata!.id, uniqueName("ref"));

    const fetched = await clients.agentInstanceQuery.getByReference({ org, slug: created.metadata!.slug });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.agentInstanceQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("getByReference rejects a kind that does not match the service", () =>
    expectGrpcCode(
      () =>
        clients.agentInstanceQuery.getByReference({ org: "acme", slug: "any", kind: ApiResourceKind.workflow }),
      Code.InvalidArgument,
      "getByReference kind mismatch",
    ));

  it("derives a slug from the name and allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const agentA = await provisionAgent(a.org);
    const agentB = await provisionAgent(b.org);
    const name = uniqueName("shared");

    const inA = await createInstance(a.org, agentA.metadata!.id, name);
    const inB = await createInstance(b.org, agentB.metadata!.id, name);

    expect(inA.metadata?.slug).toBe(name);
    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });
});

describe("AgentInstance conformance — getByAgent & list", () => {
  it("getByAgent returns the created instances AND the agent's auto-provisioned default instance", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const a = await createInstance(org, agent.metadata!.id, uniqueName("agi"));
    const b = await createInstance(org, agent.metadata!.id, uniqueName("agi"));

    const list = await clients.agentInstanceQuery.getByAgent({ agentId: agent.metadata!.id });

    const ids = list.items.map((item) => item.metadata?.id);
    // arrayContaining, never exact counts: the parent's default instance
    // (status.default_instance_id) is always a member of the result set.
    expect(ids).toEqual(expect.arrayContaining([a.metadata?.id, b.metadata?.id]));
    expect(ids, "the default instance is listed alongside user instances").toContain(
      agent.status?.defaultInstanceId,
    );
  });

  it("getByAgent scopes results to the requested org (a foreign org sees nothing)", async () => {
    const { org } = await target.provisionTenancy();
    const other = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    await createInstance(org, agent.metadata!.id, uniqueName("agi"));

    const foreign = await clients.agentInstanceQuery.getByAgent({
      agentId: agent.metadata!.id,
      org: other.org,
    });

    expect(foreign.items, "instances all live in the parent's org").toEqual([]);
  });

  it("getByAgent rejects an empty agent_id (InvalidArgument)", () =>
    expectGrpcCode(
      () => clients.agentInstanceQuery.getByAgent({ agentId: "" }),
      Code.InvalidArgument,
      "getByAgent empty agent_id",
    ));

  it("list returns the org's instances and filters by labels (AND semantics)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const marker = uniqueName("case");
    const labeled = await createInstance(org, agent.metadata!.id, uniqueName("agi"), {
      "conformance-marker": marker,
    });
    const unlabeled = await createInstance(org, agent.metadata!.id, uniqueName("agi"));

    const all = await clients.agentInstanceQuery.list({ org });
    const allIds = all.items.map((item) => item.metadata?.id);
    expect(allIds).toEqual(expect.arrayContaining([labeled.metadata?.id, unlabeled.metadata?.id]));

    const filtered = await clients.agentInstanceQuery.list({
      org,
      labels: { "conformance-marker": marker },
    });
    const filteredIds = filtered.items.map((item) => item.metadata?.id);
    expect(filteredIds).toContain(labeled.metadata?.id);
    expect(filteredIds, "label filter excludes non-matching instances").not.toContain(
      unlabeled.metadata?.id,
    );
  });

  it("list rejects an empty org (InvalidArgument)", () =>
    expectGrpcCode(() => clients.agentInstanceQuery.list({ org: "" }), Code.InvalidArgument, "list empty org"));
});

describe("AgentInstance conformance — visibility", () => {
  it("updateVisibility raises a user instance from private to org and persists it", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createInstance(org, agent.metadata!.id, uniqueName("agi"));

    const updated = await clients.agentInstanceCommand.updateVisibility({
      resourceId: created.metadata!.id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(updated.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);

    const stored = await clients.agentInstanceQuery.get({ value: created.metadata!.id });
    expect(stored.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
  });

  it("updateVisibility rejects the unsupported platform level (InvalidArgument) and leaves the stored level untouched", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createInstance(org, agent.metadata!.id, uniqueName("agi"));

    const err = await expectGrpcCode(
      () =>
        clients.agentInstanceCommand.updateVisibility({
          resourceId: created.metadata!.id,
          visibility: ApiResourceVisibility.visibility_platform,
        }),
      Code.InvalidArgument,
      "updateVisibility to platform",
    );
    // Both editions build the rejection from the kind's proto visibility
    // config; the stable fragment is part of the cross-edition contract.
    expect(err.message).toContain("cannot be set to visibility_platform");

    const stored = await clients.agentInstanceQuery.get({ value: created.metadata!.id });
    expect(stored.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
  });
});

describe("AgentInstance conformance — negative paths", () => {
  it("rejects a wrong api_version (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    await expectGrpcCode(
      () =>
        clients.agentInstanceCommand.create({
          apiVersion: "wrong.stigmer.ai/v1",
          kind: AGENT_INSTANCE_KIND,
          metadata: { name: uniqueName("agi"), org },
          spec: makeAgentInstanceSpec({ agentId: agent.metadata!.id }),
        }),
      Code.InvalidArgument,
      "create with wrong api_version",
    );
  });

  it("rejects a wrong kind (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    await expectGrpcCode(
      () =>
        clients.agentInstanceCommand.create({
          apiVersion: AGENT_INSTANCE_API_VERSION,
          kind: "NotAnAgentInstance",
          metadata: { name: uniqueName("agi"), org },
          spec: makeAgentInstanceSpec({ agentId: agent.metadata!.id }),
        }),
      Code.InvalidArgument,
      "create with wrong kind",
    );
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const name = uniqueName("dup");
    await createInstance(org, agent.metadata!.id, name);

    await expectGrpcCode(
      () =>
        clients.agentInstanceCommand.create(
          makeAgentInstance({ org, name, agentId: agent.metadata!.id }),
        ),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    await expectGrpcCode(
      () =>
        clients.agentInstanceCommand.create({
          apiVersion: AGENT_INSTANCE_API_VERSION,
          kind: AGENT_INSTANCE_KIND,
          metadata: { org },
          spec: makeAgentInstanceSpec({ agentId: agent.metadata!.id }),
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });

  it("rejects an empty agent_id (InvalidArgument, protovalidate min_len)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.agentInstanceCommand.create({
          apiVersion: AGENT_INSTANCE_API_VERSION,
          kind: AGENT_INSTANCE_KIND,
          metadata: { name: uniqueName("agi"), org },
          spec: { agentId: "", description: "missing parent ref" },
        }),
      Code.InvalidArgument,
      "create with empty agent_id",
    );
  });

  it("rejects an unknown agent_id (contract: NotFound from parent load)", async () => {
    // The parent template must exist: create runs LoadParentAgent before
    // persisting (stigmer#645) — converging on cloud and on the sibling
    // WorkflowInstance pipeline. Cross-org creation stays unpinned: see the
    // suite header (marketplace case, FGA-gated in cloud only).
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.agentInstanceCommand.create(
          makeAgentInstance({ org, name: uniqueName("agi"), agentId: "agt_doesnotexist" }),
        ),
      Code.NotFound,
      "create with unknown agent_id",
    );
  });

  it("rejects environment_refs whose kind is not environment (InvalidArgument, CEL-pinned)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);

    await expectGrpcCode(
      () =>
        clients.agentInstanceCommand.create({
          apiVersion: AGENT_INSTANCE_API_VERSION,
          kind: AGENT_INSTANCE_KIND,
          metadata: { name: uniqueName("agi"), org },
          spec: {
            agentId: agent.metadata!.id,
            description: "bad ref kind",
            environmentRefs: [{ org, slug: "some-env", kind: ApiResourceKind.workflow }],
          },
        }),
      Code.InvalidArgument,
      "create with wrong-kind environment ref",
    );
  });
});
