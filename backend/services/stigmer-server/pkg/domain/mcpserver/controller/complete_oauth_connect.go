package mcpserver

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
)

// CompleteOAuthConnect finishes the OAuth flow by exchanging the authorization
// code for tokens, storing them in the personal environment, and creating an
// OAuthGrant record.
func (c *McpServerController) CompleteOAuthConnect(
	ctx context.Context,
	input *mcpserverv1.CompleteOAuthConnectInput,
) (*mcpserverv1.CompleteOAuthConnectOutput, error) {
	if c.pendingOAuthStateStore == nil || c.oauthGrantStore == nil {
		return nil, grpclib.FailedPreconditionError(
			"OAuth Connect dependencies not initialized",
		)
	}

	mcpServerID := input.GetMcpServerId()
	if mcpServerID == "" {
		return nil, grpclib.InvalidArgumentError("mcp_server_id is required")
	}

	stateParam := input.GetState()
	if stateParam == "" {
		return nil, grpclib.InvalidArgumentError("state is required")
	}

	code := input.GetAuthorizationCode()
	if code == "" {
		return nil, grpclib.InvalidArgumentError("authorization_code is required")
	}

	// Load and validate pending state (atomically consumed)
	pendingState, err := c.pendingOAuthStateStore.GetAndDelete(ctx, stateParam)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to load pending OAuth state")
	}
	if pendingState == nil {
		return nil, grpclib.FailedPreconditionError(
			"no pending OAuth state found for the given state parameter (expired or already used)",
		)
	}

	if pendingState.McpServerID != mcpServerID {
		return nil, grpclib.FailedPreconditionError(
			"state parameter does not match the requested mcp_server_id",
		)
	}

	// Exchange authorization code for tokens
	tokenResp, err := oauth.ExchangeCode(
		ctx,
		pendingState.TokenEndpoint,
		code,
		pendingState.RedirectURI,
		pendingState.CodeVerifier,
		pendingState.ClientID,
		pendingState.ClientSecret,
	)
	if err != nil {
		return nil, grpclib.UnavailableError(
			"token exchange failed: %v", err,
		)
	}

	// Load the MCP server to get the auth block metadata
	mcpServer := &mcpserverv1.McpServer{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_mcp_server, mcpServerID, mcpServer); err != nil {
		return nil, grpclib.NotFoundError("mcp_server", mcpServerID)
	}

	// Resolve (or auto-create) the personal environment in the caller's org
	org := pendingState.Org
	if org == "" {
		org = mcpServer.GetMetadata().GetOrg()
	}
	personalEnvID, err := c.resolveOrCreatePersonalEnvironmentID(ctx, org)
	if err != nil {
		return nil, err
	}

	// Store access token in personal environment
	variables := map[string]*environmentv1.EnvironmentValue{
		pendingState.TargetEnvVar: {
			Value:    tokenResp.AccessToken,
			IsSecret: true,
		},
	}

	// Store refresh token if provided
	refreshTokenEnvVar := pendingState.TargetEnvVar + "_REFRESH_TOKEN"
	if tokenResp.RefreshToken != "" {
		variables[refreshTokenEnvVar] = &environmentv1.EnvironmentValue{
			Value:    tokenResp.RefreshToken,
			IsSecret: true,
		}
	}

	_, err = c.environmentClient.UpdateVariables(ctx, &environmentv1.UpdateEnvironmentVariablesRequest{
		EnvironmentId: personalEnvID,
		Variables:     variables,
	})
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to store OAuth tokens in personal environment")
	}

	// Calculate token expiry
	var expiresAt int64
	if tokenResp.ExpiresIn > 0 {
		expiresAt = time.Now().Unix() + tokenResp.ExpiresIn
	}

	// Create OAuthGrant record
	grant := &oauth.OAuthGrant{
		IdentityAccountID:    pendingState.IdentityAccountID,
		McpServerID:          mcpServerID,
		AccessTokenExpiresAt: expiresAt,
		ClientID:             pendingState.ClientID,
		AuthMethod:           pendingState.AuthMethod,
		TokenEndpoint:        pendingState.TokenEndpoint,
		AccessTokenEnvVar:    pendingState.TargetEnvVar,
		RefreshTokenEnvVar:   refreshTokenEnvVar,
		EnvironmentID:        personalEnvID,
	}

	if err := c.oauthGrantStore.Upsert(ctx, grant); err != nil {
		return nil, grpclib.InternalError(err, "failed to create OAuth grant record")
	}

	auth := mcpServer.GetSpec().GetAuth()

	log.Info().
		Str("mcp_server_id", mcpServerID).
		Str("auth_method", pendingState.AuthMethod).
		Str("target_env_var", pendingState.TargetEnvVar).
		Int64("expires_at", expiresAt).
		Bool("has_refresh_token", tokenResp.RefreshToken != "").
		Msg("OAuth Connect completed: tokens stored in personal environment")

	return &mcpserverv1.CompleteOAuthConnectOutput{
		Connected:         true,
		TargetEnvVar:      pendingState.TargetEnvVar,
		TokenLifetimeHint: auth.GetTokenLifetimeHint(),
	}, nil
}

// resolveOrCreatePersonalEnvironmentID finds the user's personal environment
// in the given org, or auto-creates one if it doesn't exist.
func (c *McpServerController) resolveOrCreatePersonalEnvironmentID(
	ctx context.Context,
	org string,
) (string, error) {
	listResp, err := c.environmentClient.List(ctx, &environmentv1.ListEnvironmentsRequest{
		Org:    org,
		Labels: map[string]string{personalEnvLabel: "true"},
	})
	if err != nil {
		return "", grpclib.InternalError(err, "failed to list personal environments")
	}
	if listResp.GetTotalCount() > 0 && len(listResp.GetItems()) > 0 {
		return listResp.GetItems()[0].GetMetadata().GetId(), nil
	}

	log.Info().Str("org", org).Msg("Personal environment not found, auto-creating")

	created, err := c.environmentClient.Create(ctx, &environmentv1.Environment{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Environment",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Personal",
			Org:  org,
			Labels: map[string]string{
				personalEnvLabel: "true",
			},
		},
	})
	if err != nil {
		return "", grpclib.InternalError(err, "failed to auto-create personal environment for org '"+org+"'")
	}

	log.Info().
		Str("org", org).
		Str("env_id", created.GetMetadata().GetId()).
		Msg("Auto-created personal environment")

	return created.GetMetadata().GetId(), nil
}
