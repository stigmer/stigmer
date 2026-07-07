import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGitHubFileReader } from "../useGitHubFileReader";
import { WorkspaceFileNotFoundError } from "../../workspace/WorkspaceFileReader";
import type { WorkspaceEntry } from "../../workspace/useWorkspaceEntries";

function gitEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: "ws-1",
    name: "acme/api",
    type: "git",
    gitUrl: "https://github.com/acme/api",
    gitBranch: "main",
    ...overrides,
  };
}

function localEntry(): WorkspaceEntry {
  return {
    id: "ws-2",
    name: "/Users/dev/project",
    type: "local",
    localPath: "/Users/dev/project",
  };
}

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("useGitHubFileReader", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns undefined when token is null", () => {
    const { result } = renderHook(() => useGitHubFileReader(null));
    expect(result.current).toBeUndefined();
  });

  it("returns a reader function when a token is provided", () => {
    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    expect(typeof result.current).toBe("function");
  });

  it("returns null for non-git entries without fetching", async () => {
    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    const content = await result.current!(localEntry(), "src/index.ts");
    expect(content).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns null for non-GitHub git URLs", async () => {
    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    const content = await result.current!(
      gitEntry({ gitUrl: "https://gitlab.com/acme/api" }),
      "src/index.ts",
    );
    expect(content).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("decodes a base64 text file from the Contents API", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ encoding: "base64", size: 12, content: b64("Hello World!"), sha: "s1" }),
    );

    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    const content = await result.current!(gitEntry(), "src/index.ts");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/api/contents/src/index.ts?ref=main",
      { headers: { Authorization: "Bearer ghp_abc" } },
    );
    expect(content).toEqual({
      text: "Hello World!",
      isBinary: false,
      size: 12,
      encoding: "utf-8",
    });
  });

  it("encodes the path per segment and the branch", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ encoding: "base64", size: 1, content: b64("x"), sha: "s1" }),
    );

    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    await result.current!(
      gitEntry({ gitBranch: "feat/my branch" }),
      "src/a b/c#d.ts",
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/api/contents/src/a%20b/c%23d.ts?ref=feat%2Fmy%20branch",
      expect.anything(),
    );
  });

  it("defaults to the main branch when gitBranch is undefined", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ encoding: "base64", size: 1, content: b64("x"), sha: "s1" }),
    );

    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    await result.current!(gitEntry({ gitBranch: undefined }), "f.ts");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("?ref=main"),
      expect.anything(),
    );
  });

  it("throws the typed WorkspaceFileNotFoundError on a 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("nope", { status: 404 }));

    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    await expect(result.current!(gitEntry(), "missing.ts")).rejects.toThrow(
      WorkspaceFileNotFoundError,
    );
  });

  it("throws a generic error (not the typed not-found) on other non-OK responses", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("boom", { status: 500 }));

    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    const error = await result.current!(gitEntry(), "src/index.ts").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HTTP 500");
    expect(error).not.toBeInstanceOf(WorkspaceFileNotFoundError);
  });

  it("reads at readRef in preference to gitBranch when both are set", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ encoding: "base64", size: 1, content: b64("x"), sha: "s1" }),
    );

    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    await result.current!(
      gitEntry({ gitBranch: "main", readRef: "abc123def456" }),
      "notes.md",
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("?ref=abc123def456"),
      expect.anything(),
    );
  });

  it("throws when the path is a directory (Contents API returns an array)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse([{ name: "index.ts" }]));

    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    await expect(result.current!(gitEntry(), "src")).rejects.toThrow("is a directory");
  });

  it("falls back to the Blob API when Contents returns encoding:none", async () => {
    const big = "x".repeat(2_000_000); // > 1 MB, ≤ 10 MB ceiling
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        jsonResponse({ encoding: "none", size: big.length, content: "", sha: "blobsha" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ encoding: "base64", size: big.length, content: b64(big) }),
      );

    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    const content = await result.current!(gitEntry(), "big.txt");

    expect(vi.mocked(globalThis.fetch).mock.calls[1][0]).toBe(
      "https://api.github.com/repos/acme/api/git/blobs/blobsha",
    );
    expect(content!.size).toBe(big.length);
    expect(content!.truncated).toBe(true);
    expect(content!.text).toHaveLength(1_048_576);
  });

  it("reports files above the blob ceiling as too-large without downloading", async () => {
    const hugeSize = 50 * 1024 * 1024; // 50 MB > 10 MB ceiling
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ encoding: "none", size: hugeSize, content: "", sha: "blobsha" }),
    );

    const { result } = renderHook(() => useGitHubFileReader("ghp_abc"));
    const content = await result.current!(gitEntry(), "huge.bin");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no blob download
    expect(content).toEqual({
      text: null,
      isBinary: false,
      size: hugeSize,
      encoding: "none",
      truncated: true,
    });
  });

  it("returns a stable reader reference across renders", () => {
    const { result, rerender } = renderHook(() => useGitHubFileReader("ghp_abc"));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
