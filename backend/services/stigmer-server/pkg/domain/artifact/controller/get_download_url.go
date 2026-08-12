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

const downloadURLExpiration = 7 * 24 * time.Hour // R2 maximum: 7 days

// GetDownloadUrl generates a download URL for an artifact's content blob.
//
// Direct handler (follows AgentExecution.GetArtifactDownloadUrl pattern):
// 1. Guard on storage availability
// 2. Load artifact by ID
// 3. Check storage_state is not deleted
// 4. Generate signed/direct URL from blob storage
func (c *ArtifactController) GetDownloadUrl(ctx context.Context, id *artifactv1.ArtifactId) (*artifactv1.ArtifactDownloadUrl, error) {
	if c.artifactStorage == nil {
		return nil, status.Error(codes.Internal, "artifact storage not configured")
	}

	resourceID := id.GetValue()
	if resourceID == "" {
		return nil, status.Error(codes.InvalidArgument, "artifact id is required")
	}

	// Load artifact metadata
	artifact := &artifactv1.Artifact{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_artifact, resourceID, artifact); err != nil {
		return nil, status.Errorf(codes.NotFound, "Artifact not found: %s", resourceID)
	}

	// Reject download for deleted blobs
	if artifact.GetStatus().GetStorageState() == artifactv1.ArtifactStorageState_storage_state_deleted {
		return nil, status.Errorf(codes.FailedPrecondition,
			"artifact blob has been deleted: %s", resourceID)
	}

	contentHash := artifact.GetStatus().GetContentHash()
	if contentHash == "" {
		return nil, status.Errorf(codes.Internal, "artifact has no content hash: %s", resourceID)
	}

	log.Info().
		Str("artifact_id", resourceID).
		Str("content_hash", contentHash).
		Msg("Generating download URL for artifact")

	urlCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Empty download filename: this URL is served inline, matching prior
	// behavior. Attachment disposition is opt-in at the execution-artifact
	// download path (AgentExecution.GetArtifactDownloadUrl), not here.
	downloadURL, err := c.artifactStorage.GetSignedURL(urlCtx, contentHash, downloadURLExpiration, "")
	if err != nil {
		log.Error().
			Err(err).
			Str("artifact_id", resourceID).
			Str("content_hash", contentHash).
			Msg("Failed to generate download URL for artifact")
		return nil, grpclib.InternalError(err, "failed to generate download URL")
	}

	ttlSeconds := int32(downloadURLExpiration.Seconds())

	log.Info().
		Str("artifact_id", resourceID).
		Str("content_hash", contentHash).
		Int32("ttl_seconds", ttlSeconds).
		Msg("Generated download URL for artifact")

	return &artifactv1.ArtifactDownloadUrl{
		Url:         downloadURL,
		TtlSeconds:  ttlSeconds,
		SizeBytes:   artifact.GetStatus().GetSizeBytes(),
		ContentType: artifact.GetSpec().GetContentType(),
	}, nil
}
