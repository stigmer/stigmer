// Conformance suite for saved run settings (Class A).
// Domain: agentic / routine, channel (web and Slack) — the save-time rule
// every surface that stores a RunConfig shares.
//
// The contract under test (RunConfig in run/v1/invocation.proto):
// saved settings are self-contained. A routine's or a channel's (web or
// Slack) run_config that asks for the fast tier or for thinking names the
// model it is for; only a live message may set either alone, to adjust the
// model a less specific layer chose. Each surface refuses the unnamed choice at save
// with INVALID_ARGUMENT naming the field, and accepts it with a model.
//
// Out of scope here: the same rule at execution create for a row saved
// before it (resolve-run-config.test.ts, beside the code), and the agent's
// own run defaults (agent.conformance.test.ts, "run defaults").
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";
import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { makeSlackChannel, makeWebChannel } from "../support/channels";
import { uniqueName } from "../support/naming";
import { makeRoutine } from "../support/routines";
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
  it("[rpc:RoutineCommandController.create] a routine refuses fast or thinking with no model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const slug = await agentIn(org);
    for (const runConfig of [FAST_ALONE, THINKING_ALONE]) {
      const input = create(RoutineSchema, makeRoutine(org, uniqueName("sched-saved"), slug));
      if (input.spec?.agent === undefined) {
        throw new Error("makeRoutine builds an agent invocation");
      }
      input.spec.agent.runConfig = runConfig;
      const err = await expectGrpcCode(
        () => clients.routineCommand.create(input),
        Code.InvalidArgument,
        "a routine saving a tier or thinking with no model",
      );
      expect(err.rawMessage).toContain("spec.agent.run_config.model_name");
    }
  });

  it("[rpc:ChannelCommandController.create] a web channel refuses fast or thinking with no model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const slug = await agentIn(org);
    for (const runConfig of [FAST_ALONE, THINKING_ALONE]) {
      const input = create(ChannelSchema, makeWebChannel(org, slug, { name: uniqueName("web-saved") }));
      input.spec!.runConfig = runConfig;
      const err = await expectGrpcCode(
        () => clients.channelCommand.create(input),
        Code.InvalidArgument,
        "web channel saving a tier or thinking with no model",
      );
      expect(err.rawMessage).toContain("spec.run_config.model_name");
    }
  });

  it("[rpc:ChannelCommandController.create] a Slack channel refuses fast or thinking with no model (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const slug = await agentIn(org);
    for (const runConfig of [FAST_ALONE, THINKING_ALONE]) {
      const input = create(
        ChannelSchema,
        makeSlackChannel(org, uniqueName("channel-saved"), slug, { modelName: null }),
      );
      input.spec!.runConfig = runConfig;
      const err = await expectGrpcCode(
        () => clients.channelCommand.create(input),
        Code.InvalidArgument,
        "channel saving a tier or thinking with no model",
      );
      expect(err.rawMessage).toContain("spec.run_config.model_name");
    }
  });

  it("[rpc:RoutineCommandController.create] each surface accepts thinking saved with the model it is for", async () => {
    const { org } = await target.provisionTenancy();
    const slug = await agentIn(org);

    // A routine reads an unset engine as native; a channel is judged
    // against every engine's list, so the web channel names the native id
    // and the Slack channel the Cursor id, and both are known.
    const onNative = create(RunConfigSchema, { modelName: "claude-haiku-4.5", thinkingMode: ThinkingMode.ENABLED });
    const onCursor = create(RunConfigSchema, { modelName: "claude-haiku-4-5", thinkingMode: ThinkingMode.ENABLED });

    const routine = create(RoutineSchema, makeRoutine(org, uniqueName("sched-saved-ok"), slug));
    if (routine.spec?.agent === undefined) {
      throw new Error("makeRoutine builds an agent invocation");
    }
    routine.spec.agent.runConfig = onNative;
    const savedRoutine = await clients.routineCommand.create(routine);
    fixtures.defer(() => clients.routineCommand.delete({ value: savedRoutine.metadata!.id }));
    expect(
      savedRoutine.spec?.agent?.runConfig?.thinkingMode,
    ).toBe(ThinkingMode.ENABLED);

    const web = create(ChannelSchema, makeWebChannel(org, slug, { name: uniqueName("web-saved-ok") }));
    web.spec!.runConfig = onNative;
    const savedWeb = await clients.channelCommand.create(web);
    fixtures.defer(() => clients.channelCommand.delete({ value: savedWeb.metadata!.id }));
    expect(savedWeb.spec?.runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);

    const channel = create(
      ChannelSchema,
      makeSlackChannel(org, uniqueName("channel-saved-ok"), slug, { modelName: null }),
    );
    channel.spec!.runConfig = onCursor;
    const savedChannel = await clients.channelCommand.create(channel);
    fixtures.defer(() => clients.channelCommand.delete({ value: savedChannel.metadata!.id }));
    expect(savedChannel.spec?.runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);
  });
});
