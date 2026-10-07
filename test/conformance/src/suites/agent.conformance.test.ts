// Conformance suite for the Agent domain.
// Domain: agentic / agent — a versioned blueprint resource (its versions:
// agent-versions.conformance.test.ts).
//
// Drives AgentCommandController + AgentQueryController through the raw proto
// stubs and asserts the contract: CRUD round-trips, apply create/update
// branching, immutable identity fields, reference resolution, slug semantics,
// and spec-first negative paths. An agent is run directly: a conversation
// names it by reference (the session suite), so creating one provisions
// nothing beside it. The cross-aggregate
// Agent->McpServer reference invariant lives in
// agent-mcpserver-references.conformance.test.ts.
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { AGENT_API_VERSION, AGENT_KIND, makeAgent, makeAgentSpec } from "../support/agents";
import { uniqueName, uniqueOrg } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
// Read at collection time so an edition without a capability reports its cases
// SKIPPED (the conformance guide's rule), never as passes that returned early.
const capabilities = createTarget().capabilities;
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

async function createAgent(org: string, name: string, opts: { description?: string; mcpServerRefs?: string[] } = {}) {
  const agent = await clients.agentCommand.create(makeAgent({ org, name, ...opts }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

describe("Agent conformance — CRUD & identity", () => {
  it("[rpc:AgentCommandController.create] create assigns an agt_ id, echoes the spec, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");

    const created = await createAgent(org, name, { description: "code reviewer" });

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^agt_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.description).toBe("code reviewer");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
    // Agent is a blueprint kind (defaults_to_org_visibility), so an
    // unspecified visibility defaults to org; private is an explicit opt-in.
    expect(created.metadata?.visibility, "visibility defaults to org (blueprint default)").toBe(ApiResourceVisibility.visibility_org);
  });

  it("[rpc:AgentCommandController.create] creates an agent without a spec (spec is optional at the proto level)", async () => {
    const { org } = await target.provisionTenancy();
    // AgentSpec is not `required`; a spec-less agent is a valid (if minimal)
    // blueprint. This documents that part of the contract.
    const created = await clients.agentCommand.create({
      apiVersion: AGENT_API_VERSION,
      kind: AGENT_KIND,
      metadata: { name: uniqueName("nospec"), org },
    });
    fixtures.defer(() => clients.agentCommand.delete({ value: created.metadata!.id }));

    expect(created.metadata?.id).toMatch(/^agt_[0-9a-z]+$/);
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("[rpc:AgentQueryController.get] get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createAgent(org, uniqueName("agent"));

    const fetched = await clients.agentQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(AgentSchema, created, fetched, "create vs get");
  });

  it("[rpc:AgentCommandController.apply] apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");

    const first = await clients.agentCommand.apply(makeAgent({ org, name, description: "v1" }));
    fixtures.defer(() => clients.agentCommand.delete({ value: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.agentCommand.apply(makeAgent({ org, name, description: "v2" }));

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("v2");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("[rpc:AgentCommandController.update] update replaces spec and name but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createAgent(org, uniqueName("agent"), { description: "before" });
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    const updated = await clients.agentCommand.update({
      apiVersion: AGENT_API_VERSION,
      kind: AGENT_KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: makeAgentSpec({ description: "after" }),
    });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.spec?.description).toBe("after");
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("[rpc:AgentCommandController.delete] delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
    const { id } = created.metadata!;

    const deleted = await clients.agentCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.agentQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("[rpc:AgentQueryController.get] get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.agentQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("[rpc:AgentQueryController.get] get of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.agentQuery.get({ value: "agt_doesnotexist" }), Code.NotFound, "get missing id"));

  it("[rpc:AgentQueryController.getByReference] getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createAgent(org, uniqueName("ref"));

    const fetched = await clients.agentQuery.getByReference({ org, slug: created.metadata!.slug });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("[rpc:AgentQueryController.getByReference] getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.agentQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("[rpc:AgentQueryController.getByReference] getByReference rejects a kind that does not match the service", () =>
    expectGrpcCode(
      () => clients.agentQuery.getByReference({ org: "acme", slug: "web-search", kind: ApiResourceKind.skill }),
      Code.InvalidArgument,
      "getByReference kind mismatch",
    ));

  it("[rpc:AgentCommandController.create] derives a slug from the name", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createAgent(org, "My Agent #1 (Test)");
    expect(created.metadata?.slug).toBe("my-agent-1-test");
  });

  it("[rpc:AgentCommandController.create] allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const name = uniqueName("shared");

    const inA = await createAgent(a.org, name);
    const inB = await createAgent(b.org, name);

    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });
});

describe("Agent conformance — negative paths", () => {
  it("[rpc:AgentCommandController.create] rejects instructions shorter than the minimum length (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // AgentSpec.instructions has min_len=10; a present-but-too-short value is a
    // Layer-1 protovalidate violation caught by ValidateProtoStep.
    await expectGrpcCode(
      () =>
        clients.agentCommand.create({
          apiVersion: AGENT_API_VERSION,
          kind: AGENT_KIND,
          metadata: { name: uniqueName("short"), org },
          spec: makeAgentSpec({ instructions: "too short" }),
        }),
      Code.InvalidArgument,
      "create with short instructions",
    );
  });

  it("[rpc:AgentCommandController.create] rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dup");
    await createAgent(org, name);

    await expectGrpcCode(
      () => clients.agentCommand.create(makeAgent({ org, name })),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("[rpc:AgentCommandController.create] rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // Spec is valid so Layer 1 passes; the empty name is what must be rejected
    // (slug resolution has nothing to derive from).
    await expectGrpcCode(
      () =>
        clients.agentCommand.create({
          apiVersion: AGENT_API_VERSION,
          kind: AGENT_KIND,
          metadata: { org },
          spec: makeAgentSpec(),
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });

  it("[rpc:AgentCommandController.create] [rpc:AgentCommandController.apply] rejects a create and an apply into an Organization that does not exist (contract: NotFound, the load-first copy)", async () => {
    // A slug no Organization holds. Every edition answers this before any
    // permission question and with the same sentence, whether the server
    // signs its callers in or not (stigmer#1163): nothing is stored under
    // a slug nothing lists.
    const missing = uniqueOrg();
    for (const [lane, call] of [
      ["create", () => clients.agentCommand.create(makeAgent({ org: missing, name: uniqueName("phantom") }))],
      ["apply", () => clients.agentCommand.apply(makeAgent({ org: missing, name: uniqueName("phantom") }))],
    ] as const) {
      const error = await expectGrpcCode(call, Code.NotFound, `${lane} into a missing organization`);
      expect(error.rawMessage, lane).toBe(`Organization not found: ${missing}`);
    }
  });
});

describe("Agent conformance — run defaults", () => {
  // An agent's run defaults (spec.run_config) are judged at save on the
  // engine they name (spec.harness): each engine lists its own models.
  // Existence is checked only here, never when a turn starts.
  it("[rpc:AgentCommandController.create] [rpc:AgentQueryController.getVersion] stores run defaults and their engine, versioned with the agent", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("defaults"),
        harness: Harness.NATIVE,
        runConfig: { modelName: "claude-sonnet-5", thinkingMode: ThinkingMode.ENABLED, maxCostUsd: 2 },
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    expect(agent.spec?.harness).toBe(Harness.NATIVE);
    expect(agent.spec?.runConfig?.modelName).toBe("claude-sonnet-5");
    const version = await clients.agentQuery.getVersion({
      agentId: agent.metadata!.id,
      versionHash: agent.status!.versionHash,
    });
    expect(version.specSnapshot?.runConfig?.maxCostUsd).toBe(2);
    expect(version.specSnapshot?.harness).toBe(Harness.NATIVE);
  });

  it("[rpc:AgentCommandController.create] accepts an engine with no model, and bounds with no engine", async () => {
    const { org } = await target.provisionTenancy();
    const engineOnly = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("defaults-ok"), harness: Harness.CURSOR }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: engineOnly.metadata!.id }));
    const boundsOnly = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("defaults-ok"), runConfig: { maxCostUsd: 1, maxToolRounds: 30 } }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: boundsOnly.metadata!.id }));

    // Stored as written, read back.
    const engine = await clients.agentQuery.get({ value: engineOnly.metadata!.id });
    expect(engine.spec?.harness).toBe(Harness.CURSOR);
    expect(engine.spec?.runConfig?.modelName ?? "").toBe("");
    const bounds = await clients.agentQuery.get({ value: boundsOnly.metadata!.id });
    expect(bounds.spec?.harness).toBe(Harness.UNSPECIFIED);
    expect(bounds.spec?.runConfig?.maxCostUsd).toBe(1);
    expect(bounds.spec?.runConfig?.maxToolRounds).toBe(30);
  });

  it.each<[string, Parameters<typeof makeAgent>[0]["runConfig"], Harness | undefined, string]>([
    ["a model with no engine", { modelName: "claude-sonnet-5" }, undefined, "requires spec.harness"],
    ["a model the engine does not list", { modelName: "claude-sonnet-4.6" }, Harness.CURSOR, "cursor harness"],
    ["fast with no model", { serviceTier: ServiceTier.FAST }, Harness.CURSOR, "requires spec.run_config.model_name"],
    [
      "thinking on a model that cannot think on the engine",
      { modelName: "composer-2.5", thinkingMode: ThinkingMode.ENABLED },
      Harness.CURSOR,
      "no thinking capability",
    ],
  ])("[rpc:AgentCommandController.create] refuses %s (InvalidArgument)", async (what, runConfig, harness, says) => {
    const { org } = await target.provisionTenancy();
    const err = await expectGrpcCode(
      () =>
        clients.agentCommand.create(
          makeAgent({
            org,
            name: uniqueName("defaults-bad"),
            runConfig,
            ...(harness !== undefined ? { harness } : {}),
          }),
        ),
      Code.InvalidArgument,
      what,
    );
    expect(err.rawMessage).toContain(says);
  });
});

describe("Agent conformance — reserved labels", () => {
  // The label the retired default-agent lookup once read. It stays the
  // canonical example of a reserved stigmer.ai/* key an ordinary caller may
  // not introduce; nothing resolves it any more.
  const DEFAULT_AGENT_LABEL = "stigmer.ai/default-agent";

  // The write guard is cloud-only; the local OSS targets are deliberately
  // unguarded (single-tenant, the operator owns the store), so this pin is the
  // false-branch twin of the capability — where ordinary reserved writes
  // are allowed there is nothing to reject.
  it.skipIf(capabilities.clientReservedLabelWrites)("an ordinary caller introducing a reserved stigmer.ai/* label is rejected where the guard holds", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.agentCommand.create(
          makeAgent({ org, name: uniqueName("forged-default"), labels: { [DEFAULT_AGENT_LABEL]: "true" } }),
        ),
      Code.InvalidArgument,
      "reserved-label introduction by an ordinary caller",
    );
  });
});

describe("Agent conformance — delete frees the slug (stigmer#611)", () => {
  it("[rpc:AgentCommandController.delete] delete frees the agent slug: a recreate under the same name converges on a new agent", async () => {
    // The cascade pin (stigmer#592): nothing an agent owned outlives it to
    // hold its slug, so a same-name recreate is a new agent rather than a
    // collision. Sessions that named the deleted
    // agent survive as historical record (the #582 ruling) and keep naming
    // the agent they pinned (the agentexecution suite's re-created-slug arm).
    const { org } = await target.provisionTenancy();
    const name = uniqueName("cascade");

    const created = await clients.agentCommand.create(makeAgent({ org, name }));
    const agentId = created.metadata!.id;

    await clients.agentCommand.delete({ value: agentId });
    await expectGrpcCode(() => clients.agentQuery.get({ value: agentId }), Code.NotFound, "agent after delete");

    const recreated = await createAgent(org, name);
    expect(recreated.metadata?.slug).toBe(created.metadata?.slug);
    expect(recreated.metadata?.id).not.toBe(agentId);
  });
});

describe("Agent conformance — plain-update visibility door (stigmer#573)", () => {
  // The updateVisibility RPC is the ONLY door for visibility changes on both
  // editions: every guard (per-kind level support stigmer#489) lives on the
  // updateVisibility pipelines, so plain updates preserve the stored level UNCONDITIONALLY —
  // a request-carried level is ignored, never applied and never an error
  // (stale manifests re-applied after a console visibility change must not
  // fail the whole update). OSS: preserveImmutableFields; cloud:
  // UpdateOperationPreserveResourceIdentifiersStepV2.

  it("[rpc:AgentCommandController.update] update carrying a different level succeeds but leaves the stored level untouched", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createAgent(org, uniqueName("agent"));
    expect(created.metadata?.visibility, "precondition: blueprint default").toBe(ApiResourceVisibility.visibility_org);

    const updated = await clients.agentCommand.update({
      apiVersion: AGENT_API_VERSION,
      kind: AGENT_KIND,
      metadata: {
        id: created.metadata!.id,
        name: created.metadata!.name,
        org,
        // The stigmer#573 bypass shape: an explicitly carried level on a
        // plain update. Must be ignored like the slug/org mutations above.
        visibility: ApiResourceVisibility.visibility_child_orgs,
      },
      spec: makeAgentSpec({ description: "updated alongside a carried level" }),
    });

    expect(updated.spec?.description, "the spec update itself lands").toBe("updated alongside a carried level");
    expect(updated.metadata?.visibility, "the carried level is ignored").toBe(ApiResourceVisibility.visibility_org);

    const stored = await clients.agentQuery.get({ value: created.metadata!.id });
    expect(stored.metadata?.visibility, "the stored level is untouched").toBe(ApiResourceVisibility.visibility_org);
  });

});
