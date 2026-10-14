// References conformance — a reference holds the id of the resource it meant.
// Domain: conformance suites.
//
// People write references by name (org and slug); the server stores the
// target's id and answers with the target's current slug beside it. So:
//   - a reference written by slug comes back with its id and slug; one
//     written by id alone does too; one naming an id and a slug of two
//     different resources is refused INVALID_ARGUMENT;
//   - delete and remake: when the agent a reference names is deleted and
//     another agent takes its name, the reference keeps naming the deleted
//     one (its id, and no slug): a session's agent, a schedule's fire, and
//     the list filters keyed on an agent id (channels, schedules, shares)
//     never move to the newcomer.
// Edition-unconditional: no Temporal, no runner.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ScheduleFireOutcome } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { makeSchedule, targetMissingReason } from "../support/schedules";
import { makeSession } from "../support/sessions";
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

async function createAgent(org: string, slug: string): Promise<{ id: string; slug: string }> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: slug }));
  const id = agent.metadata!.id;
  fixtures.defer(async () => {
    await clients.agentCommand.delete({ value: id }).catch(() => undefined);
  });
  return { id, slug: agent.metadata!.slug };
}

describe("a reference is written by name and held by id", () => {
  it("[rpc:SessionCommandController.create] [rpc:SessionQueryController.get] a reference written by slug is answered with its id and slug", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, uniqueName("ref-target"));
    const session = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("ref-chat"), agentRef: { org, slug: agent.slug } }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

    expect(session.spec?.agentRef).toMatchObject({ kind: ApiResourceKind.agent, id: agent.id, slug: agent.slug });
    const read = await clients.sessionQuery.get({ value: session.metadata!.id });
    expect(read.spec?.agentRef).toMatchObject({ id: agent.id, slug: agent.slug });
  });

  it("[rpc:SessionCommandController.create] a reference written by id alone is answered with its slug", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, uniqueName("ref-by-id"));
    const session = await clients.sessionCommand.create({
      ...makeSession({ org, name: uniqueName("ref-chat") }),
      spec: { agentRef: { kind: ApiResourceKind.agent, id: agent.id } },
    });
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));
    expect(session.spec?.agentRef).toMatchObject({ id: agent.id, slug: agent.slug });
  });

  it("[rpc:SessionCommandController.create] an id and a slug naming two resources are refused INVALID_ARGUMENT naming both", async () => {
    const { org } = await target.provisionTenancy();
    const first = await createAgent(org, uniqueName("ref-first"));
    const second = await createAgent(org, uniqueName("ref-second"));
    const err = await expectGrpcCode(
      () =>
        clients.sessionCommand.create({
          ...makeSession({ org, name: uniqueName("ref-chat") }),
          spec: { agentRef: { kind: ApiResourceKind.agent, org, slug: second.slug, id: first.id } },
        }),
      Code.InvalidArgument,
      "a reference naming two resources",
    );
    expect(err.message).toContain(second.slug);
    expect(err.message).toContain(first.id);
  });
});

describe("delete and remake: a reference never moves to a newcomer that takes a deleted resource's name", () => {
  it("[rpc:SessionQueryController.get] a session's agent reference keeps the deleted agent's id, and names no slug", async () => {
    const { org } = await target.provisionTenancy();
    const slug = uniqueName("remade");
    const before = await createAgent(org, slug);
    const session = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("remade-chat"), agentRef: { org, slug } }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

    await clients.agentCommand.delete({ value: before.id });
    const after = await createAgent(org, slug);
    expect(after.slug).toBe(slug);

    const read = await clients.sessionQuery.get({ value: session.metadata!.id });
    expect(read.spec?.agentRef?.id).toBe(before.id);
    expect(read.spec?.agentRef?.slug).toBe("");
    expect(read.status?.agentId).toBe(before.id);
  });

  it("[rpc:ScheduleCommandController.trigger] a schedule's fire refuses TARGET_MISSING naming the deleted agent, and never runs the newcomer", async () => {
    const { org } = await target.provisionTenancy();
    const slug = uniqueName("remade-sched");
    const before = await createAgent(org, slug);
    const schedule = await clients.scheduleCommand.create(makeSchedule(org, uniqueName("sched"), slug));
    fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));

    await clients.agentCommand.delete({ value: before.id });
    await createAgent(org, slug);

    const fired = await clients.scheduleCommand.trigger({ value: schedule.metadata!.id });
    expect(fired.outcome).toBe(ScheduleFireOutcome.TARGET_MISSING);
    // The reason names the organization by the id the reference holds.
    expect(fired.refusalReason).toBe(targetMissingReason(schedule.metadata!.org, before.id));
    expect(fired.runId).toBe("");
  });

  it("[rpc:AgentChannelQueryController.listByAgent] [rpc:ScheduleQueryController.listByAgent] [rpc:AgentShareQueryController.listByAgent] the lists keyed on an agent id answer the agent they were written for, never the newcomer", async () => {
    const { org } = await target.provisionTenancy();
    const slug = uniqueName("remade-lists");
    const before = await createAgent(org, slug);
    const channel = await clients.agentChannelCommand.create(makeSlackAgentChannel(org, uniqueName("chan"), slug));
    fixtures.defer(() => clients.agentChannelCommand.delete({ value: channel.metadata!.id }));
    const schedule = await clients.scheduleCommand.create(makeSchedule(org, uniqueName("sched"), slug));
    fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));

    await clients.agentCommand.delete({ value: before.id });
    const after = await createAgent(org, slug);

    const newcomerChannels = await clients.agentChannelQuery.listByAgent({ agentId: after.id, org });
    const newcomerSchedules = await clients.scheduleQuery.listByAgent({ agentId: after.id, org });
    const newcomerShares = await clients.agentShareQuery.listByAgent({ agentId: after.id, org });
    expect(newcomerChannels.entries.map((c) => c.metadata?.id)).toEqual([]);
    expect(newcomerSchedules.entries.map((s) => s.metadata?.id)).toEqual([]);
    expect(newcomerShares.entries.map((s) => s.metadata?.id)).toEqual([]);

    const keptChannels = await clients.agentChannelQuery.listByAgent({ agentId: before.id, org });
    const keptSchedules = await clients.scheduleQuery.listByAgent({ agentId: before.id, org });
    expect(keptChannels.entries.map((c) => c.metadata?.id)).toEqual([channel.metadata!.id]);
    expect(keptSchedules.entries.map((s) => s.metadata?.id)).toEqual([schedule.metadata!.id]);
  });
});
