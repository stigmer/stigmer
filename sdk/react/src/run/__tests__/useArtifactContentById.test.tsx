import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useArtifactContentById } from "../useArtifactContentById";

function wrapperFor(stigmer: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
  );
}

function makeStigmer(getContent = vi.fn()) {
  return { artifact: { getContent } } as unknown as Stigmer;
}

function contentResponse(text: string, overrides: Record<string, unknown> = {}) {
  return {
    content: new TextEncoder().encode(text),
    contentType: "application/json",
    totalSizeBytes: BigInt(text.length),
    truncated: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useArtifactContentById", () => {
  it("fetches by artifact id and decodes the content as UTF-8", async () => {
    const getContent = vi.fn().mockResolvedValue(contentResponse('{"a":1}'));
    const { result } = renderHook(() => useArtifactContentById("art_1"), {
      wrapper: wrapperFor(makeStigmer(getContent)),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getContent).toHaveBeenCalledTimes(1);
    expect(getContent.mock.calls[0][0]).toMatchObject({ artifactId: "art_1" });
    expect(result.current.content).toBe('{"a":1}');
    expect(result.current.contentType).toBe("application/json");
    expect(result.current.error).toBeNull();
  });

  it("surfaces the server's truncation contract", async () => {
    const getContent = vi.fn().mockResolvedValue(
      contentResponse("partial", {
        truncated: true,
        totalSizeBytes: BigInt(2_000_000),
      }),
    );
    const { result } = renderHook(() => useArtifactContentById("art_1"), {
      wrapper: wrapperFor(makeStigmer(getContent)),
    });

    await waitFor(() => expect(result.current.isTruncated).toBe(true));
    expect(result.current.totalSizeBytes).toBe(BigInt(2_000_000));
    expect(result.current.content).toBe("partial");
  });

  it("returns the error state when the fetch fails", async () => {
    const getContent = vi.fn().mockRejectedValue(new Error("blob deleted"));
    const { result } = renderHook(() => useArtifactContentById("art_1"), {
      wrapper: wrapperFor(makeStigmer(getContent)),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("blob deleted");
    expect(result.current.content).toBeNull();
  });

  it("skips fetching entirely when artifactId is null", async () => {
    const getContent = vi.fn();
    const { result } = renderHook(() => useArtifactContentById(null), {
      wrapper: wrapperFor(makeStigmer(getContent)),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.content).toBeNull();
    expect(getContent).not.toHaveBeenCalled();
  });
});
