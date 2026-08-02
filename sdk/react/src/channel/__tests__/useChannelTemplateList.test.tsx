import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ListChannelTemplatesInput } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useChannelTemplateList } from "../useChannelTemplateList";

function createMockStigmer(overrides: {
  listTemplates?: (input: ListChannelTemplatesInput) => Promise<unknown>;
} = {}) {
  return {
    agentChannel: {
      listTemplates:
        overrides.listTemplates ?? vi.fn().mockResolvedValue({ entries: [] }),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function makeTemplate(name: string, status: string) {
  return {
    name,
    language: "en_US",
    category: "UTILITY",
    status,
    parameterFormat: "POSITIONAL",
    parameterNames: [],
    bodyText: `Hi {{1}}, this is ${name}.`,
    headerFormat: "",
    rejectionReason: "",
    unsupportedReason: "",
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useChannelTemplateList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads templates by channel slug + org with the exact wire input", async () => {
    const listTemplates = vi
      .fn()
      .mockResolvedValue({ entries: [makeTemplate("fee_reminder", "APPROVED")] });
    const client = createMockStigmer({ listTemplates });

    const { result } = renderHook(
      () => useChannelTemplateList("wa-main", "acme"),
      { wrapper: wrapper(client) },
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0].name).toBe("fee_reminder");
    expect(result.current.error).toBeNull();
    // The RPC is keyed on slug + org, and the console's default leaves
    // approvedOnly unset so every status renders with its badge.
    expect(listTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "wa-main",
        org: "acme",
        approvedOnly: false,
      }),
    );
  });

  it("passes approvedOnly through when a caller sets it", async () => {
    const listTemplates = vi.fn().mockResolvedValue({ entries: [] });
    const client = createMockStigmer({ listTemplates });

    renderHook(
      () => useChannelTemplateList("wa-main", "acme", { approvedOnly: true }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() =>
      expect(listTemplates).toHaveBeenCalledWith(
        expect.objectContaining({ approvedOnly: true }),
      ),
    );
  });

  it("skips fetching when the channel slug is empty (stable no-op)", async () => {
    const listTemplates = vi.fn();
    const client = createMockStigmer({ listTemplates });

    const { result } = renderHook(() => useChannelTemplateList("", "acme"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.templates).toEqual([]);
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it("skips fetching when the org is empty (stable no-op)", async () => {
    const listTemplates = vi.fn();
    const client = createMockStigmer({ listTemplates });

    const { result } = renderHook(() => useChannelTemplateList("wa-main", ""), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.templates).toEqual([]);
    expect(listTemplates).not.toHaveBeenCalled();
  });

  it("surfaces the server's refusal verbatim", async () => {
    const listTemplates = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "unauthorized to use business messaging on this agent channel",
        ),
      );
    const client = createMockStigmer({ listTemplates });

    const { result } = renderHook(
      () => useChannelTemplateList("wa-main", "acme"),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe(
      "unauthorized to use business messaging on this agent channel",
    );
    expect(result.current.templates).toEqual([]);
  });

  it("polls at 60s while a template is PENDING and stops once none are", async () => {
    vi.useFakeTimers();

    // First answer holds a PENDING entry; every later answer is settled.
    let calls = 0;
    const listTemplates = vi.fn(async () => {
      calls += 1;
      return {
        entries:
          calls === 1
            ? [makeTemplate("fee_reminder", "PENDING")]
            : [makeTemplate("fee_reminder", "APPROVED")],
      };
    });
    const client = createMockStigmer({ listTemplates });

    const { result } = renderHook(
      () => useChannelTemplateList("wa-main", "acme"),
      { wrapper: wrapper(client) },
    );

    await flush();
    expect(listTemplates).toHaveBeenCalledTimes(1);
    expect(result.current.templates[0].status).toBe("PENDING");

    // The pending entry arms the poll; one interval later it re-reads.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(listTemplates).toHaveBeenCalledTimes(2);
    expect(result.current.templates[0].status).toBe("APPROVED");

    // Settled data disarms the poll — no further reads, ever.
    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    await flush();
    expect(listTemplates).toHaveBeenCalledTimes(2);
  });

  it("never polls when the first answer is already settled", async () => {
    vi.useFakeTimers();

    const listTemplates = vi.fn(async () => ({
      entries: [makeTemplate("fee_reminder", "APPROVED")],
    }));
    const client = createMockStigmer({ listTemplates });

    renderHook(() => useChannelTemplateList("wa-main", "acme"), {
      wrapper: wrapper(client),
    });

    await flush();
    expect(listTemplates).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    await flush();
    expect(listTemplates).toHaveBeenCalledTimes(1);
  });
});
