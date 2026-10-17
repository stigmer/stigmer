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
//     the list filters keyed on an agent id (channels, schedules)
//     never move to the newcomer (a channel goes with its agent, so the
//     newcomer lists none and neither does the deleted agent).
// Edition-unconditional: no Temporal, no runner.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RoutineFireOutcome } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeSlackChannel } from "../support/channels";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { makeRoutine, targetMissingReason } from "../support/routines";
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
    const routine = await clients.routineCommand.create(makeRoutine(org, uniqueName("sched"), slug));
    fixtures.defer(() => clients.routineCommand.delete({ value: routine.metadata!.id }));

    await clients.agentCommand.delete({ value: before.id });
    await createAgent(org, slug);

    const fired = await clients.routineCommand.fire({ value: routine.metadata!.id });
    expect(fired.outcome).toBe(RoutineFireOutcome.TARGET_MISSING);
    // The reason names the organization by the id the reference holds.
    expect(fired.refusalReason).toBe(targetMissingReason(routine.metadata!.org, before.id));
    expect(fired.runId).toBe("");
  });

  it("[rpc:ChannelQueryController.listByAgent] [rpc:ScheduleQueryController.listByAgent] the lists keyed on an agent id answer the agent they were written for, never the newcomer", async () => {
    const { org } = await target.provisionTenancy();
    const slug = uniqueName("remade-lists");
    const before = await createAgent(org, slug);
    const channel = await clients.channelCommand.create(makeSlackChannel(org, uniqueName("chan"), slug));
    fixtures.defer(() => clients.channelCommand.delete({ value: channel.metadata!.id }));
    const routine = await clients.routineCommand.create(makeRoutine(org, uniqueName("sched"), slug));
    fixtures.defer(() => clients.routineCommand.delete({ value: routine.metadata!.id }));

    await clients.agentCommand.delete({ value: before.id });
    const after = await createAgent(org, slug);

    const newcomerChannels = await clients.channelQuery.listByAgent({ agentId: after.id, org });
    const newcomerRoutines = await clients.routineQuery.listByAgent({ agentId: after.id, org });
    expect(newcomerChannels.entries.map((c) => c.metadata?.id)).toEqual([]);
    expect(newcomerRoutines.entries.map((s) => s.metadata?.id)).toEqual([]);

    const keptChannels = await clients.channelQuery.listByAgent({ agentId: before.id, org });
    const keptRoutines = await clients.routineQuery.listByAgent({ agentId: before.id, org });
    // A channel goes with its agent (channel.conformance.test.ts), so the
    // deleted agent's list is empty too: neither id lists the old channel.
    expect(keptChannels.entries.map((c) => c.metadata?.id)).toEqual([]);
    expect(keptRoutines.entries.map((s) => s.metadata?.id)).toEqual([routine.metadata!.id]);
  });
});
