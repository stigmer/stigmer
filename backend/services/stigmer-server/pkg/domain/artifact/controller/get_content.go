package artifact

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// DefaultMaxContentBytes is the default size limit when max_bytes is unset
// (0). The server returns the first 512 KB of the artifact and sets
// truncated=true if the full content exceeds this threshold.
//
// Matches AgentExecutionController.GetArtifactContent's default so the two
// content-read endpoints behave identically from a client's perspective.
const DefaultMaxContentBytes int64 = 512 * 1024 // 512 KB

// GetContent reads the raw content of an artifact through the API.
//
// Unlike GetDownloadUrl (which returns a presigned URL for direct browser
// download), this endpoint returns the artifact bytes in the response,
// eliminating CORS concerns for SDK consumers who read content
// programmatically — e.g., rendering an artifact-backed review payload
// inside an embedded approval gate.
//
// Direct handler (follows GetDownloadUrl's structure):
// 1. Guard on storage availability
// 2. Load artifact by ID
// 3. Check storage_state is not deleted
// 4. Download the blob by content hash and truncate to max_bytes
//
// Authorization (can_view) is handled by the proto authorization
// interceptor via the rpc method options.
func (c *ArtifactController) GetContent(ctx context.Context, req *artifactv1.GetArtifactContentRequest) (*artifactv1.GetArtifactContentResponse, error) {
	if c.artifactStorage == nil {
		return nil, status.Error(codes.Internal, "artifact storage not configured")
	}

	artifactID := req.GetArtifactId()
	if artifactID == "" {
		return nil, status.Error(codes.InvalidArgument, "artifact_id is required")
	}

	artifact := &artifactv1.Artifact{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_artifact, artifactID, artifact); err != nil {
		return nil, status.Errorf(codes.NotFound, "Artifact not found: %s", artifactID)
	}

	if artifact.GetStatus().GetStorageState() == artifactv1.ArtifactStorageState_storage_state_deleted {
		return nil, status.Errorf(codes.FailedPrecondition,
			"artifact blob has been deleted: %s", artifactID)
	}

	contentHash := artifact.GetStatus().GetContentHash()
	if contentHash == "" {
		return nil, status.Errorf(codes.Internal, "artifact has no content hash: %s", artifactID)
	}

	maxBytes := req.GetMaxBytes()
	if maxBytes <= 0 {
		maxBytes = DefaultMaxContentBytes
	}

	dlCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	data, err := c.artifactStorage.Download(dlCtx, contentHash)
	if err != nil {
		log.Error().
			Err(err).
			Str("artifact_id", artifactID).
			Str("content_hash", contentHash).
			Msg("Failed to download artifact content")
		return nil, grpclib.InternalError(err, "failed to read artifact content")
	}

	totalSize := int64(len(data))
	truncated := false
	if totalSize > maxBytes {
		data = data[:maxBytes]
		truncated = true
	}

	log.Info().
		Str("artifact_id", artifactID).
		Int64("total_size_bytes", totalSize).
		Int("returned_bytes", len(data)).
		Bool("truncated", truncated).
		Msg("Read artifact content")

	return &artifactv1.GetArtifactContentResponse{
		Content:        data,
		ContentType:    artifact.GetSpec().GetContentType(),
		TotalSizeBytes: totalSize,
		Truncated:      truncated,
	}, nil
}
