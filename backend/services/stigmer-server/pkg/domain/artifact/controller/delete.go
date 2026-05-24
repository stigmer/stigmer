package artifact

import (
	"context"

	"github.com/rs/zerolog/log"
	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Delete performs a soft delete on an artifact by transitioning its
// storage_state to deleted. The blob is NOT removed — GC handles that.
//
// Direct handler because soft-delete (state transition + save) differs
// from the standard hard-delete pipeline (which calls store.DeleteResource).
func (c *ArtifactController) Delete(ctx context.Context, id *apiresource.ApiResourceId) (*artifactv1.Artifact, error) {
	resourceID := id.GetValue()
	if resourceID == "" {
		return nil, status.Error(codes.InvalidArgument, "artifact id is required")
	}

	artifact := &artifactv1.Artifact{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_artifact, resourceID, artifact); err != nil {
		return nil, status.Errorf(codes.NotFound, "Artifact not found: %s", resourceID)
	}

	log.Info().
		Str("artifact_id", resourceID).
		Str("previous_state", artifact.GetStatus().GetStorageState().String()).
		Msg("Soft-deleting artifact")

	// Transition storage state
	if artifact.Status == nil {
		artifact.Status = &artifactv1.ArtifactStatus{}
	}
	artifact.Status.StorageState = artifactv1.ArtifactStorageState_storage_state_deleted

	if err := steps.SetAuditFieldsForUpdate(artifact); err != nil {
		log.Error().Err(err).Msg("Failed to set audit fields on artifact delete")
	}

	if err := c.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_artifact, resourceID, artifact); err != nil {
		log.Error().Err(err).Str("artifact_id", resourceID).Msg("Failed to persist artifact deletion")
		return nil, status.Errorf(codes.Internal, "failed to persist artifact deletion: %v", err)
	}

	log.Info().
		Str("artifact_id", resourceID).
		Msg("Artifact soft-deleted successfully")

	return artifact, nil
}
