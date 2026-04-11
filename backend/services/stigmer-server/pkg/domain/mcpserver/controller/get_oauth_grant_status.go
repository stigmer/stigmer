package mcpserver

import (
	"context"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// GetOAuthGrantStatus checks whether the authenticated user has an active
// OAuth grant for the specified MCP server in the given org.
//
// Returns grant metadata (connected status, token expiry, auth method)
// without exposing secret token values. The frontend uses this to render
// the correct OAuth state in the MCP server detail page and session composer.
//
// In OSS mode the identity_account_id is always empty (single-user).
func (c *McpServerController) GetOAuthGrantStatus(
	ctx context.Context,
	input *mcpserverv1.GetOAuthGrantStatusInput,
) (*mcpserverv1.GetOAuthGrantStatusOutput, error) {
	if c.oauthGrantStore == nil {
		return &mcpserverv1.GetOAuthGrantStatusOutput{Connected: false}, nil
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
		return &mcpserverv1.GetOAuthGrantStatusOutput{Connected: false}, nil
	}

	return &mcpserverv1.GetOAuthGrantStatusOutput{
		Connected:            true,
		AccessTokenExpiresAt: grant.AccessTokenExpiresAt,
		TargetEnvVar:         grant.AccessTokenEnvVar,
		AuthMethod:           grant.AuthMethod,
	}, nil
}
