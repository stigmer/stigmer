// AgentShare conformance — CRUD, the rotatable link token, the resolution
// lanes' uniform-refusal contract, the guest path, and the same-organization
// invariant on agent_ref (Class A).
// Domain: conformance suites.
//
// An AgentShare is the hosted-chat channel for one agent. A hosted chat link
// names it by its id alone (`/chat/<share id>`), so no rename of its
// organization breaks the link and no later holder of the organization's
// name can capture it. These surfaces make the domain distinct, all
// asserted here:
//
//   - The CANONICAL-SHARE default: creating a share with neither name nor
//     slug adopts the agent's own slug (its name in the organization), and
//     create stamps status.agent_id — the server-owned rebind pin that
//     keeps a stale share from attaching to whatever agent later claims
//     the slug.
//   - The ANONYMOUS resolution lane (getSharedProfile, by share id): every
//     miss — share absent, an id of another kind, share disabled, locked
//     link with a wrong or missing token, dangling or rebound agent —
//     answers ONE byte-identical NotFound that deliberately says "Agent" and
//     echoes only the id the caller sent, so a public link leaks nothing
//     about which internal state produced the refusal (the constant-time
//     token compare behind it is unit-level; the wire contract is the
//     uniformity).
//   - The MEMBER lane (getSharedProfileForMember, by share id): it asks
//     membership of the loaded share's organization, and a non-member hears
//     the same NotFound as a missing share.
//   - The GUEST path (mintGuestToken, by share id): where an edition mints,
//     the token names the share and its organization; open source pins the
//     UNIMPLEMENTED edition sentence.
//   - The ROTATABLE link token: rotateShareLink is status.share_link_token's
//     sole writer; after rotation the plain URL dies, the tokened URL
//     resolves, and a stale token on an UNLOCKED link stays harmless.
//   - The SAME-ORGANIZATION invariant: a share's agent lives in the share's
//     own organization. An agent_ref naming another organization is refused
//     with one FailedPrecondition sentence before any lookup, whether that
//     organization's slug exists or not, so the share lane is never an
//     existence probe; another organization's agent is shared by installing
//     the plugin that carries it and sharing the installed copy.
//   - The AUDIENCE default: an omitted audience means the organization's
//     members. The server writes it out as org on create, update and
//     apply, so the echo says what it means; anything a public link alone
//     may carry (vaults, run options) needs public said out loud, and a
//     manifest that drops the audience narrows the share, never widens it.
//
// The agentshare boot migration is asserted separately, never here.
import { Code } from "@connectrpc/connect";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { makeAgentShare } from "../support/agentshares";
import { myVaultTarget, setSecretsInput } from "../support/vaults";
import { uniqueName } from "../support/naming";
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

async function createAgentFixture(org: string, using: ConformanceClients = clients) {
  const agent = await using.agentCommand.create(
    makeAgent({ org, name: uniqueName("shared-agent") }),
  );
  fixtures.defer(() => using.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

async function createShareFixture(
  org: string,
  agentSlug: string,
  options: Parameters<typeof makeAgentShare>[2] = {},
  using: ConformanceClients = clients,
) {
  const share = await using.agentShareCommand.create(makeAgentShare(org, agentSlug, options));
  fixtures.defer(() => using.agentShareCommand.delete({ value: share.metadata!.id }));
  return share;
}

// The uniform public refusal — deliberately "Agent", never "AgentShare":
// the visitor asked for an agent's chat page; the share resource is an
// internal modeling detail a public error must not teach. It echoes the
// share id the caller sent, which the caller already holds.
function sharedNotFoundMessage(shareId: string): string {
  return `Agent not found: ${shareId}`;
}

// The open-source edition's answer to a guest mint (no unit composes the
// capability).
const GUEST_MINT_UNIMPLEMENTED =
  "PlatformClientTokenController.mintGuestToken is not implemented: guest tokens for shared agents are served by the Cloud edition";

// A JWT's payload, decoded without verifying: the arm reads which share
// and organization the server named, not whether it signed them.
function jwtPayload(token: string): Record<string, unknown> {
  const [, payload = ""] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("AgentShare conformance — CRUD & identity", () => {
  it("[rpc:AgentShareCommandController.create] the canonical share adopts the agent's slug and stamps the rebind pin", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createShareFixture(org, agent.metadata!.slug);

    expect(created.metadata?.id).toMatch(/^ash_/);
    expect(created.metadata?.org).toBe(org);
    // No name, no slug in the create → the share lives at the agent's own
    // hosted URL.
    expect(created.metadata?.slug).toBe(agent.metadata?.slug);
    // The system-managed rebind pin: the immutable ID of the agent the ref
    // resolved to at creation, surviving the create pipeline's status wipe.
    expect(created.status?.agentId).toBe(agent.metadata?.id);
    // The relative agent_ref was normalized to an absolute one.
    expect(created.spec?.agentRef?.org).toBe(org);
  });

  it("[rpc:AgentShareCommandController.create] a named share gets its own slug beside the canonical one", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const named = await createShareFixture(org, agent.metadata!.slug, {
      name: uniqueName("campaign-link"),
    });

    expect(named.metadata?.slug).not.toBe(agent.metadata?.slug);
    expect(named.metadata?.slug).toContain("campaign-link");
  });

  it("[rpc:AgentShareQueryController.get] [rpc:AgentShareQueryController.getByReference] [rpc:AgentShareQueryController.getByAgent] [rpc:AgentShareQueryController.list] get, getByReference, getByAgent, and list resolve the share", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await createShareFixture(org, agent.metadata!.slug);

    const fetched = await clients.agentShareQuery.get({ value: created.metadata!.id });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);

    const byRef = await clients.agentShareQuery.getByReference({
      org,
      slug: created.metadata!.slug,
    });
    expect(byRef.metadata?.id).toBe(created.metadata?.id);

    const byAgent = await clients.agentShareQuery.getByAgent({ agentId: agent.metadata!.id });
    expect(byAgent.items.some((s) => s.metadata?.id === created.metadata?.id)).toBe(true);

    const listed = await clients.agentShareQuery.list({ org });
    expect(listed.items.some((s) => s.metadata?.id === created.metadata?.id)).toBe(true);
  });

  it("[rpc:AgentShareCommandController.update] update flips mutable fields but refuses re-pointing agent_ref (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const otherAgent = await createAgentFixture(org);
    const created = await createShareFixture(org, agent.metadata!.slug, {
      name: uniqueName("share"),
    });

    const updated = await clients.agentShareCommand.update({
      ...makeAgentShare(org, agent.metadata!.slug, {
        name: created.metadata!.name,
        enabled: false,
      }),
      metadata: created.metadata,
    });
    expect(updated.spec?.enabled).toBe(false);
    // The rebind pin is status and survives updates wholesale.
    expect(updated.status?.agentId).toBe(agent.metadata?.id);

    const err = await expectGrpcCode(
      () =>
        clients.agentShareCommand.update({
          ...makeAgentShare(org, otherAgent.metadata!.slug, { name: created.metadata!.name }),
          metadata: created.metadata,
        }),
      Code.FailedPrecondition,
      "update re-pointing the share at a different agent",
    );
    expect(err.rawMessage).toContain("spec.agent_ref is immutable");
  });

  it("[rpc:AgentShareCommandController.apply] apply creates on first call and updates in place on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const name = uniqueName("share");

    const first = await clients.agentShareCommand.apply(makeAgentShare(org, agent.metadata!.slug, { name }));
    fixtures.defer(() => clients.agentShareCommand.delete({ value: first.metadata!.id }));
    expect(first.spec?.enabled).toBe(true);

    // The same agent_ref: re-pointing a share is refused, which the update arm pins.
    const second = await clients.agentShareCommand.apply(
      makeAgentShare(org, agent.metadata!.slug, { name, enabled: false }),
    );

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.enabled).toBe(false);
    // The rebind pin is status and survives the re-apply.
    expect(second.status?.agentId).toBe(agent.metadata?.id);
  });

  it("[rpc:AgentShareCommandController.delete] delete removes the share", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const created = await clients.agentShareCommand.create(
      makeAgentShare(org, agent.metadata!.slug),
    );

    await clients.agentShareCommand.delete({ value: created.metadata!.id });

    await expectGrpcCode(
      () => clients.agentShareQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
  });
});

describe("AgentShare conformance — create validation", () => {
  it("[rpc:AgentShareCommandController.create] requires metadata.org (InvalidArgument)", async () => {
    const err = await expectGrpcCode(
      () => clients.agentShareCommand.create(makeAgentShare("", "some-agent")),
      Code.InvalidArgument,
      "create without metadata.org",
    );
    expect(err.rawMessage).toBe("metadata.org is required for an agent share");
  });

  it("[rpc:AgentShareCommandController.create] rejects an unknown agent with the same NotFound a direct lookup produces", async () => {
    const { org } = await target.provisionTenancy();
    const err = await expectGrpcCode(
      () => clients.agentShareCommand.create(makeAgentShare(org, "no-such-agent")),
      Code.NotFound,
      "create referencing a nonexistent agent",
    );
    expect(err.rawMessage).toBe("Agent not found: no-such-agent");
  });

  it("[rpc:AgentShareCommandController.create] rejects vaults on an org-audience share (InvalidArgument — the CEL rule)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const share = makeAgentShare(org, agent.metadata!.slug, {
      audience: AgentShareAudience.org,
      vaults: ["some-vault"],
    });

    await expectGrpcCode(
      () => clients.agentShareCommand.create(share),
      Code.InvalidArgument,
      "org-audience share carrying vaults",
    );
  });

  it("[rpc:AgentShareCommandController.create] an omitted audience is stored and echoed as org, and the anonymous lane refuses it", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const share = await createShareFixture(org, agent.metadata!.slug, {
      audience: AgentShareAudience.unspecified,
    });
    expect(share.spec?.audience).toBe(AgentShareAudience.org);

    const refused = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId: share.metadata!.id }),
      Code.NotFound,
      "getSharedProfile on a share whose audience was omitted",
    );
    expect(refused.rawMessage).toBe(sharedNotFoundMessage(share.metadata!.id));
  });

  it("[rpc:AgentShareCommandController.create] rejects vaults on a share whose audience was omitted (InvalidArgument — public must be said)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const share = makeAgentShare(org, agent.metadata!.slug, {
      audience: AgentShareAudience.unspecified,
      vaults: ["some-vault"],
    });

    const err = await expectGrpcCode(
      () => clients.agentShareCommand.create(share),
      Code.InvalidArgument,
      "omitted-audience share carrying vaults",
    );
    expect(err.rawMessage).toContain("vaults can only be set on public-audience shares");
  });

  it("[rpc:AgentShareCommandController.apply] a manifest that drops the audience narrows a public share to org, never the reverse", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const name = uniqueName("share");

    const first = await clients.agentShareCommand.apply(
      makeAgentShare(org, agent.metadata!.slug, { name, audience: AgentShareAudience.public }),
    );
    fixtures.defer(() => clients.agentShareCommand.delete({ value: first.metadata!.id }));
    expect(first.spec?.audience).toBe(AgentShareAudience.public);

    const second = await clients.agentShareCommand.apply(
      makeAgentShare(org, agent.metadata!.slug, { name, audience: AgentShareAudience.unspecified }),
    );
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.spec?.audience).toBe(AgentShareAudience.org);
  });

  it("[rpc:AgentShareCommandController.create] a share link cannot carry anyone's own My vault (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const mine = await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { SHARE_KEY: "mine" }));
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));

    const share = makeAgentShare(org, agent.metadata!.slug, { vaults: [mine.metadata!.slug] });

    const err = await expectGrpcCode(
      () => clients.agentShareCommand.create(share),
      Code.FailedPrecondition,
      "a public share carrying the caller's My vault",
    );
    expect(err.rawMessage).toContain("a My vault cannot be attached to a share link");
  });
});

describe("AgentShare conformance — the anonymous resolution lane", () => {
  it("[rpc:AgentShareQueryController.getSharedProfile] resolves an enabled share by its id to the trimmed profile (share identity + agent display)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const share = await createShareFixture(org, agent.metadata!.slug);

    const profile = await clients.agentShareQuery.getSharedProfile({
      shareId: share.metadata!.id,
    });

    // The share's organization, slug and agent reference from the SHARE (the
    // hosted page starts its sessions on exactly that reference); display
    // fields from the AGENT — never the full Agent resource (its spec
    // carries the system prompt).
    expect(profile.org).toBe(org);
    expect(profile.slug).toBe(share.metadata?.slug);
    expect(profile.name).toBe(agent.metadata?.name);
    expect(profile.agentRef?.slug).toBe(agent.metadata?.slug);
    expect(profile.agentRef?.org).toBe(share.spec?.agentRef?.org);
  });

  it("[rpc:AgentShareQueryController.getSharedProfile] [rpc:PlatformClientTokenController.mintGuestToken] require a share_id of at most 128 characters (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId: "" }),
      Code.InvalidArgument,
      "getSharedProfile without share_id",
    );
    // The bound is checked before anything is read, so an oversized id is
    // never echoed in the uniform refusal; both editions validate the mint's
    // request before its capability is reached.
    const oversized = `ash_${"x".repeat(125)}`;
    await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId: oversized }),
      Code.InvalidArgument,
      "getSharedProfile with a 129-character share_id",
    );
    await expectGrpcCode(
      () => clients.platformClientToken.mintGuestToken({ shareId: oversized }),
      Code.InvalidArgument,
      "mintGuestToken with a 129-character share_id",
    );
  });

  it("[rpc:AgentShareQueryController.getSharedProfile] answers ONE byte-identical NotFound for absent, other-kind, disabled, and dangling shares", async () => {
    const { org } = await target.provisionTenancy();

    // Absent share.
    const missingId = "ash_01confnevercreated";
    const absent = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId: missingId }),
      Code.NotFound,
      "getSharedProfile on a nonexistent share",
    );
    expect(absent.rawMessage).toBe(sharedNotFoundMessage(missingId));

    // Another kind's id: an agent's id is not a share's.
    const agent = await createAgentFixture(org);
    const otherKind = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId: agent.metadata!.id }),
      Code.NotFound,
      "getSharedProfile on an agent's id",
    );
    expect(otherKind.rawMessage).toBe(sharedNotFoundMessage(agent.metadata!.id));

    // Disabled share: existing-but-disabled must be indistinguishable.
    const disabledShare = await createShareFixture(org, agent.metadata!.slug, { enabled: false });
    const disabled = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId: disabledShare.metadata!.id }),
      Code.NotFound,
      "getSharedProfile on a disabled share",
    );
    expect(disabled.rawMessage).toBe(sharedNotFoundMessage(disabledShare.metadata!.id));

    // Dangling agent_ref: a channel to a deleted agent must look exactly
    // like no channel. (Deleting the agent directly; the share outlives it.)
    const dangling = await createAgentFixture(org);
    const danglingShare = await createShareFixture(org, dangling.metadata!.slug);
    await clients.agentCommand.delete({ value: dangling.metadata!.id });
    const afterDelete = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId: danglingShare.metadata!.id }),
      Code.NotFound,
      "getSharedProfile after the referenced agent was deleted",
    );
    expect(afterDelete.rawMessage).toBe(sharedNotFoundMessage(danglingShare.metadata!.id));
  });

  it("[rpc:AgentShareQueryController.getSharedProfile] [rpc:AgentShareQueryController.getSharedProfileForMember] collapses an org-audience share to the SAME NotFound — members-only links teach anonymous visitors nothing", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const share = await createShareFixture(org, agent.metadata!.slug, {
      audience: AgentShareAudience.org,
    });

    // The proto's audience contract: org-audience shares resolve only via
    // getSharedProfileForMember; the anonymous lane answers the uniform
    // refusal, byte-identical with a share that never existed.
    const refused = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId: share.metadata!.id }),
      Code.NotFound,
      "getSharedProfile on an org-audience share",
    );
    expect(refused.rawMessage).toBe(sharedNotFoundMessage(share.metadata!.id));

    // The member lane still resolves it — the refusal is audience, not state.
    const profile = await clients.agentShareQuery.getSharedProfileForMember({
      value: share.metadata!.id,
    });
    expect(profile.slug).toBe(share.metadata?.slug);
  });

  it("[rpc:AgentShareQueryController.getSharedProfile] a stale token on an UNLOCKED link stays harmless", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const share = await createShareFixture(org, agent.metadata!.slug);

    // No live token → whatever the caller presented is ignored, so an old
    // bookmarked ?k= keeps working after an unlock-by-recreate.
    const profile = await clients.agentShareQuery.getSharedProfile({
      shareId: share.metadata!.id,
      linkToken: "stale-token-from-an-old-bookmark",
    });
    expect(profile.slug).toBe(share.metadata?.slug);
  });
});

describe("AgentShare conformance — the rotatable link token", () => {
  it("[rpc:AgentShareCommandController.rotateShareLink] [rpc:AgentShareQueryController.getSharedProfile] rotation kills the plain link, admits the tokened one, and refuses the wrong token uniformly", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const share = await createShareFixture(org, agent.metadata!.slug);
    const shareId = share.metadata!.id;

    const rotated = await clients.agentShareCommand.rotateShareLink({
      resourceId: shareId,
    });
    const token = rotated.status?.shareLinkToken ?? "";
    // 20 bytes of server entropy → 27 url-safe base64 characters.
    expect(token).toMatch(/^[A-Za-z0-9_-]{27}$/);

    // The plain link is dead — and the refusal is byte-identical with a
    // nonexistent share's, so a killed link looks like one that never was.
    const plain = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId }),
      Code.NotFound,
      "plain link after rotation",
    );
    expect(plain.rawMessage).toBe(sharedNotFoundMessage(shareId));

    // A wrong token refuses the same way — never a distinct "wrong token".
    const wrong = await expectGrpcCode(
      () =>
        clients.agentShareQuery.getSharedProfile({
          shareId,
          linkToken: "not-the-token-that-was-minted",
        }),
      Code.NotFound,
      "wrong token after rotation",
    );
    expect(wrong.rawMessage).toBe(sharedNotFoundMessage(shareId));

    // The minted token resolves.
    const profile = await clients.agentShareQuery.getSharedProfile({
      shareId,
      linkToken: token,
    });
    expect(profile.slug).toBe(share.metadata?.slug);

    // Rotating again kills the previous token immediately.
    await clients.agentShareCommand.rotateShareLink({ resourceId: shareId });
    await expectGrpcCode(
      () =>
        clients.agentShareQuery.getSharedProfile({
          shareId,
          linkToken: token,
        }),
      Code.NotFound,
      "previous token after a second rotation",
    );
  });

  it("[rpc:AgentShareCommandController.rotateShareLink] rotateShareLink on an unknown share returns NotFound", async () => {
    const err = await expectGrpcCode(
      () => clients.agentShareCommand.rotateShareLink({ resourceId: "ash_01confmissing" }),
      Code.NotFound,
      "rotateShareLink on a nonexistent share",
    );
    expect(err.rawMessage).toBe("AgentShare not found: ash_01confmissing");
  });
});

describe("AgentShare conformance — the member resolution lane", () => {
  it("[rpc:AgentShareQueryController.getSharedProfileForMember] resolves enabled shares by id and requires the id, like the anonymous lane", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const share = await createShareFixture(org, agent.metadata!.slug);

    const profile = await clients.agentShareQuery.getSharedProfileForMember({
      value: share.metadata!.id,
    });
    expect(profile.slug).toBe(share.metadata?.slug);

    await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfileForMember({ value: "" }),
      Code.InvalidArgument,
      "member lookup without an id",
    );
    await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfileForMember({ value: `ash_${"x".repeat(125)}` }),
      Code.InvalidArgument,
      "member lookup with a 129-character id",
    );
    const missingId = "ash_01confnevercreated";
    const missing = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfileForMember({ value: missingId }),
      Code.NotFound,
      "member lookup of a nonexistent share",
    );
    expect(missing.rawMessage).toBe(sharedNotFoundMessage(missingId));
  });

  it("[rpc:AgentShareQueryController.getSharedProfileForMember] resolves for a member of the share's organization and answers a non-member the missing share's NotFound", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const tenancy = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(tenancy));
    const agent = await createAgentFixture(tenancy.org, lane.clients);
    const share = await createShareFixture(
      tenancy.org,
      agent.metadata!.slug,
      { audience: AgentShareAudience.org },
      lane.clients,
    );
    const shareId = share.metadata!.id;

    const member = await lane.provisionMember(tenancy);
    const resolved = await member.agentShareQuery.getSharedProfileForMember({ value: shareId });
    expect(resolved.org, "the profile names the share's organization").toBe(tenancy.org);

    // The link names only the share, so membership is asked of the share's
    // organization after it loads; a non-member hears exactly what a
    // nonexistent share answers.
    const outsider = await lane.provisionIdentity();
    const refused = await expectGrpcCode(
      () => outsider.agentShareQuery.getSharedProfileForMember({ value: shareId }),
      Code.NotFound,
      "member lookup by someone outside the share's organization",
    );
    expect(refused.rawMessage).toBe(sharedNotFoundMessage(shareId));
  });

  it("[rpc:AgentShareQueryController.getSharedProfileForMember] refuses a token-locked PUBLIC share on the tokenless member path, but not an org-audience one", async () => {
    const { org } = await target.provisionTenancy();

    // Public-audience + rotated: this tokenless path must not reveal a
    // killed link's profile.
    const publicAgent = await createAgentFixture(org);
    const publicShare = await createShareFixture(org, publicAgent.metadata!.slug);
    await clients.agentShareCommand.rotateShareLink({ resourceId: publicShare.metadata!.id });
    const refused = await expectGrpcCode(
      () =>
        clients.agentShareQuery.getSharedProfileForMember({
          value: publicShare.metadata!.id,
        }),
      Code.NotFound,
      "member path on a token-locked public share",
    );
    expect(refused.rawMessage).toBe(sharedNotFoundMessage(publicShare.metadata!.id));

    // Org-audience + rotated: the gate is membership, not the link token —
    // the member path still resolves.
    const orgAgent = await createAgentFixture(org);
    const orgShare = await createShareFixture(org, orgAgent.metadata!.slug, {
      audience: AgentShareAudience.org,
    });
    await clients.agentShareCommand.rotateShareLink({ resourceId: orgShare.metadata!.id });
    const resolved = await clients.agentShareQuery.getSharedProfileForMember({
      value: orgShare.metadata!.id,
    });
    expect(resolved.slug).toBe(orgShare.metadata?.slug);
  });
});

describe("AgentShare conformance — the guest path by share id", () => {
  it("[rpc:PlatformClientTokenController.mintGuestToken] mints a guest token naming the share and its organization, or pins open source's refusal", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const share = await createShareFixture(org, agent.metadata!.slug);
    const shareId = share.metadata!.id;

    if (!target.capabilities.guestMinting) {
      const err = await expectGrpcCode(
        () => clients.platformClientToken.mintGuestToken({ shareId }),
        Code.Unimplemented,
        "mintGuestToken on an edition that mints no guest tokens",
      );
      expect(err.rawMessage).toBe(GUEST_MINT_UNIMPLEMENTED);
      return;
    }

    const minted = await clients.platformClientToken.mintGuestToken({ shareId });
    expect(minted.tokenType).toBe("Bearer");
    expect(minted.guestCookieId, "a fresh visitor gets a server-issued id").not.toBe("");
    const claims = jwtPayload(minted.accessToken);
    expect(claims.share_id, "the token names the share the link named").toBe(shareId);
    expect(claims.org, "and the share's organization, which the link never named").toBe(org);
  });

  it("[rpc:PlatformClientTokenController.mintGuestToken] refuses an unknown share id with the uniform NotFound", async (ctx) => {
    if (!target.capabilities.guestMinting) {
      return ctx.skip("guestMinting is false: the open-source refusal is pinned by the arm above");
    }
    const missingId = "ash_01confnevercreated";
    const err = await expectGrpcCode(
      () => clients.platformClientToken.mintGuestToken({ shareId: missingId }),
      Code.NotFound,
      "mintGuestToken for a nonexistent share",
    );
    expect(err.rawMessage).toBe(sharedNotFoundMessage(missingId));
  });
});

describe("AgentShare conformance — the same-organization invariant", () => {
  it("[rpc:AgentShareCommandController.create] refuses an agent_ref naming another organization with one sentence, whether the agent exists or not", async () => {
    const { org: originOrg } = await target.provisionTenancy();
    const { org: sharingOrg } = await target.provisionTenancy();
    const existing = await createAgentFixture(originOrg);

    const copy =
      "spec.agent_ref.org must match metadata.org — a share must live in " +
      `the referenced agent's organization (${originOrg})`;

    const existingErr = await expectGrpcCode(
      () =>
        clients.agentShareCommand.create(
          makeAgentShare(sharingOrg, existing.metadata!.slug, { agentRefOrg: originOrg }),
        ),
      Code.FailedPrecondition,
      "share of another organization's existing agent",
    );
    expect(existingErr.rawMessage).toBe(copy);

    // The same answer for a slug that organization does not hold: the
    // create path is not an existence probe.
    const ghostErr = await expectGrpcCode(
      () =>
        clients.agentShareCommand.create(
          makeAgentShare(sharingOrg, "no-such-agent", { agentRefOrg: originOrg }),
        ),
      Code.FailedPrecondition,
      "share of another organization's missing agent",
    );
    expect(ghostErr.rawMessage).toBe(copy);
  });
});
