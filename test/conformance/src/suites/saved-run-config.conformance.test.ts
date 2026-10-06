// Conformance suite for saved run settings (Class A).
// Domain: agentic / schedule, agentshare, agentchannel — the save-time rule
// every surface that stores a RunConfig shares.
//
// The contract under test (RunConfig in agentexecution/v1/invocation.proto):
// saved settings are self-contained. A schedule's, a share's or a channel's
// run_config that asks for the fast tier or for thinking names the model it
// is for; only a live message may set either alone, to adjust the model a
// less specific layer chose. Each surface refuses the unnamed choice at save
// with INVALID_ARGUMENT naming the field, and accepts it with a model.
//
// Out of scope here: the same rule at execution create for a row saved
// before it (resolve-run-config.test.ts, beside the code), and the agent's
// own run defaults (agent.conformance.test.ts, "run defaults").
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/invocation_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { makeSlackAgentChannel } from "../support/agentchannels";
import { makeAgentShare } from "../support/agentshares";
import { uniqueName } from "../support/naming";
import { makeSchedule } from "../support/schedules";
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

async function agentIn(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("saved-settings") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent.metadata!.slug;
}

const FAST_ALONE = create(RunConfigSchema, { serviceTier: ServiceTier.FAST });
const THINKING_ALONE = create(RunConfigSchema, { thinkingMode: ThinkingMode.ENABLED });

describe("Saved run settings name the model their tier or thinking is for", () => {
  it("[rpc:ScheduleCommandController.create] a schedule refuses fast or thinking with no model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const slug = await agentIn(org);
    for (const runConfig of [FAST_ALONE, THINKING_ALONE]) {
      const input = create(ScheduleSchema, makeSchedule(org, uniqueName("sched-saved"), slug));
      if (input.spec?.target.case !== "agent") {
        throw new Error("makeSchedule builds an agent target");
      }
      input.spec.target.value.runConfig = runConfig;
      const err = await expectGrpcCode(
        () => clients.scheduleCommand.create(input),
        Code.InvalidArgument,
        "schedule saving a tier or thinking with no model",
      );
      expect(err.rawMessage).toContain("spec.agent.run_config.model_name");
    }
  });

  it("[rpc:AgentShareCommandController.create] a share refuses fast or thinking with no model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const slug = await agentIn(org);
    for (const runConfig of [FAST_ALONE, THINKING_ALONE]) {
      const input = create(AgentShareSchema, makeAgentShare(org, slug, { name: uniqueName("share-saved") }));
      input.spec!.runConfig = runConfig;
      const err = await expectGrpcCode(
        () => clients.agentShareCommand.create(input),
        Code.InvalidArgument,
        "share saving a tier or thinking with no model",
      );
      expect(err.rawMessage).toContain("spec.run_config.model_name");
    }
  });

  it("[rpc:AgentChannelCommandController.create] a channel refuses fast or thinking with no model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const slug = await agentIn(org);
    for (const runConfig of [FAST_ALONE, THINKING_ALONE]) {
      const input = create(
        AgentChannelSchema,
        makeSlackAgentChannel(org, uniqueName("channel-saved"), slug, { modelName: null }),
      );
      input.spec!.runConfig = runConfig;
      const err = await expectGrpcCode(
        () => clients.agentChannelCommand.create(input),
        Code.InvalidArgument,
        "channel saving a tier or thinking with no model",
      );
      expect(err.rawMessage).toContain("spec.run_config.model_name");
    }
  });

  it("[rpc:ScheduleCommandController.create] each surface accepts thinking saved with the model it is for", async () => {
    const { org } = await target.provisionTenancy();
    const slug = await agentIn(org);

    // A schedule and a share read an unset engine as native; a channel is
    // judged against every engine's list, so it names the Cursor id.
    const onNative = create(RunConfigSchema, { modelName: "claude-haiku-4.5", thinkingMode: ThinkingMode.ENABLED });
    const onCursor = create(RunConfigSchema, { modelName: "claude-haiku-4-5", thinkingMode: ThinkingMode.ENABLED });

    const schedule = create(ScheduleSchema, makeSchedule(org, uniqueName("sched-saved-ok"), slug));
    if (schedule.spec?.target.case !== "agent") {
      throw new Error("makeSchedule builds an agent target");
    }
    schedule.spec.target.value.runConfig = onNative;
    const savedSchedule = await clients.scheduleCommand.create(schedule);
    fixtures.defer(() => clients.scheduleCommand.delete({ value: savedSchedule.metadata!.id }));
    expect(
      savedSchedule.spec?.target.case === "agent" ? savedSchedule.spec.target.value.runConfig?.thinkingMode : undefined,
    ).toBe(ThinkingMode.ENABLED);

    const share = create(AgentShareSchema, makeAgentShare(org, slug, { name: uniqueName("share-saved-ok") }));
    share.spec!.runConfig = onNative;
    const savedShare = await clients.agentShareCommand.create(share);
    fixtures.defer(() => clients.agentShareCommand.delete({ value: savedShare.metadata!.id }));
    expect(savedShare.spec?.runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);

    const channel = create(
      AgentChannelSchema,
      makeSlackAgentChannel(org, uniqueName("channel-saved-ok"), slug, { modelName: null }),
    );
    channel.spec!.runConfig = onCursor;
    const savedChannel = await clients.agentChannelCommand.create(channel);
    fixtures.defer(() => clients.agentChannelCommand.delete({ value: savedChannel.metadata!.id }));
    expect(savedChannel.spec?.runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);
  });
});
