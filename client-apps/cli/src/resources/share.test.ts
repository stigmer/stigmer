// Unit tests for the share-agent resource layer. The critical contract is
// merge-preservation: `updateSharing` replaces `spec.sharing` wholesale, so a
// CLI toggle must never wipe console-configured origins or visitor messages.

import { create } from "@bufbuild/protobuf";
import { AgentSchema, type Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { UpdateAgentSharingInput } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { buildEmbedSnippet, type Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { classify, ExitCode, UsageError } from "../errors/index.js";
import { shareAgent } from "./share.js";

const CLOUD = { appOrigin: "https://app.stigmer.ai", isLocal: false };
const LOCAL = { appOrigin: "http://localhost:8234", isLocal: true };

function makeAgent(sharing?: {
  enabled?: boolean;
  allowedOrigins?: string[];
  messages?: { rateLimited?: string; unavailable?: string; conversationEnded?: string };
}): Agent {
  return create(AgentSchema, {
    metadata: { id: "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", org: "acme", slug: "support-agent", name: "Support Agent" },
    spec: sharing !== undefined ? { sharing } : {},
  });
}

// A minimal fake of the SDK surface shareAgent touches: agent.getByReference /
// agent.get + a call-recording agent.updateSharing (skill.test.ts convention).
function fakeClient(agent: Agent, opts: { failWith?: Error } = {}) {
  const calls: UpdateAgentSharingInput[] = [];
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
    },
  } as unknown as Stigmer;
  return { client, calls };
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
