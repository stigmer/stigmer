package mcpserver

import (
	"context"
	"time"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Must match oauth.RefreshTokenIfExpired's 60-second buffer so the health
// signal ("expired but refreshable") aligns with what the refresh service
// will actually do at execution time.
const expiryBufferSeconds = 60

// GetOAuthGrantStatus checks whether the authenticated user has an active
// OAuth grant for the specified MCP server in the given org.
//
// Returns grant metadata (connected status, token expiry, auth method,
// connection health) without exposing secret token values. The frontend
// uses this to render the correct OAuth state in the MCP server detail
// page and session composer.
//
// In OSS mode the identity_account_id is always empty (single-user).
func (c *McpServerController) GetOAuthGrantStatus(
	ctx context.Context,
	input *mcpserverv1.GetOAuthGrantStatusInput,
) (*mcpserverv1.GetOAuthGrantStatusOutput, error) {
	if c.oauthGrantStore == nil {
		return &mcpserverv1.GetOAuthGrantStatusOutput{
			Connected:        false,
			ConnectionHealth: mcpserverv1.OAuthConnectionHealth_OAUTH_CONNECTION_HEALTH_NO_GRANT,
		}, nil
	}

	if input.GetResourceId() == "" {
		return nil, status.Error(codes.InvalidArgument, "resource_id is required")
	}
	if input.GetOrg() == "" {
		return nil, status.Error(codes.InvalidArgument, "org is required")
	}

	grant, err := c.oauthGrantStore.Find(ctx, "", input.GetResourceId(), input.GetOrg())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to look up OAuth grant: %v", err)
	}

	if grant == nil {
		return &mcpserverv1.GetOAuthGrantStatusOutput{
			Connected:        false,
			ConnectionHealth: mcpserverv1.OAuthConnectionHealth_OAUTH_CONNECTION_HEALTH_NO_GRANT,
		}, nil
	}

	return &mcpserverv1.GetOAuthGrantStatusOutput{
		Connected:            true,
		AccessTokenExpiresAt: grant.AccessTokenExpiresAt,
		TargetEnvVar:         grant.AccessTokenEnvVar,
		AuthMethod:           grant.AuthMethod,
		ConnectionHealth:     evaluateHealth(grant),
	}, nil
}

// evaluateHealth determines the health of an OAuth connection from locally
// available grant metadata. Uses the same 60-second expiry buffer as
// oauth.RefreshTokenIfExpired so the UX signal matches execution behavior.
func evaluateHealth(grant *oauth.OAuthGrant) mcpserverv1.OAuthConnectionHealth {
	if grant.AccessTokenExpiresAt == 0 {
		return mcpserverv1.OAuthConnectionHealth_OAUTH_CONNECTION_HEALTH_HEALTHY
	}

	now := time.Now().Unix()
	if now < grant.AccessTokenExpiresAt-expiryBufferSeconds {
		return mcpserverv1.OAuthConnectionHealth_OAUTH_CONNECTION_HEALTH_HEALTHY
	}

	if grant.RefreshTokenEnvVar != "" {
		return mcpserverv1.OAuthConnectionHealth_OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE
	}

	return mcpserverv1.OAuthConnectionHealth_OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED
}
