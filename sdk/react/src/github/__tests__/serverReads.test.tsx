/**
 * The console's GitHub reads go through the server's GitHub query RPCs with
 * the login saved in My vault: the repository list and branches, search,
 * the tree lister and the file reader each call `GitHubQueryController`,
 * pass the organization whose My vault holds the login, and never call
 * `fetch` (so nothing in the page reaches api.github.com or holds a token).
 * Pins, too, the readers' contracts kept from the browser era: readRef over
 * branch over "main", null for non-git and non-GitHub entries, the typed
 * not-found, the too-large report, and the truncation marker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { GitHubQueryController } from "@stigmer/protos/ai/stigmer/platform/github/v1/query_pb";
import {
  GitHubBranchListSchema,
  GitHubFileContentSchema,
  GitHubRepositoryListSchema,
  GitHubRepositorySchema,
  GitHubTreeSchema,
  type GetGitHubFileContentInput,
  type GetGitHubTreeInput,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/io_pb";
import { StigmerContext } from "../../context";
import { WorkspaceFileNotFoundError } from "../../workspace/WorkspaceFileReader";
import type { WorkspaceEntry } from "../../workspace/useWorkspaceEntries";
import { useGitHubFileReader } from "../useGitHubFileReader";
import { useGitHubRepos } from "../useGitHubRepos";
import { useGitHubSearch } from "../useGitHubSearch";
import { useGitHubTreeLister } from "../useGitHubTreeLister";

const ORG = "org_acme";

function gitEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: "ws-1",
    name: "acme/api",
    type: "git",
    gitUrl: "https://github.com/acme/api",
    gitBranch: "dev",
    ...overrides,
  };
}

const REPO = create(GitHubRepositorySchema, {
  id: 7n,
  fullName: "acme/api",
  name: "api",
  owner: "acme",
  ownerIsOrganization: true,
  htmlUrl: "https://github.com/acme/api",
  cloneUrl: "https://github.com/acme/api.git",
  defaultBranch: "main",
  isPrivate: true,
  updatedAt: "2026-10-01T00:00:00Z",
});

interface Calls {
  tree: GetGitHubTreeInput[];
  file: GetGitHubFileContentInput[];
}

function wrapperWith(
  calls: Calls,
  opts: {
    fileMissing?: boolean;
    fileError?: boolean;
    treeError?: boolean;
    twoPages?: boolean;
    tooLarge?: boolean;
    truncated?: boolean;
  } = {},
) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(GitHubQueryController, {
        listRepositories: (input) =>
          opts.twoPages && input.page === 1
            ? create(GitHubRepositoryListSchema, { repositories: [REPO], hasMore: true })
            : create(GitHubRepositoryListSchema, {
                repositories: opts.twoPages ? [{ ...REPO, id: 8n, fullName: "acme/web", name: "web" }] : [REPO],
                hasMore: false,
              }),
        searchRepositories: () => create(GitHubRepositoryListSchema, { repositories: [REPO], hasMore: false }),
        listBranches: () => create(GitHubBranchListSchema, { names: ["main", "dev"] }),
        getTree: (input) => {
          calls.tree.push(input);
          if (opts.treeError) throw new ConnectError("connect GitHub first", Code.FailedPrecondition);
          return create(GitHubTreeSchema, {
            entries: [
              { path: "src", isDirectory: true },
              { path: "src/index.ts", isDirectory: false, size: 42n },
            ],
            truncated: opts.truncated ?? false,
          });
        },
        getFileContent: (input) => {
          calls.file.push(input);
          if (opts.fileMissing) throw new ConnectError("no such file", Code.NotFound);
          if (opts.fileError) throw new ConnectError("connect GitHub first", Code.FailedPrecondition);
          return create(GitHubFileContentSchema, opts.tooLarge
            ? { size: 50_000_000n, tooLarge: true }
            : { content: new TextEncoder().encode("hello"), size: 5n });
        },
      });
    }),
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  };
}

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchSpy.mockReset();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("GitHub reads through the server", () => {
  it("lists repositories and branches with the organization, never calling fetch", async () => {
    const calls: Calls = { tree: [], file: [] };
    const { result } = renderHook(() => useGitHubRepos(ORG), { wrapper: wrapperWith(calls) });

    await waitFor(() => expect(result.current.repos).toHaveLength(1));
    expect(result.current.repos[0]).toMatchObject({ id: 7, fullName: "acme/api", ownerType: "Organization", isPrivate: true });
    await expect(result.current.fetchBranches("acme", "api")).resolves.toEqual([{ name: "main" }, { name: "dev" }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("searches through the server, never calling fetch", async () => {
    const calls: Calls = { tree: [], file: [] };
    const { result } = renderHook(() => useGitHubSearch(ORG), { wrapper: wrapperWith(calls) });

    act(() => result.current.setQuery("api"));
    await waitFor(() => expect(result.current.results).toHaveLength(1), { timeout: 2_000 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists a tree at readRef over the branch, with the truncation marker", async () => {
    const calls: Calls = { tree: [], file: [] };
    const { result } = renderHook(() => useGitHubTreeLister(ORG), { wrapper: wrapperWith(calls, { truncated: true }) });

    const entries = await result.current!(gitEntry({ readRef: "abc123" }));
    expect(calls.tree[0]).toMatchObject({ org: ORG, owner: "acme", repo: "api", ref: "abc123" });
    expect(entries?.slice(0, 2)).toEqual([
      { path: "src", isDirectory: true },
      { path: "src/index.ts", isDirectory: false },
    ]);
    expect(entries?.[2]?.notice).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads a file at readRef over the branch", async () => {
    const calls: Calls = { tree: [], file: [] };
    const { result } = renderHook(() => useGitHubFileReader(ORG), { wrapper: wrapperWith(calls) });

    await result.current!(gitEntry({ readRef: "abc123" }), "src/new.ts");
    expect(calls.file[0]).toMatchObject({ org: ORG, owner: "acme", repo: "api", ref: "abc123", path: "src/new.ts" });

    await result.current!(gitEntry(), "src/index.ts");
    expect(calls.file[1]).toMatchObject({ ref: "dev", path: "src/index.ts" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads a file at the branch, defaulting to main", async () => {
    const calls: Calls = { tree: [], file: [] };
    const { result } = renderHook(() => useGitHubFileReader(ORG), { wrapper: wrapperWith(calls) });

    const content = await result.current!(gitEntry({ gitBranch: undefined }), "README.md");
    expect(calls.file[0]).toMatchObject({ org: ORG, owner: "acme", repo: "api", ref: "main", path: "README.md" });
    expect(content?.text).toBe("hello");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws the typed not-found for a file not at the ref", async () => {
    const calls: Calls = { tree: [], file: [] };
    const { result } = renderHook(() => useGitHubFileReader(ORG), { wrapper: wrapperWith(calls, { fileMissing: true }) });

    await expect(result.current!(gitEntry(), "new.ts")).rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
  });

  it("reports a file above the ceiling as too large, by size", async () => {
    const calls: Calls = { tree: [], file: [] };
    const { result } = renderHook(() => useGitHubFileReader(ORG), { wrapper: wrapperWith(calls, { tooLarge: true }) });

    const content = await result.current!(gitEntry(), "big.bin");
    expect(content).toMatchObject({ text: null, truncated: true, size: 50_000_000 });
  });

  it("has no lister or reader without a connection, and null for entries it cannot read", async () => {
    const calls: Calls = { tree: [], file: [] };
    const wrapper = wrapperWith(calls);
    expect(renderHook(() => useGitHubTreeLister(null), { wrapper }).result.current).toBeUndefined();
    expect(renderHook(() => useGitHubFileReader(null), { wrapper }).result.current).toBeUndefined();

    const lister = renderHook(() => useGitHubTreeLister(ORG), { wrapper }).result.current!;
    await expect(lister({ id: "l", name: "x", type: "local", localPath: "/x" })).resolves.toBeNull();
    await expect(lister(gitEntry({ gitUrl: "https://gitlab.com/acme/api" }))).resolves.toBeNull();
    expect(calls.tree).toEqual([]);
  });

  it("reads every further page in the background", async () => {
    const calls: Calls = { tree: [], file: [] };
    const { result } = renderHook(() => useGitHubRepos(ORG), { wrapper: wrapperWith(calls, { twoPages: true }) });
    await waitFor(() => expect(result.current.repos.map((r) => r.fullName)).toEqual(["acme/api", "acme/web"]));
  });

  it("lists no branches without an organization", async () => {
    const calls: Calls = { tree: [], file: [] };
    const { result } = renderHook(() => useGitHubRepos(null), { wrapper: wrapperWith(calls) });
    await expect(result.current.fetchBranches("acme", "api")).resolves.toEqual([]);
  });

  it("answers null for an entry the reader cannot read, null when the tree read fails, and passes on other failures", async () => {
    const calls: Calls = { tree: [], file: [] };
    const reader = renderHook(() => useGitHubFileReader(ORG), { wrapper: wrapperWith(calls, { fileError: true }) }).result
      .current!;
    await expect(reader({ id: "l", name: "x", type: "local", localPath: "/x" }, "a")).resolves.toBeNull();
    await expect(reader(gitEntry({ gitUrl: "https://gitlab.com/acme/api" }), "a")).resolves.toBeNull();
    await expect(reader(gitEntry(), "a")).rejects.toThrow(/connect GitHub first/);

    const lister = renderHook(() => useGitHubTreeLister(ORG), { wrapper: wrapperWith(calls, { treeError: true }) }).result
      .current!;
    await expect(lister(gitEntry())).resolves.toBeNull();
  });
});
