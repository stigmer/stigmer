// Unit tests for the share-agent resource layer. The critical contract is
// merge-preservation: `updateSharing` replaces `spec.sharing` wholesale, so a
// CLI toggle must never wipe console-configured origins or visitor messages.

import { clone, create } from "@bufbuild/protobuf";
import { AgentSchema, type Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import type { UpdateAgentSharingInput } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { AgentSharingAudience } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { buildEmbedSnippet, type Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { classify, ExitCode, UsageError } from "../errors/index.js";
import { shareAgent } from "./share.js";

const CLOUD = { appOrigin: "https://app.stigmer.ai", isLocal: false };
const LOCAL = { appOrigin: "http://localhost:8234", isLocal: true };

function makeAgent(
  sharing?: {
    enabled?: boolean;
    audience?: AgentSharingAudience;
    allowedOrigins?: string[];
    messages?: { rateLimited?: string; unavailable?: string; conversationEnded?: string };
  },
  shareLinkToken?: string,
): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", org: "acme", slug: "support-agent", name: "Support Agent" },
    spec: sharing !== undefined ? { sharing } : {},
    ...(shareLinkToken !== undefined ? { status: { shareLinkToken } } : {}),
  });
}

// A minimal fake of the SDK surface shareAgent touches: agent.getByReference /
// agent.get + call-recording agent.updateSharing / agent.rotateShareLink
// (skill.test.ts convention). Rotation answers with the agent re-stamped
// with `rotatedToken`, mirroring the server's fresh-entropy response.
function fakeClient(
  agent: Agent,
  opts: { failWith?: Error; rotatedToken?: string } = {},
) {
  const calls: UpdateAgentSharingInput[] = [];
  let rotations = 0;
  const client = {
    agent: {
      async get() {
        return agent;
      },
      async getByReference() {
        return agent;
      },
      async updateSharing(input: UpdateAgentSharingInput) {
        if (opts.failWith) throw opts.failWith;
        calls.push(input);
        return agent;
      },
      async rotateShareLink() {
        rotations += 1;
        const rotated = clone(AgentSchema, agent);
        rotated.status = create(AgentStatusSchema, {
          shareLinkToken: opts.rotatedToken ?? "fresh-token",
        });
        return rotated;
      },
    },
  } as unknown as Stigmer;
  return { client, calls, rotationCount: () => rotations };
}

describe("shareAgent merge-preservation (fails closed)", () => {
  it("enabling preserves console-configured origins and messages verbatim", async () => {
    const agent = makeAgent({
      enabled: false,
      allowedOrigins: ["https://example.com", "https://docs.example.com"],
      messages: { rateLimited: "Slow down!", unavailable: "Back soon.", conversationEnded: "Bye!" },
    });
    const { client, calls } = fakeClient(agent);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(calls).toHaveLength(1);
    expect(calls[0].resourceId).toBe("agt_01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(calls[0].sharing?.enabled).toBe(true);
    expect(calls[0].sharing?.allowedOrigins).toEqual(["https://example.com", "https://docs.example.com"]);
    expect(calls[0].sharing?.messages?.rateLimited).toBe("Slow down!");
    expect(calls[0].sharing?.messages?.unavailable).toBe("Back soon.");
    expect(calls[0].sharing?.messages?.conversationEnded).toBe("Bye!");
  });

  it("disabling preserves origins and messages, flipping only enabled", async () => {
    const agent = makeAgent({
      enabled: true,
      allowedOrigins: ["https://example.com"],
      messages: { rateLimited: "Slow down!" },
    });
    const { client, calls } = fakeClient(agent);

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: false, ...CLOUD });

    expect(calls).toHaveLength(1);
    expect(calls[0].sharing?.enabled).toBe(false);
    expect(calls[0].sharing?.allowedOrigins).toEqual(["https://example.com"]);
    expect(calls[0].sharing?.messages?.rateLimited).toBe("Slow down!");
    expect(result.message).toContain("Sharing disabled");
    // No link/snippet on disable — the URL no longer works.
    expect(result.sections).toHaveLength(0);
  });

  it("enables cleanly for an agent that has never been shared (no spec.sharing)", async () => {
    const { client, calls } = fakeClient(makeAgent(undefined));

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(calls).toHaveLength(1);
    expect(calls[0].sharing?.enabled).toBe(true);
    expect(calls[0].sharing?.allowedOrigins).toEqual([]);
    expect(calls[0].sharing?.messages?.rateLimited).toBe("");
  });

  it("a plain toggle preserves an org-members-only audience (never reverts to public)", async () => {
    const agent = makeAgent({
      enabled: false,
      audience: AgentSharingAudience.org,
      allowedOrigins: [],
    });
    const { client, calls } = fakeClient(agent);

    await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(calls).toHaveLength(1);
    // A re-enable without --audience must keep the org restriction: writing
    // public here would silently expose an internal agent to the internet.
    expect(calls[0].sharing?.audience).toBe(AgentSharingAudience.org);
  });
});

describe("shareAgent audience", () => {
  it("--audience org sets the audience and writes the full block", async () => {
    const agent = makeAgent({
      enabled: true,
      allowedOrigins: ["https://example.com"],
      messages: { rateLimited: "Slow down!" },
    });
    const { client, calls } = fakeClient(agent);

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "org",
      ...CLOUD,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sharing?.audience).toBe(AgentSharingAudience.org);
    expect(calls[0].sharing?.enabled).toBe(true);
    expect(calls[0].sharing?.allowedOrigins).toEqual(["https://example.com"]);
    expect(calls[0].sharing?.messages?.rateLimited).toBe("Slow down!");

    // Org shares print the member link and NO embed snippet (embeds serve
    // anonymous guests, which org shares refuse).
    const link = result.sections.find((s) => s.title === "Member chat link");
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/acme/support-agent"]);
    expect(result.sections.find((s) => s.title === "Embed on your site")).toBeUndefined();
    expect(result.hints.some((h) => h.includes("signed-in members"))).toBe(true);
    expect(result.hints.some((h) => h.includes("search engines"))).toBe(false);
  });

  it("--audience public converts an org share back to an explicit public one", async () => {
    const agent = makeAgent({ enabled: true, audience: AgentSharingAudience.org });
    const { client, calls } = fakeClient(agent);

    await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "public",
      ...CLOUD,
    });

    expect(calls).toHaveLength(1);
    // Written as the explicit enum value, never left unspecified.
    expect(calls[0].sharing?.audience).toBe(AgentSharingAudience.public);
  });

  it("an audience change alone triggers a write even when enabled matches", async () => {
    const agent = makeAgent({ enabled: true });
    const { client, calls } = fakeClient(agent);

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "org",
      ...CLOUD,
    });

    expect(calls).toHaveLength(1);
    expect(result.message).toContain("Sharing enabled");
  });

  it("matching enabled AND audience stays idempotent (no write)", async () => {
    const agent = makeAgent({ enabled: true, audience: AgentSharingAudience.org });
    const { client, calls } = fakeClient(agent);

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      audience: "org",
      ...CLOUD,
    });

    expect(calls).toHaveLength(0);
    expect(result.message).toContain("already on");
  });
});

describe("shareAgent idempotency", () => {
  it("skips the write when sharing is already enabled, still reporting the link", async () => {
    const { client, calls } = fakeClient(makeAgent({ enabled: true }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(calls).toHaveLength(0);
    expect(result.message).toContain("already on");
    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/acme/support-agent"]);
  });

  it("skips the write when sharing is already disabled", async () => {
    const { client, calls } = fakeClient(makeAgent({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: false, ...CLOUD });

    expect(calls).toHaveLength(0);
    expect(result.message).toContain("already off");
  });
});

describe("shareAgent output", () => {
  it("builds the link and snippet from the RESOLVED agent's org/slug (ID refs included)", async () => {
    const { client } = fakeClient(makeAgent({ enabled: false }));

    const result = await shareAgent(client, "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", "", { enabled: true, ...CLOUD });

    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/acme/support-agent"]);
  });

  it("emits the exact embed snippet the web share dialog emits", async () => {
    const { client } = fakeClient(makeAgent({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    const embed = result.sections.find((s) => s.title === "Embed on your site");
    expect(embed?.items.join("\n")).toBe(buildEmbedSnippet("https://app.stigmer.ai", "acme", "support-agent"));
  });

  it("includes the who-pays and indexability hints", async () => {
    const { client } = fakeClient(makeAgent({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(result.hints.some((h) => h.includes("acme's credits"))).toBe(true);
    expect(result.hints.some((h) => h.includes("search engines"))).toBe(true);
  });

  it("warns that a local link won't serve visitors (guest chat is Cloud-only)", async () => {
    const { client } = fakeClient(makeAgent({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...LOCAL });

    const link = result.sections.find((s) => s.title === "Public chat link");
    expect(link?.items).toEqual(["http://localhost:8234/chat/acme/support-agent"]);
    expect(result.hints.some((h) => h.includes("Stigmer Cloud"))).toBe(true);
  });

  it("omits the local warning on a cloud backend", async () => {
    const { client } = fakeClient(makeAgent({ enabled: false }));

    const result = await shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD });

    expect(result.hints.some((h) => h.includes("Stigmer Cloud"))).toBe(false);
  });
});

describe("shareAgent --reset-link (rotatable share token)", () => {
  it("rotates and prints the fresh tokened link and snippet", async () => {
    const { client, calls, rotationCount } = fakeClient(
      makeAgent({ enabled: true }),
      { rotatedToken: "fresh-token" },
    );

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      resetLink: true,
      ...CLOUD,
    });

    // Already enabled: no sharing write, exactly one rotation.
    expect(calls).toHaveLength(0);
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

  it("a plain toggle on a locked link keeps printing the existing tokened URL", async () => {
    const { client, rotationCount } = fakeClient(
      makeAgent({ enabled: true }, "existing-token"),
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
      makeAgent({ enabled: true, audience: AgentSharingAudience.org }),
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
      makeAgent({ enabled: true, audience: AgentSharingAudience.org }, "existing-token"),
    );

    const result = await shareAgent(client, "acme/support-agent", "acme", {
      enabled: true,
      ...CLOUD,
    });

    const link = result.sections.find((s) => s.title === "Member chat link");
    expect(link?.items).toEqual(["https://app.stigmer.ai/chat/acme/support-agent"]);
  });
});

describe("shareAgent errors", () => {
  it("fails fast with org guidance for a bare slug and no org", async () => {
    const { client, calls } = fakeClient(makeAgent());

    const err = await shareAgent(client, "support-agent", "", { enabled: true, ...CLOUD }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UsageError);
    expect((err as Error).message).toContain("organization not set");
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    expect(calls).toHaveLength(0);
  });

  it("does not apply the org guard to an ID reference", async () => {
    const { client, calls } = fakeClient(makeAgent({ enabled: false }));

    await shareAgent(client, "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", "", { enabled: true, ...CLOUD });

    expect(calls).toHaveLength(1);
  });

  it("propagates server rejections (permission denied) unchanged", async () => {
    const denied = new Error("permission denied: can_edit required");
    const { client } = fakeClient(makeAgent({ enabled: false }), { failWith: denied });

    await expect(shareAgent(client, "acme/support-agent", "acme", { enabled: true, ...CLOUD })).rejects.toThrow(
      /permission denied/,
    );
  });
});
