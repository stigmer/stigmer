package skill

import (
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
)

// SkillController implements SkillCommandController and SkillQueryController
type SkillController struct {
	skillv1.UnimplementedSkillCommandControllerServer
	skillv1.UnimplementedSkillQueryControllerServer
	store           *badger.Store
	artifactStorage storage.ArtifactStorage
}

// NewSkillController creates a new SkillController
func NewSkillController(store *badger.Store, artifactStorage storage.ArtifactStorage) *SkillController {
	return &SkillController{
		store:           store,
		artifactStorage: artifactStorage,
	}
}
