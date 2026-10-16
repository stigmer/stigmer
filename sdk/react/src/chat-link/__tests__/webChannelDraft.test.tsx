// The chat-link dialog's web channel draft and the inputs a save sends: the
// create input for a new web channel (identity, agent_ref, the web arm and
// its bindings) and the edit a draft makes through useSaveChannel, which
// names the web settings one by one so a field the edit does not name
// keeps its stored value.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { sentUpdate } from "../../internal/__tests__/sent-update";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChannelAudience } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { StigmerContext } from "../../context";
import { useSaveChannel } from "../../channel/useSaveChannel";
import {
  draftFromWebChannel,
  chatLinkAudienceFromProto,
  webChannelCreateInput,
  webChannelPatch,
  webLinkTokenOf,
  type WebChannelDraft,
} from "../webChannelDraft";

function createMockStigmer(overrides: {
  update?: (resource: Channel, paths: string[]) => Promise<unknown>;
} = {}) {
  return {
    channel: {
      update: overrides.update ?? vi.fn().mockResolvedValue({}),
    },
  } as never;
}

/** Every field the chat-link dialog saves, by its path. */
const DRAFT_PATHS = [
  "spec.enabled",
  "spec.web.audience",
  "spec.web.allowed_origins",
  "spec.web.messages",
  "spec.vaults",
  "spec.run_config",
];

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

const AGENT = {
  metadata: {
    id: "agt_1",
    org: "acme",
    slug: "support-agent",
    name: "Support Agent",
  },
} as never;

const FULL_DRAFT: WebChannelDraft = {
  enabled: true,
  audience: "public",
  allowedOrigins: ["https://example.com", "https://docs.example.com"],
  messages: {
    rateLimited: "Slow down, please.",
    unavailable: "We're not taking chats right now.",
    conversationEnded: "This conversation has ended.",
  },
  vaults: [{ org: "acme", slug: "github-org-shared" }],
  runConfig: { modelName: "gpt-5-mini", maxCostUsd: 0.25 },
};

function webChannel(overrides: { id?: string; org?: string; slug?: string; spec?: Record<string, unknown> } = {}): Channel {
  return {
    metadata: {
      id: overrides.id ?? "ash_1",
      org: overrides.org ?? "acme",
      slug: overrides.slug ?? "support-agent",
      name: "Support Agent",
    },
    spec: overrides.spec ?? { enabled: true, type: { case: "web", value: {} } },
  } as unknown as Channel;
}

/** Render useSaveChannel and send the edit `draft` makes to `channel`. */
async function saveEdit(
  channel: Channel,
  draft: WebChannelDraft,
  fields?: ReadonlyArray<keyof WebChannelDraft>,
) {
  const update = vi.fn().mockResolvedValue({});
  const { result } = renderHook(() => useSaveChannel(), {
    wrapper: wrapper(createMockStigmer({ update })),
  });
  await act(() => result.current.update(channel, webChannelPatch(draft, fields)));
  return sentUpdate<Channel>(update);
}

describe("webChannelCreateInput", () => {
  it("carries the complete configuration — identity, agent_ref, the web settings, and bindings", () => {
    const input = webChannelCreateInput(AGENT, FULL_DRAFT, {
      name: "Support Agent",
      slug: "support-agent",
    });

    expect(input.org).toBe("acme");
    expect(input.slug).toBe("support-agent");
    expect(input.name).toBe("Support Agent");
    expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
    expect(input.enabled).toBe(true);
    expect(input.web?.allowedOrigins).toEqual([
      "https://example.com",
      "https://docs.example.com",
    ]);
    expect(input.web?.messages?.rateLimited).toBe("Slow down, please.");
    expect(input.web?.messages?.unavailable).toBe("We're not taking chats right now.");
    expect(input.web?.messages?.conversationEnded).toBe(
      "This conversation has ended.",
    );
    expect(input.vaults).toEqual([
      { org: "acme", slug: "github-org-shared" },
    ]);
    expect(input.runConfig).toEqual({ modelName: "gpt-5-mini", maxCostUsd: 0.25 });
    // A web channel: no other type's arm is set.
    expect(input.slack).toBeUndefined();
    expect(input.whatsapp).toBeUndefined();
  });

  it("a disabled draft still carries origins, messages, and audience", () => {
    // An org-audience channel carries no vaults or runConfig (both are
    // public-audience-only by the proto CEL rules).
    const input = webChannelCreateInput(AGENT, {
      ...FULL_DRAFT,
      enabled: false,
      audience: "org",
      vaults: [],
      runConfig: undefined,
    });

    expect(input.enabled).toBe(false);
    expect(input.web?.allowedOrigins).toEqual(FULL_DRAFT.allowedOrigins);
    expect(input.web?.messages?.rateLimited).toBe(FULL_DRAFT.messages.rateLimited);
    expect(input.web?.audience).toBe(ChannelAudience.org);
  });

  it("maps the audience union to the proto enum, writing public explicitly", () => {
    const first = webChannelCreateInput(AGENT, FULL_DRAFT);
    const second = webChannelCreateInput(AGENT, { ...FULL_DRAFT, audience: "org", vaults: [] });

    // Both persist as explicit enum values, never unspecified, so a stored
    // channel always says what it means.
    expect(first.web?.audience).toBe(ChannelAudience.public);
    expect(second.web?.audience).toBe(ChannelAudience.org);
  });

  it("lands the web channel in the agent's own organization, named by the server when no identity is given", () => {
    const input = webChannelCreateInput(AGENT, FULL_DRAFT);

    // The channel is the agent organization's resource (its URL, billing
    // and credentials) and agent_ref points at that organization's agent.
    expect(input.org).toBe("acme");
    expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
    // No slug and no name: the server names it `<agent slug>-web`.
    expect(input.slug).toBeUndefined();
    expect(input.name).toBe("");
  });
});

describe("webChannelPatch through useSaveChannel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("edits an existing web channel by its id, naming every draft field and the web settings one by one (a renamed channel is never forked)", async () => {
    // A channel created via manifest with a non-default slug: an apply with
    // the agent's slug would create a SECOND channel; an update names it by id.
    const renamed = webChannel({ id: "ash_1", slug: "help-desk" });

    const sent = await saveEdit(renamed, FULL_DRAFT);

    expect(sent.id).toBe("ash_1");
    expect(sent.paths).toEqual(DRAFT_PATHS);
    // The agent reference is not named: it stays as stored.
    expect(sent.paths).not.toContain("spec.agent_ref");
    expect(sent.resource.spec?.type).toMatchObject({
      case: "web",
      value: { audience: ChannelAudience.public, allowedOrigins: FULL_DRAFT.allowedOrigins },
    });
  });

  it("a pause/resume toggle names spec.enabled alone, so an API-set run_config stays", async () => {
    // A channel whose run_config was set via CLI/API — the console list's
    // toggle names `enabled` alone, so no console save can touch it.
    const channel = webChannel({
      spec: {
        enabled: true,
        type: { case: "web", value: { allowedOrigins: ["https://example.com"] } },
        vaults: [],
        runConfig: { modelName: "gpt-5-mini", maxCostUsd: 0.25, maxToolRounds: 8 },
      },
    });

    const sent = await saveEdit(channel, { ...draftFromWebChannel(channel), enabled: false }, ["enabled"]);

    expect(sent.paths).toEqual(["spec.enabled"]);
    expect(sent.resource.spec?.enabled).toBe(false);
  });

  it("an edit of one web setting names that setting alone", async () => {
    const sent = await saveEdit(webChannel(), { ...FULL_DRAFT, audience: "org" }, ["audience"]);

    expect(sent.paths).toEqual(["spec.web.audience"]);
  });

  it("a save built from draftFromWebChannel carries every run_config field (stigmer#1905)", async () => {
    // Every RunConfig field set: a draft that dropped any one of them
    // would silently clear the owner's setting on the next pause/resume.
    const runConfig = {
      modelName: "claude-sonnet-4.6",
      maxCostUsd: 0.5,
      maxToolRounds: 12,
      serviceTier: ServiceTier.FAST,
      thinkingMode: ThinkingMode.ENABLED,
      maxToolResultChars: 20000,
    };
    const channel = webChannel({
      id: "ash_3",
      spec: { enabled: true, type: { case: "web", value: { allowedOrigins: [] } }, vaults: [], runConfig },
    });

    const sent = await saveEdit(channel, { ...draftFromWebChannel(channel), enabled: false });

    expect(sent.paths).toContain("spec.run_config");
    expect(sent.resource.spec?.runConfig).toMatchObject(runConfig);
  });

  it("editing an existing web channel keeps ITS identity, whatever organization it was written in", async () => {
    // A channel written before sharing across organizations was retired
    // may live in another organization; an edit must not re-home it.
    const legacy = webChannel({ id: "ash_ext", org: "consumer-org", slug: "renamed-channel" });

    const sent = await saveEdit(legacy, FULL_DRAFT);

    // An update names the channel by its id: its organization and slug are
    // never named, so it is never re-homed.
    expect(sent.id).toBe("ash_ext");
    expect(sent.paths).toEqual(DRAFT_PATHS);
  });
});

describe("draftFromWebChannel", () => {
  it("reads the web settings from the web arm of spec.type", () => {
    const channel = webChannel({
      spec: {
        enabled: true,
        type: {
          case: "web",
          value: {
            audience: ChannelAudience.public,
            allowedOrigins: ["https://example.com"],
            messages: { rateLimited: "Slow down.", unavailable: "", conversationEnded: "" },
          },
        },
      },
    });

    const draft = draftFromWebChannel(channel);

    expect(draft.audience).toBe("public");
    expect(draft.allowedOrigins).toEqual(["https://example.com"]);
    expect(draft.messages.rateLimited).toBe("Slow down.");
  });

  it("leaves run_config undefined when the channel carries none", () => {
    expect(draftFromWebChannel(null).runConfig).toBeUndefined();
    expect(draftFromWebChannel(webChannel()).runConfig).toBeUndefined();
  });
});

describe("webLinkTokenOf", () => {
  it("reads the link token from the web arm of status.typeStatus, empty for a plain link", () => {
    const locked = {
      ...webChannel(),
      status: { typeStatus: { case: "web", value: { linkToken: "tok123" } } },
    } as unknown as Channel;

    expect(webLinkTokenOf(locked)).toBe("tok123");
    expect(webLinkTokenOf(webChannel())).toBe("");
    expect(webLinkTokenOf(null)).toBe("");
  });
});

describe("chatLinkAudienceFromProto", () => {
  it("maps unspecified to org (a link reaches the internet only by an explicit choice)", () => {
    expect(chatLinkAudienceFromProto(undefined)).toBe("org");
    expect(chatLinkAudienceFromProto(ChannelAudience.unspecified)).toBe(
      "org",
    );
  });

  it("maps the explicit values", () => {
    expect(chatLinkAudienceFromProto(ChannelAudience.public)).toBe("public");
    expect(chatLinkAudienceFromProto(ChannelAudience.org)).toBe("org");
  });
});
