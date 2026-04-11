package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// TokenResponse holds the response from an OAuth token endpoint.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`

	// Slack V2 nests user tokens under authed_user when only user scopes
	// are requested. Standard OAuth providers leave this nil.
	AuthedUser *authedUser `json:"authed_user,omitempty"`
}

// resolveFromAuthedUser promotes Slack's nested authed_user fields to
// the top level so callers don't need vendor-specific logic.
func (r *TokenResponse) resolveFromAuthedUser() {
	if r.AccessToken == "" && r.AuthedUser != nil {
		if r.AuthedUser.AccessToken != "" {
			r.AccessToken = r.AuthedUser.AccessToken
		}
		if r.TokenType == "" && r.AuthedUser.TokenType != "" {
			r.TokenType = r.AuthedUser.TokenType
		}
		if r.Scope == "" && r.AuthedUser.Scope != "" {
			r.Scope = r.AuthedUser.Scope
		}
	}
}

type authedUser struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
}

var tokenHTTPClient = &http.Client{Timeout: 15 * time.Second}

// ExchangeCode exchanges an authorization code for tokens at the given
// token endpoint using the authorization_code grant with PKCE.
//
// For public clients (DCR), clientSecret should be empty.
// For confidential clients (vendor OAuth), clientSecret is from the OAuthApp.
func ExchangeCode(
	ctx context.Context,
	tokenEndpoint string,
	code string,
	redirectURI string,
	codeVerifier string,
	clientID string,
	clientSecret string,
) (*TokenResponse, error) {
	params := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"code_verifier": {codeVerifier},
		"client_id":     {clientID},
	}

	return doTokenRequest(ctx, tokenEndpoint, params, clientID, clientSecret)
}

// RefreshToken exchanges a refresh token for a new access token.
//
// For public clients (DCR), clientSecret should be empty.
// For confidential clients (vendor OAuth), clientSecret is from the OAuthApp.
//
// The response may include a new refresh token (token rotation). Callers
// should always check TokenResponse.RefreshToken and update storage if
// a new one is issued.
func RefreshToken(
	ctx context.Context,
	tokenEndpoint string,
	refreshToken string,
	clientID string,
	clientSecret string,
) (*TokenResponse, error) {
	params := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {clientID},
	}

	return doTokenRequest(ctx, tokenEndpoint, params, clientID, clientSecret)
}

func doTokenRequest(
	ctx context.Context,
	tokenEndpoint string,
	params url.Values,
	clientID string,
	clientSecret string,
) (*TokenResponse, error) {
	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, tokenEndpoint,
		strings.NewReader(params.Encode()),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	if clientSecret != "" {
		req.SetBasicAuth(clientID, clientSecret)
	}

	resp, err := tokenHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request to %s failed: %w", tokenEndpoint, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf(
			"token endpoint %s returned HTTP %d: %s",
			tokenEndpoint, resp.StatusCode, truncateBody(body),
		)
	}

	var tokenResp TokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	tokenResp.resolveFromAuthedUser()

	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("token response from %s is missing access_token", tokenEndpoint)
	}

	return &tokenResp, nil
}
