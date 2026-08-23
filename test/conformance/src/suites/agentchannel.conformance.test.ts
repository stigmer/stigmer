// AgentChannel conformance — CRUD + validation, the install/conversation/
// messaging runtime postures, and the same-org invariants (Class A).
// Domain: conformance suites.
//
// An AgentChannel binds one agent to one external messaging workspace. The
// resource CRUD surface is fully served by both editions; the RUNTIME lanes
// split by edition and are pinned by posture (channel-integrations T02 §0-b
// and the conversation/messaging decisions, all documented in the Go
// controllers):
//
//   - COMMANDS that ask to DO a cloud-only thing refuse FailedPrecondition
//     with per-surface copy — byte-pinned here where channelMessaging is
//     false (the OSS contract the TS port must reproduce): installs
//     ("channel installs require Stigmer Cloud"), conversation participation
//     ("conversation participation requires Stigmer Cloud"), proactive
//     messaging ("proactive channel messaging requires Stigmer Cloud").
//   - DISCOVERY reads answer truthful emptiness on both editions (empty
//     lists; uniform NotFound for single-row reads) — asserted
//     unconditionally: a fresh conformance fixture has no conversation
//     traffic on either edition.
//   - INPUT VALIDATION runs before every refusal (the controllers validate
//     first precisely so the InvalidArgument contract matches cloud) —
//     asserted unconditionally.
//
// Deliberate exclusions, disclosed in the wave-2 PR:
//   - The app_ref freeze-while-installed rule is structurally unreachable on
//     OSS (install_state never reaches `installed` — the install lane is the
//     refusal above). The reachable half of the same rule IS asserted: a
//     pending channel rebinds its app freely.
//   - The install/conversation/messaging lanes' full CLOUD behavior needs
//     live provider workspaces; it stays covered by cloud's integration
//     tests (see the channelMessaging flag comment in targets/target.ts).
import { Code } from "@connectrpc/connect";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import {
  makeSlackAgentChannel,
  makeWhatsAppAgentChannel,
} from "../support/agentchannels";
import { makeSlackChannelApp } from "../support/channelapps";
import { uniqueName } from "../support/naming";
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

// An agent for channels to reference — every channel needs one, and the
// same-org invariant is about ITS org.
async function createAgentFixture(org: string) {
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("channel-agent") }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

async function createChannelFixture(org: string, agentSlug: string, name = uniqueName("channel")) {
  const channel = await clients.agentChannelCommand.create(
    makeSlackAgentChannel(org, name, agentSlug),
  );
  fixtures.defer(() => clients.agentChannelCommand.delete({ value: channel.metadata!.id }));
  return channel;
}

describe("AgentChannel conformance — CRUD & identity", () => {
  it("create assigns an ach_ id, echoes the spec, and initializes install_state to pending_install", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    expect(created.metadata?.id).toMatch(/^ach_/);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.providerConfig?.case).toBe("slack");
    // The relative agent_ref was normalized to an absolute one.
    expect(created.spec?.agentRef?.org).toBe(org);
    expect(created.spec?.agentRef?.slug).toBe(agent.metadata?.slug);
    // System-managed install lifecycle starts at pending_install — set
    // AFTER the create pipeline's status wipe, so its presence proves the
    // ordering contract too.
    expect(created.status?.installState).toBe(AgentChannelInstallState.pending_install);
  });

  it("get, getByReference, and list resolve the channel", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const fetched = await clients.agentChannelQuery.get({ value: created.metadata!.id });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);

    const byRef = await clients.agentChannelQuery.getByReference({
      org,
      slug: created.metadata!.slug,
    });
    expect(byRef.metadata?.id).toBe(created.metadata?.id);

    const listed = await clients.agentChannelQuery.list({ org });
    expect(listed.items.some((c) => c.metadata?.id === created.metadata?.id)).toBe(true);
  });

  it("getByAgent returns the agent's channels; an unknown agent id yields an empty list, not an error", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const channels = await clients.agentChannelQuery.getByAgent({ agentId: agent.metadata!.id });
    expect(channels.items.some((c) => c.metadata?.id === created.metadata?.id)).toBe(true);

    // "No channels" is the useful answer for the integrations surface
    // whether the agent is unknown or merely channel-less.
    const none = await clients.agentChannelQuery.getByAgent({ agentId: "agent_01confmissing" });
    expect(none.totalCount).toBe(0);
    expect(none.items).toHaveLength(0);
  });

  it("update flips mutable fields (enabled) and preserves identity", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const updated = await clients.agentChannelCommand.update({
      ...makeSlackAgentChannel(org, created.metadata!.name, agent.metadata!.slug, {
        enabled: false,
      }),
      metadata: created.metadata,
    });

    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.spec?.enabled).toBe(false);
    // Status (install lifecycle) is system-managed and survives updates.
    expect(updated.status?.installState).toBe(AgentChannelInstallState.pending_install);
  });

  it("delete removes the channel", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    // No deferred cleanup: this test deletes the channel itself.
    const created = await clients.agentChannelCommand.create(
      makeSlackAgentChannel(org, uniqueName("channel"), agent.metadata!.slug),
    );

    await clients.agentChannelCommand.delete({ value: created.metadata!.id });

    await expectGrpcCode(
      () => clients.agentChannelQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
  });
});

describe("AgentChannel conformance — create validation", () => {
  it("requires metadata.org (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const err = await expectGrpcCode(
      () =>
        clients.agentChannelCommand.create(
          makeSlackAgentChannel("", uniqueName("channel"), agent.metadata!.slug),
        ),
      Code.InvalidArgument,
      "create without metadata.org",
    );
    expect(err.rawMessage).toBe("metadata.org is required for an agent channel");
  });

  it("rejects a cross-org agent_ref (FailedPrecondition — channels have no cross-org arm)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const { org: otherOrg } = await target.provisionTenancy();

    // NOTE the deliberate as-is pin: the same-org rule here answers
    // FailedPrecondition while ChannelApp's provider rule answers
    // InvalidArgument — the cross-domain inconsistency recorded in the
    // wave-2 PR for post-cutover harmonization.
    const err = await expectGrpcCode(
      () =>
        clients.agentChannelCommand.create(
          makeSlackAgentChannel(otherOrg, uniqueName("channel"), agent.metadata!.slug, {
            agentRefOrg: org,
          }),
        ),
      Code.FailedPrecondition,
      "create with agent_ref pointing at another org",
    );
    expect(err.rawMessage).toContain("spec.agent_ref.org must match metadata.org");
  });

  it("rejects an unknown agent with the same NotFound a direct lookup produces", async () => {
    const { org } = await target.provisionTenancy();

    const err = await expectGrpcCode(
      () =>
        clients.agentChannelCommand.create(
          makeSlackAgentChannel(org, uniqueName("channel"), "no-such-agent"),
        ),
      Code.NotFound,
      "create referencing a nonexistent agent",
    );
    // Byte-identical with the direct agent lookup's refusal (the
    // indistinguishability contract the defaults resolver documents).
    expect(err.rawMessage).toBe("Agent not found: no-such-agent");
  });

  it("the pin-REQUIRED rule is edition-split: OSS stores an unpinned channel, cloud refuses it (#362)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const unpinned = makeSlackAgentChannel(org, uniqueName("channel"), agent.metadata!.slug, {
      modelName: null,
    });

    if (target.capabilities.channelMessaging) {
      // The edition that SERVES channels refuses an unpinned one at write
      // time: its channel execution profile runs the Cursor harness, where
      // no pin means billing as Auto.
      const err = await expectGrpcCode(
        () => clients.agentChannelCommand.create(unpinned),
        Code.InvalidArgument,
        "unpinned channel where the channel runtime serves Cursor",
      );
      expect(err.rawMessage).toContain(
        "spec.run_config.model_name must name a pinned model when the run would use the Cursor harness",
      );
    } else {
      // The edition that only STORES channels accepts the unpinned spec —
      // there is no serving profile to bill against.
      const created = await clients.agentChannelCommand.create(unpinned);
      fixtures.defer(() => clients.agentChannelCommand.delete({ value: created.metadata!.id }));
      expect(created.spec?.runConfig?.modelName ?? "").toBe("");
    }
  });

  it("rejects an unknown model pin (InvalidArgument, stable message prefix)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const err = await expectGrpcCode(
      () =>
        clients.agentChannelCommand.create(
          makeSlackAgentChannel(org, uniqueName("channel"), agent.metadata!.slug, {
            modelName: "surely-not-a-real-model-xyz",
          }),
        ),
      Code.InvalidArgument,
      "create with a model pin the registry does not know",
    );
    // Prefix only, never the full string: the refusal appends a
    // did-you-mean suffix whose content depends on the registry snapshot.
    expect(err.rawMessage).toContain(
      "spec.run_config.model_name: model 'surely-not-a-real-model-xyz' is not in the model registry",
    );
  });

  it("requires app_ref for WhatsApp channels (InvalidArgument — BYO-only provider)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const err = await expectGrpcCode(
      () =>
        clients.agentChannelCommand.create(
          makeWhatsAppAgentChannel(org, uniqueName("channel"), agent.metadata!.slug),
        ),
      Code.InvalidArgument,
      "create a WhatsApp channel without an app_ref",
    );
    expect(err.rawMessage).toBe(
      "spec.app_ref is required for WhatsApp channels — register your Meta app as a channel app and reference it",
    );
  });

  it("rejects a cross-org app_ref (FailedPrecondition — secrets never cross orgs)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const { org: otherOrg } = await target.provisionTenancy();

    const err = await expectGrpcCode(
      () =>
        clients.agentChannelCommand.create(
          makeSlackAgentChannel(org, uniqueName("channel"), agent.metadata!.slug, {
            appRefSlug: "some-app",
            appRefOrg: otherOrg,
          }),
        ),
      Code.FailedPrecondition,
      "create with app_ref pointing at another org's app",
    );
    expect(err.rawMessage).toContain("spec.app_ref.org must match metadata.org");
  });

  it("rejects a create with no provider arm (InvalidArgument — required oneof)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const spec = makeSlackAgentChannel(org, uniqueName("channel"), agent.metadata!.slug);
    delete (spec.spec as { providerConfig?: unknown }).providerConfig;

    await expectGrpcCode(
      () => clients.agentChannelCommand.create(spec),
      Code.InvalidArgument,
      "create with an empty provider_config oneof",
    );
  });
});

describe("AgentChannel conformance — update immutability", () => {
  it("rejects re-pointing agent_ref (FailedPrecondition — a channel serves ONE agent)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const otherAgent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const err = await expectGrpcCode(
      () =>
        clients.agentChannelCommand.update({
          ...makeSlackAgentChannel(org, created.metadata!.name, otherAgent.metadata!.slug),
          metadata: created.metadata,
        }),
      Code.FailedPrecondition,
      "update re-pointing the channel at a different agent",
    );
    expect(err.rawMessage).toContain("spec.agent_ref is immutable");
  });

  it("rejects flipping the provider arm (FailedPrecondition — install state is provider-shaped)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const err = await expectGrpcCode(
      () =>
        clients.agentChannelCommand.update({
          ...makeWhatsAppAgentChannel(org, created.metadata!.name, agent.metadata!.slug, {
            appRefSlug: "some-app",
          }),
          metadata: created.metadata,
        }),
      Code.FailedPrecondition,
      "update flipping slack → whatsapp",
    );
    expect(err.rawMessage).toContain("spec provider is immutable (channel provider is slack)");
  });

  it("allows rebinding app_ref while the channel is pending (the reachable half of the freeze rule)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const app = await clients.channelAppCommand.create(
      makeSlackChannelApp(org, uniqueName("channel-app")),
    );
    const created = await createChannelFixture(org, agent.metadata!.slug);
    // The channel must unbind before cleanup deletes the app (delete-block).
    fixtures.defer(() => clients.channelAppCommand.delete({ resourceId: app.metadata!.id }));

    // pending_install channels rebind freely — the freeze applies only to
    // installed channels, a state this edition never reaches (the install
    // lane is a refusal; see the suite header's disclosed exclusion).
    const bound = await clients.agentChannelCommand.update({
      ...makeSlackAgentChannel(org, created.metadata!.name, agent.metadata!.slug, {
        appRefSlug: app.metadata!.slug,
      }),
      metadata: created.metadata,
    });
    expect(bound.spec?.appRef?.slug).toBe(app.metadata?.slug);

    const unbound = await clients.agentChannelCommand.update({
      ...makeSlackAgentChannel(org, created.metadata!.name, agent.metadata!.slug),
      metadata: created.metadata,
    });
    expect(unbound.spec?.appRef?.slug ?? "").toBe("");
  });
});

describe("AgentChannel conformance — the install lanes", () => {
  it("initiateInstall on an unknown channel answers the LoadChannel NotFound (both editions)", async () => {
    const err = await expectGrpcCode(
      () => clients.agentChannelCommand.initiateInstall({ resourceId: "ach_01confmissing" }),
      Code.NotFound,
      "initiateInstall on a nonexistent channel",
    );
    // The load-then-refuse contract: NOT_FOUND is deliberately identical to
    // the cloud edition's LoadChannel step, so only the final (documented)
    // step diverges by edition.
    expect(err.rawMessage).toBe("AgentChannel not found: ach_01confmissing");
  });

  it("refuses installs where no channel runtime exists (the pinned OSS posture)", async (ctx) => {
    // Cloud serves real installs; their behavior needs a live provider
    // workspace — covered by cloud's integration tests, not pinnable here
    // (the skill transfer-lane skip precedent: no observable opposite arm).
    if (target.capabilities.channelMessaging) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const initiate = await expectGrpcCode(
      () => clients.agentChannelCommand.initiateInstall({ resourceId: created.metadata!.id }),
      Code.FailedPrecondition,
      "initiateInstall on this edition",
    );
    expect(initiate.rawMessage).toBe("channel installs require Stigmer Cloud");

    const complete = await expectGrpcCode(
      () =>
        clients.agentChannelCommand.completeInstall({
          resourceId: created.metadata!.id,
          state: "conformance-state-token",
          code: "conformance-oauth-code",
        }),
      Code.FailedPrecondition,
      "completeInstall on this edition",
    );
    expect(complete.rawMessage).toBe("channel installs require Stigmer Cloud");
  });
});

describe("AgentChannel conformance — conversation lanes", () => {
  // The reads probe a REAL channel of the caller's own org: on cloud a
  // fabricated channel id fails closed in authorization (PermissionDenied,
  // no existence leak) before any handler runs, so only an owned channel
  // reaches the shared truthful-emptiness contract on both editions.
  it("discovery reads answer truthful emptiness (no conversation traffic exists)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createChannelFixture(org, agent.metadata!.slug);

    const conversations = await clients.channelConversationQuery.listConversations({ org });
    expect(conversations.totalCount).toBe(0);
    expect(conversations.items).toHaveLength(0);

    const timeline = await clients.channelConversationQuery.getTimeline({
      agentChannelId: channel.metadata!.id,
      conversationKey: "conf-conversation",
    });
    expect(timeline.items ?? []).toHaveLength(0);
  });

  it("single-row reads answer uniform NotFound (no local probing, no existence leak)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createChannelFixture(org, agent.metadata!.slug);

    await expectGrpcCode(
      () =>
        clients.channelConversationQuery.getConversation({
          agentChannelId: channel.metadata!.id,
          conversationKey: "conf-conversation",
        }),
      Code.NotFound,
      "getConversation on a channel with no conversations",
    );

    const media = await expectGrpcCode(
      () =>
        clients.channelConversationQuery.getMediaDownloadUrl({
          agentChannelId: channel.metadata!.id,
          conversationKey: "conf-conversation",
          itemId: "conf-item",
        }),
      Code.NotFound,
      "getMediaDownloadUrl uniform miss",
    );
    // Byte-identical with the cloud handler's uniform miss (which covers
    // every cause the same way so a prober cannot learn which items exist).
    expect(media.rawMessage).toBe("no downloadable media at this timeline item");
  });

  it("validation runs before any refusal (InvalidArgument matches cloud)", async () => {
    // Empty conversation_key fails proto validation on BOTH editions —
    // proving the controllers validate before the edition split.
    await expectGrpcCode(
      () => clients.channelConversationCommand.takeOver({ agentChannelId: "ach_x", conversationKey: "" }),
      Code.InvalidArgument,
      "takeOver with an empty conversation_key",
    );
    await expectGrpcCode(
      () => clients.channelConversationCommand.escalate({ reason: "" }),
      Code.InvalidArgument,
      "escalate with an empty reason",
    );
  });

  it("refuses participation commands where no runtime exists (the pinned OSS posture)", async (ctx) => {
    if (target.capabilities.channelMessaging) return ctx.skip();
    const refusal = "conversation participation requires Stigmer Cloud";
    const control = { agentChannelId: "ach_01confmissing", conversationKey: "conf-conversation" };

    for (const [label, call] of [
      [
        "reply",
        () =>
          clients.channelConversationCommand.reply({
            ...control,
            payload: { kind: { case: "text", value: { body: "hello" } } },
          }),
      ],
      ["takeOver", () => clients.channelConversationCommand.takeOver(control)],
      ["handBack", () => clients.channelConversationCommand.handBack(control)],
      ["clearAttention", () => clients.channelConversationCommand.clearAttention(control)],
      ["escalate", () => clients.channelConversationCommand.escalate({ reason: "needs a human" })],
    ] as const) {
      const err = await expectGrpcCode(call, Code.FailedPrecondition, `${label} on this edition`);
      expect(err.rawMessage, `${label} refusal copy`).toBe(refusal);
    }
  });
});

describe("AgentChannel conformance — messaging lanes", () => {
  it("listMessagingChannels answers truthful emptiness on the storing edition, a refusal on the serving one", async () => {
    if (target.capabilities.channelMessaging) {
      // The serving edition resolves this read from an agent SESSION (the
      // runner's identity), so a bare direct call is refused with guidance
      // toward the resource surface — a verified edition divergence,
      // pinned two-armed rather than skipped.
      const err = await expectGrpcCode(
        () => clients.channelMessageQuery.listMessagingChannels({}),
        Code.InvalidArgument,
        "direct listMessagingChannels where the channel runtime serves",
      );
      expect(err.rawMessage).toContain("resolves from an agent session");
      return;
    }
    // The storing edition answers "none" for everyone: the runner issues
    // this read on every agent execution to decide whether to attach the
    // send tool, and an expected-error path in that hot loop would be
    // noise.
    const channels = await clients.channelMessageQuery.listMessagingChannels({});
    expect(channels.entries ?? []).toHaveLength(0);
  });

  it("validation runs before any refusal (InvalidArgument matches cloud)", async () => {
    await expectGrpcCode(
      () => clients.channelMessageCommand.sendMessage({ channel: "c", recipient: "" }),
      Code.InvalidArgument,
      "sendMessage with an empty recipient",
    );
  });

  it("refuses proactive messaging where no runtime exists (the pinned OSS posture)", async (ctx) => {
    if (target.capabilities.channelMessaging) return ctx.skip();
    const refusal = "proactive channel messaging requires Stigmer Cloud";

    const send = await expectGrpcCode(
      () =>
        clients.channelMessageCommand.sendMessage({
          channel: "conf-channel",
          recipient: "15551234567",
          payload: { kind: { case: "text", value: { body: "hello" } } },
        }),
      Code.FailedPrecondition,
      "sendMessage on this edition",
    );
    expect(send.rawMessage).toBe(refusal);

    const templates = await expectGrpcCode(
      () => clients.channelMessageQuery.listTemplates({ channel: "conf-channel" }),
      Code.FailedPrecondition,
      "listTemplates on this edition",
    );
    expect(templates.rawMessage).toBe(refusal);
  });
});
