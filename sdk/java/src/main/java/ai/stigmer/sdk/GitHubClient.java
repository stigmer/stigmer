package ai.stigmer.sdk;

import ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest;
import ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest;
import ai.stigmer.platform.github.v1.GitHubServiceGrpc;
import ai.stigmer.sdk.gen.StigmerException;
import io.grpc.Channel;
import io.grpc.StatusRuntimeException;

import java.util.Objects;

/**
 * GitHub OAuth integration client.
 *
 * <p>Provides methods to initiate the OAuth flow (get authorize URL) and
 * exchange the authorization code for an access token. The access token
 * is returned to the caller — the backend never persists it.
 *
 * <pre>{@code
 * GitHubClient.OAuthAuthorizeUrlResponse auth = client.github().getOAuthAuthorizeUrl(
 *     GitHubClient.GetOAuthAuthorizeUrlParams.builder()
 *         .redirectUri("https://app.example.com/callback")
 *         .build());
 * // redirect user to auth.getAuthorizeUrl()
 * }</pre>
 */
public final class GitHubClient {

    private final GitHubServiceGrpc.GitHubServiceBlockingStub stub;

    GitHubClient(Channel channel) {
        this.stub = GitHubServiceGrpc.newBlockingStub(channel);
    }

    /** Gets the GitHub OAuth authorize URL to redirect the user to. */
    public OAuthAuthorizeUrlResponse getOAuthAuthorizeUrl(GetOAuthAuthorizeUrlParams params) {
        try {
            ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse resp =
                    stub.getOAuthAuthorizeUrl(GetOAuthAuthorizeUrlRequest.newBuilder()
                            .setRedirectUri(params.redirectUri)
                            .build());
            return new OAuthAuthorizeUrlResponse(resp.getAuthorizeUrl(), resp.getState());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** Exchanges an OAuth authorization code for an access token. */
    public OAuthTokenResponse exchangeOAuthCode(ExchangeOAuthCodeParams params) {
        try {
            ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse resp =
                    stub.exchangeOAuthCode(ExchangeOAuthCodeRequest.newBuilder()
                            .setCode(params.code)
                            .setState(params.state)
                            .setRedirectUri(params.redirectUri)
                            .build());
            return new OAuthTokenResponse(
                    resp.getAccessToken(), resp.getTokenType(), resp.getScope());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    // -- GetOAuthAuthorizeUrlParams -------------------------------------------

    /** Parameters for getting the GitHub OAuth authorize URL. */
    public static final class GetOAuthAuthorizeUrlParams {
        final String redirectUri;

        private GetOAuthAuthorizeUrlParams(Builder builder) {
            this.redirectUri = builder.redirectUri;
        }

        public static Builder builder() { return new Builder(); }

        public static final class Builder {
            private String redirectUri;

            private Builder() {}

            /** The URI that GitHub will redirect back to after the user authorizes. */
            public Builder redirectUri(String redirectUri) {
                this.redirectUri = Objects.requireNonNull(redirectUri);
                return this;
            }

            public GetOAuthAuthorizeUrlParams build() {
                Objects.requireNonNull(redirectUri, "redirectUri is required");
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

        private ExchangeOAuthCodeParams(Builder builder) {
            this.code = builder.code;
            this.state = builder.state;
            this.redirectUri = builder.redirectUri;
        }

        public static Builder builder() { return new Builder(); }

        public static final class Builder {
            private String code;
            private String state;
            private String redirectUri;

            private Builder() {}

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
                return new ExchangeOAuthCodeParams(this);
            }
        }
    }

    // -- OAuthTokenResponse ---------------------------------------------------

    /** Response containing the exchanged GitHub access token. */
    public static final class OAuthTokenResponse {
        private final String accessToken;
        private final String tokenType;
        private final String scope;

        OAuthTokenResponse(String accessToken, String tokenType, String scope) {
            this.accessToken = accessToken;
            this.tokenType = tokenType;
            this.scope = scope;
        }

        public String getAccessToken() { return accessToken; }
        public String getTokenType() { return tokenType; }
        public String getScope() { return scope; }
    }
}
