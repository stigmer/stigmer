package agentexecution

import (
	"context"
	"path"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// DefaultArtifactURLExpiration is the default expiration time for artifact download URLs.
// R2 supports up to 7 days (604800 seconds) for presigned URLs.
const DefaultArtifactURLExpiration = 7 * 24 * time.Hour // 7 days

// GetArtifactDownloadUrl generates a presigned download URL for an execution artifact.
//
// This endpoint generates presigned URLs for artifacts published by agents
// during execution. The URLs are time-limited and can be used for direct
// HTTP download without authentication.
//
// ## Inline vs. attachment
//
// When req.AsAttachment is set, the URL forces a browser download saved under
// the artifact's filename (Content-Disposition: attachment, derived from the
// storage key's basename). This is required because browsers ignore the HTML
// `download` attribute on cross-origin URLs, so text artifacts would otherwise
// render in a tab instead of saving. When unset, the URL serves inline — the
// mode needed for rendering surfaces such as an `<img src>`.
//
// ## Authorization
//
// Authorization (can_view on execution) is handled by the proto authorization
// interceptor via the rpc method options.
//
// ## Security
//
// The storage_key is validated to ensure it belongs to the specified execution.
// Storage keys must start with "artifacts/{execution_id}/" to prevent path
// traversal attacks where a user could request URLs for other executions'
// artifacts.
//
// ## Use Cases
//
// - CLI downloading agent-created files
// - Web UI providing download links for artifacts
// - Refreshing expired download URLs
func (c *AgentExecutionController) GetArtifactDownloadUrl(ctx context.Context, req *agentexecutionv1.GetArtifactDownloadUrlRequest) (*agentexecutionv1.GetArtifactDownloadUrlResponse, error) {
	// Check artifact storage is configured
	if c.artifactStorage == nil {
		log.Error().Msg("Artifact storage not configured - cannot generate download URL")
		return nil, status.Error(codes.Internal, "artifact storage not configured")
	}

	// Validate request fields (buf validate handles min_len)
	if req.ExecutionId == "" {
		return nil, status.Error(codes.InvalidArgument, "execution_id is required")
	}
	if req.StorageKey == "" {
		return nil, status.Error(codes.InvalidArgument, "storage_key is required")
	}

	// Security check: Validate storage_key belongs to this execution
	// Storage keys for artifacts must be in format: artifacts/{execution_id}/{filename}
	expectedPrefix := "artifacts/" + req.ExecutionId + "/"
	if !strings.HasPrefix(req.StorageKey, expectedPrefix) {
		log.Warn().
			Str("execution_id", req.ExecutionId).
			Str("storage_key", req.StorageKey).
			Str("expected_prefix", expectedPrefix).
			Msg("Storage key does not belong to execution - potential path traversal attempt")
		return nil, status.Error(codes.InvalidArgument, "storage_key does not belong to this execution")
	}

	// Verify the execution exists (authorization is already handled by interceptor)
	execution := &agentexecutionv1.AgentExecution{}
	err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, req.ExecutionId, execution)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", req.ExecutionId).
			Msg("Failed to load execution for artifact download")
		return nil, status.Errorf(codes.NotFound, "execution not found: %s", req.ExecutionId)
	}

	// Generate presigned URL
	expiresIn := DefaultArtifactURLExpiration
	expiresAt := time.Now().UTC().Add(expiresIn)

	log.Info().
		Str("execution_id", req.ExecutionId).
		Str("storage_key", req.StorageKey).
		Dur("expires_in", expiresIn).
		Msg("Generating presigned download URL for artifact")

	urlCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// When the caller wants a browser download (as_attachment), derive the
	// saved filename from the storage key's basename (already validated to be
	// scoped to this execution above). Empty otherwise, which serves inline.
	var downloadFilename string
	if req.AsAttachment {
		downloadFilename = path.Base(req.StorageKey)
	}

	downloadURL, err := c.artifactStorage.GetSignedURL(urlCtx, req.StorageKey, expiresIn, downloadFilename)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", req.ExecutionId).
			Str("storage_key", req.StorageKey).
			Msg("Failed to generate presigned URL for artifact")
		return nil, status.Errorf(codes.Internal, "failed to generate download URL: %v", err)
	}

	log.Info().
		Str("execution_id", req.ExecutionId).
		Str("storage_key", req.StorageKey).
		Time("expires_at", expiresAt).
		Msg("Successfully generated presigned download URL for artifact")

	return &agentexecutionv1.GetArtifactDownloadUrlResponse{
		DownloadUrl: downloadURL,
		ExpiresAt:   expiresAt.Format(time.RFC3339),
	}, nil
}
