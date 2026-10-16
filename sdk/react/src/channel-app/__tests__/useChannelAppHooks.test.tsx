import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ChannelAppInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useChannelAppList } from "../useChannelAppList";
import { useCreateChannelApp } from "../useCreateChannelApp";
import { useUpdateChannelApp } from "../useUpdateChannelApp";
import { useDeleteChannelApp } from "../useDeleteChannelApp";

function createMockStigmer(channelapp: Record<string, unknown>) {
  return { channelapp } as never;
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

const APP = {
  metadata: { id: "chapp_1", name: "Acme Support Bot", org: "acme", slug: "acme-support-bot" },
  spec: {
    providerConfig: {
      case: "slack",
      value: { clientId: "1234.5678", clientSecret: "***REDACTED***", signingSecret: "***REDACTED***" },
    },
  },
};

describe("useChannelAppList", () => {
  it("fetches the org's channel apps", async () => {
    const list = vi.fn().mockResolvedValue({ entries: [APP], nextPageToken: "" });
    const client = createMockStigmer({ list });

    const { result } = renderHook(() => useChannelAppList("acme"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.channelApps).toHaveLength(1);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ org: "acme" }),
    );
  });

  it("skips fetching while org is null (unresolved org)", () => {
    const list = vi.fn();
    const client = createMockStigmer({ list });

    const { result } = renderHook(() => useChannelAppList(null), {
      wrapper: wrapper(client),
    });

    expect(list).not.toHaveBeenCalled();
    expect(result.current.channelApps).toEqual([]);
  });
});

describe("useCreateChannelApp", () => {
  it("creates and returns the server resource", async () => {
    const create = vi.fn().mockResolvedValue(APP);
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateChannelApp(), {
      wrapper: wrapper(client),
    });

    const input: ChannelAppInput = {
      name: "Acme Support Bot",
      org: "acme",
      slack: { clientId: "1234.5678", clientSecret: "s", signingSecret: "s2" },
    };

    await act(async () => {
      await result.current.create(input);
    });

    expect(create).toHaveBeenCalledWith(input);
    expect(result.current.error).toBeNull();
  });

  it("captures and rethrows failures", async () => {
    const create = vi.fn().mockRejectedValue(new Error("unauthorized to create channel app in this organization"));
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateChannelApp(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(
        result.current.create({ name: "x", org: "acme" }),
      ).rejects.toThrow("unauthorized");
    });
    expect(result.current.error?.message).toContain("unauthorized");
  });
});

describe("useUpdateChannelApp", () => {
  it("passes redaction markers through untouched — the keep-stored-value contract", async () => {
    const update = vi.fn().mockResolvedValue(APP);
    const client = createMockStigmer({ update });

    const { result } = renderHook(() => useUpdateChannelApp(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.update(
        {
          metadata: { id: "chapp_1", etag: "etag-at-load" },
          spec: {
            providerConfig: {
              case: "slack",
              value: { clientId: "1234.5678", clientSecret: "***REDACTED***", signingSecret: "rotated" },
            },
          },
        },
        ["spec.slack"],
      );
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ id: "chapp_1", etag: "etag-at-load" }),
        spec: expect.objectContaining({
          providerConfig: expect.objectContaining({
            value: expect.objectContaining({ clientSecret: "***REDACTED***", signingSecret: "rotated" }),
          }),
        }),
      }),
      ["spec.slack"],
    );
  });
});

describe("useDeleteChannelApp", () => {
  it("deletes by id and surfaces the referencing-channels refusal", async () => {
    const del = vi.fn().mockRejectedValue(
      new Error("Cannot delete channel app: 1 channel(s) still reference it via spec.app_ref."),
    );
    const client = createMockStigmer({ delete: del });

    const { result } = renderHook(() => useDeleteChannelApp(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(result.current.deleteApp("chapp_1")).rejects.toThrow(
        "still reference it",
      );
    });

    expect(del).toHaveBeenCalledWith({ resourceId: "chapp_1" });
    expect(result.current.error?.message).toContain("still reference it");
    expect(result.current.isDeleting).toBe(false);
  });
});
