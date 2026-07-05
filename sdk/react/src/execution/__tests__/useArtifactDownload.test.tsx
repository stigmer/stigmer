import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useArtifactDownload } from "../useArtifactDownload";

function wrapperFor(stigmer: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

function makeStigmer(getArtifactDownloadUrl = vi.fn()) {
  return { agentExecution: { getArtifactDownloadUrl } } as unknown as Stigmer;
}

// Browser download is triggered via a transient anchor; stub the click so the
// jsdom navigation no-op doesn't add noise and we can keep the test focused on
// the URL-minting behavior.
beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

describe("useArtifactDownload", () => {
  it("mints a fresh URL at click time and toggles isDownloading", async () => {
    const fn = vi.fn().mockResolvedValue({ downloadUrl: "https://fresh/dl" });
    const { result } = renderHook(() => useArtifactDownload("aex_1"), {
      wrapper: wrapperFor(makeStigmer(fn)),
    });

    expect(result.current.isDownloading).toBe(false);
    await act(async () => {
      await result.current.download("artifacts/aex_1/file.bin", "file.bin");
    });

    expect(fn).toHaveBeenCalledTimes(1);
    const req = fn.mock.calls[0][0];
    expect(req.executionId).toBe("aex_1");
    expect(req.storageKey).toBe("artifacts/aex_1/file.bin");
    // Save-to-disk actions force an attachment disposition on the minted URL.
    expect(req.asAttachment).toBe(true);
    expect(result.current.isDownloading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("is a no-op when the execution id is unknown", async () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useArtifactDownload(null), {
      wrapper: wrapperFor(makeStigmer(fn)),
    });
    await act(async () => {
      await result.current.download("artifacts/x/file.bin");
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("surfaces an error when the refresh RPC fails", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useArtifactDownload("aex_1"), {
      wrapper: wrapperFor(makeStigmer(fn)),
    });
    await act(async () => {
      await result.current.download("artifacts/aex_1/file.bin");
    });
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.isDownloading).toBe(false);
  });
});
