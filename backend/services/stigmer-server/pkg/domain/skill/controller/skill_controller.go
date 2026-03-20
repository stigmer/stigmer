package skill

import (
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
)

// SkillController implements SkillCommandController and SkillQueryController
type SkillController struct {
	skillv1.UnimplementedSkillCommandControllerServer
	skillv1.UnimplementedSkillQueryControllerServer
	store                    store.Store
	artifactStorage          storage.ArtifactStorage
	executionArtifactStorage artifactstorage.ArtifactStorage
}

// NewSkillController creates a new SkillController
func NewSkillController(store store.Store, artifactStorage storage.ArtifactStorage) *SkillController {
	return &SkillController{
		store:           store,
		artifactStorage: artifactStorage,
	}
}

// SetExecutionArtifactStorage configures the execution artifact storage
// used by PushFromExecutionArtifact to read directory artifacts produced
// by agent executions. Optional — when nil, the pushFromExecutionArtifact
// RPC returns an "not configured" error.
func (c *SkillController) SetExecutionArtifactStorage(s artifactstorage.ArtifactStorage) {
	c.executionArtifactStorage = s
}
