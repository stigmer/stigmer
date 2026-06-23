import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useArtifactDownloadUrl } from "../useArtifactDownloadUrl";

function wrapperFor(stigmer: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

function makeStigmer(getArtifactDownloadUrl = vi.fn()) {
  return { agentExecution: { getArtifactDownloadUrl } } as unknown as Stigmer;
}

describe("useArtifactDownloadUrl", () => {
  it("mints a fresh URL on demand from the stable storage key", async () => {
    const fn = vi.fn().mockResolvedValue({ downloadUrl: "https://fresh/1" });
    const { result } = renderHook(
      () => useArtifactDownloadUrl("aex_1", "artifacts/aex_1/k1"),
      { wrapper: wrapperFor(makeStigmer(fn)) },
    );

    await waitFor(() => expect(result.current.url).toBe("https://fresh/1"));
    expect(fn).toHaveBeenCalledTimes(1);
    const req = fn.mock.calls[0][0];
    expect(req.executionId).toBe("aex_1");
    expect(req.storageKey).toBe("artifacts/aex_1/k1");
  });

  it("stays idle when disabled", () => {
    const fn = vi.fn();
    const { result } = renderHook(
      () => useArtifactDownloadUrl("aex_1", "artifacts/aex_1/k2", { enabled: false }),
      { wrapper: wrapperFor(makeStigmer(fn)) },
    );
    expect(result.current.url).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("skips fetching when either id is null", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useArtifactDownloadUrl(null, null), {
      wrapper: wrapperFor(makeStigmer(fn)),
    });
    expect(result.current.url).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });
});
