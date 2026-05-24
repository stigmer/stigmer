package artifact

import (
	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"

	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// ArtifactController implements ArtifactCommandController and ArtifactQueryController.
//
// It provides the full CRUD surface for first-class Artifact resources (T07).
// Blob content is delegated to ArtifactStorage (local filesystem or R2);
// metadata is persisted as protobuf in the generic resources table.
type ArtifactController struct {
	artifactv1.UnimplementedArtifactCommandControllerServer
	artifactv1.UnimplementedArtifactQueryControllerServer
	store           store.Store
	artifactStorage artifactstorage.ArtifactStorage
}

// NewArtifactController creates an ArtifactController.
// artifactStorage may be nil if blob storage is not configured;
// RPCs that require it will return codes.Internal.
func NewArtifactController(s store.Store, as artifactstorage.ArtifactStorage) *ArtifactController {
	return &ArtifactController{
		store:           s,
		artifactStorage: as,
	}
}
