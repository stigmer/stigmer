// Parent-gated create authorization: the seven create lanes whose target is
// not a request field — a parent loaded from a reference (an agent to
// schedule, share, channel-bind or instantiate; a workflow to instantiate),
// or the organization a blueprint or memory lands in. Each RPC is
// `is_skip_authorization` on the wire where the target is loaded, and the
// handler asks the bar its proto states once its resolve step has loaded
// the parent. This suite pins those bars on the enforcing lane:
//
//   - McpServer.create: the admin bar (`can_create_mcp_server`), so a member
//     is refused and an outsider naming the organization is refused;
//   - AgentInstance.create: a member instantiates an org-visible agent in
//     their organization, is refused a private one with the parent's copy,
//     and an outsider naming the organization is refused with its copy;
//   - WorkflowInstance.create: a member instantiates an org-visible
//     workflow and is refused a private one;
//   - Schedule, AgentShare, AgentChannel: `can_edit` on the referenced agent,
//     so a member who may run an org-visible agent may not schedule, share or
//     channel-bind it, and an outsider is refused; the admin may;
//   - Memory.create: an outsider naming an organization is refused; a member
//     remembers there once both the organization and the member have
//     turned memory on, the memory filed under the member;
//   - an environment reference: a write may attach only an environment its
//     writer can view, so a member naming a teammate's private environment
//     on an instance is refused PERMISSION_DENIED with the rule's sentence,
//     while the owner may attach their own and anyone an org-visible one.
//
// Every refusal is asserted by code AND copy, because the copy is the wire
// contract each lane has carried since the Java edition. Out of scope: the
// run gate (its own suites), the reads by reference
// (reference-read-authorization), and the default-instance self-heal the
// server composes in-process (a server unit, since the wire cannot compose
// one).
import { Code } from "@connectrpc/connect";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeAgentInstance } from "../support/agentinstances";
import { makeEnvironment } from "../support/environments";
import { makeAgentShare } from "../support/agentshares";
import { makeMcpServer } from "../support/mcpservers";
import {
  enableMyMemory,
  enableOrganizationMemory,
  MEMORY_ACCOUNT_DISABLED_MESSAGE,
  makeMemory,
} from "../support/memories";
import { uniqueName } from "../support/naming";
import { makeSchedule } from "../support/schedules";
import { makeWorkflow } from "../support/workflows";
import { makeWorkflowInstance } from "../support/workflowinstances";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
  type TenancyContext,
} from "../targets";
import { organizationSlug } from "../support/organizations";

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

const PRIVATE = ApiResourceVisibility.visibility_private;
const ORG_VISIBLE = ApiResourceVisibility.visibility_org;

interface Cast {
  readonly org: string;
  readonly tenancy: TenancyContext;
  readonly owner: ConformanceClients;
  readonly admin: ConformanceClients;
  readonly member: ConformanceClients;
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
    outsider: await lane.provisionIdentity(),
  };
}

// The deny copies, byte for byte: the Java handlers' where the lane had one,
// the annotation family's where the check is new.
const MCP_SERVER_ORG_DENIED =
  "unauthorized to create mcp server in this organization";
const INSTANCE_ORG_DENIED =
  "unauthorized to create agent instance in this organization";
const INSTANCE_PARENT_DENIED =
  "You don't have permission to create instances of this agent";
const WORKFLOW_INSTANCE_PARENT_DENIED =
  "You don't have permission to create instances of this workflow";
const SCHEDULE_DENIED = "You don't have permission to schedule this agent";
const SHARE_DENIED = "You don't have permission to share this agent";
const CHANNEL_DENIED =
  "You don't have permission to connect this agent to a channel";
const MEMORY_ORG_DENIED = "unauthorized to capture memory in this organization";

async function seedAgent(
  c: Cast,
  visibility: ApiResourceVisibility,
  name = uniqueName("gate-agent"),
) {
  const input = makeAgent({ org: c.org, name });
  input.metadata = { ...input.metadata, visibility };
  const agent = await c.owner.agentCommand.create(input);
  fixtures.defer(() =>
    c.owner.agentCommand.delete({ value: agent.metadata!.id }),
  );
  return agent;
}

async function seedWorkflow(c: Cast, visibility: ApiResourceVisibility) {
  const input = makeWorkflow({ org: c.org, name: uniqueName("gate-wf") });
  input.metadata = { ...input.metadata, visibility };
  const workflow = await c.owner.workflowCommand.create(input);
  fixtures.defer(() =>
    c.owner.workflowCommand.delete({ value: workflow.metadata!.id }),
  );
  return workflow;
}

async function expectDenied(
  op: () => Promise<unknown>,
  copy: string,
  context: string,
): Promise<void> {
  const denied = await expectGrpcCode(op, Code.PermissionDenied, context);
  expect(denied.rawMessage, `${context}: copy`).toBe(copy);
}

describe("McpServer.create asks the blueprint bar", () => {
  it("[rpc:McpServerCommandController.create] an admin authors an MCP server; a member and an outsider are refused with the organization's copy", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const created = await c.admin.mcpServerCommand.create(
      makeMcpServer({ org: c.org, name: uniqueName("gate-mcp") }),
    );
    fixtures.defer(() =>
      c.owner.mcpServerCommand.delete({ resourceId: created.metadata!.id }),
    );
    for (const [who, using] of [
      ["member", c.member],
      ["outsider", c.outsider],
    ] as const) {
      await expectDenied(
        () =>
          using.mcpServerCommand.create(
            makeMcpServer({ org: c.org, name: uniqueName("gate-mcp") }),
          ),
        MCP_SERVER_ORG_DENIED,
        `${who} creates an MCP server`,
      );
    }
  });
});

describe("AgentInstance.create asks the organization's bar, then the parent's", () => {
  it("[rpc:AgentInstanceCommandController.create] a member instantiates an org-visible agent in their organization", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const agent = await seedAgent(c, ORG_VISIBLE);
    const created = await c.member.agentInstanceCommand.create(
      makeAgentInstance({
        org: c.org,
        name: uniqueName("gate-inst"),
        agentId: agent.metadata!.id,
      }),
    );
    fixtures.defer(() =>
      c.owner.agentInstanceCommand.delete({ value: created.metadata!.id }),
    );
    expect(created.metadata?.org).toBe(c.org);
  });

  it("[rpc:AgentInstanceCommandController.create] a member is refused a PRIVATE agent with the parent's copy; an outsider naming the organization hears the organization's copy first", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const privateAgent = await seedAgent(c, PRIVATE);
    const orgAgent = await seedAgent(c, ORG_VISIBLE);
    await expectDenied(
      () =>
        c.member.agentInstanceCommand.create(
          makeAgentInstance({
            org: c.org,
            name: uniqueName("gate-inst"),
            agentId: privateAgent.metadata!.id,
          }),
        ),
      INSTANCE_PARENT_DENIED,
      "member instantiates a private agent",
    );
    await expectDenied(
      () =>
        c.outsider.agentInstanceCommand.create(
          makeAgentInstance({
            org: c.org,
            name: uniqueName("gate-inst"),
            agentId: orgAgent.metadata!.id,
          }),
        ),
      INSTANCE_ORG_DENIED,
      "outsider instantiates into a foreign organization",
    );
  });
});

describe("an instance attaches only environments its writer can view", () => {
  const notViewable = (org: string, slug: string) =>
    `referenced environment '${org}/${slug}' is not one you can view; ` +
    "attach an environment you own or one shared with the organization.";

  it("[rpc:AgentInstanceCommandController.create] a member naming the owner's private environment is refused; the owner attaches it, and a member attaches an org-visible one", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const agent = await seedAgent(c, ORG_VISIBLE);
    const ownersKeys = await c.owner.environmentCommand.create(
      makeEnvironment({
        org: c.org,
        name: uniqueName("owner-keys"),
        data: { API_KEY: { value: "owner-secret", isSecret: true } },
      }),
    );
    fixtures.defer(() =>
      c.owner.environmentCommand.delete({
        resourceId: ownersKeys.metadata!.id,
      }),
    );
    const teamKeys = await c.owner.environmentCommand.create(
      makeEnvironment({
        org: c.org,
        name: uniqueName("team-keys"),
        data: { API_KEY: { value: "team-secret", isSecret: true } },
      }),
    );
    fixtures.defer(() =>
      c.owner.environmentCommand.delete({ resourceId: teamKeys.metadata!.id }),
    );
    await c.owner.environmentCommand.updateVisibility({
      resourceId: teamKeys.metadata!.id,
      visibility: ORG_VISIBLE,
    });
    const instanceNaming = (slug: string) =>
      makeAgentInstance({
        org: c.org,
        name: uniqueName("gate-env-inst"),
        agentId: agent.metadata!.id,
        environmentRefs: [{ org: c.org, slug }],
      });

    await expectDenied(
      () =>
        c.member.agentInstanceCommand.create(
          instanceNaming(ownersKeys.metadata!.slug),
        ),
      notViewable(await organizationSlug(c.owner.organizationQuery, c.org), ownersKeys.metadata!.slug),
      "member attaches the owner's private environment",
    );

    for (const [who, using, slug] of [
      [
        "owner, their own private environment",
        c.owner,
        ownersKeys.metadata!.slug,
      ],
      ["member, an org-visible environment", c.member, teamKeys.metadata!.slug],
    ] as const) {
      const created = await using.agentInstanceCommand.create(
        instanceNaming(slug),
      );
      fixtures.defer(() =>
        c.owner.agentInstanceCommand.delete({ value: created.metadata!.id }),
      );
      expect(
        created.spec?.environmentRefs.map((r) => r.slug),
        who,
      ).toEqual([slug]);
    }
  });
});

describe("WorkflowInstance.create asks can_execute on the parent", () => {
  it("[rpc:WorkflowInstanceCommandController.create] a member instantiates an org-visible workflow and is refused a private one", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const orgWorkflow = await seedWorkflow(c, ORG_VISIBLE);
    const privateWorkflow = await seedWorkflow(c, PRIVATE);
    const created = await c.member.workflowInstanceCommand.create(
      makeWorkflowInstance({
        org: c.org,
        name: uniqueName("gate-wfi"),
        workflowId: orgWorkflow.metadata!.id,
      }),
    );
    fixtures.defer(() =>
      c.owner.workflowInstanceCommand.delete({ value: created.metadata!.id }),
    );
    await expectDenied(
      () =>
        c.member.workflowInstanceCommand.create(
          makeWorkflowInstance({
            org: c.org,
            name: uniqueName("gate-wfi"),
            workflowId: privateWorkflow.metadata!.id,
          }),
        ),
      WORKFLOW_INSTANCE_PARENT_DENIED,
      "member instantiates a private workflow",
    );
  });
});

describe("Schedule, AgentShare and AgentChannel ask can_edit on the referenced agent", () => {
  it("[rpc:ScheduleCommandController.create] [rpc:AgentShareCommandController.create] [rpc:AgentChannelCommandController.create] an admin schedules, shares and channel-binds an org-visible agent; a member who may run it may not; an outsider is refused", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const agent = await seedAgent(c, ORG_VISIBLE);
    const slug = agent.metadata!.slug;

    const schedule = await c.admin.scheduleCommand.create(
      makeSchedule(c.org, uniqueName("gate-sched"), slug, { enabled: false }),
    );
    fixtures.defer(() =>
      c.owner.scheduleCommand.delete({ value: schedule.metadata!.id }),
    );
    const share = await c.admin.agentShareCommand.create(
      makeAgentShare(c.org, slug, { name: uniqueName("gate-share") }),
    );
    fixtures.defer(() =>
      c.owner.agentShareCommand.delete({ value: share.metadata!.id }),
    );
    const channel = await c.admin.agentChannelCommand.create(
      makeSlackAgentChannel(c.org, uniqueName("gate-chan"), slug),
    );
    fixtures.defer(() =>
      c.owner.agentChannelCommand.delete({ value: channel.metadata!.id }),
    );

    for (const [who, using] of [
      ["member", c.member],
      ["outsider", c.outsider],
    ] as const) {
      await expectDenied(
        () =>
          using.scheduleCommand.create(
            makeSchedule(c.org, uniqueName("gate-sched"), slug, {
              enabled: false,
            }),
          ),
        SCHEDULE_DENIED,
        `${who} schedules the agent`,
      );
      await expectDenied(
        () =>
          using.agentShareCommand.create(
            makeAgentShare(c.org, slug, { name: uniqueName("gate-share") }),
          ),
        SHARE_DENIED,
        `${who} shares the agent`,
      );
      await expectDenied(
        () =>
          using.agentChannelCommand.create(
            makeSlackAgentChannel(c.org, uniqueName("gate-chan"), slug),
          ),
        CHANNEL_DENIED,
        `${who} channel-binds the agent`,
      );
    }
  });
});

describe("Memory.create asks can_create_session on the organization", () => {
  it("[rpc:MemoryCommandController.create] a member remembers in their organization; an outsider naming it is refused", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    // The lane's tenancy is founded with memory off; the owner turns it on
    // so the member's positive arm reaches the store. The outsider's arm
    // does not depend on it: the authorization question comes BEFORE the
    // enablement check, so an outsider never learns the setting.
    await enableOrganizationMemory(c.owner, c.org);
    // Memory is the person's as well as the organization's (stigmer#1387):
    // with only the organization's switch on, the member is refused with
    // their own account's copy, and captures once they opt in, the memory
    // filed under them — so only they can clean it up (subject-only).
    const refused = await expectGrpcCode(
      () => c.member.memoryCommand.create(makeMemory(c.org)),
      Code.FailedPrecondition,
      "a member who has not opted in captures a memory",
    );
    expect(refused.rawMessage).toBe(MEMORY_ACCOUNT_DISABLED_MESSAGE);
    const member = await enableMyMemory(c.member);
    const memory = await c.member.memoryCommand.create(makeMemory(c.org));
    fixtures.defer(() =>
      c.member.memoryCommand.delete({ value: memory.metadata!.id }),
    );
    expect(memory.spec?.subjectIdentityAccountId).toBe(member.metadata?.id);
    await expectDenied(
      () => c.outsider.memoryCommand.create(makeMemory(c.org)),
      MEMORY_ORG_DENIED,
      "outsider captures a memory in a foreign organization",
    );
  });
});
