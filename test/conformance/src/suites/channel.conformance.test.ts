// Channel conformance — CRUD and validation of every type, the nameless
// channel's name, the web channel's link (the rotatable token, the
// resolution lanes' uniform refusal, the guest path), the Slack and
// WhatsApp channels' install/conversation/messaging runtime postures, the
// same-organization invariant, and an agent's delete taking its channels
// with it (Class A).
// Domain: conformance suites.
//
// A Channel is one way people reach an agent, typed by spec's oneof: a web
// channel is the hosted chat link and the widget sites embed; a Slack or
// WhatsApp channel is a connection the provider delivers messages to. The
// resource surface is served by every edition; these contracts make the
// domain distinct, all asserted here:
//
//   - The NAMELESS channel: a channel created with neither name nor slug
//     takes the slug `<agent slug>-<type>` and the name
//     `<agent name> (Web|Slack|WhatsApp)`, so a second nameless channel of
//     one type on one agent is a duplicate (ALREADY_EXISTS) while one of
//     another type sits beside it; a named channel keeps its own slug. The
//     stored spec.agent_ref holds the agent's id, so a channel never
//     attaches to whatever agent later takes the slug.
//   - TYPE-SHAPED lanes: only a web channel has a link (rotateLink refuses
//     a Slack channel FailedPrecondition, and both profile reads answer a
//     Slack channel's id with the uniform NotFound); only a Slack or
//     WhatsApp channel installs (both install RPCs refuse a web channel
//     FailedPrecondition, after the load and the authorization, on every
//     edition). The type cannot change on update.
//   - The ANONYMOUS resolution lane (getAgentProfile, by channel id): every
//     miss — channel absent, an id of another kind, a channel of another
//     type, disabled, locked link with a wrong or missing token, agent
//     deleted — answers ONE byte-identical NotFound that deliberately says
//     "Agent" and echoes only the id the caller sent, so a public link leaks
//     nothing about which internal state produced the refusal (the
//     constant-time token compare behind it is unit-level; the wire
//     contract is the uniformity).
//   - The MEMBER lane (getAgentProfileForMember, by channel id): it asks
//     membership of the loaded channel's organization, and a non-member
//     hears the same NotFound as a missing channel.
//   - The GUEST path (mintGuestToken, by channel id): where an edition
//     mints, the token names the channel and its organization; open source
//     pins the UNIMPLEMENTED edition sentence.
//   - The ROTATABLE link token: rotateLink is status.web.link_token's sole
//     writer; after rotation the plain URL dies, the tokened URL resolves,
//     and a stale token on an UNLOCKED link stays harmless.
//   - The SAME-ORGANIZATION invariant: a channel's agent lives in the
//     channel's own organization. An agent_ref naming another organization
//     is refused with one FailedPrecondition sentence before any lookup,
//     whether that organization's slug exists or not, so the create lane is
//     never an existence probe.
//   - The AUDIENCE default: a web channel's omitted audience means the
//     organization's members. The server writes it out as org on create,
//     update and apply, so the echo says what it means; anything a public
//     link alone may carry (vaults, run options) needs public said out
//     loud, and a manifest that drops the audience narrows the link, never
//     widens it.
//   - An AGENT'S DELETE removes its channels of every type.
//   - The Slack and WhatsApp RUNTIME lanes split by edition and are pinned
//     by posture (documented in the controllers): COMMANDS that ask to DO a
//     cloud-only thing refuse FailedPrecondition with per-surface copy,
//     byte-pinned where channelMessaging is false: installs ("channel
//     installs require Stigmer Cloud"), conversation participation
//     ("conversation participation requires Stigmer Cloud"), proactive
//     messaging ("proactive channel messaging requires Stigmer Cloud").
//     DISCOVERY reads answer truthful emptiness on every edition (empty
//     lists; uniform NotFound for single-row reads): a fresh conformance
//     fixture has no conversation traffic. INPUT VALIDATION runs before
//     every refusal (the controllers validate first so the InvalidArgument
//     contract matches cloud).
//
// Deliberate exclusions:
//   - The app_ref freeze-while-installed rule is structurally unreachable on
//     open source (install_state never reaches `installed`: the install lane
//     is the refusal above). The reachable half of the same rule IS
//     asserted: a pending channel rebinds its app freely.
//   - The install/conversation/messaging lanes' full CLOUD behavior needs
//     live provider workspaces; it stays covered by cloud's integration
//     tests (see the channelMessaging flag comment in targets/target.ts).
//   - Renaming a channel is pinned with every renamable kind in
//     rename.conformance.test.ts.
import { Code } from "@connectrpc/connect";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { ChannelInstallState } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/status_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { makeSlackChannelApp, makeWhatsAppChannelApp } from "../support/channelapps";
import {
  makeSlackChannel,
  makeWebChannel,
  makeWhatsAppChannel,
} from "../support/channels";
import { uniqueName } from "../support/naming";
import { myVaultTarget, setSecretsInput } from "../support/vaults";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

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

// An agent for channels to reference: every channel needs one, and the
// same-org invariant is about ITS org.
async function createAgentFixture(org: string, using: ConformanceClients = clients) {
  const agent = await using.agentCommand.create(
    makeAgent({ org, name: uniqueName("channel-agent") }),
  );
  fixtures.defer(() => using.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

// A Slack channel of the agent, deleted at the end of the test.
async function createChannelFixture(org: string, agentSlug: string, name = uniqueName("channel")) {
  const channel = await clients.channelCommand.create(
    makeSlackChannel(org, name, agentSlug),
  );
  fixtures.defer(() => clients.channelCommand.delete({ value: channel.metadata!.id }));
  return channel;
}

// A web channel of the agent (nameless unless the options name it), deleted
// at the end of the test.
async function createWebFixture(
  org: string,
  agentSlug: string,
  options: Parameters<typeof makeWebChannel>[2] = {},
  using: ConformanceClients = clients,
) {
  const channel = await using.channelCommand.create(makeWebChannel(org, agentSlug, options));
  fixtures.defer(() => using.channelCommand.delete({ value: channel.metadata!.id }));
  return channel;
}

// A web channel's audience, read through the type oneof; undefined for any
// other type.
function audienceOf(channel: Channel): ChannelAudience | undefined {
  return channel.spec?.type.case === "web" ? channel.spec.type.value.audience : undefined;
}

// A web channel's live link token, read through the status oneof; empty
// when the link is plain.
function linkTokenOf(channel: Channel): string {
  return channel.status?.typeStatus.case === "web" ? channel.status.typeStatus.value.linkToken : "";
}

// A Slack channel's app slug, read through the type oneof; empty when none.
function slackAppSlugOf(channel: Channel): string {
  return channel.spec?.type.case === "slack" ? channel.spec.type.value.appRef?.slug ?? "" : "";
}

// The uniform public refusal — deliberately "Agent", never "Channel": the
// visitor asked for an agent's chat page; the channel resource is an
// internal modeling detail a public error must not teach. It echoes the
// channel id the caller sent, which the caller already holds.
function linkNotFoundMessage(channelId: string): string {
  return `Agent not found: ${channelId}`;
}

// The refusal a lane answers for a channel id it cannot load.
function channelNotFoundMessage(channelId: string): string {
  return `Channel not found: ${channelId}`;
}

// The open-source edition's answer to a guest mint (no unit composes the
// capability).
const GUEST_MINT_UNIMPLEMENTED =
  "TokenService.mintGuestToken is not implemented: guest tokens for shared agents are served by the Cloud edition";

// The FailedPrecondition copy of the type-shaped lanes.
const ROTATE_LINK_NOT_APPLICABLE = "only a web channel has a link to rotate";
const INSTALL_NOT_APPLICABLE =
  "a web channel has nothing to install — installs are for Slack and WhatsApp channels";

// A JWT's payload, decoded without verifying: the arm reads which channel
// and organization the server named, not whether it signed them.
function jwtPayload(token: string): Record<string, unknown> {
  const [, payload = ""] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("Channel conformance — CRUD & identity (Slack)", () => {
  it("[rpc:ChannelCommandController.create] create assigns a chn_ id, echoes the spec, and initializes install_state to pending_install", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    expect(created.metadata?.id).toMatch(/^chn_/);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.type.case).toBe("slack");
    // The relative agent_ref was normalized to an absolute one.
    expect(created.spec?.agentRef?.org).toBe(org);
    expect(created.spec?.agentRef?.slug).toBe(agent.metadata?.slug);
    // System-managed install lifecycle starts at pending_install — set
    // AFTER the create pipeline's status wipe, so its presence proves the
    // ordering contract too.
    expect(created.status?.installState).toBe(ChannelInstallState.pending_install);
  });

  it("[rpc:ChannelQueryController.get] [rpc:ChannelQueryController.getByReference] [rpc:ChannelQueryController.list] get, getByReference, and list resolve the channel", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const fetched = await clients.channelQuery.get({ value: created.metadata!.id });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);

    const byRef = await clients.channelQuery.getByReference({
      org,
      slug: created.metadata!.slug,
    });
    expect(byRef.metadata?.id).toBe(created.metadata?.id);

    const listed = await clients.channelQuery.list({ org });
    expect(listed.entries.some((c) => c.metadata?.id === created.metadata?.id)).toBe(true);
  });

  it("[rpc:ChannelQueryController.listByAgent] listByAgent returns the agent's channels; an unknown agent id yields an empty list, not an error", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const channels = await clients.channelQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(channels.entries.some((c) => c.metadata?.id === created.metadata?.id)).toBe(true);

    // "No channels" is the useful answer for the integrations surface
    // whether the agent is unknown or merely channel-less.
    const none = await clients.channelQuery.listByAgent({ agentId: "agent_01confmissing" });
    expect(none.nextPageToken).toBe("");
    expect(none.entries).toHaveLength(0);
  });

  it("[rpc:ChannelCommandController.update] update flips mutable fields (enabled) and preserves identity", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const updated = await clients.channelCommand.update({ resource: {
      ...makeSlackChannel(org, created.metadata!.name, agent.metadata!.slug, {
        enabled: false,
      }),
      metadata: created.metadata,
    }, updateMask: { paths: ["*"] } });

    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.spec?.enabled).toBe(false);
    // Status (install lifecycle) is system-managed and survives updates.
    expect(updated.status?.installState).toBe(ChannelInstallState.pending_install);
  });

  it("[rpc:ChannelCommandController.apply] apply creates on first call and updates in place on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const name = uniqueName("channel");

    const first = await clients.channelCommand.apply(makeSlackChannel(org, name, agent.metadata!.slug));
    fixtures.defer(() => clients.channelCommand.delete({ value: first.metadata!.id }));
    expect(first.metadata?.id).toMatch(/^chn_/);
    expect(first.spec?.enabled).toBe(true);

    const second = await clients.channelCommand.apply(
      makeSlackChannel(org, name, agent.metadata!.slug, { enabled: false }),
    );

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.enabled).toBe(false);
    // Status (install lifecycle) is system-managed and survives the re-apply.
    expect(second.status?.installState).toBe(ChannelInstallState.pending_install);
  });

  it("[rpc:ChannelCommandController.delete] delete removes the channel", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    // No deferred cleanup: this test deletes the channel itself.
    const created = await clients.channelCommand.create(
      makeSlackChannel(org, uniqueName("channel"), agent.metadata!.slug),
    );

    await clients.channelCommand.delete({ value: created.metadata!.id });

    await expectGrpcCode(
      () => clients.channelQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
  });
});

describe("Channel conformance — CRUD & identity (web)", () => {
  it("[rpc:ChannelCommandController.create] a named web channel gets its own slug beside the nameless one", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const named = await createWebFixture(org, agent.metadata!.slug, {
      name: uniqueName("campaign-link"),
    });

    expect(named.metadata?.slug).not.toBe(`${agent.metadata?.slug}-web`);
    expect(named.metadata?.slug).toContain("campaign-link");
  });

  it("[rpc:ChannelQueryController.get] [rpc:ChannelQueryController.getByReference] [rpc:ChannelQueryController.listByAgent] [rpc:ChannelQueryController.list] get, getByReference, listByAgent, and list resolve the web channel", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createWebFixture(org, agent.metadata!.slug);

    const fetched = await clients.channelQuery.get({ value: created.metadata!.id });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);

    const byRef = await clients.channelQuery.getByReference({
      org,
      slug: created.metadata!.slug,
    });
    expect(byRef.metadata?.id).toBe(created.metadata?.id);

    const byAgent = await clients.channelQuery.listByAgent({ agentId: agent.metadata!.id });
    expect(byAgent.entries.some((s) => s.metadata?.id === created.metadata?.id)).toBe(true);

    const listed = await clients.channelQuery.list({ org });
    expect(listed.entries.some((s) => s.metadata?.id === created.metadata?.id)).toBe(true);
  });

  it("[rpc:ChannelCommandController.update] update flips a web channel's mutable fields but refuses re-pointing agent_ref (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const otherAgent = await createAgentFixture(org);
    const created = await createWebFixture(org, agent.metadata!.slug, {
      name: uniqueName("web"),
    });

    const updated = await clients.channelCommand.update({ resource: {
      ...makeWebChannel(org, agent.metadata!.slug, {
        name: created.metadata!.name,
        enabled: false,
      }),
      metadata: created.metadata,
    }, updateMask: { paths: ["*"] } });
    expect(updated.spec?.enabled).toBe(false);
    // The stored reference keeps the agent's id through an update.
    expect(updated.spec?.agentRef?.id).toBe(agent.metadata?.id);

    const err = await expectGrpcCode(
      () =>
        clients.channelCommand.update({ resource: {
          ...makeWebChannel(org, otherAgent.metadata!.slug, { name: created.metadata!.name }),
          // No etag: the refusal under test is the immutable agent_ref.
          metadata: { id: created.metadata!.id, name: created.metadata!.name, org: created.metadata!.org },
        }, updateMask: { paths: ["*"] } }),
      Code.FailedPrecondition,
      "update re-pointing the web channel at a different agent",
    );
    expect(err.rawMessage).toContain("spec.agent_ref is immutable");
  });

  it("[rpc:ChannelCommandController.apply] a web channel's apply creates on first call and updates in place on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const name = uniqueName("web");

    const first = await clients.channelCommand.apply(makeWebChannel(org, agent.metadata!.slug, { name }));
    fixtures.defer(() => clients.channelCommand.delete({ value: first.metadata!.id }));
    expect(first.spec?.enabled).toBe(true);

    // The same agent_ref: re-pointing a channel is refused, which the update arm pins.
    const second = await clients.channelCommand.apply(
      makeWebChannel(org, agent.metadata!.slug, { name, enabled: false }),
    );

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.enabled).toBe(false);
    // The stored reference keeps the agent's id through the re-apply.
    expect(second.spec?.agentRef?.id).toBe(agent.metadata?.id);
  });

  it("[rpc:ChannelCommandController.delete] delete removes the web channel", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await clients.channelCommand.create(
      makeWebChannel(org, agent.metadata!.slug),
    );

    await clients.channelCommand.delete({ value: created.metadata!.id });

    await expectGrpcCode(
      () => clients.channelQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
  });
});

describe("Channel conformance — the nameless channel's name", () => {
  it("[rpc:ChannelCommandController.create] a nameless web channel takes the slug <agent slug>-web and the name <agent name> (Web), and its spec.agent_ref holds its agent's id", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createWebFixture(org, agent.metadata!.slug);

    expect(created.metadata?.id).toMatch(/^chn_/);
    expect(created.metadata?.org).toBe(org);
    expect(created.metadata?.slug).toBe(`${agent.metadata?.slug}-web`);
    expect(created.metadata?.name).toBe(`${agent.metadata?.name} (Web)`);
    // The stored reference holds the agent's id, so the channel never
    // attaches to whatever agent later takes the slug.
    expect(created.spec?.agentRef?.id).toBe(agent.metadata?.id);
    // The relative agent_ref was normalized to an absolute one.
    expect(created.spec?.agentRef?.org).toBe(org);
    // A web channel has nothing to install.
    expect(created.status?.installState).toBe(ChannelInstallState.channel_install_state_unspecified);
  });

  it("[rpc:ChannelCommandController.create] a nameless Slack channel takes the slug <agent slug>-slack and the name <agent name> (Slack)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await clients.channelCommand.create(
      makeSlackChannel(org, undefined, agent.metadata!.slug),
    );
    fixtures.defer(() => clients.channelCommand.delete({ value: created.metadata!.id }));

    expect(created.metadata?.slug).toBe(`${agent.metadata?.slug}-slack`);
    expect(created.metadata?.name).toBe(`${agent.metadata?.name} (Slack)`);
    expect(created.spec?.agentRef?.id).toBe(agent.metadata?.id);
  });

  it("[rpc:ChannelCommandController.create] a nameless WhatsApp channel takes the slug <agent slug>-whatsapp and the name <agent name> (WhatsApp)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const app = await clients.channelAppCommand.create(
      makeWhatsAppChannelApp(org, uniqueName("wa-app")),
    );
    // Deferred before the channel, so the channel goes first (the app's
    // delete is refused while a channel references it).
    fixtures.defer(() => clients.channelAppCommand.delete({ resourceId: app.metadata!.id }));
    const created = await clients.channelCommand.create(
      makeWhatsAppChannel(org, undefined, agent.metadata!.slug, { appRefSlug: app.metadata!.slug }),
    );
    fixtures.defer(() => clients.channelCommand.delete({ value: created.metadata!.id }));

    expect(created.metadata?.slug).toBe(`${agent.metadata?.slug}-whatsapp`);
    expect(created.metadata?.name).toBe(`${agent.metadata?.name} (WhatsApp)`);
    expect(created.spec?.agentRef?.id).toBe(agent.metadata?.id);
    expect(created.status?.installState).toBe(ChannelInstallState.pending_install);
  });

  it("[rpc:ChannelCommandController.create] a second nameless channel of one type on one agent is refused ALREADY_EXISTS; one of another type sits beside it", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const slack = await clients.channelCommand.create(
      makeSlackChannel(org, undefined, agent.metadata!.slug),
    );
    fixtures.defer(() => clients.channelCommand.delete({ value: slack.metadata!.id }));

    await expectGrpcCode(
      () => clients.channelCommand.create(makeSlackChannel(org, undefined, agent.metadata!.slug)),
      Code.AlreadyExists,
      "a second nameless Slack channel on one agent",
    );

    const web = await createWebFixture(org, agent.metadata!.slug);
    expect(web.metadata?.slug).toBe(`${agent.metadata?.slug}-web`);
    const listed = await clients.channelQuery.listByAgent({ agentId: agent.metadata!.id, org });
    expect(listed.entries.map((c) => c.metadata?.id).sort()).toEqual(
      [slack.metadata!.id, web.metadata!.id].sort(),
    );
  });
});

describe("Channel conformance — an agent's delete", () => {
  it("[rpc:AgentCommandController.delete] deleting an agent deletes its channels of every type", async () => {
    const { org } = await target.provisionTenancy();
    // No deferred agent cleanup: this test deletes the agent itself.
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("channel-agent") }),
    );
    const web = await clients.channelCommand.create(makeWebChannel(org, agent.metadata!.slug));
    fixtures.defer(() => clients.channelCommand.delete({ value: web.metadata!.id }));
    const slack = await clients.channelCommand.create(
      makeSlackChannel(org, undefined, agent.metadata!.slug),
    );
    fixtures.defer(() => clients.channelCommand.delete({ value: slack.metadata!.id }));

    await clients.agentCommand.delete({ value: agent.metadata!.id });

    for (const [label, channel] of [
      ["web", web],
      ["Slack", slack],
    ] as const) {
      const err = await expectGrpcCode(
        () => clients.channelQuery.get({ value: channel.metadata!.id }),
        Code.NotFound,
        `the ${label} channel after its agent's delete`,
      );
      expect(err.rawMessage).toBe(channelNotFoundMessage(channel.metadata!.id));
    }
    const left = await clients.channelQuery.listByAgent({ agentId: agent.metadata!.id, org });
    expect(left.entries, "no channel of the deleted agent lists").toHaveLength(0);
  });
});

describe("Channel conformance — create validation (Slack and WhatsApp)", () => {
  it("[rpc:ChannelCommandController.create] requires metadata.org (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const err = await expectGrpcCode(
      () =>
        clients.channelCommand.create(
          makeSlackChannel("", uniqueName("channel"), agent.metadata!.slug),
        ),
      Code.InvalidArgument,
      "create without metadata.org",
    );
    expect(err.rawMessage).toBe("metadata.org is required for a channel");
  });

  it("[rpc:ChannelCommandController.create] rejects a cross-org agent_ref (FailedPrecondition — channels have no cross-org arm)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const { org: otherOrg } = await target.provisionTenancy();

    // NOTE the deliberate as-is pin: the same-org rule here answers
    // FailedPrecondition while ChannelApp's provider rule answers
    // InvalidArgument — a known cross-domain inconsistency, pinned as-is.
    const err = await expectGrpcCode(
      () =>
        clients.channelCommand.create(
          makeSlackChannel(otherOrg, uniqueName("channel"), agent.metadata!.slug, {
            agentRefOrg: org,
          }),
        ),
      Code.FailedPrecondition,
      "create with agent_ref pointing at another org",
    );
    expect(err.rawMessage).toContain("spec.agent_ref.org must match metadata.org");
  });

  it("[rpc:ChannelCommandController.create] rejects an unknown agent with the same NotFound a direct lookup produces", async () => {
    const { org } = await target.provisionTenancy();

    const err = await expectGrpcCode(
      () =>
        clients.channelCommand.create(
          makeSlackChannel(org, uniqueName("channel"), "no-such-agent"),
        ),
      Code.NotFound,
      "create referencing a nonexistent agent",
    );
    // Byte-identical with the direct agent lookup's refusal (the
    // indistinguishability contract the defaults resolver documents).
    expect(err.rawMessage).toBe("Agent not found: no-such-agent");
  });

  it("[rpc:ChannelCommandController.create] stores an unpinned channel on every edition (#362)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const unpinned = makeSlackChannel(org, uniqueName("channel"), agent.metadata!.slug, {
      modelName: null,
    });

    // A channel names no engine: its conversations start on the engine its
    // agent names, native when it names none, in both editions. Nothing at
    // write time knows the turn will run Cursor, so an unpinned channel is
    // stored; an unattended Cursor turn that names no model anywhere is
    // refused when it runs (stigmer/stigmer#362).
    const created = await clients.channelCommand.create(unpinned);
    fixtures.defer(() => clients.channelCommand.delete({ value: created.metadata!.id }));
    expect(created.spec?.runConfig?.modelName ?? "").toBe("");
  });

  it("[rpc:ChannelCommandController.create] rejects an unknown model pin (InvalidArgument, stable message prefix)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const err = await expectGrpcCode(
      () =>
        clients.channelCommand.create(
          makeSlackChannel(org, uniqueName("channel"), agent.metadata!.slug, {
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

  it("[rpc:ChannelCommandController.create] requires app_ref for WhatsApp channels (InvalidArgument — BYO-only provider)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const err = await expectGrpcCode(
      () =>
        clients.channelCommand.create(
          makeWhatsAppChannel(org, uniqueName("channel"), agent.metadata!.slug),
        ),
      Code.InvalidArgument,
      "create a WhatsApp channel without an app_ref",
    );
    expect(err.rawMessage).toBe(
      "spec.whatsapp.app_ref is required for WhatsApp channels — register your Meta app as a channel app and reference it",
    );
  });

  it("[rpc:ChannelCommandController.create] rejects a cross-org app_ref (FailedPrecondition — secrets never cross orgs)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const { org: otherOrg } = await target.provisionTenancy();

    const err = await expectGrpcCode(
      () =>
        clients.channelCommand.create(
          makeSlackChannel(org, uniqueName("channel"), agent.metadata!.slug, {
            appRefSlug: "some-app",
            appRefOrg: otherOrg,
          }),
        ),
      Code.FailedPrecondition,
      "create with app_ref pointing at another org's app",
    );
    expect(err.rawMessage).toContain("spec.slack.app_ref.org must match metadata.org");
  });

  it("[rpc:ChannelCommandController.create] rejects a create with no type (InvalidArgument — required oneof)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const spec = makeSlackChannel(org, uniqueName("channel"), agent.metadata!.slug);
    delete (spec.spec as { type?: unknown }).type;

    await expectGrpcCode(
      () => clients.channelCommand.create(spec),
      Code.InvalidArgument,
      "create with an empty type oneof",
    );
  });
});

describe("Channel conformance — create validation (web)", () => {
  it("[rpc:ChannelCommandController.create] requires metadata.org on a web channel, before its agent is read (InvalidArgument)", async () => {
    const err = await expectGrpcCode(
      () => clients.channelCommand.create(makeWebChannel("", "some-agent")),
      Code.InvalidArgument,
      "create without metadata.org",
    );
    expect(err.rawMessage).toBe("metadata.org is required for a channel");
  });

  it("[rpc:ChannelCommandController.create] rejects a web channel of an unknown agent with the same NotFound a direct lookup produces", async () => {
    const { org } = await target.provisionTenancy();
    const err = await expectGrpcCode(
      () => clients.channelCommand.create(makeWebChannel(org, "no-such-agent")),
      Code.NotFound,
      "create referencing a nonexistent agent",
    );
    expect(err.rawMessage).toBe("Agent not found: no-such-agent");
  });

  it("[rpc:ChannelCommandController.create] rejects vaults on an org-audience web channel (InvalidArgument — the CEL rule)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const channel = makeWebChannel(org, agent.metadata!.slug, {
      audience: ChannelAudience.org,
      vaults: ["some-vault"],
    });

    await expectGrpcCode(
      () => clients.channelCommand.create(channel),
      Code.InvalidArgument,
      "org-audience web channel carrying vaults",
    );
  });

  it("[rpc:ChannelCommandController.create] an omitted audience is stored and echoed as org, and the anonymous lane refuses it", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const channel = await createWebFixture(org, agent.metadata!.slug, {
      audience: ChannelAudience.unspecified,
    });
    expect(audienceOf(channel)).toBe(ChannelAudience.org);

    const refused = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId: channel.metadata!.id }),
      Code.NotFound,
      "getAgentProfile on a web channel whose audience was omitted",
    );
    expect(refused.rawMessage).toBe(linkNotFoundMessage(channel.metadata!.id));
  });

  it("[rpc:ChannelCommandController.create] rejects vaults on a web channel whose audience was omitted (InvalidArgument — public must be said)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const channel = makeWebChannel(org, agent.metadata!.slug, {
      audience: ChannelAudience.unspecified,
      vaults: ["some-vault"],
    });

    const err = await expectGrpcCode(
      () => clients.channelCommand.create(channel),
      Code.InvalidArgument,
      "omitted-audience web channel carrying vaults",
    );
    expect(err.rawMessage).toContain("vaults can only be set on a web channel whose audience is public");
  });

  it("[rpc:ChannelCommandController.apply] a manifest that drops the audience narrows a public web channel to org, never the reverse", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const name = uniqueName("web");

    const first = await clients.channelCommand.apply(
      makeWebChannel(org, agent.metadata!.slug, { name, audience: ChannelAudience.public }),
    );
    fixtures.defer(() => clients.channelCommand.delete({ value: first.metadata!.id }));
    expect(audienceOf(first)).toBe(ChannelAudience.public);

    const second = await clients.channelCommand.apply(
      makeWebChannel(org, agent.metadata!.slug, { name, audience: ChannelAudience.unspecified }),
    );
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(audienceOf(second)).toBe(ChannelAudience.org);
  });

  it("[rpc:ChannelCommandController.create] a web channel cannot carry anyone's own My vault (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const mine = await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { SHARE_KEY: "mine" }));
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));

    const channel = makeWebChannel(org, agent.metadata!.slug, { vaults: [mine.metadata!.slug] });

    const err = await expectGrpcCode(
      () => clients.channelCommand.create(channel),
      Code.FailedPrecondition,
      "a public web channel carrying the caller's My vault",
    );
    expect(err.rawMessage).toContain("a My vault cannot be attached to a channel");
  });
});

describe("Channel conformance — update immutability", () => {
  it("[rpc:ChannelCommandController.update] rejects re-pointing agent_ref (FailedPrecondition — a channel serves ONE agent)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const otherAgent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const err = await expectGrpcCode(
      () =>
        clients.channelCommand.update({ resource: {
          ...makeSlackChannel(org, created.metadata!.name, otherAgent.metadata!.slug),
          metadata: created.metadata,
        }, updateMask: { paths: ["*"] } }),
      Code.FailedPrecondition,
      "update re-pointing the channel at a different agent",
    );
    expect(err.rawMessage).toContain("spec.agent_ref is immutable");
  });

  it("[rpc:ChannelCommandController.update] rejects changing the type (FailedPrecondition — install state is type-shaped)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const err = await expectGrpcCode(
      () =>
        clients.channelCommand.update({ resource: {
          ...makeWhatsAppChannel(org, created.metadata!.name, agent.metadata!.slug, {
            appRefSlug: "some-app",
          }),
          metadata: created.metadata,
        }, updateMask: { paths: ["*"] } }),
      Code.FailedPrecondition,
      "update changing slack → whatsapp",
    );
    expect(err.rawMessage).toBe(
      "spec type is immutable (channel type is slack) — create a new channel of a different type",
    );
  });

  it("[rpc:ChannelCommandController.update] allows rebinding app_ref while the channel is pending (the reachable half of the freeze rule)", async () => {
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
    const bound = await clients.channelCommand.update({ resource: {
      ...makeSlackChannel(org, created.metadata!.name, agent.metadata!.slug, {
        appRefSlug: app.metadata!.slug,
      }),
      // No etag: the first rebind moved the row since this read.
      metadata: { id: created.metadata!.id, name: created.metadata!.name, org: created.metadata!.org },
    }, updateMask: { paths: ["*"] } });
    expect(slackAppSlugOf(bound)).toBe(app.metadata?.slug);

    const unbound = await clients.channelCommand.update({ resource: {
      ...makeSlackChannel(org, created.metadata!.name, agent.metadata!.slug),
      // No etag: the first rebind moved the row since this read.
      metadata: { id: created.metadata!.id, name: created.metadata!.name, org: created.metadata!.org },
    }, updateMask: { paths: ["*"] } });
    expect(slackAppSlugOf(unbound)).toBe("");
  });
});

describe("Channel conformance — the install lanes", () => {
  it("[rpc:ChannelCommandController.initiateInstall] initiateInstall on an unknown channel answers the LoadChannel NotFound (both editions)", async () => {
    const err = await expectGrpcCode(
      () => clients.channelCommand.initiateInstall({ resourceId: "chn_01confmissing" }),
      Code.NotFound,
      "initiateInstall on a nonexistent channel",
    );
    // The load-then-refuse contract: NOT_FOUND is deliberately identical to
    // the cloud edition's LoadChannel step, so only the final (documented)
    // step diverges by edition.
    expect(err.rawMessage).toBe(channelNotFoundMessage("chn_01confmissing"));
  });

  it("[rpc:ChannelCommandController.initiateInstall] [rpc:ChannelCommandController.completeInstall] refuses installs where no channel runtime exists (the pinned OSS posture)", async (ctx) => {
    // Cloud serves real installs; their behavior needs a live provider
    // workspace — covered by cloud's integration tests, not pinnable here
    // (the skill transfer-lane skip precedent: no observable opposite arm).
    if (target.capabilities.channelMessaging) return ctx.skip();
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createChannelFixture(org, agent.metadata!.slug);

    const initiate = await expectGrpcCode(
      () => clients.channelCommand.initiateInstall({ resourceId: created.metadata!.id }),
      Code.FailedPrecondition,
      "initiateInstall on this edition",
    );
    expect(initiate.rawMessage).toBe("channel installs require Stigmer Cloud");

    const complete = await expectGrpcCode(
      () =>
        clients.channelCommand.completeInstall({
          resourceId: created.metadata!.id,
          state: "conformance-state-token",
          code: "conformance-oauth-code",
        }),
      Code.FailedPrecondition,
      "completeInstall on this edition",
    );
    expect(complete.rawMessage).toBe("channel installs require Stigmer Cloud");
  });

  it("[rpc:ChannelCommandController.initiateInstall] [rpc:ChannelCommandController.completeInstall] a web channel has nothing to install: both install RPCs refuse it (FailedPrecondition, every edition)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const web = await createWebFixture(org, agent.metadata!.slug);

    const initiate = await expectGrpcCode(
      () => clients.channelCommand.initiateInstall({ resourceId: web.metadata!.id }),
      Code.FailedPrecondition,
      "initiateInstall on a web channel",
    );
    expect(initiate.rawMessage).toBe(INSTALL_NOT_APPLICABLE);

    const complete = await expectGrpcCode(
      () =>
        clients.channelCommand.completeInstall({
          resourceId: web.metadata!.id,
          state: "conformance-state-token",
          code: "conformance-oauth-code",
        }),
      Code.FailedPrecondition,
      "completeInstall on a web channel",
    );
    expect(complete.rawMessage).toBe(INSTALL_NOT_APPLICABLE);
  });
});

describe("Channel conformance — conversation lanes", () => {
  // The reads probe a REAL channel of the caller's own org: on cloud a
  // fabricated channel id fails closed in authorization (PermissionDenied,
  // no existence leak) before any handler runs, so only an owned channel
  // reaches the shared truthful-emptiness contract on both editions.
  it("[rpc:ChannelConversationQueryController.list] [rpc:ChannelConversationQueryController.countConversations] [rpc:ChannelConversationQueryController.listTimeline] discovery reads answer truthful emptiness (no conversation traffic exists)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createChannelFixture(org, agent.metadata!.slug);

    const conversations = await clients.channelConversationQuery.list({ org });
    expect(conversations.entries).toHaveLength(0);
    expect(conversations.nextPageToken).toBe("");
    const count = await clients.channelConversationQuery.countConversations({ org });
    expect(count.count).toBe(0);

    const timeline = await clients.channelConversationQuery.listTimeline({
      channelId: channel.metadata!.id,
      conversationKey: "conf-conversation",
    });
    expect(timeline.entries ?? []).toHaveLength(0);
  });

  it("[rpc:ChannelConversationQueryController.getConversation] [rpc:ChannelConversationQueryController.getMediaDownloadUrl] single-row reads answer uniform NotFound (no local probing, no existence leak)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createChannelFixture(org, agent.metadata!.slug);

    await expectGrpcCode(
      () =>
        clients.channelConversationQuery.getConversation({
          channelId: channel.metadata!.id,
          conversationKey: "conf-conversation",
        }),
      Code.NotFound,
      "getConversation on a channel with no conversations",
    );

    const media = await expectGrpcCode(
      () =>
        clients.channelConversationQuery.getMediaDownloadUrl({
          channelId: channel.metadata!.id,
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

  it("[rpc:ChannelConversationCommandController.takeOver] [rpc:ChannelConversationCommandController.escalate] validation runs before any refusal (InvalidArgument matches cloud)", async () => {
    // Empty conversation_key fails proto validation on BOTH editions —
    // proving the controllers validate before the edition split.
    await expectGrpcCode(
      () => clients.channelConversationCommand.takeOver({ channelId: "chn_x", conversationKey: "" }),
      Code.InvalidArgument,
      "takeOver with an empty conversation_key",
    );
    await expectGrpcCode(
      () => clients.channelConversationCommand.escalate({ reason: "" }),
      Code.InvalidArgument,
      "escalate with an empty reason",
    );
  });

  it("[rpc:ChannelConversationCommandController.reply] [rpc:ChannelConversationCommandController.takeOver] [rpc:ChannelConversationCommandController.handBack] [rpc:ChannelConversationCommandController.clearAttention] [rpc:ChannelConversationCommandController.escalate] refuses participation commands where no runtime exists (the pinned OSS posture)", async (ctx) => {
    if (target.capabilities.channelMessaging) return ctx.skip();
    const refusal = "conversation participation requires Stigmer Cloud";
    const control = { channelId: "chn_01confmissing", conversationKey: "conf-conversation" };

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

describe("Channel conformance — messaging lanes", () => {
  it("[rpc:ChannelMessageQueryController.listMessagingChannels] listMessagingChannels answers truthful emptiness on the storing edition, a refusal on the serving one", async () => {
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

  it("[rpc:ChannelMessageCommandController.sendMessage] validation runs before any refusal (InvalidArgument matches cloud)", async () => {
    await expectGrpcCode(
      () => clients.channelMessageCommand.sendMessage({ channel: "c", recipient: "" }),
      Code.InvalidArgument,
      "sendMessage with an empty recipient",
    );
  });

  it("[rpc:ChannelMessageCommandController.sendMessage] [rpc:ChannelMessageQueryController.listTemplates] refuses proactive messaging where no runtime exists (the pinned OSS posture)", async (ctx) => {
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

describe("Channel conformance — the anonymous resolution lane", () => {
  it("[rpc:ChannelQueryController.getAgentProfile] resolves an enabled web channel by its id to the trimmed profile (channel identity + agent display)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createWebFixture(org, agent.metadata!.slug);

    const profile = await clients.channelQuery.getAgentProfile({
      channelId: channel.metadata!.id,
    });

    // The channel's organization, slug and agent reference from the CHANNEL
    // (the hosted page starts its sessions on exactly that reference);
    // display fields from the AGENT — never the full Agent resource (its
    // spec carries the system prompt).
    expect(profile.org).toBe(org);
    expect(profile.slug).toBe(channel.metadata?.slug);
    expect(profile.name).toBe(agent.metadata?.name);
    expect(profile.agentRef?.slug).toBe(agent.metadata?.slug);
    expect(profile.agentRef?.org).toBe(channel.spec?.agentRef?.org);
  });

  it("[rpc:ChannelQueryController.getAgentProfile] [rpc:TokenService.mintGuestToken] require a channel_id of at most 128 characters (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId: "" }),
      Code.InvalidArgument,
      "getAgentProfile without channel_id",
    );
    // The bound is checked before anything is read, so an oversized id is
    // never echoed in the uniform refusal; both editions validate the mint's
    // request before its capability is reached.
    const oversized = `chn_${"x".repeat(125)}`;
    await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId: oversized }),
      Code.InvalidArgument,
      "getAgentProfile with a 129-character channel_id",
    );
    await expectGrpcCode(
      () => clients.token.mintGuestToken({ channelId: oversized }),
      Code.InvalidArgument,
      "mintGuestToken with a 129-character channel_id",
    );
  });

  it("[rpc:ChannelQueryController.getAgentProfile] answers ONE byte-identical NotFound for absent, other-kind, disabled, and agent-deleted web channels", async () => {
    const { org } = await target.provisionTenancy();

    // Absent channel, under a retired prefix: old links keep their ids.
    const missingId = "ash_01confnevercreated";
    const absent = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId: missingId }),
      Code.NotFound,
      "getAgentProfile on a nonexistent channel",
    );
    expect(absent.rawMessage).toBe(linkNotFoundMessage(missingId));

    // Another kind's id: an agent's id is not a channel's.
    const agent = await createAgentFixture(org);
    const otherKind = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId: agent.metadata!.id }),
      Code.NotFound,
      "getAgentProfile on an agent's id",
    );
    expect(otherKind.rawMessage).toBe(linkNotFoundMessage(agent.metadata!.id));

    // Disabled channel: existing-but-disabled must be indistinguishable.
    const disabledChannel = await createWebFixture(org, agent.metadata!.slug, { enabled: false });
    const disabled = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId: disabledChannel.metadata!.id }),
      Code.NotFound,
      "getAgentProfile on a disabled web channel",
    );
    expect(disabled.rawMessage).toBe(linkNotFoundMessage(disabledChannel.metadata!.id));

    // The agent deleted: its delete takes the channel with it, and the link
    // must look exactly like no channel.
    const doomed = await createAgentFixture(org);
    const doomedChannel = await createWebFixture(org, doomed.metadata!.slug);
    await clients.agentCommand.delete({ value: doomed.metadata!.id });
    const afterDelete = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId: doomedChannel.metadata!.id }),
      Code.NotFound,
      "getAgentProfile after the referenced agent was deleted",
    );
    expect(afterDelete.rawMessage).toBe(linkNotFoundMessage(doomedChannel.metadata!.id));
  });

  it("[rpc:ChannelQueryController.getAgentProfile] [rpc:ChannelQueryController.getAgentProfileForMember] answer a Slack channel's id with the same NotFound — only a web channel has a profile", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const slack = await createChannelFixture(org, agent.metadata!.slug);
    const slackId = slack.metadata!.id;

    const anonymous = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId: slackId }),
      Code.NotFound,
      "getAgentProfile on a Slack channel's id",
    );
    expect(anonymous.rawMessage).toBe(linkNotFoundMessage(slackId));

    const member = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfileForMember({ value: slackId }),
      Code.NotFound,
      "getAgentProfileForMember on a Slack channel's id",
    );
    expect(member.rawMessage).toBe(linkNotFoundMessage(slackId));
  });

  it("[rpc:ChannelQueryController.getAgentProfile] [rpc:ChannelQueryController.getAgentProfileForMember] collapses an org-audience web channel to the SAME NotFound — members-only links teach anonymous visitors nothing", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createWebFixture(org, agent.metadata!.slug, {
      audience: ChannelAudience.org,
    });

    // The proto's audience contract: org-audience channels resolve only via
    // getAgentProfileForMember; the anonymous lane answers the uniform
    // refusal, byte-identical with a channel that never existed.
    const refused = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId: channel.metadata!.id }),
      Code.NotFound,
      "getAgentProfile on an org-audience web channel",
    );
    expect(refused.rawMessage).toBe(linkNotFoundMessage(channel.metadata!.id));

    // The member lane still resolves it — the refusal is audience, not state.
    const profile = await clients.channelQuery.getAgentProfileForMember({
      value: channel.metadata!.id,
    });
    expect(profile.slug).toBe(channel.metadata?.slug);
  });

  it("[rpc:ChannelQueryController.getAgentProfile] a stale token on an UNLOCKED link stays harmless", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createWebFixture(org, agent.metadata!.slug);

    // No live token → whatever the caller presented is ignored, so an old
    // bookmarked ?k= keeps working after an unlock-by-recreate.
    const profile = await clients.channelQuery.getAgentProfile({
      channelId: channel.metadata!.id,
      linkToken: "stale-token-from-an-old-bookmark",
    });
    expect(profile.slug).toBe(channel.metadata?.slug);
  });
});

describe("Channel conformance — the rotatable link token", () => {
  it("[rpc:ChannelCommandController.rotateLink] [rpc:ChannelQueryController.getAgentProfile] rotation kills the plain link, admits the tokened one, and refuses the wrong token uniformly", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createWebFixture(org, agent.metadata!.slug);
    const channelId = channel.metadata!.id;

    const rotated = await clients.channelCommand.rotateLink({
      resourceId: channelId,
    });
    const token = linkTokenOf(rotated);
    // 20 bytes of server entropy → 27 url-safe base64 characters.
    expect(token).toMatch(/^[A-Za-z0-9_-]{27}$/);

    // The plain link is dead — and the refusal is byte-identical with a
    // nonexistent channel's, so a killed link looks like one that never was.
    const plain = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfile({ channelId }),
      Code.NotFound,
      "plain link after rotation",
    );
    expect(plain.rawMessage).toBe(linkNotFoundMessage(channelId));

    // A wrong token refuses the same way — never a distinct "wrong token".
    const wrong = await expectGrpcCode(
      () =>
        clients.channelQuery.getAgentProfile({
          channelId,
          linkToken: "not-the-token-that-was-minted",
        }),
      Code.NotFound,
      "wrong token after rotation",
    );
    expect(wrong.rawMessage).toBe(linkNotFoundMessage(channelId));

    // The minted token resolves.
    const profile = await clients.channelQuery.getAgentProfile({
      channelId,
      linkToken: token,
    });
    expect(profile.slug).toBe(channel.metadata?.slug);

    // Rotating again kills the previous token immediately.
    await clients.channelCommand.rotateLink({ resourceId: channelId });
    await expectGrpcCode(
      () =>
        clients.channelQuery.getAgentProfile({
          channelId,
          linkToken: token,
        }),
      Code.NotFound,
      "previous token after a second rotation",
    );
  });

  it("[rpc:ChannelCommandController.rotateLink] rotateLink on an unknown channel returns NotFound", async () => {
    const err = await expectGrpcCode(
      () => clients.channelCommand.rotateLink({ resourceId: "ash_01confmissing" }),
      Code.NotFound,
      "rotateLink on a nonexistent channel",
    );
    expect(err.rawMessage).toBe(channelNotFoundMessage("ash_01confmissing"));
  });

  it("[rpc:ChannelCommandController.rotateLink] rotateLink refuses a Slack channel, which has no link (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const slack = await createChannelFixture(org, agent.metadata!.slug);

    const err = await expectGrpcCode(
      () => clients.channelCommand.rotateLink({ resourceId: slack.metadata!.id }),
      Code.FailedPrecondition,
      "rotateLink on a Slack channel",
    );
    expect(err.rawMessage).toBe(ROTATE_LINK_NOT_APPLICABLE);
    const read = await clients.channelQuery.get({ value: slack.metadata!.id });
    expect(read.status?.typeStatus.case, "the refusal wrote no link token").not.toBe("web");
  });
});

describe("Channel conformance — the member resolution lane", () => {
  it("[rpc:ChannelQueryController.getAgentProfileForMember] resolves enabled web channels by id and requires the id, like the anonymous lane", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createWebFixture(org, agent.metadata!.slug);

    const profile = await clients.channelQuery.getAgentProfileForMember({
      value: channel.metadata!.id,
    });
    expect(profile.slug).toBe(channel.metadata?.slug);

    await expectGrpcCode(
      () => clients.channelQuery.getAgentProfileForMember({ value: "" }),
      Code.InvalidArgument,
      "member lookup without an id",
    );
    await expectGrpcCode(
      () => clients.channelQuery.getAgentProfileForMember({ value: `chn_${"x".repeat(125)}` }),
      Code.InvalidArgument,
      "member lookup with a 129-character id",
    );
    const missingId = "chn_01confnevercreated";
    const missing = await expectGrpcCode(
      () => clients.channelQuery.getAgentProfileForMember({ value: missingId }),
      Code.NotFound,
      "member lookup of a nonexistent channel",
    );
    expect(missing.rawMessage).toBe(linkNotFoundMessage(missingId));
  });

  it("[rpc:ChannelQueryController.getAgentProfileForMember] resolves for a member of the channel's organization and answers a non-member the missing channel's NotFound", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const tenancy = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(tenancy));
    const agent = await createAgentFixture(tenancy.org, lane.clients);
    const channel = await createWebFixture(
      tenancy.org,
      agent.metadata!.slug,
      { audience: ChannelAudience.org },
      lane.clients,
    );
    const channelId = channel.metadata!.id;

    const member = await lane.provisionMember(tenancy);
    const resolved = await member.channelQuery.getAgentProfileForMember({ value: channelId });
    expect(resolved.org, "the profile names the channel's organization").toBe(tenancy.org);

    // The link names only the channel, so membership is asked of the
    // channel's organization after it loads; a non-member hears exactly what
    // a nonexistent channel answers.
    const outsider = await lane.provisionIdentity();
    const refused = await expectGrpcCode(
      () => outsider.channelQuery.getAgentProfileForMember({ value: channelId }),
      Code.NotFound,
      "member lookup by someone outside the channel's organization",
    );
    expect(refused.rawMessage).toBe(linkNotFoundMessage(channelId));
  });

  it("[rpc:ChannelQueryController.getAgentProfileForMember] refuses a token-locked PUBLIC web channel on the tokenless member path, but not an org-audience one", async () => {
    const { org } = await target.provisionTenancy();

    // Public-audience + rotated: this tokenless path must not reveal a
    // killed link's profile.
    const publicAgent = await createAgentFixture(org);
    const publicChannel = await createWebFixture(org, publicAgent.metadata!.slug);
    await clients.channelCommand.rotateLink({ resourceId: publicChannel.metadata!.id });
    const refused = await expectGrpcCode(
      () =>
        clients.channelQuery.getAgentProfileForMember({
          value: publicChannel.metadata!.id,
        }),
      Code.NotFound,
      "member path on a token-locked public web channel",
    );
    expect(refused.rawMessage).toBe(linkNotFoundMessage(publicChannel.metadata!.id));

    // Org-audience + rotated: the gate is membership, not the link token —
    // the member path still resolves.
    const orgAgent = await createAgentFixture(org);
    const orgChannel = await createWebFixture(org, orgAgent.metadata!.slug, {
      audience: ChannelAudience.org,
    });
    await clients.channelCommand.rotateLink({ resourceId: orgChannel.metadata!.id });
    const resolved = await clients.channelQuery.getAgentProfileForMember({
      value: orgChannel.metadata!.id,
    });
    expect(resolved.slug).toBe(orgChannel.metadata?.slug);
  });
});

describe("Channel conformance — the guest path by channel id", () => {
  it("[rpc:TokenService.mintGuestToken] mints a guest token naming the web channel and its organization, or pins open source's refusal", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const channel = await createWebFixture(org, agent.metadata!.slug);
    const channelId = channel.metadata!.id;

    if (!target.capabilities.guestMinting) {
      const err = await expectGrpcCode(
        () => clients.token.mintGuestToken({ channelId }),
        Code.Unimplemented,
        "mintGuestToken on an edition that mints no guest tokens",
      );
      expect(err.rawMessage).toBe(GUEST_MINT_UNIMPLEMENTED);
      return;
    }

    const minted = await clients.token.mintGuestToken({ channelId });
    expect(minted.tokenType).toBe("Bearer");
    expect(minted.guestCookieId, "a fresh visitor gets a server-issued id").not.toBe("");
    const claims = jwtPayload(minted.accessToken);
    expect(claims.channel_id, "the token names the channel the link named").toBe(channelId);
    expect(claims.org, "and the channel's organization, which the link never named").toBe(org);
  });

  it("[rpc:TokenService.mintGuestToken] refuses an unknown channel id with the uniform NotFound", async (ctx) => {
    if (!target.capabilities.guestMinting) {
      return ctx.skip("guestMinting is false: the open-source refusal is pinned by the arm above");
    }
    const missingId = "chn_01confnevercreated";
    const err = await expectGrpcCode(
      () => clients.token.mintGuestToken({ channelId: missingId }),
      Code.NotFound,
      "mintGuestToken for a nonexistent channel",
    );
    expect(err.rawMessage).toBe(linkNotFoundMessage(missingId));
  });
});

describe("Channel conformance — the same-organization invariant", () => {
  it("[rpc:ChannelCommandController.create] refuses an agent_ref naming another organization with one sentence, whether the agent exists or not", async () => {
    const { org: originOrg } = await target.provisionTenancy();
    const { org: channelOrg } = await target.provisionTenancy();
    const existing = await createAgentFixture(originOrg);

    const copy =
      "spec.agent_ref.org must match metadata.org — a channel must live in " +
      `the referenced agent's organization (${originOrg})`;

    const existingErr = await expectGrpcCode(
      () =>
        clients.channelCommand.create(
          makeWebChannel(channelOrg, existing.metadata!.slug, { agentRefOrg: originOrg }),
        ),
      Code.FailedPrecondition,
      "a channel of another organization's existing agent",
    );
    expect(existingErr.rawMessage).toBe(copy);

    // The same answer for a slug that organization does not hold: the
    // create path is not an existence probe.
    const ghostErr = await expectGrpcCode(
      () =>
        clients.channelCommand.create(
          makeWebChannel(channelOrg, "no-such-agent", { agentRefOrg: originOrg }),
        ),
      Code.FailedPrecondition,
      "a channel of another organization's missing agent",
    );
    expect(ghostErr.rawMessage).toBe(copy);
  });
});
