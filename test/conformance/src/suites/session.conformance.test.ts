// Conformance suite for the Session domain.
// Domain: agentic / session — the runtime conversation thread, on an agent it
// names by reference or on the built-in assistant.
//
// Drives SessionCommandController + SessionQueryController through the raw proto
// stubs and asserts the contract: CRUD round-trips, apply create/update branching,
// immutable identity fields, the configuration fields (harness / execution_target),
// the field-level updateSubject contract, list / listByAgent queries and
// their cursor paging (a walk with no gap or duplicate, newest first, one
// organization's sessions only, a token refused on another request), slug
// semantics, and spec-first negative paths.
//
// The agent pin: a session names its agent by spec.agent_ref, and the server
// writes the agent and the exact version the reference resolves to on
// status.agent_id and status.agent_version_hash. Pinned here:
//   - a reference with no version pins the agent's current version; a tag or
//     a content hash pins the version it names; a version the agent does not
//     hold is FAILED_PRECONDITION;
//   - an update naming `latest` re-pins to the current version and stores no
//     version (`latest` is an instruction, not a state); an update echoing the
//     stored reference exactly (no version, or the same tag even after the tag
//     moved) keeps the pin;
//   - a status a client sends never survives: the server's pin wins;
//   - another organization's agent is accepted only when that organization
//     is the session organization's parent and shares it with its child
//     organizations, and an update is held to the same reference rule as a
//     create (another organization's skill that is not shared is refused);
//   - listByAgent answers the sessions pinned to an agent, whichever version.
// Who may name or change an agent (the run gate) is the run-gate suite's.
//
// Session has NO Temporal involvement — it only persists conversation
// configuration that later drives agent-execution dispatch. The lifecycle-bound
// behaviors it gates (harness_state_id, and the harness / execution_target
// immutability sentinels that fire only once harness_state_id is set by a real
// execution) are therefore out of scope here and belong to the execution-lifecycle
// suites, as is the runtime merge of session-level mcp_server_usages /
// skill_refs into the agent graph.
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { type Session, SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { ExecutionTarget, Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { createChildOrganization } from "../support/organizations";
import { AGENT_API_VERSION, AGENT_KIND, type AgentRefInit, agentRefOf, makeAgent, makeAgentSpec } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { uniqueName } from "../support/naming";
import { SESSION_API_VERSION, SESSION_KIND, makeSession, makeSessionSpec } from "../support/sessions";
import { makeSkillArtifact } from "../support/skills";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
// Read at collection time: a deployed endpoint carries no operator credential
// by design, so the cases seeded through the privileged scope report SKIPPED
// there, never passes that returned early.
const hasPrivilegedScope = createTarget().provisionPrivilegedScope !== undefined;
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

// An agent-bound session names a real agent by reference. The agent is
// created with the instructions `said(label)`, so a later save under the same
// name with another label is a new version of it.
function said(label: string): string {
  return `Session fixture agent instructions, ${label}.`;
}

async function createAgent(
  org: string,
  opts: { name?: string; label?: string; tag?: string; visibility?: ApiResourceVisibility } = {},
): Promise<Agent> {
  const agent = await clients.agentCommand.apply({
    apiVersion: AGENT_API_VERSION,
    kind: AGENT_KIND,
    metadata: {
      name: opts.name ?? uniqueName("agent"),
      org,
      ...(opts.tag !== undefined ? { version: { tag: opts.tag } } : {}),
      ...(opts.visibility !== undefined ? { visibility: opts.visibility } : {}),
    },
    spec: makeAgentSpec({ instructions: said(opts.label ?? "v1") }),
  });
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
  return agent;
}

// The author saves a new version of `agent` (an apply under its name with
// other instructions), optionally moving a tag to it.
async function saveNewVersion(agent: Agent, label: string, tag?: string): Promise<Agent> {
  const saved = await clients.agentCommand.apply({
    apiVersion: AGENT_API_VERSION,
    kind: AGENT_KIND,
    metadata: { name: agent.metadata!.name, org: agent.metadata!.org, ...(tag !== undefined ? { version: { tag } } : {}) },
    spec: makeAgentSpec({ instructions: said(label) }),
  });
  expect(saved.metadata?.id, "the save updates the same agent").toBe(agent.metadata?.id);
  expect(saved.status?.versionHash, "the save is a new version").not.toBe(agent.status?.versionHash);
  return saved;
}

async function provisionAgentRef(org: string): Promise<AgentRefInit> {
  return agentRefOf(await createAgent(org));
}

async function createSession(
  org: string,
  name: string,
  agentRef: AgentRefInit | undefined,
  opts: { subject?: string; harness?: Harness; executionTarget?: ExecutionTarget } = {},
) {
  const session = await clients.sessionCommand.create(makeSession({ org, name, agentRef, ...opts }));
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }).catch(() => undefined));
  return session;
}

// A full update of `session` with the given spec (identity carried over).
function updateSession(session: Session, spec: MessageInitShape<typeof SessionSpecSchema>) {
  const { id, name, slug, org } = session.metadata!;
  return clients.sessionCommand.update({
    apiVersion: SESSION_API_VERSION,
    kind: SESSION_KIND,
    metadata: { id, name, slug, org },
    spec,
  });
}

describe("Session conformance — CRUD & identity", () => {
  it("[rpc:SessionCommandController.create] create assigns a ses_ id, echoes the spec, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session");

    const created = await createSession(org, name, agentRef, { subject: "Plan the migration" });

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^ses_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.agentRef?.slug).toBe(agentRef.slug);
    expect(created.spec?.subject).toBe("Plan the migration");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("[rpc:SessionQueryController.get] get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const created = await createSession(org, uniqueName("session"), agentRef);

    const fetched = await clients.sessionQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(SessionSchema, created, fetched, "create vs get");
  });

  it("[rpc:SessionCommandController.apply] apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session");

    const first = await clients.sessionCommand.apply(makeSession({ org, name, agentRef, subject: "v1" }));
    fixtures.defer(() => clients.sessionCommand.delete({ value: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.sessionCommand.apply(makeSession({ org, name, agentRef, subject: "v2" }));

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.subject).toBe("v2");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("[rpc:SessionCommandController.update] update replaces spec and name but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const created = await createSession(org, uniqueName("session"), agentRef, { subject: "before" });
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    const updated = await clients.sessionCommand.update({
      apiVersion: SESSION_API_VERSION,
      kind: SESSION_KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: makeSessionSpec({ agentRef, subject: "after" }),
    });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.spec?.subject).toBe("after");
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("[rpc:SessionCommandController.delete] delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const created = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("session"), agentRef }),
    );
    const { id } = created.metadata!;

    // The session owner deletes their own session (in cloud this is the
    // can_delete FGA check on the session; OSS has no auth step). Deletion
    // cascades to the session's agent executions — covered by edition-specific
    // tests since a conformance run cannot deterministically create a
    // terminal execution.
    const deleted = await clients.sessionCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.sessionQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("[rpc:SessionQueryController.get] get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.sessionQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("[rpc:SessionQueryController.get] get of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.sessionQuery.get({ value: "ses_doesnotexist" }), Code.NotFound, "get missing id"));

  it("[rpc:SessionCommandController.create] derives a slug from the name", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const created = await createSession(org, "My Session #1 (Test)", agentRef);
    expect(created.metadata?.slug).toBe("my-session-1-test");
  });

  it("[rpc:SessionCommandController.create] allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const refA = await provisionAgentRef(a.org);
    const refB = await provisionAgentRef(b.org);
    const name = uniqueName("shared");

    const inA = await createSession(a.org, name, refA);
    const inB = await createSession(b.org, name, refB);

    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });
});

describe("Session conformance — configuration fields", () => {
  it("[rpc:SessionCommandController.create] stores an omitted harness as UNSPECIFIED (resolved to NATIVE only at execution dispatch)", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);

    // Session.create does not normalize harness; the "defaults to NATIVE" semantic
    // is applied at dispatch time (out of scope here), so the stored value of an
    // omitted harness is UNSPECIFIED.
    const created = await createSession(org, uniqueName("session"), agentRef);

    expect(created.spec?.harness).toBe(Harness.UNSPECIFIED);
  });

  it("[rpc:SessionCommandController.create] round-trips an explicit harness and execution_target", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);

    const created = await createSession(org, uniqueName("session"), agentRef, {
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

describe("[rpc:SessionCommandController.updateSubject] Session conformance — subject", () => {
  it("updateSubject changes only the subject and preserves other spec fields", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const created = await createSession(org, uniqueName("session"), agentRef, {
      subject: "original",
      harness: Harness.NATIVE,
    });

    const updated = await clients.sessionCommand.updateSubject({ id: created.metadata!.id, subject: "renamed thread" });

    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.spec?.subject).toBe("renamed thread");
    // The targeted update must leave every other field untouched.
    expect(updated.spec?.agentRef?.slug).toBe(agentRef.slug);
    expect(updated.spec?.harness).toBe(Harness.NATIVE);
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("updateSubject can clear the subject with an empty string", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const created = await createSession(org, uniqueName("session"), agentRef, { subject: "to be cleared" });

    const updated = await clients.sessionCommand.updateSubject({ id: created.metadata!.id, subject: "" });

    expect(updated.spec?.subject).toBe("");
  });

  it("updateSubject rejects an empty id with InvalidArgument", () =>
    // id declares required=true; the transport-boundary protovalidate interceptor
    // enforces it before the handler runs (previously Unknown on the
    // retired Go server).
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
  it("[rpc:SessionQueryController.list] list includes created sessions", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const a = await createSession(org, uniqueName("session"), agentRef);
    const b = await createSession(org, uniqueName("session"), agentRef);

    const listed = await clients.sessionQuery.list({});
    const ids = listed.entries.map((s) => s.metadata?.id);

    expect(ids).toContain(a.metadata?.id);
    expect(ids).toContain(b.metadata?.id);
  });

  it("[rpc:SessionQueryController.list] list pages one organization newest first, with no gap, no duplicate and a token until the last page", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const created = new Set<string>();
    for (let i = 0; i < 5; i++) {
      created.add((await createSession(org, uniqueName("session"), agentRef)).metadata!.id);
    }

    const walked: Array<{ id: string; createdAt: bigint }> = [];
    let pageToken = "";
    let pages = 0;
    do {
      const page = await clients.sessionQuery.list({ org, pageSize: 2, pageToken });
      pages += 1;
      expect(page.entries.length, "a page never exceeds page_size").toBeLessThanOrEqual(2);
      expect(page.totalPages, "total_pages is 1 only on the final page").toBe(page.nextPageToken === "" ? 1 : 0);
      for (const session of page.entries) {
        const at = session.status?.audit?.specAudit?.createdAt;
        walked.push({ id: session.metadata!.id, createdAt: (at?.seconds ?? 0n) * 1_000_000_000n + BigInt(at?.nanos ?? 0) });
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== "");

    expect(pages).toBe(3);
    expect(new Set(walked.map((w) => w.id))).toEqual(created);
    expect(walked).toHaveLength(created.size);
    for (let i = 1; i < walked.length; i++) {
      expect(walked[i - 1]!.createdAt, "newest first").toBeGreaterThanOrEqual(walked[i]!.createdAt);
    }
  });

  it("[rpc:SessionQueryController.list] list never places another organization's session on a page, and refuses a token on another request", async () => {
    const mine = await target.provisionTenancy();
    const theirs = await target.provisionTenancy();
    const myAgent = await provisionAgentRef(mine.org);
    const theirAgent = await provisionAgentRef(theirs.org);
    await createSession(mine.org, uniqueName("session"), myAgent);
    await createSession(mine.org, uniqueName("session"), myAgent);
    const theirSession = await createSession(theirs.org, uniqueName("session"), theirAgent);

    const first = await clients.sessionQuery.list({ org: mine.org, pageSize: 1 });
    const rest = await clients.sessionQuery.list({ org: mine.org, pageSize: 5, pageToken: first.nextPageToken });
    const ids = [...first.entries, ...rest.entries].map((s) => s.metadata?.id);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(theirSession.metadata?.id);

    await expectGrpcCode(
      () => clients.sessionQuery.list({ org: theirs.org, pageSize: 1, pageToken: first.nextPageToken }),
      Code.InvalidArgument,
      "list page_token issued for another organization",
    );
  });

  it("[rpc:SessionQueryController.listByAgent] listByAgent pages the agent's sessions", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const created = new Set<string>();
    for (let i = 0; i < 3; i++) {
      created.add((await createSession(org, uniqueName("session"), agentRefOf(agent))).metadata!.id);
    }
    const agentId = agent.metadata!.id;
    const first = await clients.sessionQuery.listByAgent({ agentId, pageSize: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextPageToken).not.toBe("");
    const second = await clients.sessionQuery.listByAgent({ agentId, pageSize: 2, pageToken: first.nextPageToken });
    expect(second.nextPageToken).toBe("");
    expect(new Set([...first.entries, ...second.entries].map((s) => s.metadata!.id))).toEqual(created);
  });

  it("[rpc:SessionQueryController.listByAgent] listByAgent returns the sessions pinned to the agent, whichever version, and no other agent's", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const onFirst = await createSession(org, uniqueName("session"), agentRefOf(agent));
    const saved = await saveNewVersion(agent, "v2");
    const onSecond = await createSession(org, uniqueName("session"), agentRefOf(saved));
    expect(onFirst.status?.agentVersionHash).not.toBe(onSecond.status?.agentVersionHash);
    await createSession(org, uniqueName("session"), await provisionAgentRef(org));
    await createSession(org, uniqueName("session"), undefined);

    const listed = await clients.sessionQuery.listByAgent({ agentId: agent.metadata!.id });

    expect(new Set(listed.entries.map((s) => s.metadata?.id))).toEqual(
      new Set([onFirst.metadata?.id, onSecond.metadata?.id]),
    );
  });

  it("[rpc:SessionQueryController.listByAgent] listByAgent returns an empty list for an unknown agent", async () => {
    const listed = await clients.sessionQuery.listByAgent({ agentId: "agt_doesnotexist" });
    expect(listed.entries).toHaveLength(0);
  });

  it("[rpc:SessionQueryController.listByAgent] listByAgent rejects an empty agent_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.sessionQuery.listByAgent({ agentId: "" }),
      Code.InvalidArgument,
      "listByAgent empty agent_id",
    ));

  it("[rpc:SessionQueryController.listByChannel] listByChannel answers an empty list for a channel with no sessions — ordinary sessions never leak into a channel view", async () => {
    // The probe targets a REAL owned channel (the conversation-lane
    // convention): on cloud a fabricated channel id fails closed in the
    // channel can_view gate (PermissionDenied, no existence leak) before the
    // filter ever runs, so only an owned channel reaches
    // the shared truthful-emptiness contract on both editions. Channel
    // sessions are created by the cloud channel runtime, which stamps the
    // stigmer.ai/channel-id label at create time; the OSS runtime has no
    // channel broker, so nothing ever stamps it there. Creating an ordinary
    // session first makes this a real filter assertion rather than a vacuous
    // empty-store read: a broken filter that returned unlabeled sessions
    // would fail here.
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const channel = await clients.agentChannelCommand.create(
      makeSlackAgentChannel(org, uniqueName("channel"), agent.metadata!.slug),
    );
    fixtures.defer(() => clients.agentChannelCommand.delete({ value: channel.metadata!.id }));
    await createSession(org, uniqueName("session"), agentRefOf(agent));

    const listed = await clients.sessionQuery.listByChannel({ channelId: channel.metadata!.id });

    expect(listed.entries).toHaveLength(0);
  });

  it.skipIf(!hasPrivilegedScope)("[rpc:SessionQueryController.listByChannel] listByChannel returns exactly the sessions stamped with the channel's label", async () => {
    // The positive arm: the filter must key on the stigmer.ai/channel-id
    // label, not on emptiness. The channel is a REAL owned resource (the
    // conversation-lane convention — cloud's can_view gate passes only for
    // channels the caller can open), and the label is a
    // server-stamped reserved key an ordinary caller cannot forge on cloud
    // (GuardReservedLabelsStep), so the channel-originated session is seeded
    // through the privileged scope (stigmer#547) — the activity suite's
    // runtime-origin seeding pattern. Deployed endpoints carry no operator
    // credential by design and skip.
    // Present: the case skips (hasPrivilegedScope) on a target without it.
    const scope = await target.provisionPrivilegedScope!();

    try {
      const org = scope.context.org;
      const agent = await scope.clients.agentCommand.create(
        makeAgent({ org, name: uniqueName("agent") }),
      );
      const agentRef = agentRefOf(agent);
      const channel = await scope.clients.agentChannelCommand.create(
        makeSlackAgentChannel(org, uniqueName("channel"), agent.metadata!.slug),
      );
      const channelId = channel.metadata!.id;

      const channelSession = await scope.clients.sessionCommand.create(
        makeSession({
          org,
          name: uniqueName("session"),
          agentRef,
          labels: { "stigmer.ai/channel-id": channelId },
        }),
      );
      await scope.clients.sessionCommand.create(
        makeSession({ org, name: uniqueName("session"), agentRef }),
      );

      const listed = await scope.clients.sessionQuery.listByChannel({ channelId });
      const ids = listed.entries.map((s) => s.metadata?.id);

      expect(ids, "the channel-stamped session is the one result").toEqual([
        channelSession.metadata?.id,
      ]);

      await scope.clients.agentChannelCommand.delete({ value: channel.metadata!.id });
      await scope.clients.agentCommand.delete({ value: agent.metadata!.id });
    } finally {
      await scope.cleanup();
    }
  });

  it("[rpc:SessionQueryController.listByChannel] listByChannel rejects an empty channel_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.sessionQuery.listByChannel({ channelId: "" }),
      Code.InvalidArgument,
      "listByChannel empty channel_id",
    ));
});

describe("Session conformance — negative paths", () => {
  it("[rpc:SessionCommandController.create] rejects a wrong api_version (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          apiVersion: "wrong.stigmer.ai/v1",
          kind: SESSION_KIND,
          metadata: { name: uniqueName("session"), org },
          spec: makeSessionSpec({ agentRef }),
        }),
      Code.InvalidArgument,
      "create with wrong api_version",
    );
  });

  it("[rpc:SessionCommandController.create] rejects a wrong kind (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          apiVersion: SESSION_API_VERSION,
          kind: "NotASession",
          metadata: { name: uniqueName("session"), org },
          spec: makeSessionSpec({ agentRef }),
        }),
      Code.InvalidArgument,
      "create with wrong kind",
    );
  });

  it("[rpc:SessionCommandController.create] rejects a create with no metadata (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    // metadata is required=true at the proto level.
    await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          apiVersion: SESSION_API_VERSION,
          kind: SESSION_KIND,
          spec: makeSessionSpec({ agentRef }),
        }),
      Code.InvalidArgument,
      "create without metadata",
    );
  });

  it("[rpc:SessionCommandController.create] creates a session with no agent (the built-in assistant): no reference and no pin", async () => {
    const { org } = await target.provisionTenancy();
    // No agent_ref: nothing resolves. The session runs the built-in
    // assistant and holds no pin.
    const created = await clients.sessionCommand.create({
      apiVersion: SESSION_API_VERSION,
      kind: SESSION_KIND,
      metadata: { name: uniqueName("session"), org },
    });
    fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));
    expect(created.spec?.agentRef).toBeUndefined();
    expect(created.status?.agentId ?? "").toBe("");
    const fetched = await clients.sessionQuery.get({ value: created.metadata!.id });
    expect(fetched.spec?.agentRef).toBeUndefined();
    expect(fetched.status?.agentId ?? "").toBe("");
  });

  it("[rpc:SessionCommandController.update] lets a session gain an agent and drop back to the built-in assistant on update", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const created = await clients.sessionCommand.create({
      apiVersion: SESSION_API_VERSION,
      kind: SESSION_KIND,
      metadata: { name: uniqueName("session"), org },
    });
    fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));
    const { id, name, slug } = created.metadata!;

    const bound = await clients.sessionCommand.update({
      apiVersion: SESSION_API_VERSION,
      kind: SESSION_KIND,
      metadata: { id, name, slug, org },
      spec: makeSessionSpec({ agentRef }),
    });
    expect(bound.spec?.agentRef?.slug).toBe(agentRef.slug);
    expect(bound.status?.agentId, "gaining an agent pins it").not.toBe("");

    // The agent is not an immutable field (the harness and the execution
    // target are): no reference on update returns the conversation to the
    // built-in assistant and clears the pin.
    const dropped = await clients.sessionCommand.update({
      apiVersion: SESSION_API_VERSION,
      kind: SESSION_KIND,
      metadata: { id, name, slug, org },
      spec: makeSessionSpec(),
    });
    expect(dropped.spec?.agentRef).toBeUndefined();
    expect(dropped.status?.agentId ?? "").toBe("");
    expect(dropped.status?.agentVersionHash ?? "").toBe("");
  });

  it("[rpc:SessionCommandController.create] rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("dup");
    await createSession(org, name, agentRef);

    // create's duplicate check is the shared CheckDuplicateStep, which returns a
    // typed AlreadyExists on every target.
    await expectGrpcCode(
      () => clients.sessionCommand.create(makeSession({ org, name, agentRef })),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("[rpc:SessionCommandController.create] rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    // agent_ref is set so the spec is an ordinary agent-bound one; the
    // empty name is what must be rejected (slug resolution has nothing to
    // derive from).
    await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          apiVersion: SESSION_API_VERSION,
          kind: SESSION_KIND,
          metadata: { org },
          spec: makeSessionSpec({ agentRef }),
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });
});

describe("Session conformance — the agent pin", () => {
  it("[rpc:SessionCommandController.create] a session on an agent reference pins the agent and its current version", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);

    const created = await createSession(org, uniqueName("session"), agentRefOf(agent));

    expect(created.status?.agentId).toBe(agent.metadata?.id);
    expect(created.status?.agentVersionHash).toBe(agent.status?.versionHash);
    const fetched = await clients.sessionQuery.get({ value: created.metadata!.id });
    expect(fetched.status?.agentId).toBe(agent.metadata?.id);
    expect(fetched.status?.agentVersionHash).toBe(agent.status?.versionHash);
  });

  it("[rpc:SessionCommandController.create] a tag pins the version it names, not the current one", async () => {
    const { org } = await target.provisionTenancy();
    const v1 = await createAgent(org, { tag: "stable" });
    await saveNewVersion(v1, "v2");

    const created = await createSession(org, uniqueName("session"), agentRefOf(v1, "stable"));

    expect(created.status?.agentVersionHash).toBe(v1.status?.versionHash);
    expect(created.spec?.agentRef?.version, "the tag is stored as written").toBe("stable");
  });

  it("[rpc:SessionCommandController.create] a content hash pins the version it names, not the current one", async () => {
    const { org } = await target.provisionTenancy();
    const v1 = await createAgent(org);
    await saveNewVersion(v1, "v2");

    const created = await createSession(org, uniqueName("session"), agentRefOf(v1, v1.status!.versionHash));

    expect(created.status?.agentVersionHash).toBe(v1.status?.versionHash);
  });

  it("[rpc:SessionCommandController.create] a version the agent does not hold is refused with FailedPrecondition naming it", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const ref = agentRefOf(agent, "no-such-tag");

    const refused = await expectGrpcCode(
      () => clients.sessionCommand.create(makeSession({ org, name: uniqueName("session"), agentRef: ref })),
      Code.FailedPrecondition,
      "a session on a version the agent does not hold",
    );
    expect(refused.rawMessage).toBe(
      `referenced agent '${ref.org}/${ref.slug}' has no version 'no-such-tag'; name one of its tags or content hashes, or 'latest' for its current version.`,
    );
  });

  it("[rpc:SessionCommandController.update] an update naming version latest re-pins to the version the author saved, and stores no version", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const session = await createSession(org, uniqueName("session"), agentRefOf(agent));
    const saved = await saveNewVersion(agent, "v2");

    const updated = await updateSession(session, makeSessionSpec({ agentRef: agentRefOf(agent, "latest") }));

    expect(updated.status?.agentVersionHash).toBe(saved.status?.versionHash);
    expect(updated.spec?.agentRef?.version, "latest is an instruction, never stored").toBe("");
    const fetched = await clients.sessionQuery.get({ value: session.metadata!.id });
    expect(fetched.status?.agentVersionHash).toBe(saved.status?.versionHash);
    expect(fetched.spec?.agentRef?.version).toBe("");
  });

  it("[rpc:SessionCommandController.update] an update echoing the stored reference with no version keeps the pin after the author saves", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const session = await createSession(org, uniqueName("session"), agentRefOf(agent));
    await saveNewVersion(agent, "v2");

    const updated = await updateSession(session, makeSessionSpec({ agentRef: agentRefOf(agent), subject: "renamed" }));

    expect(updated.spec?.subject).toBe("renamed");
    expect(updated.status?.agentId).toBe(agent.metadata?.id);
    expect(updated.status?.agentVersionHash).toBe(agent.status?.versionHash);
  });

  it("[rpc:SessionCommandController.update] an update echoing a stored tag keeps the pin after the tag moves to another version", async () => {
    const { org } = await target.provisionTenancy();
    const v1 = await createAgent(org, { tag: "stable" });
    const session = await createSession(org, uniqueName("session"), agentRefOf(v1, "stable"));
    const v2 = await saveNewVersion(v1, "v2", "stable");

    const updated = await updateSession(session, makeSessionSpec({ agentRef: agentRefOf(v1, "stable"), subject: "renamed" }));

    expect(updated.status?.agentVersionHash, "the echo moves nothing").toBe(v1.status?.versionHash);
    // The tag did move: a new conversation on it pins the version it names now.
    const fresh = await createSession(org, uniqueName("session"), agentRefOf(v1, "stable"));
    expect(fresh.status?.agentVersionHash).toBe(v2.status?.versionHash);
  });

  it("[rpc:SessionCommandController.create] a status the client sends on create never survives: the server's pin wins", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);

    const created = await clients.sessionCommand.create({
      ...makeSession({ org, name: uniqueName("session"), agentRef: agentRefOf(agent) }),
      status: { agentId: "agt_forged", agentVersionHash: "f".repeat(64) },
    });
    fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }).catch(() => undefined));

    expect(created.status?.agentId).toBe(agent.metadata?.id);
    expect(created.status?.agentVersionHash).toBe(agent.status?.versionHash);
  });

  it("[rpc:SessionCommandController.update] a status the client sends on update never survives: the server's pin wins", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org);
    const session = await createSession(org, uniqueName("session"), agentRefOf(agent));
    const { id, name, slug } = session.metadata!;

    const updated = await clients.sessionCommand.update({
      apiVersion: SESSION_API_VERSION,
      kind: SESSION_KIND,
      metadata: { id, name, slug, org },
      spec: makeSessionSpec({ agentRef: agentRefOf(agent), subject: "renamed" }),
      status: { agentId: "agt_forged", agentVersionHash: "f".repeat(64) },
    });

    expect(updated.status?.agentId).toBe(agent.metadata?.id);
    expect(updated.status?.agentVersionHash).toBe(agent.status?.versionHash);
  });
});

describe("Session conformance — a new conversation's engine", () => {
  // An agent's run defaults name the engine they were chosen for
  // (AgentSpec.harness); a new conversation that names no engine starts on
  // it, and one that names an engine keeps its own.
  async function cursorAgent(org: string): Promise<Agent> {
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("cursor-agent"), harness: Harness.CURSOR }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    return agent;
  }

  it("[rpc:SessionCommandController.create] a session naming no engine starts on the agent's engine", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await cursorAgent(org);

    const created = await createSession(org, uniqueName("session"), agentRefOf(agent));

    expect(created.spec?.harness).toBe(Harness.CURSOR);
  });

  it("[rpc:SessionCommandController.create] a session naming an engine keeps it", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await cursorAgent(org);

    const created = await createSession(org, uniqueName("session"), agentRefOf(agent), { harness: Harness.NATIVE });

    expect(created.spec?.harness).toBe(Harness.NATIVE);
  });
});

describe("Session conformance — references across organizations and on update", () => {
  const notAvailable = (kind: string, slug: string) =>
    `referenced ${kind} '${slug}' of another organization is not available to this organization; ` +
    "another organization's resource can be referenced only when it is this organization's parent and shares it with its child organizations.";

  it("[rpc:SessionCommandController.create] a session naming the parent organization's org-visible agent is refused; the agent it shares with its children is accepted", async () => {
    const { org: otherOrg } = await target.provisionTenancy();
    const { id: org } = await createChildOrganization(clients.organizationCommand, otherOrg, "the session's organization");
    fixtures.defer(() => clients.organizationCommand.delete({ value: org }));
    const orgVisible = await createAgent(otherOrg, { visibility: ApiResourceVisibility.visibility_org });
    const platformVisible = await createAgent(otherOrg, { visibility: ApiResourceVisibility.visibility_child_orgs });

    const refused = await expectGrpcCode(
      () => clients.sessionCommand.create(makeSession({ org, name: uniqueName("session"), agentRef: agentRefOf(orgVisible) })),
      Code.FailedPrecondition,
      "a session on another organization's org-visible agent",
    );
    expect(refused.rawMessage).toBe(notAvailable("agent", orgVisible.metadata!.slug));

    const admitted = await createSession(org, uniqueName("session"), agentRefOf(platformVisible));
    expect(admitted.metadata?.org).toBe(org);
    expect(admitted.status?.agentId).toBe(platformVisible.metadata?.id);
  });

  it("[rpc:SessionCommandController.update] an update introducing another organization's skill that is not shared with child organizations is refused", async () => {
    const { org } = await target.provisionTenancy();
    const { org: otherOrg } = await target.provisionTenancy();
    const skill = await clients.skillCommand.push({
      org: otherOrg,
      artifact: makeSkillArtifact({ name: uniqueName("skill"), body: "# other organization's skill" }),
    });
    fixtures.defer(() => clients.skillCommand.delete({ value: skill.metadata!.id }).catch(() => undefined));
    const session = await createSession(org, uniqueName("session"), await provisionAgentRef(org));

    const refused = await expectGrpcCode(
      () =>
        updateSession(session, {
          ...makeSessionSpec({ agentRef: { org: session.spec!.agentRef!.org, slug: session.spec!.agentRef!.slug } }),
          skillRefs: [{ org: otherOrg, slug: skill.metadata!.slug, kind: ApiResourceKind.skill }],
        }),
      Code.FailedPrecondition,
      "a session update adding another organization's private skill",
    );
    expect(refused.rawMessage).toBe(notAvailable("skill", skill.metadata!.slug));
    const stored = await clients.sessionQuery.get({ value: session.metadata!.id });
    expect(stored.spec?.skillRefs, "the refused update stored nothing").toHaveLength(0);
  });

  it("[rpc:SessionCommandController.update] an update echoing a skill deleted after the session named it is accepted: an update judges only what it introduces", async () => {
    const { org } = await target.provisionTenancy();
    const skill = await clients.skillCommand.push({
      org,
      artifact: makeSkillArtifact({ name: uniqueName("skill"), body: "# a skill the session names" }),
    });
    const agentRef = await provisionAgentRef(org);
    const session = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("session"), agentRef, skillRefs: [skill.metadata!.slug] }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }).catch(() => undefined));
    await clients.skillCommand.delete({ value: skill.metadata!.id });

    const updated = await updateSession(session, makeSessionSpec({ agentRef, skillRefs: [skill.metadata!.slug], subject: "renamed" }));

    expect(updated.spec?.subject).toBe("renamed");
    expect(updated.spec?.skillRefs.map((ref) => ref.slug)).toEqual([skill.metadata!.slug]);
  });
});
