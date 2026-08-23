// AgentShare conformance — CRUD, the rotatable link token, the anonymous
// resolution lane's uniform-refusal contract, and the cross-org
// public-dependency rules (Class A).
// Domain: conformance suites.
//
// An AgentShare is the hosted-chat channel for one agent. Four surfaces
// make the domain distinct, all asserted here:
//
//   - The CANONICAL-SHARE default: creating a share with neither name nor
//     slug adopts the agent's own slug (the /chat/<org>/<agent-slug> URL),
//     and create stamps status.agent_id — the server-owned rebind pin that
//     keeps a stale share from attaching to whatever agent later claims
//     the slug.
//   - The ANONYMOUS resolution lane (getSharedProfile): every miss — share
//     absent, share disabled, locked link with a wrong or missing token,
//     dangling or rebound agent — answers ONE byte-identical NotFound that
//     deliberately says "Agent", so a public URL leaks nothing about which
//     internal state produced the refusal (the constant-time token compare
//     behind it is unit-level; the wire contract is the uniformity).
//   - The ROTATABLE link token: rotateShareLink is status.share_link_token's
//     sole writer; after rotation the plain URL dies, the tokened URL
//     resolves, and a stale token on an UNLOCKED link stays harmless.
//   - The CROSS-ORG contract (decision 013): sharing another org's agent
//     requires the agent public, the audience public, and every declared
//     dependency public — with the blocker-naming refusal pinned. Gated on
//     clientPublicVisibilityWrites (the happy paths need a public agent,
//     which only the local single-tenant targets let an ordinary caller
//     mint); the same-org surface runs everywhere.
//
// OD-1 exclusion (parent blueprint): the agentshare boot migration is
// asserted separately, never here.
import { Code } from "@connectrpc/connect";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { makeAgentShare } from "../support/agentshares";
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

async function createAgentFixture(org: string, opts: { public?: boolean } = {}) {
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("shared-agent") }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  if (opts.public === true) {
    await clients.agentCommand.updateVisibility({
      resourceId: agent.metadata!.id,
      visibility: ApiResourceVisibility.visibility_public,
    });
  }
  return agent;
}

async function createShareFixture(
  org: string,
  agentSlug: string,
  options: Parameters<typeof makeAgentShare>[2] = {},
) {
  const share = await clients.agentShareCommand.create(makeAgentShare(org, agentSlug, options));
  fixtures.defer(() => clients.agentShareCommand.delete({ value: share.metadata!.id }));
  return share;
}

// The uniform public refusal — deliberately "Agent", never "AgentShare":
// the visitor asked for an agent's chat page; the share resource is an
// internal modeling detail a public error must not teach.
function sharedNotFoundMessage(slug: string): string {
  return `Agent not found: ${slug}`;
}

describe("AgentShare conformance — CRUD & identity", () => {
  it("the canonical share adopts the agent's slug and stamps the rebind pin", async () => {
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

  it("a named share gets its own slug beside the canonical one", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const named = await createShareFixture(org, agent.metadata!.slug, {
      name: uniqueName("campaign-link"),
    });

    expect(named.metadata?.slug).not.toBe(agent.metadata?.slug);
    expect(named.metadata?.slug).toContain("campaign-link");
  });

  it("get, getByReference, getByAgent, and list resolve the share", async () => {
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

  it("update flips mutable fields but refuses re-pointing agent_ref (FailedPrecondition)", async () => {
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

  it("delete removes the share", async () => {
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
  it("requires metadata.org (InvalidArgument)", async () => {
    const err = await expectGrpcCode(
      () => clients.agentShareCommand.create(makeAgentShare("", "some-agent")),
      Code.InvalidArgument,
      "create without metadata.org",
    );
    expect(err.rawMessage).toBe("metadata.org is required for an agent share");
  });

  it("rejects an unknown agent with the same NotFound a direct lookup produces", async () => {
    const { org } = await target.provisionTenancy();
    const err = await expectGrpcCode(
      () => clients.agentShareCommand.create(makeAgentShare(org, "no-such-agent")),
      Code.NotFound,
      "create referencing a nonexistent agent",
    );
    expect(err.rawMessage).toBe("Agent not found: no-such-agent");
  });

  it("rejects environment_refs on an org-audience share (InvalidArgument — the CEL rule)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);

    const share = makeAgentShare(org, agent.metadata!.slug, {
      audience: AgentShareAudience.org,
    });
    (share.spec as { environmentRefs?: unknown[] }).environmentRefs = [
      { slug: "some-env", kind: 53 },
    ];

    await expectGrpcCode(
      () => clients.agentShareCommand.create(share),
      Code.InvalidArgument,
      "org-audience share carrying environment_refs",
    );
  });
});

describe("AgentShare conformance — the anonymous resolution lane", () => {
  it("resolves an enabled share to the trimmed profile (share identity + agent display)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    await createShareFixture(org, agent.metadata!.slug);

    const profile = await clients.agentShareQuery.getSharedProfile({
      org,
      slug: agent.metadata!.slug,
    });

    // URL identity from the SHARE; display fields from the AGENT — never
    // the full Agent resource (its spec carries the system prompt).
    expect(profile.org).toBe(org);
    expect(profile.slug).toBe(agent.metadata?.slug);
    expect(profile.name).toBe(agent.metadata?.name);
    expect(profile.defaultInstanceId).toBe(agent.status?.defaultInstanceId);
  });

  it("requires org (InvalidArgument — cross-org slug matching would enable enumeration)", async () => {
    const err = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ org: "", slug: "anything" }),
      Code.InvalidArgument,
      "getSharedProfile without org",
    );
    expect(err.rawMessage).toBe("org is required for shared agent lookup");
  });

  it("answers ONE byte-identical NotFound for absent, disabled, and dangling shares", async () => {
    const { org } = await target.provisionTenancy();
    const slug = uniqueName("uniform");

    // Absent share.
    const absent = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ org, slug }),
      Code.NotFound,
      "getSharedProfile on a nonexistent share",
    );
    expect(absent.rawMessage).toBe(sharedNotFoundMessage(slug));

    // Disabled share: existing-but-disabled must be indistinguishable.
    const agent = await createAgentFixture(org);
    await createShareFixture(org, agent.metadata!.slug, { enabled: false });
    const disabled = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ org, slug: agent.metadata!.slug }),
      Code.NotFound,
      "getSharedProfile on a disabled share",
    );
    expect(disabled.rawMessage).toBe(sharedNotFoundMessage(agent.metadata!.slug));

    // Dangling agent_ref: a channel to a deleted agent must look exactly
    // like no channel. (Deleting the agent directly; the share outlives it.)
    const dangling = await createAgentFixture(org);
    await createShareFixture(org, dangling.metadata!.slug);
    await clients.agentCommand.delete({ value: dangling.metadata!.id });
    const afterDelete = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ org, slug: dangling.metadata!.slug }),
      Code.NotFound,
      "getSharedProfile after the referenced agent was deleted",
    );
    expect(afterDelete.rawMessage).toBe(sharedNotFoundMessage(dangling.metadata!.slug));
  });

  it("a stale token on an UNLOCKED link stays harmless", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    await createShareFixture(org, agent.metadata!.slug);

    // No live token → whatever the caller presented is ignored, so an old
    // bookmarked ?k= keeps working after an unlock-by-recreate.
    const profile = await clients.agentShareQuery.getSharedProfile({
      org,
      slug: agent.metadata!.slug,
      linkToken: "stale-token-from-an-old-bookmark",
    });
    expect(profile.slug).toBe(agent.metadata?.slug);
  });
});

describe("AgentShare conformance — the rotatable link token", () => {
  it("rotation kills the plain URL, admits the tokened one, and refuses the wrong token uniformly", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const share = await createShareFixture(org, agent.metadata!.slug);

    const rotated = await clients.agentShareCommand.rotateShareLink({
      resourceId: share.metadata!.id,
    });
    const token = rotated.status?.shareLinkToken ?? "";
    // 20 bytes of server entropy → 27 url-safe base64 characters.
    expect(token).toMatch(/^[A-Za-z0-9_-]{27}$/);

    // The plain URL is dead — and the refusal is byte-identical with a
    // nonexistent share's, so a killed link looks like one that never was.
    const plain = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ org, slug: share.metadata!.slug }),
      Code.NotFound,
      "plain URL after rotation",
    );
    expect(plain.rawMessage).toBe(sharedNotFoundMessage(share.metadata!.slug));

    // A wrong token refuses the same way — never a distinct "wrong token".
    const wrong = await expectGrpcCode(
      () =>
        clients.agentShareQuery.getSharedProfile({
          org,
          slug: share.metadata!.slug,
          linkToken: "not-the-token-that-was-minted",
        }),
      Code.NotFound,
      "wrong token after rotation",
    );
    expect(wrong.rawMessage).toBe(sharedNotFoundMessage(share.metadata!.slug));

    // The minted token resolves.
    const profile = await clients.agentShareQuery.getSharedProfile({
      org,
      slug: share.metadata!.slug,
      linkToken: token,
    });
    expect(profile.slug).toBe(share.metadata?.slug);

    // Rotating again kills the previous token immediately.
    await clients.agentShareCommand.rotateShareLink({ resourceId: share.metadata!.id });
    await expectGrpcCode(
      () =>
        clients.agentShareQuery.getSharedProfile({
          org,
          slug: share.metadata!.slug,
          linkToken: token,
        }),
      Code.NotFound,
      "previous token after a second rotation",
    );
  });

  it("rotateShareLink on an unknown share returns NotFound", async () => {
    const err = await expectGrpcCode(
      () => clients.agentShareCommand.rotateShareLink({ resourceId: "ash_01confmissing" }),
      Code.NotFound,
      "rotateShareLink on a nonexistent share",
    );
    expect(err.rawMessage).toBe("AgentShare not found: ash_01confmissing");
  });
});

describe("AgentShare conformance — the member resolution lane", () => {
  it("resolves enabled shares and requires org, like the anonymous lane", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    await createShareFixture(org, agent.metadata!.slug);

    const profile = await clients.agentShareQuery.getSharedProfileForMember({
      org,
      slug: agent.metadata!.slug,
    });
    expect(profile.slug).toBe(agent.metadata?.slug);

    await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfileForMember({ org: "", slug: "anything" }),
      Code.InvalidArgument,
      "member lookup without org",
    );
  });

  it("refuses a token-locked PUBLIC share on the tokenless member path, but not an org-audience one", async () => {
    const { org } = await target.provisionTenancy();

    // Public-audience + rotated: this tokenless path must not reveal a
    // killed link's profile.
    const publicAgent = await createAgentFixture(org);
    const publicShare = await createShareFixture(org, publicAgent.metadata!.slug);
    await clients.agentShareCommand.rotateShareLink({ resourceId: publicShare.metadata!.id });
    const refused = await expectGrpcCode(
      () =>
        clients.agentShareQuery.getSharedProfileForMember({
          org,
          slug: publicShare.metadata!.slug,
        }),
      Code.NotFound,
      "member path on a token-locked public share",
    );
    expect(refused.rawMessage).toBe(sharedNotFoundMessage(publicShare.metadata!.slug));

    // Org-audience + rotated: the gate is membership, not the link token —
    // the member path still resolves.
    const orgAgent = await createAgentFixture(org);
    const orgShare = await createShareFixture(org, orgAgent.metadata!.slug, {
      audience: AgentShareAudience.org,
    });
    await clients.agentShareCommand.rotateShareLink({ resourceId: orgShare.metadata!.id });
    const resolved = await clients.agentShareQuery.getSharedProfileForMember({
      org,
      slug: orgShare.metadata!.slug,
    });
    expect(resolved.slug).toBe(orgShare.metadata?.slug);
  });
});

describe("AgentShare conformance — the cross-org contract (decision 013)", () => {
  it("refuses to share another org's non-public agent with the enumeration-safe NotFound", async () => {
    const { org: originOrg } = await target.provisionTenancy();
    const { org: sharingOrg } = await target.provisionTenancy();
    const privateAgent = await createAgentFixture(originOrg);

    // For the sharing org, another org's private agent does not exist —
    // this create path must not become an existence probe.
    const err = await expectGrpcCode(
      () =>
        clients.agentShareCommand.create(
          makeAgentShare(sharingOrg, privateAgent.metadata!.slug, { agentRefOrg: originOrg }),
        ),
      Code.NotFound,
      "cross-org share of a private agent",
    );
    expect(err.rawMessage).toBe(sharedNotFoundMessage(privateAgent.metadata!.slug));
  });

  it("shares a public agent cross-org, refusing the org audience with the pinned copy", async (ctx) => {
    // The happy path needs a PUBLIC agent, which only the unguarded local
    // targets let the ordinary caller mint (the workflow/skill suites'
    // gating precedent).
    if (!target.capabilities.clientPublicVisibilityWrites) return ctx.skip();
    const { org: originOrg } = await target.provisionTenancy();
    const { org: sharingOrg } = await target.provisionTenancy();
    const publicAgent = await createAgentFixture(originOrg, { public: true });

    // Org-audience semantics don't carry across the org boundary.
    const orgAudience = await expectGrpcCode(
      () =>
        clients.agentShareCommand.create(
          makeAgentShare(sharingOrg, publicAgent.metadata!.slug, {
            agentRefOrg: originOrg,
            audience: AgentShareAudience.org,
          }),
        ),
      Code.FailedPrecondition,
      "cross-org share with an org audience",
    );
    expect(orgAudience.rawMessage).toBe(
      `a cross-org share must have a public audience — org-audience shares are limited to the agent's own organization (${originOrg})`,
    );

    // Public audience + public dependency-free agent: the share resolves
    // for anonymous visitors under the SHARING org's URL.
    const share = await createShareFixture(sharingOrg, publicAgent.metadata!.slug, {
      agentRefOrg: originOrg,
    });
    const profile = await clients.agentShareQuery.getSharedProfile({
      org: sharingOrg,
      slug: share.metadata!.slug,
    });
    expect(profile.org).toBe(sharingOrg);
    expect(profile.name).toBe(publicAgent.metadata?.name);
  });

  it("names every non-public dependency in the blocker refusal", async (ctx) => {
    if (!target.capabilities.clientPublicVisibilityWrites) return ctx.skip();
    const { org: originOrg } = await target.provisionTenancy();
    const { org: sharingOrg } = await target.provisionTenancy();

    // A public agent whose declared MCP dependency is NOT public — guests
    // could resolve the agent but its tools would silently vanish, so the
    // create refuses and names exactly what to publish.
    const mcpServer = await clients.mcpServerCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "McpServer",
      metadata: { name: uniqueName("private-dep"), org: originOrg },
      spec: {
        description: "non-public dependency for the cross-org blocker pin",
        serverType: {
          case: "stdio",
          value: { command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] },
        },
      },
    });
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: mcpServer.metadata!.id }));

    const agent = await clients.agentCommand.create(
      makeAgent({
        org: originOrg,
        name: uniqueName("shared-agent"),
        mcpServerRefs: [mcpServer.metadata!.slug],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    await clients.agentCommand.updateVisibility({
      resourceId: agent.metadata!.id,
      visibility: ApiResourceVisibility.visibility_public,
    });

    const err = await expectGrpcCode(
      () =>
        clients.agentShareCommand.create(
          makeAgentShare(sharingOrg, agent.metadata!.slug, { agentRefOrg: originOrg }),
        ),
      Code.FailedPrecondition,
      "cross-org share of an agent with a non-public dependency",
    );
    expect(err.rawMessage).toBe(
      `cannot share ${originOrg}/${agent.metadata!.slug} across organizations: ` +
        `it references resources that are not public: mcp_server ${originOrg}/${mcpServer.metadata!.slug}`,
    );
  });
});
