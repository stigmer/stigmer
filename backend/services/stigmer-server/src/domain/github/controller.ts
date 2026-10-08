/**
 * GitHub controller: the OAuth sign-in that saves a person's `github.com`
 * login in their My vault (GitHubService), and the repository reads the
 * console makes with it (GitHubQueryController), so the page never holds
 * the token.
 *
 * getOAuthAuthorizeUrl mints the OAuth state and records it server-side
 * (the pending OAuth state store the MCP sign-in uses, under the
 * `GITHUB_SIGN_IN` marker in place of a server id) for its caller,
 * organization and redirect; the exchange consumes it once and refuses a
 * state it did not issue to that caller for that organization and
 * redirect, before GitHub is asked anything. So a crafted callback link
 * cannot plant another account's GitHub login in someone's My vault.
 * Both annotations ask can_create_vault on the organization (members).
 *
 * exchangeOAuthCode exchanges the code with the broker's client secret,
 * reads the account's login with the new token, and saves the token as
 * the `github.com` connection in the caller's My vault in the request's
 * organization (`source: sign_in`, created on the first save) — the
 * connection every clone of a private repository and every read below
 * uses. It answers the login and scopes, never the token. Connecting
 * GitHub is the explicit act of replacing the caller's github.com login:
 * whatever My vault holds at github.com, a pasted token included, is
 * replaced, unlike an MCP server's sign-in, which never replaces a login
 * it did not make.
 *
 * The reads open that connection server-side (VaultService.open) and call
 * GitHub's REST API (api.ts); without one they answer FAILED_PRECONDITION
 * ("connect GitHub first"). An owner, repository, ref or path segment of
 * "." or ".." is refused before any call: the URL would resolve it into
 * another of GitHub's endpoints.
 *
 * Proven by github.conformance.test.ts (the protovalidate arms),
 * __tests__/github.test.ts (the broker mechanics and the saved login) and
 * __tests__/github-queries.test.ts (the reads), against an injected fetch.
 *
 * The config-missing FailedPrecondition arms are STRUCTURALLY UNREACHABLE
 * on OSS — the bundled "Stigmer Local" defaults (boot/config.ts) cannot be
 * blanked — but they are ported and unit-tested: the guard is live on the
 * cloud edition, and the error copy is cross-edition contract.
 */
import { randomBytes } from "node:crypto";

import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import {
  GitHubBranchListSchema,
  GitHubFileContentSchema,
  GitHubRepositoryListSchema,
  GitHubRepositorySchema,
  GitHubTreeEntrySchema,
  GitHubTreeSchema,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/io_pb";
import type {
  GetGitHubFileContentInput,
  GetGitHubTreeInput,
  GitHubBranchList,
  GitHubFileContent,
  GitHubRepository,
  GitHubRepositoryList,
  GitHubTree,
  ListGitHubBranchesInput,
  ListGitHubRepositoriesInput,
  SearchGitHubRepositoriesInput,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/io_pb";
import { GitHubQueryController } from "@stigmer/protos/ai/stigmer/platform/github/v1/query_pb";

import {
  ExchangeOAuthCodeResponseSchema,
  GetOAuthAuthorizeUrlResponseSchema,
  GitHubService,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";
import type {
  ExchangeOAuthCodeRequest,
  ExchangeOAuthCodeResponse,
  GetOAuthAuthorizeUrlRequest,
  GetOAuthAuthorizeUrlResponse,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";

import type { Logger } from "../../boot/logger.js";
import type { PendingOAuthStateStore } from "../../store/interface.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { goUrlValuesEncode } from "../../gocompat/query-escape.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  unavailableError,
} from "../../pipeline/errors.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { GITHUB_HOST } from "../vault/constants.js";
import type { VaultService } from "../vault/service.js";
import { VaultConnectionSource } from "../vault/service.js";
import {
  FILE_CONTENT_CEILING_BYTES,
  GITHUB_RESPONSE_CEILING_BYTES,
  REPOSITORIES_PER_PAGE,
  decodeBase64,
  encodePath,
  hasNextPage,
  newGitHubApi,
  readBoundedText,
} from "./api.js";
import type { GitHubApi, GitHubRepositoryJson } from "./api.js";

/** Go githubAuthorizeURL. */
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/** Go githubTokenURL. */
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** Go oauthScopes — repo access + user identity, the workspace needs. */
const OAUTH_SCOPES = "repo,read:user";

/**
 * Go httpTimeout (10s): the exchange is a single interactive round-trip to
 * github.com; anything slower should fail the RPC rather than hold the
 * caller's OAuth callback open.
 */
const HTTP_TIMEOUT_MS = 10_000;

export interface GitHubControllerDeps {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly logger: Logger;
  /** The composed authorization seam: exchange and every read ask can_create_vault on the organization. */
  readonly authorizer: Authorizer;
  /** The vault door: the sign-in saves the login, the reads open it. */
  readonly vaults: VaultService;
  /** Where the authorize call records its state and the exchange consumes it. */
  readonly pendingOAuthStates: PendingOAuthStateStore;
  /** Test seam for every GitHub call; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/** Registers both GitHub services on the router (routes stage). */
export function registerGitHubServices(
  router: ConnectRouter,
  deps: GitHubControllerDeps,
): void {
  router.service(GitHubService, {
    getOAuthAuthorizeUrl: (req, ctx) =>
      getOAuthAuthorizeUrl(deps, req, callerIdentityOf(ctx)),
    exchangeOAuthCode: (req, ctx) =>
      exchangeOAuthCode(deps, req, callerIdentityOf(ctx)),
  });
  router.service(GitHubQueryController, {
    listRepositories: (req, ctx) => listRepositories(deps, req, ctx),
    searchRepositories: (req, ctx) => searchRepositories(deps, req, ctx),
    listBranches: (req, ctx) => listBranches(deps, req, ctx),
    getTree: (req, ctx) => getTree(deps, req, ctx),
    getFileContent: (req, ctx) => getFileContent(deps, req, ctx),
  });
}

/**
 * The marker a GitHub sign-in's pending state carries where an MCP
 * sign-in's carries its server id: no MCP server id has this shape, so
 * neither flow consumes the other's state as its own.
 */
export const GITHUB_SIGN_IN = "github";

/**
 * Go GetOAuthAuthorizeUrl: URL construction — client_id, the caller's
 * redirect_uri, the pinned scopes, and a random 16-byte hex state, encoded
 * with Go url.Values.Encode semantics (sorted keys, QueryEscape) so the
 * URL is byte-identical across editions — and the state recorded for its
 * caller, organization and redirect.
 */
async function getOAuthAuthorizeUrl(
  deps: GitHubControllerDeps,
  req: GetOAuthAuthorizeUrlRequest,
  caller: CallerIdentity,
): Promise<GetOAuthAuthorizeUrlResponse> {
  await authorizeDirect(
    GitHubService.method.getOAuthAuthorizeUrl,
    deps.authorizer,
    caller,
    req,
  );
  refuseBoundElsewhere(caller, req.org);
  if (deps.clientId === "") {
    throw failedPreconditionError(
      "GitHub OAuth is not configured (STIGMER_GITHUB_CLIENT_ID not set)",
    );
  }

  let state: string;
  try {
    state = randomBytes(16).toString("hex");
  } catch (error) {
    deps.logger.error("failed to generate OAuth state", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to generate OAuth state");
  }
  try {
    await deps.pendingOAuthStates.save({
      state,
      codeVerifier: "",
      clientId: deps.clientId,
      clientSecret: "",
      tokenEndpoint: GITHUB_TOKEN_URL,
      mcpServerId: GITHUB_SIGN_IN,
      identityAccountId: caller.identityId,
      targetEnvVar: "",
      authMethod: "vendor_oauth",
      tokenAuthMethod: "",
      redirectUri: req.redirectUri,
      org: req.org,
      vaultId: "",
      toolAddress: GITHUB_HOST,
      createdAt: 0,
    });
  } catch (error) {
    throw internalError(error, "failed to record the OAuth state");
  }

  const authorizeUrl =
    GITHUB_AUTHORIZE_URL +
    "?" +
    goUrlValuesEncode({
      client_id: deps.clientId,
      redirect_uri: req.redirectUri,
      scope: OAUTH_SCOPES,
      state,
    });

  return create(GetOAuthAuthorizeUrlResponseSchema, { authorizeUrl, state });
}

/** The JSON shape of GitHub's token endpoint response (Go githubTokenResponse). */
interface GitHubTokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/**
 * Go ExchangeOAuthCode, then the save: POSTs the code to github.com, reads
 * the account's login, and saves the token in the caller's My vault as the
 * `github.com` connection. Error mapping is contract: GitHub's own OAuth
 * error → InvalidArgument (the caller sent a bad/expired code); network
 * failure → Unavailable; unreadable/unparseable response → Internal.
 */
async function exchangeOAuthCode(
  deps: GitHubControllerDeps,
  req: ExchangeOAuthCodeRequest,
  caller: CallerIdentity,
): Promise<ExchangeOAuthCodeResponse> {
  await authorizeDirect(
    GitHubService.method.exchangeOAuthCode,
    deps.authorizer,
    caller,
    req,
  );
  // The login lands in the caller's vault in this organization.
  refuseBoundElsewhere(caller, req.org);
  if (deps.clientId === "" || deps.clientSecret === "") {
    throw failedPreconditionError("GitHub OAuth is not configured");
  }
  await consumeState(deps, req, caller);

  const body = goUrlValuesEncode({
    client_id: deps.clientId,
    client_secret: deps.clientSecret,
    code: req.code,
    redirect_uri: req.redirectUri,
  });

  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      // The form carries the client secret: a redirect is never followed.
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    deps.logger.error("GitHub token exchange failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw unavailableError("failed to reach GitHub for token exchange");
  }

  let raw: string;
  try {
    raw = await readBoundedText(response, GITHUB_RESPONSE_CEILING_BYTES);
  } catch (error) {
    deps.logger.error("failed to read GitHub token response", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to read GitHub response");
  }

  let tokenResponse: GitHubTokenResponse;
  try {
    tokenResponse = JSON.parse(raw) as GitHubTokenResponse;
  } catch (error) {
    deps.logger.error("failed to parse GitHub token response", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw internalError(error, "failed to parse GitHub response");
  }

  if (tokenResponse.error !== undefined && tokenResponse.error !== "") {
    deps.logger.warn("GitHub OAuth error", {
      error: tokenResponse.error,
      description: tokenResponse.error_description ?? "",
    });
    throw invalidArgumentError(
      `GitHub OAuth error: ${tokenResponse.error_description ?? ""}`,
    );
  }

  const token = tokenResponse.access_token ?? "";
  if (token === "") {
    throw internalError(
      new Error("GitHub token response carried no access_token"),
      "GitHub answered no access token",
    );
  }

  const { body: account } = await newGitHubApi(token, fetchImpl).getJson<{
    login?: string;
  }>("/user", "the connected account");
  const login = account.login ?? "";

  const vault = await deps.vaults.ensureMine(req.org, caller);
  await deps.vaults.setConnection(
    vault.metadata?.id ?? "",
    GITHUB_HOST,
    {
      token,
      source: VaultConnectionSource.sign_in,
      signIn: {
        expiresAt: 0n,
        clientId: deps.clientId,
        authMethod: "vendor_oauth",
        tokenEndpoint: GITHUB_TOKEN_URL,
        refreshToken: "",
        mcpServerId: "",
      },
      description: login === "" ? "GitHub" : `GitHub @${login}`,
    },
    caller,
  );
  deps.logger.info("GitHub login saved in My vault", { org: req.org, login });

  return create(ExchangeOAuthCodeResponseSchema, {
    tokenType: tokenResponse.token_type ?? "",
    scope: tokenResponse.scope ?? "",
    login,
  });
}

/**
 * Consumes the exchange's state: one the server issued to this caller, for
 * this organization and redirect, as a GitHub sign-in. Anything else is
 * refused before GitHub is asked; a consumed state never serves again.
 */
async function consumeState(
  deps: GitHubControllerDeps,
  req: ExchangeOAuthCodeRequest,
  caller: CallerIdentity,
): Promise<void> {
  let pending;
  try {
    pending = await deps.pendingOAuthStates.getAndDelete(req.state);
  } catch (error) {
    throw internalError(error, "failed to load the OAuth state");
  }
  if (pending === undefined) {
    throw failedPreconditionError(
      "this GitHub sign-in has expired or was already used: start it again",
    );
  }
  if (
    pending.mcpServerId !== GITHUB_SIGN_IN ||
    pending.identityAccountId !== caller.identityId ||
    pending.org !== req.org ||
    pending.redirectUri !== req.redirectUri
  ) {
    throw failedPreconditionError(
      "this GitHub sign-in was not started by you for this organization: start it again from your own session",
    );
  }
}

// ---------------------------------------------------------------------------
// GitHubQueryController — the reads, with the caller's saved login.
// ---------------------------------------------------------------------------

export const CONNECT_GITHUB_FIRST =
  "no GitHub login is saved in your My vault in this organization: connect GitHub first";

/**
 * The caller's GitHub API for a read: the annotation's can_create_vault on
 * the organization, then the `github.com` connection in their My vault,
 * opened in process alone: another entry that does not open never stops a read.
 */
async function githubFor(
  deps: GitHubControllerDeps,
  method: (typeof GitHubQueryController.method)[keyof typeof GitHubQueryController.method],
  req: { readonly org: string } & Parameters<typeof authorizeDirect>[3],
  ctx: HandlerContext,
): Promise<GitHubApi> {
  const caller = callerIdentityOf(ctx);
  await authorizeDirect(method, deps.authorizer, caller, req);
  refuseBoundElsewhere(caller, req.org);
  const vault = await deps.vaults.findMine(req.org, caller.identityId);
  const token =
    vault === undefined
      ? ""
      : ((await deps.vaults.entries(vault).connections.get(GITHUB_HOST)?.open())?.token ?? "");
  if (token === "") {
    throw failedPreconditionError(CONNECT_GITHUB_FIRST);
  }
  return newGitHubApi(token, deps.fetchImpl ?? fetch);
}

/** A path segment URL resolution would climb or drop: never sent to GitHub. */
function isDotSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

/**
 * Refuses "." or ".." as the owner, the repository or the ref, and as any
 * segment of the path: resolved by the URL, they would point a read at
 * another of GitHub's endpoints with the caller's token.
 */
function refuseDotSegments(req: {
  readonly owner: string;
  readonly repo: string;
  readonly ref?: string;
  readonly path?: string;
}): void {
  for (const [field, value] of [
    ["owner", req.owner],
    ["repo", req.repo],
    ["ref", req.ref ?? ""],
  ] as const) {
    if (isDotSegment(value)) {
      throw invalidArgumentError(`${field} cannot be '${value}'`);
    }
  }
  if ((req.path ?? "").split("/").some(isDotSegment)) {
    throw invalidArgumentError("path cannot hold a '.' or '..' segment");
  }
}

function repositoryOf(json: GitHubRepositoryJson): GitHubRepository {
  return create(GitHubRepositorySchema, {
    id: BigInt(json.id ?? 0),
    fullName: json.full_name ?? "",
    name: json.name ?? "",
    owner: json.owner?.login ?? "",
    ownerIsOrganization: json.owner?.type === "Organization",
    htmlUrl: json.html_url ?? "",
    cloneUrl: json.clone_url ?? "",
    defaultBranch: json.default_branch ?? "",
    isPrivate: json.private === true,
    updatedAt: json.updated_at ?? "",
  });
}

function pageOf(page: number): number {
  return page > 0 ? page : 1;
}

/** The account's repositories, most recently pushed first, one page of 100. */
async function listRepositories(
  deps: GitHubControllerDeps,
  req: ListGitHubRepositoriesInput,
  ctx: HandlerContext,
): Promise<GitHubRepositoryList> {
  const api = await githubFor(deps, GitHubQueryController.method.listRepositories, req, ctx);
  const page = pageOf(req.page);
  const { body, link } = await api.getJson<GitHubRepositoryJson[]>(
    `/user/repos?sort=pushed&direction=desc&per_page=${REPOSITORIES_PER_PAGE}&page=${page}`,
    "your repositories",
  );
  const repositories = Array.isArray(body) ? body.map(repositoryOf) : [];
  return create(GitHubRepositoryListSchema, {
    repositories,
    hasMore:
      link !== "" ? hasNextPage(link) : repositories.length === REPOSITORIES_PER_PAGE,
  });
}

/** GitHub's repository search, as the console's search box ran it. */
async function searchRepositories(
  deps: GitHubControllerDeps,
  req: SearchGitHubRepositoriesInput,
  ctx: HandlerContext,
): Promise<GitHubRepositoryList> {
  const api = await githubFor(deps, GitHubQueryController.method.searchRepositories, req, ctx);
  const page = pageOf(req.page);
  const params = new URLSearchParams({
    q: req.query,
    sort: "stars",
    order: "desc",
    per_page: String(REPOSITORIES_PER_PAGE),
    page: String(page),
  });
  const { body } = await api.getJson<{
    total_count?: number;
    items?: GitHubRepositoryJson[];
  }>(`/search/repositories?${params.toString()}`, "repository search");
  const repositories = (body.items ?? []).map(repositoryOf);
  return create(GitHubRepositoryListSchema, {
    repositories,
    hasMore: page * REPOSITORIES_PER_PAGE < (body.total_count ?? 0),
  });
}

/** A repository's branch names, every page. */
async function listBranches(
  deps: GitHubControllerDeps,
  req: ListGitHubBranchesInput,
  ctx: HandlerContext,
): Promise<GitHubBranchList> {
  refuseDotSegments(req);
  const api = await githubFor(deps, GitHubQueryController.method.listBranches, req, ctx);
  const repo = `${encodeURIComponent(req.owner)}/${encodeURIComponent(req.repo)}`;
  const names: string[] = [];
  for (let page = 1; page <= MAX_BRANCH_PAGES; page += 1) {
    const { body, link } = await api.getJson<Array<{ name?: string }>>(
      `/repos/${repo}/branches?per_page=${REPOSITORIES_PER_PAGE}&page=${page}`,
      `${req.owner}/${req.repo}`,
    );
    const batch = Array.isArray(body) ? body : [];
    names.push(...batch.map((branch) => branch.name ?? "").filter((name) => name !== ""));
    const more = link !== "" ? hasNextPage(link) : batch.length === REPOSITORIES_PER_PAGE;
    if (!more) {
      break;
    }
  }
  return create(GitHubBranchListSchema, { names });
}

/** Ten pages of a hundred: past that a picker is the wrong tool for the repository. */
const MAX_BRANCH_PAGES = 10;

/** Every file and directory at a branch or commit (the Trees API, recursive). */
async function getTree(
  deps: GitHubControllerDeps,
  req: GetGitHubTreeInput,
  ctx: HandlerContext,
): Promise<GitHubTree> {
  refuseDotSegments(req);
  const api = await githubFor(deps, GitHubQueryController.method.getTree, req, ctx);
  const repo = `${encodeURIComponent(req.owner)}/${encodeURIComponent(req.repo)}`;
  const { body } = await api.getJson<{
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; size?: number }>;
  }>(
    `/repos/${repo}/git/trees/${encodeURIComponent(req.ref)}?recursive=1`,
    `${req.owner}/${req.repo} at ${req.ref}`,
  );
  const entries = (body.tree ?? [])
    .filter((node) => node.type === "blob" || node.type === "tree")
    .map((node) =>
      create(GitHubTreeEntrySchema, {
        path: node.path ?? "",
        isDirectory: node.type === "tree",
        size: BigInt(node.size ?? 0),
      }),
    );
  return create(GitHubTreeSchema, { entries, truncated: body.truncated === true });
}

/**
 * One file at a branch or commit: the Contents API, whose 1 MB cap GitHub
 * signals with `encoding: "none"`; then the Blob API up to the 10 MiB
 * ceiling; above it, the size alone.
 */
async function getFileContent(
  deps: GitHubControllerDeps,
  req: GetGitHubFileContentInput,
  ctx: HandlerContext,
): Promise<GitHubFileContent> {
  refuseDotSegments(req);
  const api = await githubFor(deps, GitHubQueryController.method.getFileContent, req, ctx);
  const repo = `${encodeURIComponent(req.owner)}/${encodeURIComponent(req.repo)}`;
  const what = `${req.path} in ${req.owner}/${req.repo} at ${req.ref}`;
  const { body: file } = await api.getJson<{
    type?: string;
    encoding?: string;
    size?: number;
    content?: string;
    sha?: string;
  }>(
    `/repos/${repo}/contents/${encodePath(req.path)}?ref=${encodeURIComponent(req.ref)}`,
    what,
  );
  if (Array.isArray(file) || (file.type !== undefined && file.type !== "file")) {
    throw invalidArgumentError(`${req.path} is not a file`);
  }
  const size = file.size ?? 0;
  if (file.encoding === "base64") {
    return create(GitHubFileContentSchema, {
      content: decodeBase64(file.content ?? ""),
      size: BigInt(size),
    });
  }
  if (size > FILE_CONTENT_CEILING_BYTES) {
    return create(GitHubFileContentSchema, { size: BigInt(size), tooLarge: true });
  }
  const { body: blob } = await api.getJson<{ content?: string; size?: number }>(
    `/repos/${repo}/git/blobs/${encodeURIComponent(file.sha ?? "")}`,
    what,
  );
  return create(GitHubFileContentSchema, {
    content: decodeBase64(blob.content ?? ""),
    size: BigInt(blob.size ?? size),
  });
}
