package stigmer

import (
	"context"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
	githubv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/platform/github/v1"
	"google.golang.org/grpc"
)

// GetOAuthAuthorizeUrlParams configures a request to get the GitHub OAuth authorize URL.
type GetOAuthAuthorizeUrlParams struct {
	RedirectURI string
}

// OAuthAuthorizeUrlResponse holds the authorize URL and CSRF state returned by the platform.
type OAuthAuthorizeUrlResponse struct {
	AuthorizeURL string
	State        string
}

// ExchangeOAuthCodeParams configures a request to exchange a GitHub OAuth authorization code.
type ExchangeOAuthCodeParams struct {
	Code        string
	State       string
	RedirectURI string
}

// OAuthTokenResponse holds the access token returned by the GitHub OAuth exchange.
type OAuthTokenResponse struct {
	AccessToken string
	TokenType   string
	Scope       string
}

// GitHubClient provides GitHub OAuth integration against the Stigmer platform.
type GitHubClient struct {
	github githubv1.GitHubServiceClient
}

func newGitHubClient(conn grpc.ClientConnInterface) *GitHubClient {
	return &GitHubClient{github: githubv1.NewGitHubServiceClient(conn)}
}

// GetOAuthAuthorizeUrl returns the GitHub OAuth authorize URL to redirect the user to.
func (g *GitHubClient) GetOAuthAuthorizeUrl(ctx context.Context, params *GetOAuthAuthorizeUrlParams) (*OAuthAuthorizeUrlResponse, error) {
	resp, err := g.github.GetOAuthAuthorizeUrl(ctx, &githubv1.GetOAuthAuthorizeUrlRequest{
		RedirectUri: params.RedirectURI,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return &OAuthAuthorizeUrlResponse{
		AuthorizeURL: resp.GetAuthorizeUrl(),
		State:        resp.GetState(),
	}, nil
}

// ExchangeOAuthCode exchanges an OAuth authorization code for an access token.
func (g *GitHubClient) ExchangeOAuthCode(ctx context.Context, params *ExchangeOAuthCodeParams) (*OAuthTokenResponse, error) {
	resp, err := g.github.ExchangeOAuthCode(ctx, &githubv1.ExchangeOAuthCodeRequest{
		Code:        params.Code,
		State:       params.State,
		RedirectUri: params.RedirectURI,
	})
	if err != nil {
		return nil, gen.WrapErr(err)
	}
	return &OAuthTokenResponse{
		AccessToken: resp.GetAccessToken(),
		TokenType:   resp.GetTokenType(),
		Scope:       resp.GetScope(),
	}, nil
}
