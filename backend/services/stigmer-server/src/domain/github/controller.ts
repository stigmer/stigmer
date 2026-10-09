/**
 * GitHub controller: the repository reads the console makes with a
 * person's `github.com` login (GitHubQueryController), so the page never
 * holds the token. The login itself is saved by the vault's sign-in at the
 * address `github.com` (domain/vault/sign-in), through Stigmer's built-in
 * GitHub login app (domain/vault/login-providers.ts) or an organization's
 * own app for that address.
 *
 * The reads open that connection server-side (VaultService.open) and call
 * GitHub's REST API (api.ts); without one they answer FAILED_PRECONDITION
 * ("connect GitHub first"). An owner, repository, ref or path segment of
 * "." or ".." is refused before any call: the URL would resolve it into
 * another of GitHub's endpoints.
 *
 * Proven by github.conformance.test.ts (the protovalidate arms) and
 * __tests__/github-queries.test.ts (the reads), against an injected fetch.
 */
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

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import {
  failedPreconditionError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { GITHUB_HOST } from "../vault/constants.js";
import type { VaultService } from "../vault/service.js";
import {
  FILE_CONTENT_CEILING_BYTES,
  REPOSITORIES_PER_PAGE,
  decodeBase64,
  encodePath,
  hasNextPage,
  newGitHubApi,
} from "./api.js";
import type { GitHubApi, GitHubRepositoryJson } from "./api.js";

export interface GitHubControllerDeps {
  readonly logger: Logger;
  /** The composed authorization seam: every read asks can_create_vault on the organization. */
  readonly authorizer: Authorizer;
  /** The vault door: the reads open the github.com login. */
  readonly vaults: VaultService;
  /** Test seam for every GitHub call; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/** Registers the GitHub reads on the router (routes stage). */
export function registerGitHubServices(
  router: ConnectRouter,
  deps: GitHubControllerDeps,
): void {
  router.service(GitHubQueryController, {
    listRepositories: (req, ctx) => listRepositories(deps, req, ctx),
    searchRepositories: (req, ctx) => searchRepositories(deps, req, ctx),
    listBranches: (req, ctx) => listBranches(deps, req, ctx),
    getTree: (req, ctx) => getTree(deps, req, ctx),
    getFileContent: (req, ctx) => getFileContent(deps, req, ctx),
  });
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
