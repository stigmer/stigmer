package skill

import (
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// ToProto converts the SDK Skill to a platform Skill proto message.
//
// This method creates a complete Skill proto with:
//   - API version and kind
//   - Metadata with SDK annotations
//   - Spec converted from SDK skill to proto SkillSpec
//
// Only call this for inline skills (IsInline == true).
// Referenced skills (platform/org) don't need proto conversion.
//
// Example:
//
//	skill, _ := skill.New(
//	    skill.WithName("code-analysis"),
//	    skill.WithMarkdownFromFile("skills/code.md"),
//	)
//	proto, err := skill.ToProto()
func (s *Skill) ToProto() (*skillv1.Skill, error) {
	// Build metadata
	metadata := &apiresource.ApiResourceMetadata{
		Name:        s.Name,
		Annotations: SDKAnnotations(),
	}

	// Build complete Skill proto
	return &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata:   metadata,
		Spec: &skillv1.SkillSpec{
			Description:     s.Description,
			MarkdownContent: s.MarkdownContent,
		},
	}, nil
}
