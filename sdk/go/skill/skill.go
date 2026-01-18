package skill

import (
	"errors"
	"os"
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
// Inline skills:
//
//	mySkill, _ := skill.New(
//	    skill.WithName("code-analyzer"),
//	    skill.WithDescription("Analyzes code quality"),
//	    skill.WithMarkdownFromFile("skills/analyzer.md"),
//	)
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

// Option is a functional option for configuring an inline Skill.
type Option func(*Skill) error

// New creates an inline skill definition.
//
// Inline skills are created in your repository with name, description, and markdown content.
// The CLI will create these skills on the platform before creating the agent.
//
// Required options:
//   - WithName: skill name
//   - WithMarkdown or WithMarkdownFromFile: skill content
//
// Example:
//
//	skill, _ := skill.New(
//	    skill.WithName("code-analyzer"),
//	    skill.WithDescription("Analyzes code quality"),
//	    skill.WithMarkdownFromFile("skills/analyzer.md"),
//	)
func New(opts ...Option) (*Skill, error) {
	s := &Skill{
		IsInline: true,
	}

	// Apply all options
	for _, opt := range opts {
		if err := opt(s); err != nil {
			return nil, err
		}
	}

	// Validation
	if s.Name == "" {
		return nil, ErrSkillNameRequired
	}
	if s.MarkdownContent == "" {
		return nil, ErrSkillMarkdownRequired
	}

	return s, nil
}

// WithName sets the inline skill's name.
//
// The name must be lowercase alphanumeric with hyphens, max 63 characters.
// This is a required field for inline skills.
//
// Example:
//
//	skill.WithName("code-analyzer")
func WithName(name string) Option {
	return func(s *Skill) error {
		s.Name = name
		return nil
	}
}

// WithDescription sets the inline skill's description.
//
// Description is optional and is used for UI display.
//
// Example:
//
//	skill.WithDescription("Analyzes code quality and suggests improvements")
func WithDescription(description string) Option {
	return func(s *Skill) error {
		s.Description = description
		return nil
	}
}

// WithMarkdown sets the inline skill's markdown content from a string.
//
// This is a required field for inline skills.
//
// Example:
//
//	skill.WithMarkdown("# Code Analysis\n\nAnalyze code for best practices...")
func WithMarkdown(markdown string) Option {
	return func(s *Skill) error {
		s.MarkdownContent = markdown
		return nil
	}
}

// WithMarkdownFromFile sets the inline skill's markdown content from a file.
//
// Reads the file content and sets it as the skill's markdown content.
// This is a required field (alternative to WithMarkdown).
//
// Example:
//
//	skill.WithMarkdownFromFile("skills/code-analyzer.md")
func WithMarkdownFromFile(path string) Option {
	return func(s *Skill) error {
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		s.MarkdownContent = string(content)
		return nil
	}
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
