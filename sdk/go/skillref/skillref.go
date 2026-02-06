package skillref

import (
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// options holds configuration for skill reference creation.
type options struct {
	version string
}

// Option configures skill reference creation.
type Option func(*options)

// WithVersion sets the skill version.
//
// Version supports three formats:
//   - Tag name: e.g., "v1.0", "stable", "beta"
//   - Exact hash: e.g., "abc123..." (64-char hex, immutable reference)
//   - "latest": explicitly use the latest version
//
// If not specified, the version field is left empty (resolved to "latest" by the platform).
func WithVersion(v string) Option {
	return func(o *options) {
		o.version = v
	}
}

// New creates a skill reference with explicit org and slug.
//
// This is the recommended way to create skill references when you know
// the organization and slug at compile time.
//
// Examples:
//
//	skillref.New("stigmer", "web-search")
//	skillref.New("stigmer", "code-review", skillref.WithVersion("v1.0"))
//	skillref.New("acme", "internal-docs", skillref.WithVersion("stable"))
func New(org, slug string, opts ...Option) *apiresource.ApiResourceReference {
	o := &options{}
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

// Parse parses a skill reference string in "org/slug" or "org/slug@version" format.
//
// This is useful when skill references come from configuration files,
// environment variables, or user input.
//
// Supported formats:
//   - "org/slug" - e.g., "stigmer/web-search"
//   - "org/slug@version" - e.g., "stigmer/web-search@v1.0"
//
// Returns a ParseError if the format is invalid.
//
// Examples:
//
//	ref, err := skillref.Parse("stigmer/web-search")
//	ref, err := skillref.Parse("stigmer/code-review@v1.0")
//	ref, err := skillref.Parse("acme/internal-docs@stable")
func Parse(ref string) (*apiresource.ApiResourceReference, error) {
	if ref == "" {
		return nil, &ParseError{
			Input:   ref,
			Message: "reference string is empty",
			Err:     ErrInvalidFormat,
		}
	}

	// Check for version suffix
	var version string
	if atIdx := strings.LastIndex(ref, "@"); atIdx != -1 {
		version = ref[atIdx+1:]
		ref = ref[:atIdx]
	}

	// Split org/slug
	slashIdx := strings.Index(ref, "/")
	if slashIdx == -1 {
		return nil, &ParseError{
			Input:   ref,
			Message: "expected 'org/slug' format, missing '/'",
			Err:     ErrInvalidFormat,
		}
	}

	org := ref[:slashIdx]
	slug := ref[slashIdx+1:]

	if org == "" {
		return nil, &ParseError{
			Input:   ref,
			Message: "organization is empty",
			Err:     ErrEmptyOrg,
		}
	}

	if slug == "" {
		return nil, &ParseError{
			Input:   ref,
			Message: "slug is empty",
			Err:     ErrEmptySlug,
		}
	}

	return &apiresource.ApiResourceReference{
		Org:     org,
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Slug:    slug,
		Version: version,
	}, nil
}

// MustParse is like Parse but panics if the reference string is invalid.
//
// This is useful for package-level variable initialization or test code
// where you're certain the reference is valid.
//
// Examples:
//
//	var defaultSkill = skillref.MustParse("stigmer/web-search")
//	var versionedSkill = skillref.MustParse("stigmer/code-review@v1.0")
func MustParse(ref string) *apiresource.ApiResourceReference {
	result, err := Parse(ref)
	if err != nil {
		panic(err)
	}
	return result
}
