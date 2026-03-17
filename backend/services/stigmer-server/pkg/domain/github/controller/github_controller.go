package github

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	githubv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/github/v1"
)

const (
	githubAuthorizeURL = "https://github.com/login/oauth/authorize"
	githubTokenURL     = "https://github.com/login/oauth/access_token"
	oauthScopes        = "repo,read:user"
	httpTimeout        = 10 * time.Second
)

// GitHubController implements the GitHubService gRPC interface.
type GitHubController struct {
	githubv1.UnimplementedGitHubServiceServer
	clientID     string
	clientSecret string
	httpClient   *http.Client
}

// NewGitHubController creates a new GitHubController with the provided OAuth credentials.
func NewGitHubController(clientID, clientSecret string) *GitHubController {
	return &GitHubController{
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient:   &http.Client{Timeout: httpTimeout},
	}
}

// GetOAuthAuthorizeUrl constructs the GitHub OAuth authorize URL.
func (c *GitHubController) GetOAuthAuthorizeUrl(
	_ context.Context,
	req *githubv1.GetOAuthAuthorizeUrlRequest,
) (*githubv1.GetOAuthAuthorizeUrlResponse, error) {
	if c.clientID == "" {
		return nil, status.Error(codes.FailedPrecondition, "GitHub OAuth is not configured (STIGMER_GITHUB_CLIENT_ID not set)")
	}

	state, err := generateState()
	if err != nil {
		log.Error().Err(err).Msg("Failed to generate OAuth state")
		return nil, status.Error(codes.Internal, "failed to generate OAuth state")
	}

	params := url.Values{
		"client_id":    {c.clientID},
		"redirect_uri": {req.RedirectUri},
		"scope":        {oauthScopes},
		"state":        {state},
	}

	authorizeURL := githubAuthorizeURL + "?" + params.Encode()

	return &githubv1.GetOAuthAuthorizeUrlResponse{
		AuthorizeUrl: authorizeURL,
		State:        state,
	}, nil
}

// ExchangeOAuthCode exchanges a GitHub authorization code for an access token.
func (c *GitHubController) ExchangeOAuthCode(
	_ context.Context,
	req *githubv1.ExchangeOAuthCodeRequest,
) (*githubv1.ExchangeOAuthCodeResponse, error) {
	if c.clientID == "" || c.clientSecret == "" {
		return nil, status.Error(codes.FailedPrecondition, "GitHub OAuth is not configured")
	}

	params := url.Values{
		"client_id":     {c.clientID},
		"client_secret": {c.clientSecret},
		"code":          {req.Code},
		"redirect_uri":  {req.RedirectUri},
	}

	httpReq, err := http.NewRequest("POST", githubTokenURL, strings.NewReader(params.Encode()))
	if err != nil {
		log.Error().Err(err).Msg("Failed to create token exchange request")
		return nil, status.Error(codes.Internal, "failed to create token exchange request")
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		log.Error().Err(err).Msg("GitHub token exchange failed")
		return nil, status.Error(codes.Unavailable, "failed to reach GitHub for token exchange")
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Error().Err(err).Msg("Failed to read GitHub token response")
		return nil, status.Error(codes.Internal, "failed to read GitHub response")
	}

	var tokenResp githubTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		log.Error().Err(err).Msg("Failed to parse GitHub token response")
		return nil, status.Error(codes.Internal, "failed to parse GitHub response")
	}

	if tokenResp.Error != "" {
		log.Warn().
			Str("error", tokenResp.Error).
			Str("description", tokenResp.ErrorDescription).
			Msg("GitHub OAuth error")
		return nil, status.Error(codes.InvalidArgument, fmt.Sprintf("GitHub OAuth error: %s", tokenResp.ErrorDescription))
	}

	return &githubv1.ExchangeOAuthCodeResponse{
		AccessToken: tokenResp.AccessToken,
		TokenType:   tokenResp.TokenType,
		Scope:       tokenResp.Scope,
	}, nil
}

// githubTokenResponse represents the JSON response from GitHub's token endpoint.
type githubTokenResponse struct {
	AccessToken      string `json:"access_token"`
	TokenType        string `json:"token_type"`
	Scope            string `json:"scope"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

func generateState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
