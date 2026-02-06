package ref

import (
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// environmentKind is the resource kind identifier for environments.
const environmentKind = "environment"

// Environment creates an environment reference with explicit org and slug.
//
// This is the recommended way to create environment references when you know
// the organization and slug at compile time.
//
// Environments are first-class API resources that hold actual env var values.
// They are referenced by AgentInstance and WorkflowInstance via environment_refs.
//
// Note: Unlike skills, environments do not support versioning.
//
// Examples:
//
//	ref.Environment("acme", "production-aws")
//	ref.Environment("acme", "staging-gcp")
//	ref.Environment("my-org", "development")
func Environment(org, slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_environment,
		Slug: slug,
	}
}

// ParseEnvironment parses an environment reference string in "org/slug" format.
//
// This is useful when environment references come from configuration files,
// environment variables, or user input.
//
// Supported format:
//   - "org/slug" - e.g., "acme/production-aws", "my-org/staging"
//
// Note: Environments do not support versioning, so the "@version" suffix
// is not supported. Any "@" characters in the input are treated as part of the slug.
//
// Returns a *ParseError if the format is invalid. The error wraps one of the
// sentinel errors (ErrInvalidFormat, ErrEmptyOrg, ErrEmptySlug).
//
// Examples:
//
//	ref, err := ref.ParseEnvironment("acme/production-aws")
//	ref, err := ref.ParseEnvironment("my-org/staging")
func ParseEnvironment(s string) (*apiresource.ApiResourceReference, error) {
	if s == "" {
		return nil, newParseError(environmentKind, s, "reference string is empty", ErrInvalidFormat)
	}

	// Split org/slug (no version extraction for environments)
	slashIdx := strings.Index(s, "/")
	if slashIdx == -1 {
		return nil, newParseError(environmentKind, s, "expected 'org/slug' format, missing '/'", ErrInvalidFormat)
	}

	org := s[:slashIdx]
	slug := s[slashIdx+1:]

	if org == "" {
		return nil, newParseError(environmentKind, s, "organization is empty", ErrEmptyOrg)
	}

	if slug == "" {
		return nil, newParseError(environmentKind, s, "slug is empty", ErrEmptySlug)
	}

	return &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_environment,
		Slug: slug,
	}, nil
}

// MustParseEnvironment is like ParseEnvironment but panics if the reference string is invalid.
//
// This is useful for package-level variable initialization or test code
// where you're certain the reference is valid.
//
// Examples:
//
//	var prodEnv = ref.MustParseEnvironment("acme/production-aws")
//	var stagingEnv = ref.MustParseEnvironment("acme/staging")
func MustParseEnvironment(s string) *apiresource.ApiResourceReference {
	result, err := ParseEnvironment(s)
	if err != nil {
		panic(err)
	}
	return result
}
