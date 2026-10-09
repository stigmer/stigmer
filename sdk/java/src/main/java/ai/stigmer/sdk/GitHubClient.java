package ai.stigmer.sdk;

import ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest;
import ai.stigmer.platform.github.v1.GetGitHubFileContentInput;
import ai.stigmer.platform.github.v1.GetGitHubTreeInput;
import ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest;
import ai.stigmer.platform.github.v1.GitHubFileContent;
import ai.stigmer.platform.github.v1.GitHubQueryControllerGrpc;
import ai.stigmer.platform.github.v1.GitHubRepositoryList;
import ai.stigmer.platform.github.v1.GitHubServiceGrpc;
import ai.stigmer.platform.github.v1.GitHubTree;
import ai.stigmer.platform.github.v1.ListGitHubBranchesInput;
import ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput;
import ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput;
import ai.stigmer.sdk.gen.StigmerException;
import io.grpc.Channel;
import io.grpc.StatusRuntimeException;

import java.util.List;
import java.util.Objects;

/**
 * GitHub sign-in and server-side repository reads.
 *
 * <p>The OAuth exchange saves the token as the github.com login in the
 * caller's My vault in the named organization and returns only the account it
 * belongs to. Repository listing, search, branches, trees and file reads go
 * through the server, which uses that saved login, so no caller holds the token.
 *
 * <pre>{@code
 * GitHubClient.OAuthAuthorizeUrlResponse auth = client.github().getOAuthAuthorizeUrl(
 *     GitHubClient.GetOAuthAuthorizeUrlParams.builder()
 *         .redirectUri("https://app.example.com/callback")
 *         .org("acme")
 *         .build());
 * // redirect user to auth.getAuthorizeUrl()
 * }</pre>
 */
public final class GitHubClient {

    private final GitHubServiceGrpc.GitHubServiceBlockingStub stub;
    private final GitHubQueryControllerGrpc.GitHubQueryControllerBlockingStub query;

    GitHubClient(Channel channel) {
        this.stub = GitHubServiceGrpc.newBlockingStub(channel);
        this.query = GitHubQueryControllerGrpc.newBlockingStub(channel);
    }

    /** Gets the GitHub OAuth authorize URL to redirect the user to. */
    public OAuthAuthorizeUrlResponse getOAuthAuthorizeUrl(GetOAuthAuthorizeUrlParams params) {
        try {
            ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse resp =
                    stub.getOAuthAuthorizeUrl(GetOAuthAuthorizeUrlRequest.newBuilder()
                            .setRedirectUri(params.redirectUri)
                            .setOrg(params.org)
                            .build());
            return new OAuthAuthorizeUrlResponse(resp.getAuthorizeUrl(), resp.getState());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Exchanges an OAuth authorization code; the server saves the login in the
     * caller's My vault and returns the account it belongs to.
     */
    public ConnectedAccount exchangeOAuthCode(ExchangeOAuthCodeParams params) {
        try {
            ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse resp =
                    stub.exchangeOAuthCode(ExchangeOAuthCodeRequest.newBuilder()
                            .setCode(params.code)
                            .setState(params.state)
                            .setRedirectUri(params.redirectUri)
                            .setOrg(params.org)
                            .build());
            return new ConnectedAccount(resp.getLogin(), resp.getTokenType(), resp.getScope());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
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

    // -- GetOAuthAuthorizeUrlParams -------------------------------------------

    /** Parameters for getting the GitHub OAuth authorize URL. */
    public static final class GetOAuthAuthorizeUrlParams {
        final String redirectUri;
        final String org;

        private GetOAuthAuthorizeUrlParams(Builder builder) {
            this.redirectUri = builder.redirectUri;
            this.org = builder.org;
        }

        public static Builder builder() { return new Builder(); }

        public static final class Builder {
            private String redirectUri;
            private String org;

            private Builder() {}

            /**
             * The organization whose My vault will keep the login, by slug or id;
             * the caller must be a member of it, and the exchange names the same one.
             */
            public Builder org(String org) {
                this.org = Objects.requireNonNull(org);
                return this;
            }

            /** The URI that GitHub will redirect back to after the user authorizes. */
            public Builder redirectUri(String redirectUri) {
                this.redirectUri = Objects.requireNonNull(redirectUri);
                return this;
            }

            public GetOAuthAuthorizeUrlParams build() {
                Objects.requireNonNull(redirectUri, "redirectUri is required");
                Objects.requireNonNull(org, "org is required");
                return new GetOAuthAuthorizeUrlParams(this);
            }
        }
    }

    // -- OAuthAuthorizeUrlResponse --------------------------------------------

    /** Response containing the OAuth authorize URL and CSRF state. */
    public static final class OAuthAuthorizeUrlResponse {
        private final String authorizeUrl;
        private final String state;

        OAuthAuthorizeUrlResponse(String authorizeUrl, String state) {
            this.authorizeUrl = authorizeUrl;
            this.state = state;
        }

        public String getAuthorizeUrl() { return authorizeUrl; }
        public String getState() { return state; }
    }

    // -- ExchangeOAuthCodeParams ----------------------------------------------

    /** Parameters for exchanging a GitHub OAuth authorization code. */
    public static final class ExchangeOAuthCodeParams {
        final String code;
        final String state;
        final String redirectUri;
        final String org;

        private ExchangeOAuthCodeParams(Builder builder) {
            this.code = builder.code;
            this.state = builder.state;
            this.redirectUri = builder.redirectUri;
            this.org = builder.org;
        }

        public static Builder builder() { return new Builder(); }

        public static final class Builder {
            private String code;
            private String state;
            private String redirectUri;
            private String org;

            private Builder() {}

            /** The organization whose My vault keeps the login, by slug or id. */
            public Builder org(String org) {
                this.org = Objects.requireNonNull(org);
                return this;
            }

            /** The authorization code received from GitHub's OAuth redirect. */
            public Builder code(String code) {
                this.code = Objects.requireNonNull(code);
                return this;
            }

            /** The state value from the original authorize request, for CSRF verification. */
            public Builder state(String state) {
                this.state = Objects.requireNonNull(state);
                return this;
            }

            /** The redirect_uri used in the original authorize request. */
            public Builder redirectUri(String redirectUri) {
                this.redirectUri = Objects.requireNonNull(redirectUri);
                return this;
            }

            public ExchangeOAuthCodeParams build() {
                Objects.requireNonNull(code, "code is required");
                Objects.requireNonNull(state, "state is required");
                Objects.requireNonNull(redirectUri, "redirectUri is required");
                Objects.requireNonNull(org, "org is required");
                return new ExchangeOAuthCodeParams(this);
            }
        }
    }

    // -- ConnectedAccount -----------------------------------------------------

    /** The GitHub account a saved login belongs to. */
    public static final class ConnectedAccount {
        private final String login;
        private final String tokenType;
        private final String scope;

        ConnectedAccount(String login, String tokenType, String scope) {
            this.login = login;
            this.tokenType = tokenType;
            this.scope = scope;
        }

        public String getLogin() { return login; }
        public String getTokenType() { return tokenType; }
        public String getScope() { return scope; }
    }
}
