package skill

import (
	"errors"
	"os"

	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
)

var (
	// ErrSkillNameRequired is returned when inline skill name is missing.
	ErrSkillNameRequired = errors.New("skill name is required for inline skills")

	// ErrSkillMarkdownRequired is returned when inline skill markdown content is missing.
	ErrSkillMarkdownRequired = errors.New("skill markdown content is required for inline skills")
)

// Skill represents either an inline skill definition or a reference to an existing Skill resource.
//
// Skills provide knowledge and capabilities to agents.
// They can be:
// 1. Inline: Created in your repository with name, description, and markdown content
// 2. Referenced: Point to platform-wide or organization-specific skills
//
// Inline skills (Pulumi-style struct args):
//
//	mySkill, _ := skill.New("code-analyzer", &skill.SkillArgs{
//	    Description:     "Analyzes code quality",
//	    MarkdownContent: skill.LoadMarkdownFromFile("skills/analyzer.md"),
//	})
//
// Referenced skills:
//
//	platformSkill := skill.Platform("coding-best-practices")
//	orgSkill := skill.Organization("my-org", "internal-docs")
type Skill struct {
	// For inline skills:
	// Name is the skill name (required for inline, empty for references).
	Name string

	// Description is a brief description (optional, for inline only).
	Description string

	// MarkdownContent is the skill documentation/knowledge (required for inline).
	MarkdownContent string

	// For referenced skills:
	// Slug is the skill identifier/slug (for platform/org references).
	Slug string

	// Org is the organization that owns the skill (optional - empty for platform skills).
	Org string

	// IsInline indicates if this is an inline skill definition (true) or a reference (false).
	IsInline bool
}

// New creates an inline skill definition with struct-based args (Pulumi pattern).
//
// Inline skills are created in your repository with name, description, and markdown content.
// The CLI will create these skills on the platform before creating the agent.
//
// Follows Pulumi's Args pattern: name as parameter, struct args for configuration.
//
// Required:
//   - name: skill name (lowercase alphanumeric with hyphens)
//   - args.MarkdownContent: skill documentation/knowledge
//
// Optional args fields:
//   - Description: brief description for UI display
//
// Example:
//
//	skill, _ := skill.New("code-analyzer", &skill.SkillArgs{
//	    Description:     "Analyzes code quality and suggests improvements",
//	    MarkdownContent: "# Code Analysis\n\nThis skill analyzes code...",
//	})
//
// Example loading from file:
//
//	content, _ := skill.LoadMarkdownFromFile("skills/analyzer.md")
//	skill, _ := skill.New("code-analyzer", &skill.SkillArgs{
//	    Description:     "Analyzes code quality",
//	    MarkdownContent: content,
//	})
//
// Example with nil args (validation will fail without markdown):
//
//	skill, err := skill.New("code-analyzer", nil)
//	// Returns ErrSkillMarkdownRequired
func New(name string, args *SkillArgs) (*Skill, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &SkillArgs{}
	}

	// Create Skill from args
	s := &Skill{
		Name:            name,
		Description:     args.Description,
		MarkdownContent: args.MarkdownContent,
		IsInline:        true,
	}

	// Auto-generate slug from name
	if s.Name == "" {
		return nil, ErrSkillNameRequired
	}
	s.Slug = naming.GenerateSlug(s.Name)

	// Validation
	if s.Name == "" {
		return nil, ErrSkillNameRequired
	}
	if s.MarkdownContent == "" {
		return nil, ErrSkillMarkdownRequired
	}

	// Validate slug format
	if err := naming.ValidateSlug(s.Slug); err != nil {
		return nil, err
	}

	return s, nil
}

// LoadMarkdownFromFile is a helper that loads markdown content from a file.
//
// Use this to load skill content from a file when creating an inline skill.
//
// Example:
//
//	content, err := skill.LoadMarkdownFromFile("skills/code-analyzer.md")
//	if err != nil {
//	    return err
//	}
//	mySkill, err := skill.New("code-analyzer", &skill.SkillArgs{
//	    Description:     "Analyzes code quality",
//	    MarkdownContent: content,
//	})
func LoadMarkdownFromFile(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

// Platform creates a reference to a platform-wide skill.
//
// Platform skills are shared across the entire platform and available to all users.
//
// Example:
//
//	skill := skill.Platform("coding-best-practices")
func Platform(slug string) Skill {
	return Skill{
		Slug:     slug,
		Org:      "", // Empty org means platform skill
		IsInline: false,
	}
}

// Organization creates a reference to an organization-specific skill.
//
// Organization skills are private to a specific organization.
//
// Example:
//
//	skill := skill.Organization("my-org", "internal-security-guidelines")
func Organization(org, slug string) Skill {
	return Skill{
		Slug:     slug,
		Org:      org,
		IsInline: false,
	}
}

// IsPlatformReference returns true if this is a platform skill reference (not inline, no org).
func (s Skill) IsPlatformReference() bool {
	return !s.IsInline && s.Org == ""
}

// IsOrganizationReference returns true if this is an organization skill reference (not inline, with org).
func (s Skill) IsOrganizationReference() bool {
	return !s.IsInline && s.Org != ""
}

// IsRepositoryReference is an alias for IsOrganizationReference for consistency across SDK languages.
func (s Skill) IsRepositoryReference() bool {
	return s.IsOrganizationReference()
}

// NameOrSlug returns the skill identifier.
// For inline skills, returns the Name field.
// For referenced skills, returns the Slug field.
func (s Skill) NameOrSlug() string {
	if s.IsInline {
		return s.Name
	}
	return s.Slug
}

// Repository returns the repository/organization name for repository-scoped skills.
// For platform skills, returns empty string.
func (s Skill) Repository() string {
	return s.Org
}

// GetDescription returns the skill description (for inline skills).
func (s Skill) GetDescription() string {
	return s.Description
}

// Markdown returns the markdown content (for inline skills).
func (s Skill) Markdown() string {
	return s.MarkdownContent
}

// String returns a string representation of the Skill.
func (s Skill) String() string {
	if s.IsInline {
		return "Skill(inline:" + s.Name + ")"
	}
	if s.IsPlatformReference() {
		return "Skill(platform:" + s.Slug + ")"
	}
	return "Skill(org:" + s.Slug + "@" + s.Org + ")"
}
