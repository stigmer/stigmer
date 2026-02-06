package ref

import (
	"strings"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// mcpServerKind is the resource kind identifier for MCP servers.
const mcpServerKind = "mcp_server"

// McpServer creates an MCP server reference with explicit org and slug.
//
// This is the recommended way to create MCP server references when you know
// the organization and slug at compile time.
//
// Note: Unlike skills, MCP servers do not support versioning.
//
// Examples:
//
//	ref.McpServer("stigmer", "github")
//	ref.McpServer("acme", "internal-tools")
//	ref.McpServer("my-org", "slack-integration")
func McpServer(org, slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
	}
}

// ParseMcpServer parses an MCP server reference string in "org/slug" format.
//
// This is useful when MCP server references come from configuration files,
// environment variables, or user input.
//
// Supported format:
//   - "org/slug" - e.g., "stigmer/github", "acme/internal-tools"
//
// Note: Unlike skills, MCP servers do not support versioning, so the
// "@version" suffix is not supported. Any "@" characters in the input
// are treated as part of the slug.
//
// Returns a *ParseError if the format is invalid. The error wraps one of the
// sentinel errors (ErrInvalidFormat, ErrEmptyOrg, ErrEmptySlug).
//
// Examples:
//
//	ref, err := ref.ParseMcpServer("stigmer/github")
//	ref, err := ref.ParseMcpServer("acme/internal-tools")
func ParseMcpServer(s string) (*apiresource.ApiResourceReference, error) {
	if s == "" {
		return nil, newParseError(mcpServerKind, s, "reference string is empty", ErrInvalidFormat)
	}

	// Split org/slug (no version extraction for MCP servers)
	slashIdx := strings.Index(s, "/")
	if slashIdx == -1 {
		return nil, newParseError(mcpServerKind, s, "expected 'org/slug' format, missing '/'", ErrInvalidFormat)
	}

	org := s[:slashIdx]
	slug := s[slashIdx+1:]

	if org == "" {
		return nil, newParseError(mcpServerKind, s, "organization is empty", ErrEmptyOrg)
	}

	if slug == "" {
		return nil, newParseError(mcpServerKind, s, "slug is empty", ErrEmptySlug)
	}

	return &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
	}, nil
}

// MustParseMcpServer is like ParseMcpServer but panics if the reference string is invalid.
//
// This is useful for package-level variable initialization or test code
// where you're certain the reference is valid.
//
// Examples:
//
//	var defaultServer = ref.MustParseMcpServer("stigmer/github")
//	var internalServer = ref.MustParseMcpServer("acme/internal-tools")
func MustParseMcpServer(s string) *apiresource.ApiResourceReference {
	result, err := ParseMcpServer(s)
	if err != nil {
		panic(err)
	}
	return result
}
