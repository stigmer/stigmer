// useSaveChannel: apply a channel of any type, or change the fields an edit
// names on one as loaded (a type's settings named field by field).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import type { ChannelInput } from "@stigmer/client";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { StigmerContext } from "@stigmer/react-core";
import { useSaveChannel } from "../useSaveChannel";
import { sentRefs, sentUpdate } from "../../internal/__tests__/sent-update";

function createMockStigmer(overrides: {
  apply?: (input: ChannelInput) => Promise<unknown>;
  update?: (resource: Channel, paths: string[]) => Promise<unknown>;
} = {}) {
  return {
    channel: {
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
      update: overrides.update ?? vi.fn().mockResolvedValue({}),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

function makeChannel(overrides: Record<string, unknown> = {}): Channel {
  return {
    metadata: {
      id: "chn_1",
      name: "Support Slack",
      slug: "support-slack",
      org: "acme",
      labels: {},
    },
    spec: {
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      type: { case: "slack", value: {} },
    },
    status: { installState: 2 },
    ...overrides,
  } as never;
}

describe("useSaveChannel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("applies the input and returns the persisted channel", async () => {
    const persisted = makeChannel();
    const apply = vi.fn().mockResolvedValue(persisted);
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveChannel(), {
      wrapper: wrapper(client),
    });

    const input: ChannelInput = {
      name: "Support Slack",
      org: "acme",
      agentRef: { org: "acme", slug: "support-agent" },
      enabled: true,
      slack: {},
    };

    let returned: Channel | undefined;
    await act(async () => {
      returned = await result.current.save(input);
    });

    expect(apply).toHaveBeenCalledWith(input);
    expect(returned).toBe(persisted);
    expect(result.current.error).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it("updates a channel naming only the patch's fields, on its id and the etag it was loaded at", async () => {
    const update = vi.fn().mockResolvedValue(makeChannel());
    const client = createMockStigmer({ update });

    const { result } = renderHook(() => useSaveChannel(), {
      wrapper: wrapper(client),
    });

    const boundChannel = makeChannel({
      metadata: { id: "chn_1", name: "Support Slack", slug: "support-slack", org: "acme", labels: {}, etag: "etag-at-load" },
      spec: {
        agentRef: { org: "acme", slug: "support-agent" },
        enabled: true,
        type: { case: "slack", value: { appRef: { org: "acme", slug: "acme-support-app" } } },
        vaults: [{ org: "acme", slug: "github-credentials" }],
      },
    });

    await act(async () => {
      await result.current.update(boundChannel, { enabled: false });
    });

    // The disable toggle names `spec.enabled` alone: the agent reference,
    // the provider marker, the serving-app binding and the bound
    // credentials keep their stored values without being sent back.
    const sent = sentUpdate<Channel>(update);
    expect(sent.paths).toEqual(["spec.enabled"]);
    expect(sent.id).toBe("chn_1");
    expect(sent.etag).toBe("etag-at-load");
    expect(sent.resource.spec?.enabled).toBe(false);
  });

  it("names a key set to undefined, which clears that field", async () => {
    const update = vi.fn().mockResolvedValue(makeChannel());
    const client = createMockStigmer({ update });
    const { result } = renderHook(() => useSaveChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.update(makeChannel(), {
        runConfig: undefined,
        vaults: [{ org: "acme", slug: "github-credentials" }],
      });
    });

    const sent = sentUpdate<Channel>(update);
    expect(sent.paths).toEqual(["spec.run_config", "spec.vaults"]);
    expect(sent.resource.spec?.runConfig).toBeUndefined();
    expect(sentRefs(sent.resource.spec?.vaults)).toEqual([{ org: "acme", slug: "github-credentials" }]);
  });

  it("names a type's settings field by field, so the arm's other settings keep their stored values", async () => {
    const update = vi.fn().mockResolvedValue(makeChannel());
    const client = createMockStigmer({ update });
    const { result } = renderHook(() => useSaveChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.update(makeChannel(), { whatsapp: { proactiveMessagingEnabled: true } });
    });
    await act(async () => {
      await result.current.update(makeChannel(), {
        web: { audience: ChannelAudience.org, allowedOrigins: [] },
      });
    });
    await act(async () => {
      await result.current.update(makeChannel(), { slack: {} });
    });

    expect(update.mock.calls[0][1]).toEqual(["spec.whatsapp.proactive_messaging_enabled"]);
    expect(update.mock.calls[1][1]).toEqual(["spec.web.audience", "spec.web.allowed_origins"]);
    // An empty arm names the arm whole.
    expect(update.mock.calls[2][1]).toEqual(["spec.slack"]);
  });

  it("tracks isPending during the flight", async () => {
    let resolveApply: (value: unknown) => void = () => {};
    const apply = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveApply = resolve; }),
    );
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveChannel(), {
      wrapper: wrapper(client),
    });

    let savePromise: Promise<unknown> = Promise.resolve();
    act(() => {
      savePromise = result.current.save({
        name: "x",
        org: "acme",
        agentRef: { org: "acme", slug: "a" },
        slack: {},
      });
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      resolveApply({});
      await savePromise;
    });
    expect(result.current.isPending).toBe(false);
  });

  it("captures and rethrows save failures", async () => {
    const apply = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(
        result.current.save({
          name: "x",
          org: "acme",
          agentRef: { org: "acme", slug: "a" },
          slack: {},
        }),
      ).rejects.toThrow("quota exceeded");
    });

    expect(result.current.error?.message).toBe("quota exceeded");
    expect(result.current.isPending).toBe(false);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
