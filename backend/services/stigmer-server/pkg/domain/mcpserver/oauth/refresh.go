package oauth

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
)

// RefreshResult holds the outcome of a token refresh attempt.
type RefreshResult struct {
	Refreshed       bool
	NewAccessToken  string
	NewRefreshToken string
	NewExpiresAt    int64
}

// RefreshTokenIfExpired checks if the access token for a given OAuthGrant
// is expired, and if so, uses the refresh token to obtain a new one.
//
// Returns a RefreshResult indicating whether a refresh occurred and the
// new token values. The caller is responsible for updating the personal
// environment and the OAuthGrant record with the new values.
//
// Parameters:
//   - grant: the OAuthGrant record (must not be nil)
//   - currentRefreshToken: the decrypted refresh token from the personal env
//   - clientSecret: decrypted client_secret (empty for DCR/public clients)
//
// Returns:
//   - RefreshResult with new token values if refreshed
//   - nil result if the token is not expired
//   - error if the refresh failed (caller should return re-auth error to user)
func RefreshTokenIfExpired(
	ctx context.Context,
	grant *OAuthGrant,
	currentRefreshToken string,
	clientSecret string,
) (*RefreshResult, error) {
	if grant.AccessTokenExpiresAt == 0 {
		// Token does not expire (e.g., long-lived tokens from Notion/Slack)
		return &RefreshResult{Refreshed: false}, nil
	}

	now := time.Now().Unix()
	// Add a 60-second buffer to refresh slightly before expiry
	if now < grant.AccessTokenExpiresAt-60 {
		return &RefreshResult{Refreshed: false}, nil
	}

	if currentRefreshToken == "" {
		return nil, fmt.Errorf(
			"access token for resource '%s' has expired and no refresh token is available. "+
				"Please re-authenticate via OAuth Connect",
			grant.ResourceID,
		)
	}

	log.Info().
		Str("resource_id", grant.ResourceID).
		Str("resource_kind", grant.ResourceKind).
		Int64("expired_at", grant.AccessTokenExpiresAt).
		Str("token_endpoint", grant.TokenEndpoint).
		Msg("Access token expired, refreshing via refresh_token grant")

	tokenResp, err := RefreshToken(
		ctx,
		grant.TokenEndpoint,
		currentRefreshToken,
		grant.ClientID,
		clientSecret,
	)
	if err != nil {
		return nil, fmt.Errorf(
			"token refresh failed for resource '%s': %w. "+
				"Please re-authenticate via OAuth Connect",
			grant.ResourceID, err,
		)
	}

	var newExpiresAt int64
	if tokenResp.ExpiresIn > 0 {
		newExpiresAt = time.Now().Unix() + tokenResp.ExpiresIn
	}

	newRefreshToken := currentRefreshToken
	if tokenResp.RefreshToken != "" {
		newRefreshToken = tokenResp.RefreshToken
	}

	log.Info().
		Str("resource_id", grant.ResourceID).
		Str("resource_kind", grant.ResourceKind).
		Int64("new_expires_at", newExpiresAt).
		Bool("refresh_token_rotated", tokenResp.RefreshToken != "").
		Msg("Token refresh successful")

	return &RefreshResult{
		Refreshed:       true,
		NewAccessToken:  tokenResp.AccessToken,
		NewRefreshToken: newRefreshToken,
		NewExpiresAt:    newExpiresAt,
	}, nil
}
