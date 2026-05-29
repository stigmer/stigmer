import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGitHubTreeLister } from "../useGitHubTreeLister";
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

const SAMPLE_TREE_RESPONSE = {
  sha: "abc123",
  url: "https://api.github.com/repos/acme/api/git/trees/abc123",
  truncated: false,
  tree: [
    { path: "src", mode: "040000", type: "tree", sha: "a1", url: "" },
    { path: "src/index.ts", mode: "100644", type: "blob", sha: "a2", size: 42, url: "" },
    { path: "README.md", mode: "100644", type: "blob", sha: "a3", size: 100, url: "" },
    { path: ".gitmodules", mode: "160000", type: "commit", sha: "a4", url: "" },
  ],
};

describe("useGitHubTreeLister", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns undefined when token is null", () => {
    const { result } = renderHook(() => useGitHubTreeLister(null));
    expect(result.current).toBeUndefined();
  });

  it("returns a lister function when token is provided", () => {
    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    expect(typeof result.current).toBe("function");
  });

  it("returns null for non-git entries", async () => {
    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    const files = await result.current!(localEntry());
    expect(files).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns null for entries without gitUrl", async () => {
    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    const files = await result.current!(gitEntry({ gitUrl: undefined }));
    expect(files).toBeNull();
  });

  it("returns null for non-GitHub git URLs", async () => {
    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    const files = await result.current!(
      gitEntry({ gitUrl: "https://gitlab.com/acme/api" }),
    );
    expect(files).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fetches tree and maps blob/tree entries", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_TREE_RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    const files = await result.current!(gitEntry());

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/api/git/trees/main?recursive=1",
      { headers: { Authorization: "Bearer ghp_abc" } },
    );

    expect(files).toEqual([
      { path: "src", isDirectory: true },
      { path: "src/index.ts", isDirectory: false },
      { path: "README.md", isDirectory: false },
    ]);
  });

  it("filters out commit entries (submodules)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_TREE_RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    const files = await result.current!(gitEntry());

    const paths = files!.map((f) => f.path);
    expect(paths).not.toContain(".gitmodules");
  });

  it("appends a truncation marker when API indicates truncation", async () => {
    const truncated = { ...SAMPLE_TREE_RESPONSE, truncated: true };
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(truncated), { status: 200 }),
    );

    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    const files = await result.current!(gitEntry());

    const last = files![files!.length - 1];
    expect(last.path).toContain("truncated");
    expect(last.isDirectory).toBe(false);
  });

  it("returns null on non-OK response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );

    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    const files = await result.current!(gitEntry());
    expect(files).toBeNull();
  });

  it("defaults to 'main' branch when gitBranch is undefined", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_TREE_RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    await result.current!(gitEntry({ gitBranch: undefined }));

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/git/trees/main?"),
      expect.anything(),
    );
  });

  it("encodes branch names with special characters", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_TREE_RESPONSE), { status: 200 }),
    );

    const { result } = renderHook(() => useGitHubTreeLister("ghp_abc"));
    await result.current!(gitEntry({ gitBranch: "feat/my branch" }));

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/git/trees/feat%2Fmy%20branch?"),
      expect.anything(),
    );
  });
});
