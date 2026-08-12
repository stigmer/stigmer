package agentexecution

import (
	"context"
	"path"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
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
// Two key forms are accepted:
//
//   - "artifacts/{execution_id}/..." — outputs published by the execution
//   - a key listed verbatim in the execution's spec.attachments — inputs the
//     user submitted with the turn (keys are "attachments/{ulid}/{filename}",
//     ULID-unique per upload, so membership cannot reference another
//     execution's files)
//
// Any other key is rejected to prevent path traversal attacks where a user
// could request URLs for other executions' files.
//
// ## Use Cases
//
// - CLI downloading agent-created files
// - Web UI providing download links for artifacts
// - Web UI rendering submitted attachments in the message thread
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

	// Load the execution before the key check: the attachment arm below needs
	// spec.attachments, and this doubles as the existence check.
	// (Authorization is already handled by the interceptor.)
	execution := &agentexecutionv1.AgentExecution{}
	err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, req.ExecutionId, execution)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", req.ExecutionId).
			Msg("Failed to load execution for artifact download")
		return nil, status.Errorf(codes.NotFound, "execution not found: %s", req.ExecutionId)
	}

	// Security check: Validate storage_key belongs to this execution — either
	// an artifact the execution produced (artifacts/{execution_id}/...) or an
	// attachment the execution's spec references verbatim.
	expectedPrefix := "artifacts/" + req.ExecutionId + "/"
	if !strings.HasPrefix(req.StorageKey, expectedPrefix) && !isSpecAttachmentKey(execution, req.StorageKey) {
		log.Warn().
			Str("execution_id", req.ExecutionId).
			Str("storage_key", req.StorageKey).
			Str("expected_prefix", expectedPrefix).
			Msg("Storage key does not belong to execution - potential path traversal attempt")
		return nil, status.Error(codes.InvalidArgument, "storage_key does not belong to this execution")
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
		return nil, grpclib.InternalError(err, "failed to generate download URL")
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

// isSpecAttachmentKey reports whether storageKey appears verbatim in the
// execution's spec.attachments. This is the ownership proof for submitted
// inputs: attachment keys ("attachments/{ulid}/{filename}") carry no execution
// id, so — unlike artifacts — ownership is established by the execution record
// referencing the key, not by the key's shape.
func isSpecAttachmentKey(execution *agentexecutionv1.AgentExecution, storageKey string) bool {
	for _, attachment := range execution.GetSpec().GetAttachments() {
		if attachment.GetStorageKey() == storageKey {
			return true
		}
	}
	return false
}
