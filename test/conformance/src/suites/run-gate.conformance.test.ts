// Run-gate conformance (P1 sp.run-gate, 2026-09-11; stigmer-cloud#709).
//
// The contract: a caller may START or CONTINUE a run only on what they can
// see. The three create chains — session, agent execution, workflow
// execution — carry one AuthorizeRunTarget step that asks the edition's
// Authorizer about the record's run target (agent_instance#can_execute,
// agent#can_execute, session#can_create_execution_in, workflow#can_execute,
// workflow_instance#can_execute) before any engine check, gate slot or side
// effect. Pinned here on the multi-tenant edition with a COLLEAGUE — a fresh
// identity holding exactly `member` on the organization (provisionMember),
// so the organization-level checks pass and only the resource-level rule can
// refuse:
//
//   - a member cannot open a session on a PRIVATE agent's instance, cannot
//     start an execution on a PRIVATE agent, cannot add an execution to a
//     session they cannot see, cannot run a PRIVATE workflow — each
//     PERMISSION_DENIED with the domain's byte-pinned copy, and side-effect
//     free (no session row appears for the owner);
//   - a member CAN open a session on an ORG-visible agent (the positive arm
//     is a session create on purpose: it starts nothing, so a Class A target
//     is left with no orphan workflow);
//   - an unknown instance id answers NOT_FOUND — the authorizer's deny-path
//     existence probe, the ruled stigmer#224 order (a missing target is
//     never dressed as a denial).
//
// Deliberately out of scope: the runtime lanes (guest, channel, schedule,
// workflow sandbox), whose admission is decided by their own gate steps and
// pinned by their own suites; and the OSS edition's denial, which waits for
// P1's owner-or-admin authorizer (sp.oss-owner-or-admin-authorizer) — the
// permissive single-team posture admits every caller today, so on the
// single-user targets these arms SKIP visibly rather than assert an allow
// that the next entry is meant to flip.
import { Code } from "@connectrpc/connect";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import {
  createTarget,
  type TargetProfile,
  type TenancyContext,
} from "../targets";
import { FixtureTracker } from "../harness/fixtures";
import { expectGrpcCode } from "../contract/errors";
import { makeAgent } from "../support/agents";
import { makeAgentExecution } from "../support/agentexecutions";
import { makeSession } from "../support/sessions";
import { makeWorkflow } from "../support/workflows";
import { makeWorkflowExecution } from "../support/workflowexecutions";
import { uniqueName } from "../support/naming";

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

// The colleague exists only where roles do. A multi-tenant target that
// cannot provision one is a harness gap, not a skip.
function canProvisionMember(): boolean {
  if (!target.capabilities.multiTenant) return false;
  if (target.provisionMember === undefined) {
    throw new Error(
      `target "${target.name}" declares multiTenant but provides no provisionMember()`,
    );
  }
  return true;
}

async function tenancy(): Promise<TenancyContext> {
  const context = await target.provisionTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));
  return context;
}

async function createAgent(
  org: string,
  visibility: ApiResourceVisibility,
  label: string,
) {
  const input = makeAgent({ org, name: uniqueName(label) });
  input.metadata = { ...input.metadata, visibility };
  const agent = await clients.agentCommand.create(input);
  fixtures.defer(() =>
    clients.agentCommand.delete({ value: agent.metadata!.id }),
  );
  expect(
    agent.status?.defaultInstanceId,
    "agent create seeds a default instance",
  ).toBeTruthy();
  return agent;
}

async function createPrivateWorkflow(org: string) {
  const input = makeWorkflow({ org, name: uniqueName("run-gate-private-wf") });
  input.metadata = {
    ...input.metadata,
    visibility: ApiResourceVisibility.visibility_private,
  };
  const workflow = await clients.workflowCommand.create(input);
  fixtures.defer(() =>
    clients.workflowCommand.delete({ value: workflow.metadata!.id }),
  );
  return workflow;
}

describe("run gate — a member may run only what they can see (multi-tenant only)", () => {
  it("session create on a PRIVATE agent's instance is denied with the instance copy and leaves no row", async (ctx) => {
    if (!canProvisionMember()) return ctx.skip();
    const context = await tenancy();
    const member = await target.provisionMember!(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_private,
      "run-gate-private-agent",
    );
    const instanceId = agent.status!.defaultInstanceId;

    const denied = await expectGrpcCode(
      () =>
        member.sessionCommand.create(
          makeSession({
            org: context.org,
            name: uniqueName("member-session"),
            agentInstanceId: instanceId,
          }),
        ),
      Code.PermissionDenied,
      "member session create on a private agent's instance",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to run agent instance '${instanceId}'`,
    );

    // Side-effect free: the owner sees no session on the instance.
    const sessions = await clients.sessionQuery.listByAgentInstance({
      agentInstanceId: instanceId,
    });
    expect(sessions.entries, "no session row behind the denial").toHaveLength(
      0,
    );
  });

  it("execution create by agent_id on a PRIVATE agent is denied with the agent copy", async (ctx) => {
    if (!canProvisionMember()) return ctx.skip();
    const context = await tenancy();
    const member = await target.provisionMember!(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_private,
      "run-gate-private-agent",
    );
    const agentId = agent.metadata!.id;

    const denied = await expectGrpcCode(
      () =>
        member.agentExecutionCommand.create(
          makeAgentExecution({
            org: context.org,
            name: uniqueName("member-exec"),
            agentId,
          }),
        ),
      Code.PermissionDenied,
      "member execution create on a private agent",
    );
    expect(denied.rawMessage).toBe(`unauthorized to run agent '${agentId}'`);
  });

  it("execution create by session_id on a session the member cannot see is denied with the session copy", async (ctx) => {
    if (!canProvisionMember()) return ctx.skip();
    const context = await tenancy();
    const member = await target.provisionMember!(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_org,
      "run-gate-org-agent",
    );
    const ownerSession = await clients.sessionCommand.create(
      makeSession({
        org: context.org,
        name: uniqueName("owner-session"),
        agentInstanceId: agent.status!.defaultInstanceId,
      }),
    );
    fixtures.defer(() =>
      clients.sessionCommand.delete({ value: ownerSession.metadata!.id }),
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

  it("workflow execution create on a PRIVATE workflow is denied with the workflow copy", async (ctx) => {
    if (!canProvisionMember()) return ctx.skip();
    const context = await tenancy();
    const member = await target.provisionMember!(context);
    const workflow = await createPrivateWorkflow(context.org);
    const workflowId = workflow.metadata!.id;

    const denied = await expectGrpcCode(
      () =>
        member.workflowExecutionCommand.create(
          makeWorkflowExecution({
            org: context.org,
            name: uniqueName("member-wf-exec"),
            workflowId,
          }),
        ),
      Code.PermissionDenied,
      "member workflow execution create on a private workflow",
    );
    expect(denied.rawMessage).toBe(
      `unauthorized to run workflow '${workflowId}'`,
    );
  });

  it("session create on an ORG-visible agent's instance is allowed (the positive arm)", async (ctx) => {
    if (!canProvisionMember()) return ctx.skip();
    const context = await tenancy();
    const member = await target.provisionMember!(context);
    const agent = await createAgent(
      context.org,
      ApiResourceVisibility.visibility_org,
      "run-gate-org-agent",
    );
    const instanceId = agent.status!.defaultInstanceId;

    const session = await member.sessionCommand.create(
      makeSession({
        org: context.org,
        name: uniqueName("member-session"),
        agentInstanceId: instanceId,
      }),
    );
    fixtures.defer(() =>
      clients.sessionCommand.delete({ value: session.metadata!.id }),
    );
    expect(session.metadata?.id).toMatch(/^ses_/);
    expect(session.spec?.agentInstanceId).toBe(instanceId);
  });

  it("an unknown instance id answers NOT_FOUND, never a denial (stigmer#224)", async (ctx) => {
    if (!canProvisionMember()) return ctx.skip();
    const context = await tenancy();
    const member = await target.provisionMember!(context);
    const missing = `agi_${uniqueName("missing").replaceAll("-", "")}`;

    const notFound = await expectGrpcCode(
      () =>
        member.sessionCommand.create(
          makeSession({
            org: context.org,
            name: uniqueName("member-session"),
            agentInstanceId: missing,
          }),
        ),
      Code.NotFound,
      "member session create on an unknown instance id",
    );
    expect(notFound.rawMessage).toContain(missing);
  });
});
