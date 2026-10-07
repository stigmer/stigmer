// Run-gate conformance.
//
// The contract: a caller may START or CONTINUE a run only on what they can
// see. The two create chains — session and agent execution — ask the
// edition's Authorizer about the record's run target (agent#can_execute,
// session#can_create_run_in) before any engine check, gate slot or side effect. A session names its agent by reference and pins the agent it
// resolves to (status.agent_id), so the gate judges that resolved id, and
// asks it again whenever a write introduces or changes the agent. A turn
// asks two questions: the session's own permission, then whether the caller
// may still run the agent the session pins. Pinned here on the multi-tenant
// edition with a COLLEAGUE — a fresh identity holding exactly `member` on
// the organization (provisionMember), so the organization-level checks pass
// and only the resource-level rule can refuse:
//
//   - a member cannot open a session on a PRIVATE agent, cannot start a
//     conversation on one, cannot add an execution to a session they cannot
//     see — each PERMISSION_DENIED with the
//     domain's byte-pinned copy, and side-effect free (no session row
//     appears for the agent);
//   - a member CAN open a session on an ORG-visible agent (the positive arm
//     is a session create on purpose: it starts nothing, so a Class A target
//     is left with no orphan run), and the session pins that agent;
//   - an unknown agent slug answers the reference rule's FAILED_PRECONDITION
//     before any permission is asked (a missing target is never dressed as
//     a denial, the stigmer#224 order);
//   - the agent is asked on every turn and on every repoint: a member who
//     lost the agent (its owner made it private) is refused in their own
//     session; a viewer of someone else's session who may not run its agent
//     is refused; repointing a session to an agent the member cannot run is
//     refused at update and leaves the pin as it was;
//   - a status a client sends never reaches either check: the refusal names
//     the agent the reference resolved to, not the one the client claimed;
//   - a turn in a session the caller may not add to learns nothing about
//     the session: a forbidden session answers the session's own denial
//     whatever its agent's state, an unknown one NOT_FOUND naming only the
//     id (the authorizer's existence probe, stigmer#224).
//
// Deliberately out of scope: the runtime lanes (guest, channel, schedule),
// whose admission is decided by their own gate steps and
// pinned by their own suites.
//
// The arms run on the target's ENFORCING LANE (targets/target.ts): the
// cloud's primary, and on the managed local targets an open-source sibling
// in the OIDC posture, where the built-in Authorizer answers the run target's
// question — so the gate is one contract on the cloud and on both
// open-source store drivers. Where a target lends no lane the arms skip
// VISIBLY with its reason. Every turn arm is a refusal before the engine
// gate, so no Class A target needs an engine.
import { Code } from "@connectrpc/connect";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";
import { FixtureTracker } from "../harness/fixtures";
import { expectGrpcCode } from "../contract/errors";
import { agentRefOf, makeAgent } from "../support/agents";
import { makeAgentExecution } from "../support/agentruns";
import { policyTriple } from "../support/iampolicies";
import {
  SESSION_API_VERSION,
  SESSION_KIND,
  makeSession,
  makeSessionSpec,
} from "../support/sessions";
import { uniqueName } from "../support/naming";

let target: TargetProfile;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
// The lane's founder — the OWNER of the agents the member
// may or may not run.
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  enforcing = await enforcingLaneOf(target);
  clients = enforcing.lane?.clients ?? target.clients();
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

async function tenancy(lane: EnforcingLane): Promise<TenancyContext> {
  const context = await lane.provisionTenancy();
  fixtures.defer(() => lane.cleanupTenancy(context));
  return context;
}

async function createAgent(
  org: string,
  visibility: ApiResourceVisibility,
  label: string,
): Promise<Agent> {
  const input = makeAgent({ org, name: uniqueName(label) });
  input.metadata = { ...input.metadata, visibility };
  const agent = await clients.agentCommand.create(input);
  fixtures.defer(() =>
    clients.agentCommand
      .delete({ value: agent.metadata!.id })
      .catch(() => undefined),
  );
  return agent;
}

// A session `using` opens on `agent`, deleted by its owner at cleanup.
async function openSession(
  using: ConformanceClients,
  org: string,
  agent: Agent,
  label: string,
) {
  const session = await using.sessionCommand.create(
    makeSession({ org, name: uniqueName(label), agentRef: agentRefOf(agent) }),
  );
  fixtures.defer(() =>
    using.sessionCommand
      .delete({ value: session.metadata!.id })
      .catch(() => undefined),
  );
  return session;
}

const FORGED_STATUS = {
  agentVersionHash: "f".repeat(64),
} as const;

describe("run gate — a member may run only what they can see (on the enforcing lane)", () => {
  it("[rpc:SessionCommandController.create] session create on a PRIVATE agent is denied with the agent copy and leaves no row", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_private,
      "run-gate-private-agent",
    );
    const agentId = agent.metadata!.id;

    const denied = await expectGrpcCode(
      () =>
        member.sessionCommand.create(
          makeSession({
            org: context.org,
            name: uniqueName("member-session"),
            agentRef: agentRefOf(agent),
          }),
        ),
      Code.PermissionDenied,
      "member session create on a private agent",
    );
    expect(denied.rawMessage).toBe(`unauthorized to run agent '${agentId}'`);

    // Side-effect free: the owner sees no session on the agent.
    const sessions = await clients.sessionQuery.listByAgent({ agentId });
    expect(sessions.entries, "no session row behind the denial").toHaveLength(
      0,
    );
  });

  it("[rpc:AgentRunCommandController.create] a new conversation on a PRIVATE agent is denied with the agent copy", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_private,
      "run-gate-private-agent",
    );

    const denied = await expectGrpcCode(
      () =>
        member.agentExecutionCommand.create(
          makeAgentExecution({
            org: context.org,
            name: uniqueName("member-exec"),
            agentRef: agentRefOf(agent),
          }),
        ),
      Code.PermissionDenied,
      "member execution create on a private agent",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to run agent '${agent.metadata!.id}'`,
    );
  });

  it("[rpc:AgentRunCommandController.create] execution create by session_id on a session the member cannot see is denied with the session copy", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_org,
      "run-gate-org-agent",
    );
    const ownerSession = await openSession(
      clients,
      context.org,
      agent,
      "owner-session",
    );
    const sessionId = ownerSession.metadata!.id;

    const denied = await expectGrpcCode(
      () =>
        member.agentExecutionCommand.create(
          makeAgentExecution({
            org: context.org,
            name: uniqueName("member-turn"),
            sessionId,
          }),
        ),
      Code.PermissionDenied,
      "member execution create in the owner's session",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to add an execution to session '${sessionId}'`,
    );
  });

  it("[rpc:SessionCommandController.create] session create on an ORG-visible agent is allowed and pins it (the positive arm)", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_org,
      "run-gate-org-agent",
    );

    const session = await openSession(
      member,
      context.org,
      agent,
      "member-session",
    );
    expect(session.metadata?.id).toMatch(/^ses_/);
    expect(session.spec?.agentRef?.slug).toBe(agent.metadata?.slug);
    expect(session.status?.agentId).toBe(agent.metadata?.id);
    expect(session.status?.agentVersionHash).toBe(agent.status?.versionHash);
  });

  it("[rpc:SessionCommandController.create] an unknown agent slug answers the reference rule's FAILED_PRECONDITION, never a denial (stigmer#224)", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const missing = uniqueName("missing-agent");

    const notFound = await expectGrpcCode(
      () =>
        member.sessionCommand.create(
          makeSession({
            org: context.org,
            name: uniqueName("member-session"),
            agentRef: { org: context.org, slug: missing },
          }),
        ),
      Code.FailedPrecondition,
      "member session create on an unknown agent slug",
    );
    expect(notFound.rawMessage).toContain(
      `referenced agent(s) not found: '${missing}'`,
    );
  });
});

describe("run gate — the agent is asked on every turn and every repoint (on the enforcing lane)", () => {
  it("[rpc:AgentRunCommandController.create] a member who lost the agent is refused in their own session", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_org,
      "run-gate-revoked-agent",
    );
    const session = await openSession(
      member,
      context.org,
      agent,
      "member-session",
    );
    // The owner takes the agent back: the member keeps their session, and
    // with it session#can_create_run_in, but no longer agent#can_execute.
    await clients.agentCommand.updateVisibility({
      resourceId: agent.metadata!.id,
      visibility: ApiResourceVisibility.visibility_private,
    });

    const denied = await expectGrpcCode(
      () =>
        member.agentExecutionCommand.create(
          makeAgentExecution({
            org: context.org,
            name: uniqueName("member-turn"),
            sessionId: session.metadata!.id,
          }),
        ),
      Code.PermissionDenied,
      "a turn by a member who lost the agent, in their own session",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to run agent '${agent.metadata!.id}'`,
    );
  });

  it("[rpc:AgentRunCommandController.create] a viewer of a session who may not run its agent is refused", async (ctx) => {
    // A viewer on one session is a per-resource grant: an edition whose
    // grant scope admits only organization roles (open source's default)
    // cannot make one, and skips with that reason.
    if (!target.capabilities.perResourceGrants) {
      return ctx.skip(
        "the edition grants roles on organizations only, so no one can be made a viewer of one session",
      );
    }
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_private,
      "run-gate-owner-agent",
    );
    const ownerSession = await openSession(
      clients,
      context.org,
      agent,
      "owner-session",
    );
    const sessionId = ownerSession.metadata!.id;
    // The owner shares the conversation itself: viewer on the session gives
    // the member session#can_create_run_in, and nothing on the agent.
    await clients.iamPolicyCommand.create(
      policyTriple(
        { kind: "identity_account", id: await lane.accountIdOf(member) },
        "viewer",
        { kind: "session", id: sessionId },
      ),
    );

    const denied = await expectGrpcCode(
      () =>
        member.agentExecutionCommand.create(
          makeAgentExecution({
            org: context.org,
            name: uniqueName("viewer-turn"),
            sessionId,
          }),
        ),
      Code.PermissionDenied,
      "a session viewer's turn on an agent they cannot run",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to run agent '${agent.metadata!.id}'`,
    );
  });

  it("[rpc:SessionCommandController.update] repointing a session to an agent the member cannot run is refused and leaves the pin as it was", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const open = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_org,
      "run-gate-org-agent",
    );
    const closed = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_private,
      "run-gate-private-agent",
    );
    const session = await openSession(
      member,
      context.org,
      open,
      "member-session",
    );
    const { id, name, slug } = session.metadata!;

    const denied = await expectGrpcCode(
      () =>
        member.sessionCommand.update({
          apiVersion: SESSION_API_VERSION,
          kind: SESSION_KIND,
          metadata: { id, name, slug, org: context.org },
          spec: makeSessionSpec({ agentRef: agentRefOf(closed) }),
        }),
      Code.PermissionDenied,
      "a session repointed to a private agent",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to run agent '${closed.metadata!.id}'`,
    );

    const stored = await member.sessionQuery.get({ value: id });
    expect(stored.spec?.agentRef?.slug).toBe(open.metadata?.slug);
    expect(stored.status?.agentId).toBe(open.metadata?.id);
  });
});

describe("run gate — a client-sent status never reaches either check (on the enforcing lane)", () => {
  // Each arm names a PRIVATE agent by reference and claims, in status, an
  // ORG-visible one the member may run. The refusal naming the private
  // agent is the proof that the check judged the server's resolution.
  async function cast(ctx: { skip: (note?: string) => never }) {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const open = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_org,
      "run-gate-claimed-agent",
    );
    const closed = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_private,
      "run-gate-named-agent",
    );
    return { context, member, open, closed };
  }

  it("[rpc:SessionCommandController.create] on session create", async (ctx) => {
    const { context, member, open, closed } = await cast(ctx);

    const denied = await expectGrpcCode(
      () =>
        member.sessionCommand.create({
          ...makeSession({
            org: context.org,
            name: uniqueName("member-session"),
            agentRef: agentRefOf(closed),
          }),
          status: { agentId: open.metadata!.id, ...FORGED_STATUS },
        }),
      Code.PermissionDenied,
      "session create claiming a runnable agent in status",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to run agent '${closed.metadata!.id}'`,
    );
  });

  it("[rpc:SessionCommandController.update] on session update", async (ctx) => {
    const { context, member, open, closed } = await cast(ctx);
    const session = await openSession(
      member,
      context.org,
      open,
      "member-session",
    );
    const { id, name, slug } = session.metadata!;

    const denied = await expectGrpcCode(
      () =>
        member.sessionCommand.update({
          apiVersion: SESSION_API_VERSION,
          kind: SESSION_KIND,
          metadata: { id, name, slug, org: context.org },
          spec: makeSessionSpec({ agentRef: agentRefOf(closed) }),
          status: { agentId: open.metadata!.id, ...FORGED_STATUS },
        }),
      Code.PermissionDenied,
      "session update claiming the stored agent in status",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to run agent '${closed.metadata!.id}'`,
    );
  });

  it("[rpc:AgentRunCommandController.create] on execution create", async (ctx) => {
    const { context, member, open, closed } = await cast(ctx);

    const denied = await expectGrpcCode(
      () =>
        member.agentExecutionCommand.create({
          ...makeAgentExecution({
            org: context.org,
            name: uniqueName("member-exec"),
            agentRef: agentRefOf(closed),
          }),
          status: { agentId: open.metadata!.id, ...FORGED_STATUS },
        }),
      Code.PermissionDenied,
      "execution create claiming a runnable agent in status",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to run agent '${closed.metadata!.id}'`,
    );
  });
});

describe("run gate — a session the caller may not add to discloses nothing (on the enforcing lane)", () => {
  it("[rpc:AgentRunCommandController.create] a forbidden session answers the session's own denial even when its agent is gone", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_org,
      "run-gate-gone-agent",
    );
    const ownerSession = await openSession(
      clients,
      context.org,
      agent,
      "owner-session",
    );
    const sessionId = ownerSession.metadata!.id;
    await clients.agentCommand.delete({ value: agent.metadata!.id });

    // The owner would hear FAILED_PRECONDITION naming the agent; the member
    // hears what any forbidden session answers, because nothing about the
    // session is read before its own permission.
    const denied = await expectGrpcCode(
      () =>
        member.agentExecutionCommand.create(
          makeAgentExecution({
            org: context.org,
            name: uniqueName("member-turn"),
            sessionId,
          }),
        ),
      Code.PermissionDenied,
      "a member's turn in a forbidden session whose agent is gone",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to add an execution to session '${sessionId}'`,
    );
  });

  it("[rpc:AgentRunCommandController.create] an unknown session answers NOT_FOUND naming only the id it was sent", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const context = await tenancy(lane);
    const member = await lane.provisionMember(context);
    const missing = `ses_${uniqueName("missing").replaceAll("-", "")}`;

    const notFound = await expectGrpcCode(
      () =>
        member.agentExecutionCommand.create(
          makeAgentExecution({
            org: context.org,
            name: uniqueName("member-turn"),
            sessionId: missing,
          }),
        ),
      Code.NotFound,
      "a member's turn in an unknown session",
    );
    expect(notFound.rawMessage).toContain(missing);
  });
});
