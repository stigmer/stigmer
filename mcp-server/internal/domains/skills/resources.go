package skills

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

// Template returns the MCP resource template for skills.
func Template() *mcp.ResourceTemplate {
	return &mcp.ResourceTemplate{
		URITemplate: "stigmer://skills/{org}/{slug}",
		Name:        "stigmer_skill",
		Title:       "Stigmer Skill",
		Description: "Full definition of a Stigmer skill (latest version), identified by organization and slug.",
		MIMEType:    "application/json",
	}
}

// ResourceHandler returns a handler that reads a skill resource by parsing
// the org and slug from the request URI. Returns the latest version.
func ResourceHandler(serverAddress string) mcp.ResourceHandler {
	return domains.NewResourceHandler(
		func(ctx context.Context, addr, org, slug string) (string, error) {
			return Fetch(ctx, addr, org, slug, "")
		},
		serverAddress, "skills",
	)
}

// VersionedTemplate returns the MCP resource template for skills at a specific
// version. The version segment can be a tag name (e.g. "stable", "v1.0") or a
// SHA-256 content hash.
func VersionedTemplate() *mcp.ResourceTemplate {
	return &mcp.ResourceTemplate{
		URITemplate: "stigmer://skills/{org}/{slug}/{version}",
		Name:        "stigmer_skill_version",
		Title:       "Stigmer Skill (versioned)",
		Description: "Full definition of a Stigmer skill at a specific version, identified by organization, slug, and version (tag name or SHA-256 hash).",
		MIMEType:    "application/json",
	}
}

// VersionedResourceHandler returns a handler that reads a skill resource at a
// specific version by parsing the org, slug, and version from the request URI.
func VersionedResourceHandler(serverAddress string) mcp.ResourceHandler {
	return domains.NewVersionedResourceHandler(Fetch, serverAddress, "skills")
}
