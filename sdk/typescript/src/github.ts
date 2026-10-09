/**
 * The GitHub client: reads the connected account's repositories through the
 * server, so no caller ever holds the token.
 *
 * GitHub is connected by the vault's sign-in at the address `github.com`
 * (`VaultClient.startSignIn` and `completeSignIn`), which saves the login in
 * the caller's My vault. Repository listing, search, branches, trees and file
 * reads go through `GitHubQueryController`, which uses that saved login on
 * the server; each answers FAILED_PRECONDITION when the caller has none.
 */
import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
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

/** A repository on GitHub, by owner and name. */
export interface GitHubRepoParams {
  /** Organization whose My vault holds the github.com login. */
  readonly org: string;
  readonly owner: string;
  readonly repo: string;
}

/** Client for the server-side repository reads that use the caller's github.com login. */
export class GitHubClient {
  private readonly query: Client<typeof GitHubQueryController>;

  constructor(transport: Transport) {
    this.query = createClient(GitHubQueryController, transport);
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
