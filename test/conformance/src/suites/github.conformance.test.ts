// GitHub conformance — connecting GitHub through the vault's sign-in, and
// the server-side repository reads (Class A).
// Domain: conformance suites.
//
// GitHub is one more address on the one sign-in: a person connects it with
// VaultCommandController.startSignIn at the address `github.com`, which
// Stigmer's built-in GitHub login app serves (its client id from
// STIGMER_GITHUB_CLIENT_ID, defaulting to the bundled "Stigmer Local" OAuth
// App, so it is on in every edition). What is hermetic, and pinned here: the
// authorization URL is GitHub's own, with the app's client and scopes, PKCE
// S256, the deployment's callback, and no `resource` (a vendor's login is no
// MCP login server). The exchange dials github.com and stays in the
// server's unit suite.
//
// The repository reads (GitHubQueryController) use the caller's saved
// github.com login from their My vault, server-side, so the browser never
// holds the token. What is hermetic about them, and pinned here: malformed
// requests answer InvalidArgument (a "." or ".." owner, repository, ref or
// path segment included, which a URL would resolve into another GitHub
// endpoint), and a caller with no saved login is refused FailedPrecondition
// with the "connect GitHub first" copy before any request leaves the
// server. The reads against GitHub itself dial
// api.github.com and stay pinned in the server's unit suite.
import { Code } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { HERMETIC_OAUTH_REDIRECT_URI } from "@stigmer/test-support/server-process";
import { myVaultTarget } from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterAll(async () => {
  await target?.teardown();
});

describe("GitHub conformance — connecting GitHub is a sign-in at github.com", () => {
  it("[rpc:VaultCommandController.startSignIn] Stigmer's GitHub login app serves github.com: GitHub's authorize URL with the app's client and scopes, PKCE S256, no resource", async () => {
    const { org } = await target.provisionTenancy();
    const out = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: "github.com" });

    expect(out.providerName).toBe("GitHub");
    expect(out.scopes).toEqual(["repo", "read:user"]);
    const url = new URL(out.authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id") ?? "", "the deployment's GitHub client").not.toBe("");
    expect(url.searchParams.get("scope")).toBe("repo read:user");
    expect(url.searchParams.get("redirect_uri")).toBe(HERMETIC_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(out.state);
    expect(url.searchParams.has("resource"), "a vendor login is never sent resource").toBe(false);
  });
});

// The copy a read answers when the caller has no saved GitHub login.
const CONNECT_GITHUB_FIRST =
  "no GitHub login is saved in your My vault in this organization: connect GitHub first";

describe("GitHub conformance — server-side repository reads, before any request leaves the server", () => {
  it("[rpc:GitHubQueryController.listRepositories] [rpc:GitHubQueryController.searchRepositories] listing and searching refuse a missing org (InvalidArgument) and a caller with no saved login (FailedPrecondition)", async () => {
    await expectGrpcCode(
      () => clients.githubQuery.listRepositories({ org: "", page: 1 }),
      Code.InvalidArgument,
      "listRepositories empty org",
    );
    const { org } = await target.provisionTenancy();
    const listed = await expectGrpcCode(
      () => clients.githubQuery.listRepositories({ org, page: 1 }),
      Code.FailedPrecondition,
      "listRepositories with no saved login",
    );
    expect(listed.rawMessage).toBe(CONNECT_GITHUB_FIRST);
    await expectGrpcCode(
      () => clients.githubQuery.searchRepositories({ org, query: "", page: 1 }),
      Code.InvalidArgument,
      "searchRepositories empty query",
    );
    const searched = await expectGrpcCode(
      () => clients.githubQuery.searchRepositories({ org, query: "stigmer", page: 1 }),
      Code.FailedPrecondition,
      "searchRepositories with no saved login",
    );
    expect(searched.rawMessage).toBe(CONNECT_GITHUB_FIRST);
  });

  it("[rpc:GitHubQueryController.listBranches] [rpc:GitHubQueryController.getTree] [rpc:GitHubQueryController.getFileContent] a repository's reads refuse a malformed repository (InvalidArgument) and a caller with no saved login (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.githubQuery.listBranches({ org, owner: "acme", repo: "not a repo" }),
      Code.InvalidArgument,
      "listBranches malformed repo",
    );
    await expectGrpcCode(
      () => clients.githubQuery.listBranches({ org, owner: "..", repo: "user" }),
      Code.InvalidArgument,
      "listBranches with a dot-segment owner",
    );
    await expectGrpcCode(
      () => clients.githubQuery.getFileContent({ org, owner: "acme", repo: "repo", ref: "main", path: "../../user" }),
      Code.InvalidArgument,
      "getFileContent with a dot-segment path",
    );
    const branches = await expectGrpcCode(
      () => clients.githubQuery.listBranches({ org, owner: "acme", repo: "repo" }),
      Code.FailedPrecondition,
      "listBranches with no saved login",
    );
    expect(branches.rawMessage).toBe(CONNECT_GITHUB_FIRST);
    await expectGrpcCode(
      () => clients.githubQuery.getTree({ org, owner: "acme", repo: "repo", ref: "" }),
      Code.InvalidArgument,
      "getTree empty ref",
    );
    const tree = await expectGrpcCode(
      () => clients.githubQuery.getTree({ org, owner: "acme", repo: "repo", ref: "main" }),
      Code.FailedPrecondition,
      "getTree with no saved login",
    );
    expect(tree.rawMessage).toBe(CONNECT_GITHUB_FIRST);
    await expectGrpcCode(
      () => clients.githubQuery.getFileContent({ org, owner: "acme", repo: "repo", ref: "main", path: "" }),
      Code.InvalidArgument,
      "getFileContent empty path",
    );
    const file = await expectGrpcCode(
      () => clients.githubQuery.getFileContent({ org, owner: "acme", repo: "repo", ref: "main", path: "README.md" }),
      Code.FailedPrecondition,
      "getFileContent with no saved login",
    );
    expect(file.rawMessage).toBe(CONNECT_GITHUB_FIRST);
  });
});
