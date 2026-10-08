/**
 * The GitHub client: connects a GitHub account through OAuth and reads its
 * repositories through the server, so no caller ever holds the token.
 *
 * The OAuth exchange saves the token as the `github.com` login in the
 * caller's My vault in the named organization and answers only the account's
 * login and scopes. Repository listing, search, branches, trees and file
 * reads go through `GitHubQueryController`, which uses that saved login on
 * the server; each answers FAILED_PRECONDITION when the caller has none.
 */
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  ExchangeOAuthCodeRequestSchema,
  GetOAuthAuthorizeUrlRequestSchema,
  GitHubService,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";
import {
  GetGitHubFileContentInputSchema,
  GetGitHubTreeInputSchema,
  ListGitHubBranchesInputSchema,
  ListGitHubRepositoriesInputSchema,
  SearchGitHubRepositoriesInputSchema,
  type GitHubBranchList,
  type GitHubFileContent,
  type GitHubRepositoryList,
  type GitHubTree,
} from "@stigmer/protos/ai/stigmer/platform/github/v1/io_pb";
import { GitHubQueryController } from "@stigmer/protos/ai/stigmer/platform/github/v1/query_pb";
import { wrapError } from "./gen/errors.js";

/** Parameters for getting the OAuth authorize URL. */
export interface GetOAuthAuthorizeUrlParams {
  readonly redirectUri: string;
  /** Organization whose My vault will keep the login, by slug or id. */
  readonly org: string;
}

/** Response containing the OAuth authorize URL and state. */
export interface OAuthAuthorizeUrlResponse {
  readonly authorizeUrl: string;
  readonly state: string;
}

/** Parameters for exchanging an OAuth authorization code. */
export interface ExchangeOAuthCodeParams {
  readonly code: string;
  readonly state: string;
  readonly redirectUri: string;
  /** Organization whose My vault keeps the login, by slug or id. */
  readonly org: string;
}

/** The connected account; the token stays in the caller's My vault. */
export interface GitHubConnectedAccount {
  readonly login: string;
  readonly tokenType: string;
  readonly scope: string;
}

/** A repository on GitHub, by owner and name. */
export interface GitHubRepoParams {
  /** Organization whose My vault holds the github.com login. */
  readonly org: string;
  readonly owner: string;
  readonly repo: string;
}

/**
 * Client for GitHub: the OAuth sign-in that saves the login in My vault, and
 * the server-side repository reads that use it.
 */
export class GitHubClient {
  private readonly github: Client<typeof GitHubService>;
  private readonly query: Client<typeof GitHubQueryController>;

  constructor(transport: Transport) {
    this.github = createClient(GitHubService, transport);
    this.query = createClient(GitHubQueryController, transport);
  }

  /** Get the GitHub OAuth authorize URL to redirect the user to. */
  async getOAuthAuthorizeUrl(
    params: GetOAuthAuthorizeUrlParams,
  ): Promise<OAuthAuthorizeUrlResponse> {
    try {
      const resp = await this.github.getOAuthAuthorizeUrl(
        create(GetOAuthAuthorizeUrlRequestSchema, {
          redirectUri: params.redirectUri,
          org: params.org,
        }),
      );
      return {
        authorizeUrl: resp.authorizeUrl,
        state: resp.state,
      };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Exchange an OAuth authorization code; the server saves the login in the
   * caller's My vault and answers the account it belongs to.
   */
  async exchangeOAuthCode(
    params: ExchangeOAuthCodeParams,
  ): Promise<GitHubConnectedAccount> {
    try {
      const resp = await this.github.exchangeOAuthCode(
        create(ExchangeOAuthCodeRequestSchema, {
          code: params.code,
          state: params.state,
          redirectUri: params.redirectUri,
          org: params.org,
        }),
      );
      return {
        login: resp.login,
        tokenType: resp.tokenType,
        scope: resp.scope,
      };
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** One page (from 1) of the connected account's repositories, most recently updated first. */
  async listRepositories(params: {
    readonly org: string;
    readonly page: number;
  }): Promise<GitHubRepositoryList> {
    try {
      return await this.query.listRepositories(
        create(ListGitHubRepositoriesInputSchema, { ...params }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** One page (from 1) of the connected account's repositories matching a search. */
  async searchRepositories(params: {
    readonly org: string;
    readonly query: string;
    readonly page: number;
  }): Promise<GitHubRepositoryList> {
    try {
      return await this.query.searchRepositories(
        create(SearchGitHubRepositoriesInputSchema, { ...params }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** A repository's branch names. */
  async listBranches(params: GitHubRepoParams): Promise<GitHubBranchList> {
    try {
      return await this.query.listBranches(
        create(ListGitHubBranchesInputSchema, { ...params }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Every file and directory of a repository at a branch or commit. */
  async getTree(params: GitHubRepoParams & { readonly ref: string }): Promise<GitHubTree> {
    try {
      return await this.query.getTree(create(GetGitHubTreeInputSchema, { ...params }));
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** One file of a repository at a branch or commit; files above 10 MiB come back `tooLarge` with no content. */
  async getFileContent(
    params: GitHubRepoParams & { readonly ref: string; readonly path: string },
  ): Promise<GitHubFileContent> {
    try {
      return await this.query.getFileContent(
        create(GetGitHubFileContentInputSchema, { ...params }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }
}
