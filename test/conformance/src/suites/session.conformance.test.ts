// Conformance suite for the Session domain.
// Domain: agentic / session — the runtime conversation thread that runs against
// an AgentInstance.
//
// Drives SessionCommandController + SessionQueryController through the raw proto
// stubs and asserts the contract: CRUD round-trips, apply create/update branching,
// immutable identity fields, the configuration fields (harness / execution_target),
// the field-level updateSubject contract, list / listByAgent queries, slug
// semantics, and spec-first negative paths.
//
// Session has NO Temporal involvement — it only persists conversation
// configuration that later drives agent-execution dispatch. The lifecycle-bound
// behaviors it gates (harness_state_id, and the harness / execution_target
// immutability sentinels that fire only once harness_state_id is set by a real
// execution) are therefore out of scope here and belong to the execution-lifecycle
// slice. Likewise, the session-level mcp_server_usages / skill_refs are merged into
// the agent graph at execution time (graph construction), not validated at create
// (Session has no ValidateReferencesStep), so their merge semantics are a Class B
// concern rather than a create-time contract.
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget, Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { SESSION_API_VERSION, SESSION_KIND, makeSession, makeSessionSpec } from "../support/sessions";
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

// A session needs an AgentInstance to run against. Agent.create provisions a
// default instance and returns its id on status.default_instance_id, so every
// test sources a real instance id this way rather than seeding a default agent.
async function provisionAgentInstance(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const agentInstanceId = agent.status?.defaultInstanceId;
  if (agentInstanceId === undefined || agentInstanceId === "") {
    throw new Error("agent create did not provision a default instance id");
  }
  return agentInstanceId;
}

async function createSession(
  org: string,
  name: string,
  agentInstanceId: string,
  opts: { subject?: string; harness?: Harness; executionTarget?: ExecutionTarget } = {},
) {
  const session = await clients.sessionCommand.create(makeSession({ org, name, agentInstanceId, ...opts }));
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));
  return session;
}

describe("Session conformance — CRUD & identity", () => {
  it("create assigns a ses_ id, echoes the spec, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const name = uniqueName("session");

    const created = await createSession(org, name, agentInstanceId, { subject: "Plan the migration" });

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^ses_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.agentInstanceId).toBe(agentInstanceId);
    expect(created.spec?.subject).toBe("Plan the migration");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const created = await createSession(org, uniqueName("session"), agentInstanceId);

    const fetched = await clients.sessionQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(SessionSchema, created, fetched, "create vs get");
  });

  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const name = uniqueName("session");

    const first = await clients.sessionCommand.apply(makeSession({ org, name, agentInstanceId, subject: "v1" }));
    fixtures.defer(() => clients.sessionCommand.delete({ value: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.sessionCommand.apply(makeSession({ org, name, agentInstanceId, subject: "v2" }));

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.subject).toBe("v2");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update replaces spec and name but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const created = await createSession(org, uniqueName("session"), agentInstanceId, { subject: "before" });
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    const updated = await clients.sessionCommand.update({
      apiVersion: SESSION_API_VERSION,
      kind: SESSION_KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: makeSessionSpec({ agentInstanceId, subject: "after" }),
    });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.spec?.subject).toBe("after");
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const created = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("session"), agentInstanceId }),
    );
    const { id } = created.metadata!;

    // delete is open in OSS (no auth step); the proto's operator-only restriction
    // is a cloud-only concern. We assert the edition-agnostic part: the resource
    // is returned and is gone afterward.
    const deleted = await clients.sessionCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.sessionQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.sessionQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.sessionQuery.get({ value: "ses_doesnotexist" }), Code.NotFound, "get missing id"));

  it("derives a slug from the name", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const created = await createSession(org, "My Session #1 (Test)", agentInstanceId);
    expect(created.metadata?.slug).toBe("my-session-1-test");
  });

  it("allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const instanceA = await provisionAgentInstance(a.org);
    const instanceB = await provisionAgentInstance(b.org);
    const name = uniqueName("shared");

    const inA = await createSession(a.org, name, instanceA);
    const inB = await createSession(b.org, name, instanceB);

    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });
});

describe("Session conformance — configuration fields", () => {
  it("stores an omitted harness as UNSPECIFIED (resolved to NATIVE only at execution dispatch)", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);

    // Session.create does not normalize harness; the "defaults to NATIVE" semantic
    // is applied at dispatch time (out of scope here), so the stored value of an
    // omitted harness is UNSPECIFIED.
    const created = await createSession(org, uniqueName("session"), agentInstanceId);

    expect(created.spec?.harness).toBe(Harness.UNSPECIFIED);
  });

  it("round-trips an explicit harness and execution_target", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);

    const created = await createSession(org, uniqueName("session"), agentInstanceId, {
      harness: Harness.CURSOR,
      executionTarget: ExecutionTarget.LOCAL,
    });

    expect(created.spec?.harness).toBe(Harness.CURSOR);
    expect(created.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);

    const fetched = await clients.sessionQuery.get({ value: created.metadata!.id });
    expect(fetched.spec?.harness).toBe(Harness.CURSOR);
    expect(fetched.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
  });
});

describe("Session conformance — subject", () => {
  it("updateSubject changes only the subject and preserves other spec fields", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const created = await createSession(org, uniqueName("session"), agentInstanceId, {
      subject: "original",
      harness: Harness.NATIVE,
    });

    const updated = await clients.sessionCommand.updateSubject({ id: created.metadata!.id, subject: "renamed thread" });

    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.spec?.subject).toBe("renamed thread");
    // The targeted update must leave every other field untouched.
    expect(updated.spec?.agentInstanceId).toBe(agentInstanceId);
    expect(updated.spec?.harness).toBe(Harness.NATIVE);
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("updateSubject can clear the subject with an empty string", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const created = await createSession(org, uniqueName("session"), agentInstanceId, { subject: "to be cleared" });

    const updated = await clients.sessionCommand.updateSubject({ id: created.metadata!.id, subject: "" });

    expect(updated.spec?.subject).toBe("");
  });

  it("updateSubject rejects an empty id with InvalidArgument", () =>
    // id declares required=true; the transport-boundary protovalidate interceptor
    // enforces it before the handler runs (previously Unknown on local-go).
    expectGrpcCode(
      () => clients.sessionCommand.updateSubject({ id: "", subject: "anything" }),
      Code.InvalidArgument,
      "updateSubject empty id",
    ));

  it("updateSubject on a missing session returns NotFound", () =>
    expectGrpcCode(
      () => clients.sessionCommand.updateSubject({ id: "ses_doesnotexist", subject: "anything" }),
      Code.NotFound,
      "updateSubject missing session",
    ));
});

describe("Session conformance — queries", () => {
  it("list includes created sessions", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const a = await createSession(org, uniqueName("session"), agentInstanceId);
    const b = await createSession(org, uniqueName("session"), agentInstanceId);

    const listed = await clients.sessionQuery.list({});
    const ids = listed.entries.map((s) => s.metadata?.id);

    expect(ids).toContain(a.metadata?.id);
    expect(ids).toContain(b.metadata?.id);
  });

  it("listByAgent returns only the sessions for the given agent instance", async () => {
    const { org } = await target.provisionTenancy();
    const instanceOne = await provisionAgentInstance(org);
    const instanceTwo = await provisionAgentInstance(org);

    const forOne = await createSession(org, uniqueName("session"), instanceOne);
    await createSession(org, uniqueName("session"), instanceTwo);

    // Finding F6: despite the field being named agent_id, the OSS filter matches
    // spec.agent_instance_id, so the value passed must be an agent INSTANCE id.
    const listed = await clients.sessionQuery.listByAgent({ agentId: instanceOne });
    const ids = listed.entries.map((s) => s.metadata?.id);

    expect(ids).toContain(forOne.metadata?.id);
    expect(ids).toHaveLength(1);
  });

  it("listByAgent returns an empty list for an unknown agent instance", async () => {
    const listed = await clients.sessionQuery.listByAgent({ agentId: "ain_doesnotexist" });
    expect(listed.entries).toHaveLength(0);
  });

  it("listByAgent rejects an empty agent_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.sessionQuery.listByAgent({ agentId: "" }),
      Code.InvalidArgument,
      "listByAgent empty agent_id",
    ));
});

describe("Session conformance — negative paths", () => {
  it("rejects a wrong api_version (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          apiVersion: "wrong.stigmer.ai/v1",
          kind: SESSION_KIND,
          metadata: { name: uniqueName("session"), org },
          spec: makeSessionSpec({ agentInstanceId }),
        }),
      Code.InvalidArgument,
      "create with wrong api_version",
    );
  });

  it("rejects a wrong kind (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          apiVersion: SESSION_API_VERSION,
          kind: "NotASession",
          metadata: { name: uniqueName("session"), org },
          spec: makeSessionSpec({ agentInstanceId }),
        }),
      Code.InvalidArgument,
      "create with wrong kind",
    );
  });

  it("rejects a create with no metadata (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    // metadata is required=true at the proto level.
    await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          apiVersion: SESSION_API_VERSION,
          kind: SESSION_KIND,
          spec: makeSessionSpec({ agentInstanceId }),
        }),
      Code.InvalidArgument,
      "create without metadata",
    );
  });

  it("rejects a create with no resolvable agent instance (NotFound)", async () => {
    const { org } = await target.provisionTenancy();
    // With no agent_instance_id and no platform default agent configured (the
    // conformance server seeds none), the default-agent resolution fails with
    // NotFound. This mirrors the agent suite's getDefault-without-a-default case.
    await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          apiVersion: SESSION_API_VERSION,
          kind: SESSION_KIND,
          metadata: { name: uniqueName("session"), org },
        }),
      Code.NotFound,
      "create without a resolvable agent instance",
    );
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const name = uniqueName("dup");
    await createSession(org, name, agentInstanceId);

    // create's duplicate check is the shared CheckDuplicateStep, which returns a
    // typed AlreadyExists on every target.
    await expectGrpcCode(
      () => clients.sessionCommand.create(makeSession({ org, name, agentInstanceId })),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    // agent_instance_id is set so default-agent resolution is skipped and the spec
    // is valid; the empty name is what must be rejected (slug resolution has
    // nothing to derive from).
    await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          apiVersion: SESSION_API_VERSION,
          kind: SESSION_KIND,
          metadata: { org },
          spec: makeSessionSpec({ agentInstanceId }),
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });
});
