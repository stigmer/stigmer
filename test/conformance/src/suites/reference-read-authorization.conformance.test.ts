// Reference-read authorization: a read by org/slug answers exactly what the
// read by id answers. Every `getByReference` RPC is `is_skip_authorization` on
// the wire because its target is a slug the declarative check cannot key on;
// the server loads the row and then asks the sibling `get` annotation's
// question about it (can_view, the get's byte-pinned copy). This suite pins
// that the two lanes agree, kind by kind, on the enforcing lane:
//
//   - the owner reads their private row by reference;
//   - a member reads an org-visible row by reference;
//   - a member is REFUSED a private row by reference with the same
//     PERMISSION_DENIED and the same copy the read by id answers;
//   - an outsider is refused an existing row PERMISSION_DENIED and a missing
//     slug NOT_FOUND — the load-first order, so an id and a slug reveal the
//     same about the rows an outsider cannot see;
//   - an org-less reference is INVALID_ARGUMENT for every kind.
//
// Out of scope: the version ladder (skill and workflow suites own it), the
// redactions (each kind's own suite), and the create-side bars
// (parent-gated-create-authorization). Kinds whose rows are personal
// (environment, execution context) have no org-visible arm; kinds that carry
// no visibility (instances, shares, channels, schedules, apps) are read by
// their owner and by a member only when the model admits members.
import { Code } from "@connectrpc/connect";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeAgentInstance } from "../support/agentinstances";
import { makeAgentShare } from "../support/agentshares";
import { makeSlackChannelApp } from "../support/channelapps";
import { makeEnvironment } from "../support/environments";
import { makeExecutionContext } from "../support/executioncontexts";
import { makeMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { makeOAuthApp } from "../support/oauthapps";
import { makeSchedule } from "../support/schedules";
import { makeSkillArtifact } from "../support/skills";
import { makeWorkflow } from "../support/workflows";
import { makeWorkflowInstance } from "../support/workflowinstances";
import {
  createTarget,
  enforcingLaneOf,
  type EnforcingLane,
  type TargetProfile,
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

const PRIVATE = ApiResourceVisibility.visibility_private;
const ORG_VISIBLE = ApiResourceVisibility.visibility_org;

/** A row seeded as `using` in `org`: its id, its slug, and how to read it both ways. */
interface Seeded {
  readonly id: string;
  readonly slug: string;
}

/** One kind's table row: how to seed it, read it by id, read it by reference, and its get copy. */
interface ReferenceKind {
  readonly name: string;
  /** Whether the kind carries a visibility an owner can set; `false` = the model decides who reads it. */
  readonly visible: boolean;
  /** Whether a plain member reads the row when it is org-visible (or, for a visibility-less kind, at all). */
  readonly memberReads: boolean;
  seed(
    using: ConformanceClients,
    org: string,
    visibility: ApiResourceVisibility,
  ): Promise<Seeded>;
  getById(using: ConformanceClients, id: string): Promise<unknown>;
  getByReference(
    using: ConformanceClients,
    org: string,
    slug: string,
  ): Promise<unknown>;
  cleanup(using: ConformanceClients, id: string): Promise<unknown>;
  /** The get annotation's error_msg, which the reference read must answer byte for byte. */
  readonly deniedCopy: string;
}

/** Seeds an agent as `using` in `org` for the kinds that need a parent. */
async function seedAgent(
  using: ConformanceClients,
  org: string,
  visibility: ApiResourceVisibility = ORG_VISIBLE,
) {
  const input = makeAgent({ org, name: uniqueName("ref-agent") });
  input.metadata = { ...input.metadata, visibility };
  const agent = await using.agentCommand.create(input);
  fixtures.defer(() =>
    using.agentCommand.delete({ value: agent.metadata!.id }),
  );
  return agent;
}

const KINDS: ReadonlyArray<ReferenceKind> = [
  {
    name: "agent",
    visible: true,
    memberReads: true,
    async seed(using, org, visibility) {
      const input = makeAgent({ org, name: uniqueName("ref-agent") });
      input.metadata = { ...input.metadata, visibility };
      const created = await using.agentCommand.create(input);
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.agentQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.agentQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.agentCommand.delete({ value: id }),
    deniedCopy: "unauthorized to get agent",
  },
  {
    name: "workflow",
    visible: true,
    memberReads: true,
    async seed(using, org, visibility) {
      const input = makeWorkflow({ org, name: uniqueName("ref-wf") });
      input.metadata = { ...input.metadata, visibility };
      const created = await using.workflowCommand.create(input);
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.workflowQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.workflowQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.workflowCommand.delete({ value: id }),
    deniedCopy: "unauthorized to get workflow",
  },
  {
    name: "skill",
    visible: true,
    memberReads: true,
    async seed(using, org, visibility) {
      const pushed = await using.skillCommand.push({
        org,
        artifact: makeSkillArtifact({ name: uniqueName("ref-skill") }),
      });
      if (pushed.metadata?.visibility !== visibility) {
        await using.skillCommand.updateVisibility({
          resourceId: pushed.metadata!.id,
          visibility,
        });
      }
      return { id: pushed.metadata!.id, slug: pushed.metadata!.slug };
    },
    getById: (using, id) => using.skillQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.skillQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.skillCommand.delete({ value: id }),
    deniedCopy: "unauthorized to get skill",
  },
  {
    name: "mcp_server",
    visible: true,
    memberReads: true,
    async seed(using, org, visibility) {
      const input = makeMcpServer({ org, name: uniqueName("ref-mcp") });
      input.metadata = { ...input.metadata, visibility };
      const created = await using.mcpServerCommand.create(input);
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.mcpServerQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.mcpServerQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.mcpServerCommand.delete({ resourceId: id }),
    deniedCopy: "unauthorized to view mcp server",
  },
  {
    name: "environment",
    visible: false,
    memberReads: false,
    async seed(using, org) {
      const created = await using.environmentCommand.create(
        makeEnvironment({ org, name: uniqueName("ref-env") }),
      );
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.environmentQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.environmentQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.environmentCommand.delete({ resourceId: id }),
    deniedCopy: "unauthorized to get environment",
  },
  {
    name: "execution_context",
    visible: false,
    memberReads: false,
    async seed(using, org) {
      const created = await using.executionContextCommand.create(
        makeExecutionContext({
          org,
          name: uniqueName("ref-ectx"),
          executionId: uniqueName("aex_ref"),
        }),
      );
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.executionContextQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.executionContextQuery.getByReference({ org, slug }),
    cleanup: (using, id) =>
      using.executionContextCommand.delete({ resourceId: id }),
    deniedCopy: "unauthorized to get execution context",
  },
  {
    name: "agent_instance",
    visible: true,
    memberReads: true,
    async seed(using, org, visibility) {
      const agent = await seedAgent(using, org);
      const input = makeAgentInstance({
        org,
        name: uniqueName("ref-inst"),
        agentId: agent.metadata!.id,
      });
      input.metadata = { ...input.metadata, visibility };
      const created = await using.agentInstanceCommand.create(input);
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.agentInstanceQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.agentInstanceQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.agentInstanceCommand.delete({ value: id }),
    deniedCopy: "unauthorized to get Agent Instance",
  },
  {
    name: "workflow_instance",
    visible: true,
    memberReads: true,
    async seed(using, org, visibility) {
      const wfInput = makeWorkflow({ org, name: uniqueName("ref-wf") });
      wfInput.metadata = { ...wfInput.metadata, visibility: ORG_VISIBLE };
      const workflow = await using.workflowCommand.create(wfInput);
      fixtures.defer(() =>
        using.workflowCommand.delete({ value: workflow.metadata!.id }),
      );
      const input = makeWorkflowInstance({
        org,
        name: uniqueName("ref-wfi"),
        workflowId: workflow.metadata!.id,
      });
      input.metadata = { ...input.metadata, visibility };
      const created = await using.workflowInstanceCommand.create(input);
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.workflowInstanceQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.workflowInstanceQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.workflowInstanceCommand.delete({ value: id }),
    deniedCopy: "unauthorized to get workflow instance",
  },
  {
    name: "agent_share",
    visible: false,
    memberReads: false,
    async seed(using, org) {
      const agent = await seedAgent(using, org);
      const created = await using.agentShareCommand.create(
        makeAgentShare(org, agent.metadata!.slug),
      );
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.agentShareQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.agentShareQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.agentShareCommand.delete({ value: id }),
    deniedCopy: "unauthorized to get agent share",
  },
  {
    name: "agent_channel",
    visible: false,
    memberReads: false,
    async seed(using, org) {
      const agent = await seedAgent(using, org);
      const created = await using.agentChannelCommand.create(
        makeSlackAgentChannel(
          org,
          uniqueName("ref-chan"),
          agent.metadata!.slug,
        ),
      );
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.agentChannelQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.agentChannelQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.agentChannelCommand.delete({ value: id }),
    deniedCopy: "unauthorized to get agent channel",
  },
  {
    name: "channel_app",
    visible: false,
    memberReads: false,
    async seed(using, org) {
      const created = await using.channelAppCommand.create(
        makeSlackChannelApp(org, uniqueName("ref-app")),
      );
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.channelAppQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.channelAppQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.channelAppCommand.delete({ resourceId: id }),
    deniedCopy: "unauthorized to view channel app",
  },
  {
    name: "oauth_app",
    visible: false,
    memberReads: false,
    async seed(using, org) {
      const created = await using.oauthAppCommand.create(
        makeOAuthApp(org, uniqueName("ref-oauth")),
      );
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.oauthAppQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.oauthAppQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.oauthAppCommand.delete({ resourceId: id }),
    deniedCopy: "unauthorized to view oauth app",
  },
  {
    name: "schedule",
    visible: false,
    memberReads: false,
    async seed(using, org) {
      const agent = await seedAgent(using, org);
      const created = await using.scheduleCommand.create(
        makeSchedule(org, uniqueName("ref-sched"), agent.metadata!.slug, {
          enabled: false,
        }),
      );
      return { id: created.metadata!.id, slug: created.metadata!.slug };
    },
    getById: (using, id) => using.scheduleQuery.get({ value: id }),
    getByReference: (using, org, slug) =>
      using.scheduleQuery.getByReference({ org, slug }),
    cleanup: (using, id) => using.scheduleCommand.delete({ value: id }),
    deniedCopy: "unauthorized to get schedule",
  },
];

describe.each(KINDS)(
  "$name — a read by reference answers as the read by id",
  (kind) => {
    async function seededBy(
      using: ConformanceClients,
      org: string,
      visibility: ApiResourceVisibility,
    ): Promise<Seeded> {
      const seeded = await kind.seed(using, org, visibility);
      fixtures.defer(() => kind.cleanup(using, seeded.id));
      return seeded;
    }

    it("the owner reads their private row by reference", async (ctx) => {
      const lane = laneOrSkip(ctx);
      const { org } = await lane.provisionTenancy();
      const seeded = await seededBy(lane.clients, org, PRIVATE);
      await kind.getByReference(lane.clients, org, seeded.slug);
    });

    it("a member reads by reference exactly what they read by id", async (ctx) => {
      const lane = laneOrSkip(ctx);
      const tenancy = await lane.provisionTenancy();
      const member = await lane.provisionMember(tenancy);
      const seeded = await seededBy(
        lane.clients,
        tenancy.org,
        kind.visible ? ORG_VISIBLE : PRIVATE,
      );
      if (kind.memberReads) {
        await kind.getById(member, seeded.id);
        await kind.getByReference(member, tenancy.org, seeded.slug);
      } else {
        const byId = await expectGrpcCode(
          () => kind.getById(member, seeded.id),
          Code.PermissionDenied,
          `member ${kind.name} by id`,
        );
        const byRef = await expectGrpcCode(
          () => kind.getByReference(member, tenancy.org, seeded.slug),
          Code.PermissionDenied,
          `member ${kind.name} by reference`,
        );
        expect(byRef.rawMessage).toBe(byId.rawMessage);
        expect(byRef.rawMessage).toBe(kind.deniedCopy);
      }
    });

    it.skipIf(!kind.visible)(
      "a member is refused a PRIVATE row by reference with the get copy",
      async (ctx) => {
        const lane = laneOrSkip(ctx);
        const tenancy = await lane.provisionTenancy();
        const member = await lane.provisionMember(tenancy);
        const seeded = await seededBy(lane.clients, tenancy.org, PRIVATE);
        const denied = await expectGrpcCode(
          () => kind.getByReference(member, tenancy.org, seeded.slug),
          Code.PermissionDenied,
          `member ${kind.name} private by reference`,
        );
        expect(denied.rawMessage).toBe(kind.deniedCopy);
      },
    );

    it("an outsider is refused an existing row and told a missing slug is not found", async (ctx) => {
      const lane = laneOrSkip(ctx);
      const { org } = await lane.provisionTenancy();
      const outsider = await lane.provisionIdentity();
      const seeded = await seededBy(
        lane.clients,
        org,
        kind.visible ? ORG_VISIBLE : PRIVATE,
      );
      const denied = await expectGrpcCode(
        () => kind.getByReference(outsider, org, seeded.slug),
        Code.PermissionDenied,
        `outsider ${kind.name} by reference`,
      );
      expect(denied.rawMessage).toBe(kind.deniedCopy);
      await expectGrpcCode(
        () =>
          kind.getByReference(outsider, org, `${kind.name}-reference-missing`),
        Code.NotFound,
        `outsider ${kind.name} missing slug`,
      );
    });

    it("an org-less reference is refused as under-specified", async (ctx) => {
      const lane = laneOrSkip(ctx);
      await expectGrpcCode(
        () => kind.getByReference(lane.clients, "", `${kind.name}-orgless`),
        Code.InvalidArgument,
        `${kind.name} org-less reference`,
      );
    });
  },
);
