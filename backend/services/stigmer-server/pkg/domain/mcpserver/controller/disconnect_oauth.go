package mcpserver

import (
	"context"

	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
)

// DisconnectOAuth tears down a user's OAuth connection for an MCP server.
//
// Deletes the OAuthGrant record and its associated managed environment
// (which holds the access and refresh tokens). The MCP server definition
// is unchanged — only the caller's personal OAuth connection is removed.
//
// Idempotent: if no grant exists for the (caller, resource_id, org) tuple,
// returns disconnected=false without error. This supports race conditions,
// retries after partial failures, and desired-state semantics.
//
// Delete order: managed environment first (eliminates secrets), then grant
// record (metadata only). If grant deletion fails after environment deletion,
// the orphaned grant is harmless metadata pointing to a deleted environment.
func (c *McpServerController) DisconnectOAuth(
	ctx context.Context,
	input *mcpserverv1.DisconnectOAuthInput,
) (*mcpserverv1.DisconnectOAuthOutput, error) {
	if c.oauthGrantStore == nil {
		return &mcpserverv1.DisconnectOAuthOutput{Disconnected: false}, nil
	}

	resourceID := input.GetResourceId()
	if resourceID == "" {
		return nil, grpclib.InvalidArgumentError("resource_id is required")
	}
	org := input.GetOrg()
	if org == "" {
		return nil, grpclib.InvalidArgumentError("org is required")
	}

	// OSS mode: single user, empty identity_account_id.
	grant, err := c.oauthGrantStore.Find(ctx, "", resourceID, org)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to look up OAuth grant")
	}

	if grant == nil {
		log.Debug().
			Str("resource_id", resourceID).
			Str("org", org).
			Msg("No OAuth grant to disconnect")
		return &mcpserverv1.DisconnectOAuthOutput{Disconnected: false}, nil
	}

	envID := grant.EnvironmentID
	if envID != "" && c.managedEnvService != nil {
		if err := c.managedEnvService.DeleteManagedEnvironment(ctx, envID); err != nil {
			log.Warn().Err(err).
				Str("resource_id", resourceID).
				Str("environment_id", envID).
				Msg("Failed to delete managed environment — may already be deleted")
		}
	}

	if err := c.oauthGrantStore.Delete(ctx, "", resourceID, org); err != nil {
		return nil, grpclib.InternalError(err, "failed to delete OAuth grant")
	}

	log.Info().
		Str("resource_id", resourceID).
		Str("org", org).
		Bool("env_deleted", envID != "").
		Msg("OAuth connection disconnected")

	return &mcpserverv1.DisconnectOAuthOutput{Disconnected: true}, nil
}
