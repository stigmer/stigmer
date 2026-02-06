package mcpserverref

import (
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// New creates an MCP server reference with explicit org and slug.
//
// This is the recommended way to create MCP server references when you know
// the organization and slug at compile time.
//
// Note: Unlike skills, MCP servers do not support versioning.
//
// Examples:
//
//	mcpserverref.New("stigmer", "github")
//	mcpserverref.New("acme", "internal-tools")
//	mcpserverref.New("my-org", "slack-integration")
func New(org, slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
	}
}

// Parse parses an MCP server reference string in "org/slug" format.
//
// This is useful when MCP server references come from configuration files,
// environment variables, or user input.
//
// Supported format:
//   - "org/slug" - e.g., "stigmer/github", "acme/internal-tools"
//
// Note: Unlike skills, MCP servers do not support versioning, so the
// "@version" suffix is not supported.
//
// Returns a ParseError if the format is invalid.
//
// Examples:
//
//	ref, err := mcpserverref.Parse("stigmer/github")
//	ref, err := mcpserverref.Parse("acme/internal-tools")
func Parse(ref string) (*apiresource.ApiResourceReference, error) {
	if ref == "" {
		return nil, &ParseError{
			Input:   ref,
			Message: "reference string is empty",
			Err:     ErrInvalidFormat,
		}
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
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
	}, nil
}

// MustParse is like Parse but panics if the reference string is invalid.
//
// This is useful for package-level variable initialization or test code
// where you're certain the reference is valid.
//
// Examples:
//
//	var defaultServer = mcpserverref.MustParse("stigmer/github")
//	var internalServer = mcpserverref.MustParse("acme/internal-tools")
func MustParse(ref string) *apiresource.ApiResourceReference {
	result, err := Parse(ref)
	if err != nil {
		panic(err)
	}
	return result
}
