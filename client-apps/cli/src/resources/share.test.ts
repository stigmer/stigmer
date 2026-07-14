// Unit tests for the share-agent resource layer. The critical contract is
// merge-preservation: `agentShare.apply` replaces the share's spec wholesale,
// so a CLI toggle must never wipe console-configured origins, visitor
// messages, credential bindings, or the audience.

import { create } from "@bufbuild/protobuf";
import { AgentSchema, type Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { buildEmbedSnippet, type AgentShareInput, type Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { classify, ExitCode, UsageError } from "../errors/index.js";
import { shareAgent } from "./share.js";

const CLOUD = { appOrigin: "https://app.stigmer.ai", isLocal: false };
const LOCAL = { appOrigin: "http://localhost:8234", isLocal: true };

function makeAgent(): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", org: "acme", slug: "support-agent", name: "Support Agent" },
    spec: {},
  });
}

interface ShareFixture {
  slug?: string;
  enabled?: boolean;
  audience?: AgentShareAudience;
  allowedOrigins?: string[];
  messages?: { rateLimited?: string; unavailable?: string; conversationEnded?: string };
  environmentRefs?: { org: string; slug: string }[];
  shareLinkToken?: string;
}

// Plain-object AgentShare fixture: the CLI reads it structurally (metadata /
// spec / status), so proto construction adds nothing here.
function makeShare(fixture: ShareFixture = {}) {
  const { shareLinkToken, slug, ...spec } = fixture;
  return {
    metadata: {
      id: "ash_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      org: "acme",
      slug: slug ?? "support-agent",
      name: "Support Agent",
    },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      ...spec,
    },
    ...(shareLinkToken !== undefined ? { status: { shareLinkToken } } : {}),
  };
}

// A minimal fake of the SDK surface shareAgent touches: agent resolution +
// call-recording agentShare getByAgent/apply/rotateShareLink (skill.test.ts
// convention). Apply answers with the applied input merged over the existing
// share (id assigned), mirroring the server's upsert. Rotation answers with
// the share re-stamped with `rotatedToken`, mirroring fresh entropy.
function fakeClient(
  agent: Agent,
  share: ReturnType<typeof makeShare> | null,
  opts: { failWith?: Error; rotatedToken?: string } = {},
) {
  const applies: AgentShareInput[] = [];
  let rotations = 0;
  let currentShare = share;
  const client = {
    agent: {
      async get() {
        return agent;
      },
      async getByReference() {
        return agent;
      },
    },
    agentShare: {
      // Mirrors the server's org scope: a non-empty request org returns
      // only that org's shares (the contract resolveCanonicalShare relies
      // on to never surface another org's channel).
      async getByAgent(input: { org?: string }) {
        const items =
          currentShare &&
          (!input.org || currentShare.metadata.org === input.org)
            ? [currentShare]
            : [];
        return { totalCount: items.length, items };
      },
      async apply(input: AgentShareInput) {
        if (opts.failWith) throw opts.failWith;
        applies.push(input);
        currentShare = {
          metadata: {
            id: currentShare?.metadata.id ?? "ash_01ARZ3NDEKTSV4RRFFQ69G5FAV",
            org: input.org,
            slug: input.slug ?? "",
            name: input.name,
          },
          spec: {
            agentRef: { org: input.agentRef.org, slug: input.agentRef.slug },
            enabled: input.enabled ?? false,
            audience: input.audience ?? AgentShareAudience.unspecified,
            allowedOrigins: input.allowedOrigins ?? [],
            messages: input.messages as never,
            environmentRefs: input.environmentRefs ?? [],
          },
          ...(currentShare?.status ? { status: currentShare.status } : {}),
        } as ReturnType<typeof makeShare>;
        return currentShare;
      },
      async rotateShareLink() {
        rotations += 1;
        currentShare = {
          ...(currentShare as ReturnType<typeof makeShare>),
          status: { shareLinkToken: opts.rotatedToken ?? "fresh-token" },
        };
        return currentShare;
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
      environmentRefs: [{ org: "acme", slug: "github-org-shared" }],
    });
    const { client, applies } = fakeClient(makeAgent(), share);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    expect(applies[0].org).toBe("acme");
    expect(applies[0].slug).toBe("support-agent");
    expect(applies[0].agentRef).toEqual({ org: "acme", slug: "support-agent" });
    expect(applies[0].enabled).toBe(true);
    expect(applies[0].allowedOrigins).toEqual(["https://example.com", "https://docs.example.com"]);
    expect(applies[0].messages?.rateLimited).toBe("Slow down!");
    expect(applies[0].messages?.unavailable).toBe("Back soon.");
    expect(applies[0].messages?.conversationEnded).toBe("Bye!");
    expect(applies[0].environmentRefs).toEqual([{ org: "acme", slug: "github-org-shared" }]);
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
    expect(applies[0].allowedOrigins).toEqual(["https://example.com"]);
    expect(applies[0].messages?.rateLimited).toBe("Slow down!");
    expect(result.message).toContain("Sharing disabled");
    // No link/snippet on disable — the URL no longer works.
    expect(result.sections).toHaveLength(0);
  });

  it("enabling a never-shared agent creates the canonical share", async () => {
    const { client, applies } = fakeClient(makeAgent(), null);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    // Create identity: the agent's own org/slug (the server's default,
    // made explicit) with the agent reference and empty config.
    expect(applies[0].slug).toBe("support-agent");
    expect(applies[0].agentRef).toEqual({ org: "acme", slug: "support-agent" });
    expect(applies[0].enabled).toBe(true);
    expect(applies[0].allowedOrigins).toEqual([]);
    expect(applies[0].messages?.rateLimited).toBe("");
    expect(applies[0].environmentRefs).toEqual([]);
  });

  it("edits a renamed share under its own slug (never forks a second share)", async () => {
    const share = makeShare({ slug: "help-desk", enabled: false });
    const { client, applies } = fakeClient(makeAgent(), share);

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    // Applying with the agent's slug would CREATE a second share; the
    // toggle must target the existing row's identity.
    expect(applies[0].slug).toBe("help-desk");
    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/acme/help-desk"]);
  });

  it("a plain toggle preserves an org-members-only audience (never reverts to public)", async () => {
    const share = makeShare({
      enabled: false,
      audience: AgentShareAudience.org,
      allowedOrigins: [],
    });
    const { client, applies } = fakeClient(makeAgent(), share);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(applies).toHaveLength(1);
    // A re-enable without --audience must keep the org restriction: writing
    // public here would silently expose an internal agent to the internet.
    expect(applies[0].audience).toBe(AgentShareAudience.org);
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
    expect(applies[0].audience).toBe(AgentShareAudience.org);
    expect(applies[0].enabled).toBe(true);
    expect(applies[0].allowedOrigins).toEqual(["https://example.com"]);
    expect(applies[0].messages?.rateLimited).toBe("Slow down!");

    // Org shares print the member link and NO embed snippet (embeds serve
    // anonymous guests, which org shares refuse).
    const link = result.sections.find((s) => s.title === "Member chat link");
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/acme/support-agent"]);
    expect(result.sections.find((s) => s.title === "Embed on your site")).toBeUndefined();
    expect(result.hints.some((h) => h.includes("signed-in members"))).toBe(true);
    expect(result.hints.some((h) => h.includes("search engines"))).toBe(false);
  });

  it("--audience public converts an org share back to an explicit public one", async () => {
    const share = makeShare({ enabled: true, audience: AgentShareAudience.org });
    const { client, applies } = fakeClient(makeAgent(), share);

    await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "public",
      ...CLOUD,
    });

    expect(applies).toHaveLength(1);
    // Written as the explicit enum value, never left unspecified.
    expect(applies[0].audience).toBe(AgentShareAudience.public);
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
    const share = makeShare({ enabled: true, audience: AgentShareAudience.org });
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
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/acme/support-agent"]);
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
    // resource the owner never asked for.
    expect(applies).toHaveLength(0);
    expect(result.message).toContain("already off");
  });
});

describe("shareAgent output", () => {
  it("builds the link and snippet from the RESOLVED share's org/slug (ID refs included)", async () => {
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", "", { enabled: true, ...CLOUD });

    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/acme/support-agent"]);
  });

  it("emits the exact embed snippet the web share dialog emits", async () => {
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    const embed = result.sections.find((s) => s.title === "Embed on your site");
    expect(embed?.items.join("\n")).toBe(buildEmbedSnippet("https://app.stigmer.ai", "acme", "support-agent"));
  });

  it("includes the who-pays and indexability hints", async () => {
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(result.hints.some((h) => h.includes("acme's credits"))).toBe(true);
    expect(result.hints.some((h) => h.includes("search engines"))).toBe(true);
  });

  it("warns that a local link won't serve visitors (guest chat is Cloud-only)", async () => {
    const { client } = fakeClient(makeAgent(), makeShare({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...LOCAL });

    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual(["http://localhost:8234/chat/acme/support-agent"]);
    expect(result.hints.some((h) => h.includes("Stigmer Cloud"))).toBe(true);
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
      "https://app.stigmer.ai/chat/acme/support-agent?k=fresh-token",
    ]);
    const embed = result.sections.find((s) => s.title === "Embed on your site");
    expect(embed?.items.join("\n")).toBe(
      buildEmbedSnippet("https://app.stigmer.ai", "acme", "support-agent", "fresh-token"),
    );
    expect(result.hints.some((h) => h.includes("Re-share the new link"))).toBe(true);
  });

  it("enable + reset on a never-shared agent creates the share, then rotates it", async () => {
    const { client, applies, rotationCount } = fakeClient(makeAgent(), null, {
      rotatedToken: "fresh-token",
    });

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      resetLink: true,
      ...CLOUD,
    });

    // The rotation needs a share id, which only exists after the create.
    expect(applies).toHaveLength(1);
    expect(rotationCount()).toBe(1);
    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual([
      "https://app.stigmer.ai/chat/acme/support-agent?k=fresh-token",
    ]);
  });

  it("a plain toggle on a locked link keeps printing the existing tokened URL", async () => {
    const { client, rotationCount } = fakeClient(
      makeAgent(),
      makeShare({ enabled: true, shareLinkToken: "existing-token" }),
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
      "https://app.stigmer.ai/chat/acme/support-agent?k=existing-token",
    ]);
  });

  it("refuses --reset-link for an org-members-only share with actionable guidance", async () => {
    const { client, rotationCount } = fakeClient(
      makeAgent(),
      makeShare({ enabled: true, audience: AgentShareAudience.org }),
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
        audience: AgentShareAudience.org,
        shareLinkToken: "existing-token",
      }),
    );

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      ...CLOUD,
    });

    const link = result.sections.find((s) => s.title === "Member chat link");
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/acme/support-agent"]);
  });
});

describe("shareAgent cross-org (decision 013)", () => {
  it("lands the share in the CALLER's org, agent_ref keeps the provider's", async () => {
    const { client, applies } = fakeClient(makeAgent(), null);

    const result = await shareAgent(client, "acme/support-agent", "consumer-org", {
      enabled: true,
      ...CLOUD,
    });

    expect(applies).toHaveLength(1);
    // The share is the caller org's channel: its URL, billing, and
    // credentials — while the blueprint reference stays the provider's.
    expect(applies[0].org).toBe("consumer-org");
    expect(applies[0].slug).toBe("support-agent");
    expect(applies[0].agentRef).toEqual({ org: "acme", slug: "support-agent" });

    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/consumer-org/support-agent"]);
    expect(result.hints.some((h) => h.includes("consumer-org's credits"))).toBe(true);
  });

  it("never edits the provider org's own share (canonical resolution is org-scoped)", async () => {
    // The provider already shares this agent with its own config; the
    // caller's toggle must create the CALLER org's share, not flip (or
    // inherit the config of) the provider's row.
    const providerShare = makeShare({
      enabled: true,
      allowedOrigins: ["https://provider.example.com"],
    });
    const { client, applies } = fakeClient(makeAgent(), providerShare);

    await shareAgent(client, "acme/support-agent", "consumer-org", {
      enabled: true,
      ...CLOUD,
    });

    expect(applies).toHaveLength(1);
    expect(applies[0].org).toBe("consumer-org");
    // Fresh channel, fresh config: the provider's origins must not leak
    // into the caller org's share.
    expect(applies[0].allowedOrigins).toEqual([]);
  });

  it("refuses --audience org with guidance (cross-org shares are public only)", async () => {
    const { client, applies } = fakeClient(makeAgent(), null);

    const err = await shareAgent(client, "acme/support-agent", "consumer-org", {
      enabled: true,
      audience: "org",
      ...CLOUD,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain("agent's own organization");
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect(applies).toHaveLength(0);
  });

  it("passes the server's fail-loud dependency refusal through unchanged", async () => {
    // The D5 sweep names every non-public dependency; the CLI must
    // surface that message verbatim — it tells the caller exactly what
    // to ask the provider org to publish.
    const refusal = new Error(
      "cannot share acme/support-agent across organizations: it references resources that are not public: skill acme/private-skill",
    );
    const { client } = fakeClient(makeAgent(), null, { failWith: refusal });

    await expect(
      shareAgent(client, "acme/support-agent", "consumer-org", { enabled: true, ...CLOUD }),
    ).rejects.toThrow(/skill acme\/private-skill/);
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
