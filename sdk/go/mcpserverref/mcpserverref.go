package mcpserverref

import (
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Platform creates a reference to a platform-scoped McpServer.
//
// Platform McpServers are shared across the entire platform and available to all users.
//
// Examples:
//
//	mcpserverref.Platform("github")
//	mcpserverref.Platform("aws")
//	mcpserverref.Platform("slack")
func Platform(slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_mcp_server,
		Slug:  slug,
		Scope: apiresource.ApiResourceOwnerScope_platform,
	}
}

// Organization creates a reference to an organization-scoped McpServer.
//
// Organization McpServers are specific to an organization and only available to its members.
//
// Examples:
//
//	mcpserverref.Organization("acme-corp", "internal-tools")
//	mcpserverref.Organization("my-org", "custom-server")
func Organization(org, slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_mcp_server,
		Slug:  slug,
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   org,
	}
}

// Personal creates a reference to a personal McpServer (identity_account scope).
//
// Personal McpServers are private to the individual user and not visible to others.
// This scope is unique to McpServer - Skills don't support personal scope.
//
// Examples:
//
//	mcpserverref.Personal("my-custom-server")
//	mcpserverref.Personal("my-dev-tools")
func Personal(slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Kind:  apiresourcekind.ApiResourceKind_mcp_server,
		Slug:  slug,
		Scope: apiresource.ApiResourceOwnerScope_identity_account,
	}
}
