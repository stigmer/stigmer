// GitHub conformance — the sign-in utility service's error contract and the
// server-side repository reads (Class A).
// Domain: conformance suites.
//
// GitHubService is a platform utility, not a resource domain: it brokers the
// GitHub OAuth dance (authorize-URL construction + code-for-token exchange)
// so the frontend never holds the client credentials. What is asserted here
// is exactly the arm that is TRUE and hermetic on every edition: malformed
// requests answer InvalidArgument from protovalidate at the transport
// boundary, before any config or network concern.
//
// The broker's other arms are deliberately NOT asserted, each for a
// discovered, recorded reason:
//
//   - "Config-missing FailedPrecondition" is STRUCTURALLY UNREACHABLE on the
//     OSS server: it ships with the bundled "Stigmer Local" OAuth App
//     credentials hardcoded as defaults (config.go — the GitHub CLI pattern;
//     a localhost-only app's secret has negligible value), and the env
//     override treats an empty value as unset, so no configuration can blank
//     them. The guard is live only on the cloud edition, whose config
//     defaults to empty. The editions legitimately diverge here, by the
//     maintainers' decision, and this suite does not silently encode either
//     side.
//   - The exchange happy path and its Unavailable / GitHub-rejection arms
//     dial github.com FOR REAL on a configured broker — and the OSS broker
//     is always configured (above). A conformance run must never leave the
//     host, so those arms stay pinned in the Go controller unit tests.
//   - The authorize-URL happy path is hermetic (pure URL construction), but
//     asserting it unconditionally would fail on an unconfigured cloud
//     environment; it rides the same owner decision as the config-missing
//     arm.
//
// The OAuth state is the server's: the authorize call records it for its
// caller, organization and redirect, and the exchange refuses a state it
// never issued with FailedPrecondition before anything leaves the server.
// That arm is hermetic on both editions (the unconfigured cloud broker
// refuses with the same code, for its own reason), so it is asserted by
// code alone.
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

const VALID_REDIRECT = "https://app.example.com/oauth/callback";

describe("GitHub broker conformance — request validation (Layer 1, before config or network)", () => {
  it("[rpc:GitHubService.getOAuthAuthorizeUrl] getOAuthAuthorizeUrl rejects an empty redirect_uri with InvalidArgument", async () => {
    await expectGrpcCode(
      () => clients.github.getOAuthAuthorizeUrl({ redirectUri: "", org: "acme" }),
      Code.InvalidArgument,
      "getOAuthAuthorizeUrl empty redirect_uri",
    );
    await expectGrpcCode(
      () => clients.github.getOAuthAuthorizeUrl({ redirectUri: VALID_REDIRECT, org: "" }),
      Code.InvalidArgument,
      "getOAuthAuthorizeUrl empty org",
    );
  });

  it("[rpc:GitHubService.exchangeOAuthCode] exchangeOAuthCode refuses a state the server never issued, before GitHub is asked", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.github.exchangeOAuthCode({
          code: "c",
          state: "a-state-from-a-crafted-link",
          redirectUri: VALID_REDIRECT,
          org,
        }),
      Code.FailedPrecondition,
      "exchangeOAuthCode with a state never issued",
    );
  });

  it("[rpc:GitHubService.exchangeOAuthCode] exchangeOAuthCode rejects each missing required field with InvalidArgument", async () => {
    await expectGrpcCode(
      () => clients.github.exchangeOAuthCode({ code: "", state: "s", redirectUri: VALID_REDIRECT, org: "acme" }),
      Code.InvalidArgument,
      "exchangeOAuthCode empty code",
    );
    await expectGrpcCode(
      () => clients.github.exchangeOAuthCode({ code: "c", state: "", redirectUri: VALID_REDIRECT, org: "acme" }),
      Code.InvalidArgument,
      "exchangeOAuthCode empty state",
    );
    await expectGrpcCode(
      () => clients.github.exchangeOAuthCode({ code: "c", state: "s", redirectUri: "", org: "acme" }),
      Code.InvalidArgument,
      "exchangeOAuthCode empty redirect_uri",
    );
    await expectGrpcCode(
      () => clients.github.exchangeOAuthCode({ code: "c", state: "s", redirectUri: VALID_REDIRECT, org: "" }),
      Code.InvalidArgument,
      "exchangeOAuthCode empty org",
    );
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
