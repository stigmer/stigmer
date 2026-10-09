/**
 * Pins GitHubClient against an in-process server: each repository read
 * sends its organization and arguments to GitHubQueryController and returns the server's answer as it came; and a
 * server refusal reaches the caller as a StigmerError with its code (the
 * "connect GitHub first" precondition a caller with no saved login gets).
 */
import { describe, expect, it } from "vitest";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  GitHubBranchListSchema,
  GitHubFileContentSchema,
  GitHubRepositoryListSchema,
  GitHubTreeSchema,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/io_pb";
import { GitHubQueryController } from "@stigmer/protos/ai/stigmer/platform/github/v1/query_pb";

import { GitHubClient } from "../github";
import { StigmerError } from "../gen/errors";

/** Every request the fake server saw, by method name. */
type Seen = Record<string, unknown>;

function clientWith(seen: Seen, refuse = false): GitHubClient {
  const refusal = () => {
    throw new ConnectError("connect GitHub first", Code.FailedPrecondition);
  };
  return new GitHubClient(
    createRouterTransport(({ service }) => {
      service(GitHubQueryController, {
        listRepositories: (req) => {
          if (refuse) refusal();
          seen.list = { org: req.org, page: req.page };
          return create(GitHubRepositoryListSchema, {
            repositories: [{ fullName: "acme/app", name: "app", owner: "acme" }],
            hasMore: true,
          });
        },
        searchRepositories: (req) => {
          if (refuse) refusal();
          seen.search = { org: req.org, query: req.query, page: req.page };
          return create(GitHubRepositoryListSchema, { repositories: [], hasMore: false });
        },
        listBranches: (req) => {
          if (refuse) refusal();
          seen.branches = { org: req.org, owner: req.owner, repo: req.repo };
          return create(GitHubBranchListSchema, { names: ["main", "dev"] });
        },
        getTree: (req) => {
          if (refuse) refusal();
          seen.tree = { org: req.org, owner: req.owner, repo: req.repo, ref: req.ref };
          return create(GitHubTreeSchema, {
            entries: [{ path: "src", isDirectory: true }],
            truncated: false,
          });
        },
        getFileContent: (req) => {
          if (refuse) refusal();
          seen.file = { org: req.org, ref: req.ref, path: req.path };
          return create(GitHubFileContentSchema, {
            content: new TextEncoder().encode("hello"),
            size: 5n,
          });
        },
      });
    }),
  );
}

describe("GitHubClient", () => {
  it("sends every repository read to the server with its organization and arguments", async () => {
    const seen: Seen = {};
    const client = clientWith(seen);

    const repos = await client.listRepositories({ org: "acme", page: 2 });
    expect(repos.repositories[0]?.fullName).toBe("acme/app");
    expect(repos.hasMore).toBe(true);
    expect(seen.list).toEqual({ org: "acme", page: 2 });

    await client.searchRepositories({ org: "acme", query: "app", page: 1 });
    expect(seen.search).toEqual({ org: "acme", query: "app", page: 1 });

    const branches = await client.listBranches({ org: "acme", owner: "acme", repo: "app" });
    expect(branches.names).toEqual(["main", "dev"]);
    expect(seen.branches).toEqual({ org: "acme", owner: "acme", repo: "app" });

    const tree = await client.getTree({ org: "acme", owner: "acme", repo: "app", ref: "main" });
    expect(tree.entries[0]?.isDirectory).toBe(true);
    expect(seen.tree).toEqual({ org: "acme", owner: "acme", repo: "app", ref: "main" });

    const file = await client.getFileContent({
      org: "acme",
      owner: "acme",
      repo: "app",
      ref: "main",
      path: "README.md",
    });
    expect(new TextDecoder().decode(file.content)).toBe("hello");
    expect(seen.file).toEqual({ org: "acme", ref: "main", path: "README.md" });
  });

  it("surfaces a server refusal as a StigmerError with its code", async () => {
    const client = clientWith({}, true);
    const read = client.listRepositories({ org: "acme", page: 1 });
    await expect(read).rejects.toBeInstanceOf(StigmerError);
    await expect(read).rejects.toMatchObject({ code: "failed-precondition" });
    const repo = { org: "acme", owner: "acme", repo: "app" };
    for (const call of [
      client.searchRepositories({ org: "acme", query: "q", page: 1 }),
      client.listBranches(repo),
      client.getTree({ ...repo, ref: "main" }),
      client.getFileContent({ ...repo, ref: "main", path: "a" }),
    ]) {
      await expect(call).rejects.toMatchObject({ code: "failed-precondition" });
    }
  });
});
