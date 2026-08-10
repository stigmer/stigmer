import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useConversationMediaUrl } from "../useConversationMediaUrl";

function wrapperFor(stigmer: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

function makeStigmer(getMediaDownloadUrl = vi.fn()) {
  return { agentChannel: { getMediaDownloadUrl } } as unknown as Stigmer;
}

describe("useConversationMediaUrl", () => {
  it("mints a fresh URL from the item's conversation address", async () => {
    const fn = vi.fn().mockResolvedValue({ url: "https://fresh/1" });
    const { result } = renderHook(
      () => useConversationMediaUrl("ach-1", "15551234567", "wa:abc"),
      { wrapper: wrapperFor(makeStigmer(fn)) },
    );

    await waitFor(() => expect(result.current.url).toBe("https://fresh/1"));
    expect(fn).toHaveBeenCalledTimes(1);
    const req = fn.mock.calls[0][0];
    expect(req.agentChannelId).toBe("ach-1");
    expect(req.conversationKey).toBe("15551234567");
    expect(req.itemId).toBe("wa:abc");
  });

  it("stays idle when disabled", () => {
    const fn = vi.fn();
    const { result } = renderHook(
      () => useConversationMediaUrl("ach-1", "15551234567", "wa:abc", { enabled: false }),
      { wrapper: wrapperFor(makeStigmer(fn)) },
    );
    expect(result.current.url).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("skips fetching while any address part is empty", () => {
    const fn = vi.fn();
    const { result } = renderHook(
      () => useConversationMediaUrl("ach-1", "", "wa:abc"),
      { wrapper: wrapperFor(makeStigmer(fn)) },
    );
    expect(result.current.url).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("reports a failed mint as an error, never a broken URL", async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error("no downloadable media at this timeline item"));
    const { result } = renderHook(
      () => useConversationMediaUrl("ach-1", "15551234567", "wa:abc"),
      { wrapper: wrapperFor(makeStigmer(fn)) },
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.url).toBeNull();
  });
});
