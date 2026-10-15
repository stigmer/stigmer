// Unit tests for the share-agent resource layer. The critical contract is
// merge-preservation: `channel.apply` replaces the web channel's spec
// wholesale, so a CLI toggle must never wipe console-configured origins,
// visitor messages, credential bindings, run settings, or the audience. The
// command edits the agent's canonical web channel (`<agent slug>-web`, then
// the agent's own slug, then the first web channel), never a Slack or
// WhatsApp channel, and a never-shared agent gets a nameless web channel the
// server names. A share from another organization's context is refused
// naming both organizations by slug, and only when the server says they
// differ: a lookup that fails for another reason is reported as itself. The
// printed chat link and embed name the channel by its id alone
// (`/chat/<channel id>`, `share="<channel id>"`), never its organization or
// slug.

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { AgentSchema, type Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelAudience } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import { buildEmbedSnippet, type ChannelInput, type Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { classify, ExitCode, UsageError } from "../../errors/index.js";
import { shareAgent } from "../share.js";

const CLOUD = { appOrigin: "https://app.stigmer.ai", isLocal: false };
const LOCAL = { appOrigin: "http://localhost:7234", isLocal: true };

function makeAgent(): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", org: "acme", slug: "support-agent", name: "Support Agent" },
    spec: {},
  });
}

interface ShareFixture {
  id?: string;
  slug?: string;
  enabled?: boolean;
  audience?: ChannelAudience;
  allowedOrigins?: string[];
  messages?: { rateLimited?: string; unavailable?: string; conversationEnded?: string };
  vaults?: { org: string; slug: string }[];
  runConfig?: { maxCostUsd?: number; maxToolRounds?: number };
  linkToken?: string;
}

// The fixture channel's id: the one identity its hosted link carries. It
// carries the prefix chat links were minted with before they were channels.
const SHARE_ID = "ash_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const CLOUD_LINK = `https://app.stigmer.ai/chat/${SHARE_ID}`;

// Plain-object web Channel fixture: the CLI reads it structurally (metadata /
// spec / status), so proto construction adds nothing here. A fixture channel
// is public unless it says otherwise, the way the server stores an audience:
// written out, never left unspecified. Its slug is the agent's own, the slug
// a chat link made before links were channels keeps.
function makeShare(fixture: ShareFixture = {}) {
  const { id, linkToken, slug, enabled, vaults, runConfig, ...web } = fixture;
  return {
    metadata: {
      id: id ?? SHARE_ID,
      org: "acme",
      slug: slug ?? "support-agent",
      name: "Support Agent",
    },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: enabled ?? false,
      vaults: vaults ?? [],
      ...(runConfig !== undefined ? { runConfig } : {}),
      type: {
        case: "web" as const,
        value: { audience: ChannelAudience.public, allowedOrigins: [] as string[], ...web },
      },
    },
    ...(linkToken !== undefined ? { status: { typeStatus: { case: "web" as const, value: { linkToken } } } } : {}),
  };
}

// A Slack channel on the same agent: never the row `share agent` edits.
function makeSlackChannel() {
  return {
    metadata: { id: "chn_01ARZ3NDEKTSV4RRFFQ69G5SLK", org: "acme", slug: "support-agent-slack", name: "Support Agent (Slack)" },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      vaults: [],
      type: { case: "slack" as const, value: {} },
    },
  };
}

type ChannelFixture = ReturnType<typeof makeShare> | ReturnType<typeof makeSlackChannel>;

// A minimal fake of the SDK surface shareAgent touches: agent resolution +
// call-recording channel listByAgentAll/apply/rotateLink (skill.test.ts
// convention). Apply answers with the applied input merged over the existing
// channel (id assigned), mirroring the server's upsert, and names a nameless
// web channel `<agent slug>-web` the way the server does. Rotation answers
// with the channel re-stamped with `rotatedToken`, mirroring fresh entropy.
const CONSUMER_ID = "org_01jcccccccccccccccccccccccc";

// The organizations the fake server names: acme from an earlier release
// (id == slug) and consumer-org with a minted id, by either value.
const ORGANIZATIONS: Record<string, { id: string; slug: string }> = {
  acme: { id: "acme", slug: "acme" },
  "consumer-org": { id: CONSUMER_ID, slug: "consumer-org" },
  [CONSUMER_ID]: { id: CONSUMER_ID, slug: "consumer-org" },
};

function fakeClient(
  agent: Agent,
  share: ChannelFixture | ChannelFixture[] | null,
  opts: { failWith?: Error; rotatedToken?: string; organizationFault?: Error } = {},
) {
  const applies: ChannelInput[] = [];
  let rotations = 0;
  const channels: ChannelFixture[] = share === null ? [] : Array.isArray(share) ? [...share] : [share];
  let applied: ReturnType<typeof makeShare> | null = null;
  const client = {
    // A server that holds several organizations, so a bare slug needs one.
    platform: {
      async getServerInfo() {
        return { singleOrg: false };
      },
    },
    // The server resolves an organization by id or slug, and refuses one
    // it does not know as NotFound.
    organization: {
      async get(value: string) {
        if (opts.organizationFault) throw opts.organizationFault;
        const named = ORGANIZATIONS[value];
        if (named === undefined) throw new ConnectError("organization not found", Code.NotFound);
        return create(OrganizationSchema, { metadata: named });
      },
    },
    agent: {
      async get() {
        return agent;
      },
      async getByReference() {
        return agent;
      },
    },
    channel: {
      // Mirrors the server's org scope: a non-empty request org returns
      // only that org's channels (the contract resolveCanonicalWebChannel
      // relies on to never surface another org's channel).
      async *listByAgentAll(input: { org?: string }) {
        for (const channel of channels) {
          if (!input.org || channel.metadata.org === input.org) yield channel;
        }
      },
      async apply(input: ChannelInput) {
        if (opts.failWith) throw opts.failWith;
        applies.push(input);
        const existing = channels.find((c) => c.metadata.id === input.id) as ReturnType<typeof makeShare> | undefined;
        applied = {
          metadata: {
            id: input.id ?? "chn_01ARZ3NDEKTSV4RRFFQ69G5NEW",
            org: input.org,
            slug: input.slug ?? `${input.agentRef.slug}-web`,
            name: input.name || "Support Agent (Web)",
          },
          spec: {
            agentRef: { org: input.agentRef.org, slug: input.agentRef.slug },
            enabled: input.enabled ?? false,
            vaults: input.vaults ?? [],
            type: {
              case: "web",
              value: {
                audience: input.web?.audience ?? ChannelAudience.unspecified,
                allowedOrigins: input.web?.allowedOrigins ?? [],
                messages: input.web?.messages as never,
              },
            },
          },
          ...(existing && "status" in existing ? { status: existing.status } : {}),
        } as ReturnType<typeof makeShare>;
        return applied;
      },
      async rotateLink() {
        rotations += 1;
        applied = {
          ...((applied ?? channels.find((c) => c.spec.type.case === "web")) as ReturnType<typeof makeShare>),
          status: { typeStatus: { case: "web", value: { linkToken: opts.rotatedToken ?? "fresh-token" } } },
        };
        return applied;
      },
    },
  } as unknown as Stigmer;
  return { client, applies, rotationCount: () => rotations };
}

describe("shareAgent merge-preservation (fails closed)", () => {
  it("enabling preserves console-configured origins, messages, and bindings verbatim", async () => {
    const share = makeShare({
      enabled: false,
      allowedOrigins: ["https://example.com", "https://docs.example.com"],
      messages: { rateLimited: "Slow down!", unavailable: "Back soon.", conversationEnded: "Bye!" },
      vaults: [{ org: "acme", slug: "github-org-shared" }],
    });
    const { client, applies } = fakeClient(makeAgent(), share);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    // The existing channel is restated by its own identity.
    expect(applies[0].id).toBe(SHARE_ID);
    expect(applies[0].org).toBe("acme");
    expect(applies[0].slug).toBe("support-agent");
    expect(applies[0].name).toBe("Support Agent");
    expect(applies[0].agentRef).toEqual({ org: "acme", slug: "support-agent" });
    expect(applies[0].enabled).toBe(true);
    expect(applies[0].web?.allowedOrigins).toEqual(["https://example.com", "https://docs.example.com"]);
    expect(applies[0].web?.messages?.rateLimited).toBe("Slow down!");
    expect(applies[0].web?.messages?.unavailable).toBe("Back soon.");
    expect(applies[0].web?.messages?.conversationEnded).toBe("Bye!");
    expect(applies[0].vaults).toEqual([{ org: "acme", slug: "github-org-shared" }]);
  });

  it("disabling preserves origins and messages, flipping only enabled", async () => {
    const share = makeShare({
      enabled: true,
      allowedOrigins: ["https://example.com"],
      messages: { rateLimited: "Slow down!" },
    });
    const { client, applies } = fakeClient(makeAgent(), share);

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: false, ...CLOUD });

    expect(applies).toHaveLength(1);
    expect(applies[0].enabled).toBe(false);
    expect(applies[0].web?.allowedOrigins).toEqual(["https://example.com"]);
    expect(applies[0].web?.messages?.rateLimited).toBe("Slow down!");
    expect(result.message).toContain("Sharing disabled");
    // No link/snippet on disable — the URL no longer works.
    expect(result.sections).toHaveLength(0);
  });

  it("enabling a never-shared agent creates a nameless web channel, organization-only", async () => {
    const { client, applies } = fakeClient(makeAgent(), null);

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    // A link reaches the internet only by an explicit --audience public.
    expect(applies[0].web?.audience).toBe(ChannelAudience.org);
    expect(result.sections.find((s) => s.title === "Member chat link")).toBeDefined();
    expect(result.sections.find((s) => s.title === "Embed on your site")).toBeUndefined();
    // Create identity: no name and no slug, so the server names the channel
    // `<agent slug>-web`; the agent's org, the agent reference and empty
    // config.
    expect(applies[0].org).toBe("acme");
    expect(applies[0].name).toBe("");
    expect(applies[0].slug).toBeUndefined();
    expect(applies[0].id).toBeUndefined();
    expect(result.sections.find((s) => s.title === "Member chat link")?.items).toEqual([
      "https://app.stigmer.ai/chat/chn_01ARZ3NDEKTSV4RRFFQ69G5NEW",
    ]);
    expect(applies[0].agentRef).toEqual({ org: "acme", slug: "support-agent" });
    expect(applies[0].enabled).toBe(true);
    expect(applies[0].web?.allowedOrigins).toEqual([]);
    expect(applies[0].web?.messages?.rateLimited).toBe("");
    expect(applies[0].vaults).toEqual([]);
  });

  it("preserves the channel's run settings across a toggle", async () => {
    const share = makeShare({ enabled: false, runConfig: { maxCostUsd: 0.5, maxToolRounds: 4 } });
    const { client, applies } = fakeClient(makeAgent(), share);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    expect(applies[0].runConfig).toMatchObject({ maxCostUsd: 0.5, maxToolRounds: 4 });
  });

  it("edits a renamed share under its own slug (never forks a second share)", async () => {
    const share = makeShare({ slug: "help-desk", enabled: false });
    const { client, applies } = fakeClient(makeAgent(), share);

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    // Applying with the agent's slug would CREATE a second share; the
    // toggle must target the existing row's identity.
    expect(applies[0].slug).toBe("help-desk");
    // The link names the share by its id, so the rename never reaches it.
    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual([CLOUD_LINK]);
  });

  it("a plain toggle preserves an org-members-only audience (never reverts to public)", async () => {
    const share = makeShare({
      enabled: false,
      audience: ChannelAudience.org,
      allowedOrigins: [],
    });
    const { client, applies } = fakeClient(makeAgent(), share);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    // A re-enable without --audience must keep the org restriction: writing
    // public here would silently expose an internal agent to the internet.
    expect(applies[0].web?.audience).toBe(ChannelAudience.org);
  });
});

describe("shareAgent canonical web channel", () => {
  it("edits the channel named `<agent slug>-web` before one carrying the agent's slug", async () => {
    const converted = makeShare({ id: "ash_01ARZ3NDEKTSV4RRFFQ69G5OLD", slug: "support-agent", enabled: false });
    const named = makeShare({ id: "chn_01ARZ3NDEKTSV4RRFFQ69G5WEB", slug: "support-agent-web", enabled: false });
    const { client, applies } = fakeClient(makeAgent(), [converted, named]);

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    expect(applies[0].slug).toBe("support-agent-web");
    expect(result.sections.find((s) => s.title === "Public chat link")?.items).toEqual([
      "https://app.stigmer.ai/chat/chn_01ARZ3NDEKTSV4RRFFQ69G5WEB",
    ]);
  });

  it("edits the channel carrying the agent's slug before any other web channel", async () => {
    const other = makeShare({ id: "chn_01ARZ3NDEKTSV4RRFFQ69G5OTH", slug: "help-desk", enabled: false });
    const converted = makeShare({ slug: "support-agent", enabled: false });
    const { client, applies } = fakeClient(makeAgent(), [other, converted]);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    expect(applies[0].id).toBe(SHARE_ID);
    expect(applies[0].slug).toBe("support-agent");
  });

  it("never edits a Slack channel: an agent with only one gets a new web channel", async () => {
    const { client, applies } = fakeClient(makeAgent(), [makeSlackChannel()]);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    expect(applies[0].id).toBeUndefined();
    expect(applies[0].slug).toBeUndefined();
    expect(applies[0].slack).toBeUndefined();
    expect(applies[0].web?.audience).toBe(ChannelAudience.org);
  });

  it("names the agent, never the channel's slug, in the re-enable hint", async () => {
    const named = makeShare({ slug: "support-agent-web", enabled: true });
    const { client } = fakeClient(makeAgent(), named);

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: false, ...CLOUD });

    expect(result.hints).toContain("  stigmer share agent acme/support-agent");
  });
});

describe("shareAgent audience", () => {
  it("--audience org sets the audience and applies the full spec", async () => {
    const share = makeShare({
      enabled: true,
      allowedOrigins: ["https://example.com"],
      messages: { rateLimited: "Slow down!" },
    });
    const { client, applies } = fakeClient(makeAgent(), share);

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "org",
      ...CLOUD,
    });

    expect(applies).toHaveLength(1);
    expect(applies[0].web?.audience).toBe(ChannelAudience.org);
    expect(applies[0].enabled).toBe(true);
    expect(applies[0].web?.allowedOrigins).toEqual(["https://example.com"]);
    expect(applies[0].web?.messages?.rateLimited).toBe("Slow down!");

    // Org shares print the member link and NO embed snippet (embeds serve
    // anonymous guests, which org shares refuse).
    const link = result.sections.find((s) => s.title === "Member chat link");
    expect(link?.items).toEqual([CLOUD_LINK]);
    expect(result.sections.find((s) => s.title === "Embed on your site")).toBeUndefined();
    expect(result.hints.some((h) => h.includes("signed-in members"))).toBe(true);
    expect(result.hints.some((h) => h.includes("search engines"))).toBe(false);
  });

  it("--audience public converts an org share back to an explicit public one", async () => {
    const share = makeShare({ enabled: true, audience: ChannelAudience.org });
    const { client, applies } = fakeClient(makeAgent(), share);

    await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "public",
      ...CLOUD,
    });

    expect(applies).toHaveLength(1);
    // Written as the explicit enum value, never left unspecified.
    expect(applies[0].web?.audience).toBe(ChannelAudience.public);
  });

  it("an audience change alone triggers a write even when enabled matches", async () => {
    const share = makeShare({ enabled: true });
    const { client, applies } = fakeClient(makeAgent(), share);

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "org",
      ...CLOUD,
    });

    expect(applies).toHaveLength(1);
    expect(result.message).toContain("Sharing enabled");
  });

  it("matching enabled AND audience stays idempotent (no write)", async () => {
    const share = makeShare({ enabled: true, audience: ChannelAudience.org });
    const { client, applies } = fakeClient(makeAgent(), share);

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "org",
      ...CLOUD,
    });

    expect(applies).toHaveLength(0);
    expect(result.message).toContain("already on");
  });
});

describe("shareAgent idempotency", () => {
  it("skips the write when sharing is already enabled, still reporting the link", async () => {
    const { client, applies } = fakeClient(makeAgent(), makeShare({ enabled: true }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(0);
    expect(result.message).toContain("already on");
    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual([CLOUD_LINK]);
  });

  it("skips the write when sharing is already disabled", async () => {
    const { client, applies } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: false, ...CLOUD });

    expect(applies).toHaveLength(0);
    expect(result.message).toContain("already off");
  });

  it("disabling a never-shared agent creates nothing", async () => {
    const { client, applies } = fakeClient(makeAgent(), null);

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: false, ...CLOUD });

    // Materializing a share row just to mark it disabled would create a
    // resource the owner never asked for, though a new link's audience is
    // the organization by default.
    expect(applies).toHaveLength(0);
    expect(result.message).toContain("already off");
  });

  it("disabling a never-shared agent with an explicit --audience org stores a paused share", async () => {
    const { client, applies } = fakeClient(makeAgent(), null);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: false, audience: "org", ...CLOUD });

    expect(applies).toHaveLength(1);
    expect(applies[0].enabled).toBe(false);
    expect(applies[0].web?.audience).toBe(ChannelAudience.org);
  });

  it("reads a stored unspecified audience as the organization (it only narrows)", async () => {
    const share = makeShare({ enabled: true, audience: ChannelAudience.unspecified });
    const { client, applies } = fakeClient(makeAgent(), share);

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(0);
    expect(result.sections.find((s) => s.title === "Member chat link")?.items).toEqual([CLOUD_LINK]);
    expect(result.sections.find((s) => s.title === "Public chat link")).toBeUndefined();
  });
});

describe("shareAgent output", () => {
  it("builds the link and snippet from the RESOLVED share's id (ID refs included)", async () => {
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", "", { enabled: true, ...CLOUD });

    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual([CLOUD_LINK]);
  });

  it("emits the exact embed snippet the web share dialog emits", async () => {
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    const embed = result.sections.find((s) => s.title === "Embed on your site");
    expect(embed?.items.join("\n")).toBe(buildEmbedSnippet("https://app.stigmer.ai", SHARE_ID));
    expect(embed?.items).toContain(`<stigmer-agent share="${SHARE_ID}"></stigmer-agent>`);
  });

  it("includes the who-pays and indexability hints", async () => {
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(result.hints.some((h) => h.includes("acme's own provider keys"))).toBe(true);
    expect(result.hints.some((h) => h.includes("search engines"))).toBe(true);
  });

  it("names the organization by its slug in what a person reads, while the link names only the share", async () => {
    const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
    const agent = makeAgent();
    agent.metadata!.org = ACME_ID;
    const share = makeShare({ enabled: false });
    share.metadata.org = ACME_ID;
    const { client } = fakeClient(agent, share);
    (client as unknown as { organization: unknown }).organization = {
      async get(value: string) {
        if (value !== ACME_ID && value !== "acme") throw new Error("not found");
        return { metadata: { id: ACME_ID, slug: "acme" } };
      },
    };

    const enabled = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });
    expect(enabled.hints.some((h) => h.includes("acme's own provider keys"))).toBe(true);
    expect(enabled.hints.some((h) => h.includes(ACME_ID))).toBe(false);
    const link = enabled.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual([CLOUD_LINK]);
    expect(link?.items[0]).not.toContain(ACME_ID);

    const disabled = await shareAgent(client, "acme/support-agent", "acme", { enabled: false, ...CLOUD });
    expect(disabled.hints).toContain("  stigmer share agent acme/support-agent");
  });

  it("warns that a local link won't serve visitors (guest chat is Cloud-only)", async () => {
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...LOCAL });

    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual([`http://localhost:7234/chat/${SHARE_ID}`]);
    expect(result.hints.some((h) => h.includes("Stigmer Cloud"))).toBe(true);
  });

  it("omits the local warning for an organization link, the one a self-hosted server serves", async () => {
    const { client } = fakeClient(
      makeAgent(),
      makeShare({ enabled: false, audience: ChannelAudience.org }),
    );

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...LOCAL });

    expect(result.sections.find((s) => s.title === "Member chat link")?.items).toEqual([
      `http://localhost:7234/chat/${SHARE_ID}`,
    ]);
    expect(result.hints.some((h) => h.includes("Stigmer Cloud"))).toBe(false);
  });

  it("omits the local warning on a cloud backend", async () => {
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(result.hints.some((h) => h.includes("Stigmer Cloud"))).toBe(false);
  });
});

describe("shareAgent --reset-link (rotatable share token)", () => {
  it("rotates and prints the fresh tokened link and snippet", async () => {
    const { client, applies, rotationCount } = fakeClient(
      makeAgent(),
      makeShare({ enabled: true }),
      { rotatedToken: "fresh-token" },
    );

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      resetLink: true,
      ...CLOUD,
    });

    // Already enabled: no spec write, exactly one rotation.
    expect(applies).toHaveLength(0);
    expect(rotationCount()).toBe(1);
    expect(result.message).toContain("Share link reset");

    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual([
      `${CLOUD_LINK}?k=fresh-token`,
    ]);
    const embed = result.sections.find((s) => s.title === "Embed on your site");
    expect(embed?.items.join("\n")).toBe(
      buildEmbedSnippet("https://app.stigmer.ai", SHARE_ID, "fresh-token"),
    );
    expect(result.hints.some((h) => h.includes("Re-share the new link"))).toBe(true);
  });

  it("enable + reset on a never-shared agent creates the public share, then rotates it", async () => {
    const { client, applies, rotationCount } = fakeClient(makeAgent(), null, {
      rotatedToken: "fresh-token",
    });

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "public",
      resetLink: true,
      ...CLOUD,
    });

    // The rotation needs a channel id, which only exists after the create.
    expect(applies).toHaveLength(1);
    expect(rotationCount()).toBe(1);
    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual([
      "https://app.stigmer.ai/chat/chn_01ARZ3NDEKTSV4RRFFQ69G5NEW?k=fresh-token",
    ]);
  });

  it("a plain toggle on a locked link keeps printing the existing tokened URL", async () => {
    const { client, rotationCount } = fakeClient(
      makeAgent(),
      makeShare({ enabled: true, linkToken: "existing-token" }),
    );

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      ...CLOUD,
    });

    // No rotation was requested: the current token must ride the link
    // verbatim, or the printed URL would be dead.
    expect(rotationCount()).toBe(0);
    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual([
      `${CLOUD_LINK}?k=existing-token`,
    ]);
  });

  it("refuses --reset-link for an org-members-only share with actionable guidance", async () => {
    const { client, rotationCount } = fakeClient(
      makeAgent(),
      makeShare({ enabled: true, audience: ChannelAudience.org }),
    );

    const err = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      resetLink: true,
      ...CLOUD,
    }).catch((e: unknown) => e);

    // Org access is gated by live membership — the token is never consulted,
    // so rotating it would be a silent no-op the user did not get.
    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain("public links");
    expect(rotationCount()).toBe(0);
  });

  it("the member link never carries a token, even when one exists in status", async () => {
    const { client } = fakeClient(
      makeAgent(),
      makeShare({
        enabled: true,
        audience: ChannelAudience.org,
        linkToken: "existing-token",
      }),
    );

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      ...CLOUD,
    });

    const link = result.sections.find((s) => s.title === "Member chat link");
    expect(link?.items).toEqual([CLOUD_LINK]);
  });
});

describe("shareAgent from another organization's context", () => {
  it("refuses before any write, naming where the share lives and the plugin remedy", async () => {
    // The server would refuse the agent_ref too; the CLI refuses first so
    // the caller reads the remedy rather than a bare FAILED_PRECONDITION.
    const { client, applies } = fakeClient(makeAgent(), null);

    const err = await shareAgent(client, "acme/support-agent", "consumer-org", {
      enabled: true,
      ...CLOUD,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain("lives in acme, not consumer-org");
    expect((err as Error).message).toContain("install the plugin that carries it");
    expect((err as Error).message).toContain("--org acme");
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect(applies).toHaveLength(0);
  });

  it("names the requested organization by slug when the context gives its id", async () => {
    const { client } = fakeClient(makeAgent(), null);

    const err = await shareAgent(client, "acme/support-agent", CONSUMER_ID, {
      enabled: true,
      ...CLOUD,
    }).catch((e: unknown) => e);

    expect((err as Error).message).toContain("lives in acme, not consumer-org");
    expect((err as Error).message).not.toContain(CONSUMER_ID);
  });

  it("reports a failed organization lookup as itself, never as a share in another organization", async () => {
    const { client, applies } = fakeClient(makeAgent(), makeShare({ enabled: false }), {
      organizationFault: new ConnectError("backend unavailable", Code.Unavailable),
    });

    const err = await shareAgent(client, "acme/support-agent", "acme-by-another-name", {
      enabled: true,
      ...CLOUD,
    }).catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(UsageError);
    expect((err as Error).message).toMatch(/backend unavailable/);
    expect(classify(err)?.exitCode).toBe(ExitCode.Connection);
    expect(applies).toHaveLength(0);
  });
});

describe("shareAgent errors", () => {
  it("fails fast with org guidance for a bare slug and no org", async () => {
    const { client, applies } = fakeClient(makeAgent(), null);

    const err = await shareAgent(client, "support-agent", "", { enabled: true, ...CLOUD }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain("organization not set");
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect(applies).toHaveLength(0);
  });

  it("does not apply the org guard to an ID reference", async () => {
    const { client, applies } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    await shareAgent(client, "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", "", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
  });

  it("propagates server rejections (permission denied) unchanged", async () => {
    const denied = new Error("permission denied: can_edit required");
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }), { failWith: denied });

    await expect(shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD })).rejects.toThrow(
      /permission denied/,
    );
  });
});
