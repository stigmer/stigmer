package ref

import (
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// skillKind is the resource kind identifier for skills.
const skillKind = "skill"

// skillOptions holds configuration for skill reference creation.
type skillOptions struct {
	version string
}

// SkillOption configures skill reference creation.
type SkillOption func(*skillOptions)

// WithVersion sets the skill version.
//
// Version supports three formats:
//   - Tag name: e.g., "v1.0", "stable", "beta"
//   - Exact hash: e.g., "abc123..." (64-char hex, immutable reference)
//   - "latest": explicitly use the latest version
//
// If not specified, the version field is left empty (resolved to "latest" by the platform).
//
// Examples:
//
//	ref.Skill("stigmer", "web-search", ref.WithVersion("v1.0"))
//	ref.Skill("stigmer", "code-review", ref.WithVersion("stable"))
//	ref.Skill("acme", "internal", ref.WithVersion("latest"))
func WithVersion(v string) SkillOption {
	return func(o *skillOptions) {
		o.version = v
	}
}

// Skill creates a skill reference with explicit org and slug.
//
// This is the recommended way to create skill references when you know
// the organization and slug at compile time.
//
// Examples:
//
//	ref.Skill("stigmer", "web-search")
//	ref.Skill("stigmer", "code-review", ref.WithVersion("v1.0"))
//	ref.Skill("acme", "internal-docs", ref.WithVersion("stable"))
func Skill(org, slug string, opts ...SkillOption) *apiresource.ApiResourceReference {
	o := &skillOptions{}
	for _, opt := range opts {
		opt(o)
	}

	return &apiresource.ApiResourceReference{
		Org:     org,
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Slug:    slug,
		Version: o.version,
	}
}

// ParseSkill parses a skill reference string in "org/slug" or "org/slug@version" format.
//
// This is useful when skill references come from configuration files,
// environment variables, or user input.
//
// Supported formats:
//   - "org/slug" - e.g., "stigmer/web-search"
//   - "org/slug@version" - e.g., "stigmer/web-search@v1.0"
//
// Returns a *ParseError if the format is invalid. The error wraps one of the
// sentinel errors (ErrInvalidFormat, ErrEmptyOrg, ErrEmptySlug).
//
// Examples:
//
//	ref, err := ref.ParseSkill("stigmer/web-search")
//	ref, err := ref.ParseSkill("stigmer/code-review@v1.0")
//	ref, err := ref.ParseSkill("acme/internal-docs@stable")
func ParseSkill(s string) (*apiresource.ApiResourceReference, error) {
	if s == "" {
		return nil, newParseError(skillKind, s, "reference string is empty", ErrInvalidFormat)
	}

	// Extract version suffix if present (uses last @ to handle edge cases)
	var version string
	if atIdx := strings.LastIndex(s, "@"); atIdx != -1 {
		version = s[atIdx+1:]
		s = s[:atIdx]
	}

	// Split org/slug
	slashIdx := strings.Index(s, "/")
	if slashIdx == -1 {
		return nil, newParseError(skillKind, s, "expected 'org/slug' format, missing '/'", ErrInvalidFormat)
	}

	org := s[:slashIdx]
	slug := s[slashIdx+1:]

	if org == "" {
		return nil, newParseError(skillKind, s, "organization is empty", ErrEmptyOrg)
	}

	if slug == "" {
		return nil, newParseError(skillKind, s, "slug is empty", ErrEmptySlug)
	}

	return &apiresource.ApiResourceReference{
		Org:     org,
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Slug:    slug,
		Version: version,
	}, nil
}

// MustParseSkill is like ParseSkill but panics if the reference string is invalid.
//
// This is useful for package-level variable initialization or test code
// where you're certain the reference is valid.
//
// Examples:
//
//	var defaultSkill = ref.MustParseSkill("stigmer/web-search")
//	var versionedSkill = ref.MustParseSkill("stigmer/code-review@v1.0")
func MustParseSkill(s string) *apiresource.ApiResourceReference {
	result, err := ParseSkill(s)
	if err != nil {
		panic(err)
	}
	return result
}
