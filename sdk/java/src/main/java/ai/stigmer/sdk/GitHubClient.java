package ai.stigmer.sdk;

import ai.stigmer.platform.github.v1.GetGitHubFileContentInput;
import ai.stigmer.platform.github.v1.GetGitHubTreeInput;
import ai.stigmer.platform.github.v1.GitHubFileContent;
import ai.stigmer.platform.github.v1.GitHubQueryControllerGrpc;
import ai.stigmer.platform.github.v1.GitHubRepositoryList;
import ai.stigmer.platform.github.v1.GitHubTree;
import ai.stigmer.platform.github.v1.ListGitHubBranchesInput;
import ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput;
import ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput;
import ai.stigmer.sdk.gen.StigmerException;
import io.grpc.Channel;
import io.grpc.StatusRuntimeException;

import java.util.List;

/**
 * Server-side GitHub repository reads.
 *
 * <p>GitHub is connected by the vault's sign-in at the address
 * {@code github.com} (the vault client's {@code startSignIn} and
 * {@code completeSignIn}), which saves the login in the caller's My vault.
 * Repository listing, search, branches, trees and file reads go through the
 * server, which uses that saved login, so no caller holds the token.
 *
 * <pre>{@code
 * GitHubRepositoryList repos = client.github().listRepositories("acme", 1);
 * }</pre>
 */
public final class GitHubClient {

    private final GitHubQueryControllerGrpc.GitHubQueryControllerBlockingStub query;

    GitHubClient(Channel channel) {
        this.query = GitHubQueryControllerGrpc.newBlockingStub(channel);
    }

    /** One page (from 1) of the connected account's repositories, most recently updated first. */
    public GitHubRepositoryList listRepositories(String org, int page) {
        try {
            return query.listRepositories(ListGitHubRepositoriesInput.newBuilder()
                    .setOrg(org).setPage(page).build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** One page (from 1) of the connected account's repositories matching a search. */
    public GitHubRepositoryList searchRepositories(String org, String search, int page) {
        try {
            return query.searchRepositories(SearchGitHubRepositoriesInput.newBuilder()
                    .setOrg(org).setQuery(search).setPage(page).build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** A repository's branch names. */
    public List<String> listBranches(String org, String owner, String repo) {
        try {
            return query.listBranches(ListGitHubBranchesInput.newBuilder()
                    .setOrg(org).setOwner(owner).setRepo(repo).build()).getNamesList();
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** Every file and directory of a repository at a branch or commit. */
    public GitHubTree getTree(String org, String owner, String repo, String ref) {
        try {
            return query.getTree(GetGitHubTreeInput.newBuilder()
                    .setOrg(org).setOwner(owner).setRepo(repo).setRef(ref).build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** One file at a branch or commit; above 10 MiB it is too large and carries no content. */
    public GitHubFileContent getFileContent(
            String org, String owner, String repo, String ref, String path) {
        try {
            return query.getFileContent(GetGitHubFileContentInput.newBuilder()
                    .setOrg(org).setOwner(owner).setRepo(repo).setRef(ref).setPath(path).build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }
}
