/**
 * Pins the GitHub reads the console makes through the server, so the page
 * never holds the token: each RPC uses the github.com login in the
 * caller's own My vault, server-side; none answers without one; another
 * entry in that vault no key opens never stops a read; nothing returned
 * carries the token; GitHub's answers map onto the console's
 * shapes (repositories, has_more from the Link header or the total, the
 * tree's directories and truncation, a file through the Contents API, the
 * Blob API past its cap, and the size alone past the ceiling); 401 says
 * reconnect, 404 is NOT_FOUND; the annotation's denial stops a read before
 * the vault is opened; an owner, repository, ref or path segment of "." or
 * ".." is refused before GitHub is called, so no read reaches another of
 * GitHub's endpoints with the caller's token.
 *
 * In-process router over a real sqlite store and vault service, with an
 * injected fetch — a test never leaves the host.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultSecretSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { GitHubQueryController } from "@stigmer/protos/ai/stigmer/platform/github/v1/query_pb";

import { createLogger } from "../../../boot/logger.js";
import { EncryptionScope, SecretService } from "../../../encryption/encryption.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { callerIdentityKey } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { newVaultService } from "../../vault/service.js";
import type { VaultService } from "../../vault/service.js";
import { VaultConnectionSource } from "../../vault/service.js";
import { FILE_CONTENT_CEILING_BYTES, RECONNECT_GITHUB } from "../api.js";
import { CONNECT_GITHUB_FIRST, registerGitHubServices } from "../controller.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ORG = "org_00000000000000000000000001";
const TOKEN = "gho_secret_token";
const alice = testCallerIdentity({ identityId: "ida_alice" });

let dir: string;
let store: SqliteStore;
let vaults: VaultService;
let calls: Array<{ url: string; authorization: string }>;
let routes: Map<string, () => Response>;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "github-queries-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
  vaults = newVaultService({
    store,
    logger: silentLogger,
    secretService: SecretService.create(undefined),
    authorizationLifecycle: undefined,
  });
  calls = [];
  routes = new Map();
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = String(input);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  calls.push({ url, authorization: headers["Authorization"] ?? "" });
  const route = routes.get(url);
  if (route === undefined) {
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  }
  return route();
}) as typeof fetch;

function json(body: unknown, headers: Record<string, string> = {}): () => Response {
  return () => new Response(JSON.stringify(body), { status: 200, headers });
}

function client(authorizer: Authorizer = newPermissiveSingleTeamAuthorizer()) {
  const stamp: Interceptor = (next) => (request) => {
    request.contextValues.set(callerIdentityKey, alice);
    return next(request);
  };
  const transport = createRouterTransport(
    (router) => {
      registerGitHubServices(router, {
        logger: silentLogger,
        authorizer,
        vaults,
        fetchImpl,
      });
    },
    { router: { interceptors: [stamp] } },
  );
  return createClient(GitHubQueryController, transport);
}

async function connectGitHub(): Promise<void> {
  const mine = await vaults.ensureMine(ORG, alice);
  await vaults.setConnection(
    mine.metadata!.id,
    "github.com",
    { token: TOKEN, source: VaultConnectionSource.sign_in },
    alice,
  );
}

async function refusal(run: () => Promise<unknown>): Promise<ConnectError> {
  const error = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

const REPO = {
  id: 42,
  full_name: "acme/app",
  name: "app",
  owner: { login: "acme", type: "Organization" },
  html_url: "https://github.com/acme/app",
  clone_url: "https://github.com/acme/app.git",
  default_branch: "main",
  private: true,
  updated_at: "2026-10-01T00:00:00Z",
};

describe("without a saved GitHub login", () => {
  it("every read refuses with FAILED_PRECONDITION and calls nothing", async () => {
    const c = client();
    const reads = [
      () => c.listRepositories({ org: ORG, page: 1 }),
      () => c.searchRepositories({ org: ORG, query: "app", page: 1 }),
      () => c.listBranches({ org: ORG, owner: "acme", repo: "app" }),
      () => c.getTree({ org: ORG, owner: "acme", repo: "app", ref: "main" }),
      () => c.getFileContent({ org: ORG, owner: "acme", repo: "app", ref: "main", path: "a" }),
    ];
    for (const read of reads) {
      const error = await refusal(read);
      expect(error.code).toBe(Code.FailedPrecondition);
      expect(error.rawMessage).toBe(CONNECT_GITHUB_FIRST);
    }
    expect(calls).toEqual([]);
  });

  it("a teammate's login is never used for the caller", async () => {
    const ben = testCallerIdentity({ identityId: "ida_ben" });
    const theirs = await vaults.ensureMine(ORG, ben);
    await vaults.setConnection(
      theirs.metadata!.id,
      "github.com",
      { token: "gho_ben", source: VaultConnectionSource.sign_in },
      ben,
    );
    const error = await refusal(() => client().listRepositories({ org: ORG, page: 1 }));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(calls).toEqual([]);
  });

  it("the annotation's denial stops a read before the vault is opened", async () => {
    await connectGitHub();
    const denying: Authorizer = {
      authorize: () => Promise.resolve({ kind: "deny", reason: "" }),
    };
    const error = await refusal(() => client(denying).listRepositories({ org: ORG, page: 1 }));
    expect(error.code).toBe(Code.PermissionDenied);
    expect(calls).toEqual([]);
  });
});

describe("with the caller's saved login", () => {
  beforeEach(connectGitHub);

  it("lists repositories server-side with the saved token, and the answer carries no token", async () => {
    routes.set(
      "https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=100&page=2",
      json([REPO], { link: '<https://api.github.com/user/repos?page=3>; rel="next"' }),
    );
    const out = await client().listRepositories({ org: ORG, page: 2 });
    expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(out.hasMore).toBe(true);
    expect(out.repositories).toHaveLength(1);
    const repo = out.repositories[0]!;
    expect(repo.fullName).toBe("acme/app");
    expect(repo.owner).toBe("acme");
    expect(repo.ownerIsOrganization).toBe(true);
    expect(repo.cloneUrl).toBe("https://github.com/acme/app.git");
    expect(repo.defaultBranch).toBe("main");
    expect(repo.isPrivate).toBe(true);
    expect(repo.id).toBe(42n);
    expect(JSON.stringify(out, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))).not.toContain(TOKEN);
  });

  it("a page without a next link has no more", async () => {
    routes.set(
      "https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=100&page=1",
      json([REPO], { link: '<https://api.github.com/user/repos?page=1>; rel="prev"' }),
    );
    expect((await client().listRepositories({ org: ORG, page: 0 })).hasMore).toBe(false);
  });

  it("searches repositories, more pages while the total says so", async () => {
    routes.set(
      "https://api.github.com/search/repositories?q=app&sort=stars&order=desc&per_page=100&page=1",
      json({ total_count: 150, items: [REPO] }),
    );
    const out = await client().searchRepositories({ org: ORG, query: "app", page: 1 });
    expect(out.repositories.map((r) => r.fullName)).toEqual(["acme/app"]);
    expect(out.hasMore).toBe(true);
  });

  it("lists every page of branches", async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}` }));
    routes.set(
      "https://api.github.com/repos/acme/app/branches?per_page=100&page=1",
      json(first, { link: '<https://api.github.com/x?page=2>; rel="next"' }),
    );
    routes.set(
      "https://api.github.com/repos/acme/app/branches?per_page=100&page=2",
      json([{ name: "main" }]),
    );
    const out = await client().listBranches({ org: ORG, owner: "acme", repo: "app" });
    expect(out.names).toHaveLength(101);
    expect(out.names.at(-1)).toBe("main");
  });

  it("lists the tree's files and directories, drops submodules, and says when GitHub truncated it", async () => {
    routes.set(
      "https://api.github.com/repos/acme/app/git/trees/feat%2Fx?recursive=1",
      json({
        truncated: true,
        tree: [
          { path: "src", type: "tree" },
          { path: "src/a.ts", type: "blob", size: 12 },
          { path: "vendor/lib", type: "commit" },
        ],
      }),
    );
    const out = await client().getTree({ org: ORG, owner: "acme", repo: "app", ref: "feat/x" });
    expect(out.truncated).toBe(true);
    expect(out.entries.map((e) => [e.path, e.isDirectory, e.size])).toEqual([
      ["src", true, 0n],
      ["src/a.ts", false, 12n],
    ]);
  });

  it("reads a file through the Contents API", async () => {
    routes.set(
      "https://api.github.com/repos/acme/app/contents/src/a%20b.ts?ref=main",
      json({ type: "file", encoding: "base64", size: 5, content: Buffer.from("hello").toString("base64"), sha: "s1" }),
    );
    const out = await client().getFileContent({ org: ORG, owner: "acme", repo: "app", ref: "main", path: "src/a b.ts" });
    expect(new TextDecoder().decode(out.content)).toBe("hello");
    expect(out.size).toBe(5n);
    expect(out.tooLarge).toBe(false);
  });

  it("reads a file past the Contents cap through the Blob API", async () => {
    routes.set(
      "https://api.github.com/repos/acme/app/contents/big.bin?ref=main",
      json({ type: "file", encoding: "none", size: 2_000_000, content: "", sha: "sha-big" }),
    );
    routes.set(
      "https://api.github.com/repos/acme/app/git/blobs/sha-big",
      json({ content: Buffer.from("blob").toString("base64"), size: 2_000_000 }),
    );
    const out = await client().getFileContent({ org: ORG, owner: "acme", repo: "app", ref: "main", path: "big.bin" });
    expect(new TextDecoder().decode(out.content)).toBe("blob");
    expect(out.size).toBe(2_000_000n);
  });

  it("reports a file past the ceiling by size, without downloading it", async () => {
    routes.set(
      "https://api.github.com/repos/acme/app/contents/huge.bin?ref=main",
      json({ type: "file", encoding: "none", size: FILE_CONTENT_CEILING_BYTES + 1, content: "", sha: "sha-huge" }),
    );
    const out = await client().getFileContent({ org: ORG, owner: "acme", repo: "app", ref: "main", path: "huge.bin" });
    expect(out.tooLarge).toBe(true);
    expect(out.content).toHaveLength(0);
    expect(calls.some((c) => c.url.includes("/git/blobs/"))).toBe(false);
  });

  it("refuses a path that is a directory, not a file", async () => {
    routes.set(
      "https://api.github.com/repos/acme/app/contents/src?ref=main",
      json([{ type: "file", path: "src/a.ts" }]),
    );
    const folder = await refusal(() =>
      client().getFileContent({ org: ORG, owner: "acme", repo: "app", ref: "main", path: "src" }),
    );
    expect(folder.code).toBe(Code.InvalidArgument);
    expect(folder.rawMessage).toBe("src is not a file");
  });

  it("refuses a dot segment in the owner, the repository, the ref or the path, calling nothing", async () => {
    const c = client();
    const reads = [
      () => c.listBranches({ org: ORG, owner: "..", repo: "user" }),
      () => c.listBranches({ org: ORG, owner: "acme", repo: "." }),
      () => c.getTree({ org: ORG, owner: "..", repo: "app", ref: "main" }),
      () => c.getTree({ org: ORG, owner: "acme", repo: "app", ref: ".." }),
      () => c.getFileContent({ org: ORG, owner: "acme", repo: "..", ref: "main", path: "a" }),
      () => c.getFileContent({ org: ORG, owner: "acme", repo: "app", ref: "main", path: "../../../user" }),
      () => c.getFileContent({ org: ORG, owner: "acme", repo: "app", ref: "main", path: "src/./a.ts" }),
    ];
    for (const read of reads) {
      const error = await refusal(read);
      expect(error.code).toBe(Code.InvalidArgument);
    }
    expect(calls).toEqual([]);
  });

  it("an unrelated secret in the My vault that no key opens never stops a read", async () => {
    const mine = (await vaults.findMine(ORG, alice.identityId))!;
    const id = mine.metadata!.id;
    // Sealed under a key this server does not hold: opening it throws.
    const sealed = await SecretService.create(randomBytes(32)).encrypt(
      "unrelated",
      EncryptionScope.forOrganization(ORG),
    );
    const row = await store.getResource(ApiResourceKind.vault, id, VaultSchema);
    row.spec!.secrets["BROKEN"] = create(VaultSecretSchema, { value: sealed });
    await store.saveResource(ApiResourceKind.vault, id, VaultSchema, row);
    routes.set(
      "https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=100&page=1",
      json([REPO]),
    );
    const out = await client().listRepositories({ org: ORG, page: 1 });
    expect(out.repositories.map((repo) => repo.fullName)).toEqual(["acme/app"]);
    expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("maps GitHub's 401 to reconnect and 404 to NOT_FOUND", async () => {
    routes.set(
      "https://api.github.com/user/repos?sort=pushed&direction=desc&per_page=100&page=1",
      () => new Response("{}", { status: 401 }),
    );
    const stale = await refusal(() => client().listRepositories({ org: ORG, page: 1 }));
    expect(stale.code).toBe(Code.FailedPrecondition);
    expect(stale.rawMessage).toBe(RECONNECT_GITHUB);

    const missing = await refusal(() =>
      client().getTree({ org: ORG, owner: "acme", repo: "gone", ref: "main" }),
    );
    expect(missing.code).toBe(Code.NotFound);
  });
});
