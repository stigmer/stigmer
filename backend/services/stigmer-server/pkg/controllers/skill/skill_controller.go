package skill

import (
	"github.com/stigmer/stigmer/backend/libs/go/badger"
	skillv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/skill/v1"
)

// SkillController implements SkillCommandController and SkillQueryController
type SkillController struct {
	skillv1.UnimplementedSkillCommandControllerServer
	skillv1.UnimplementedSkillQueryControllerServer
	store *badger.Store
}

// NewSkillController creates a new SkillController
func NewSkillController(store *badger.Store) *SkillController {
	return &SkillController{
		store: store,
	}
}
