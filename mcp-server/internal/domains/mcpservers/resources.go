package mcpservers

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

// Template returns the MCP resource template for MCP servers.
func Template() *mcp.ResourceTemplate {
	return &mcp.ResourceTemplate{
		URITemplate: "stigmer://mcp-servers/{org}/{slug}",
		Name:        "stigmer_mcp_server",
		Title:       "Stigmer MCP Server",
		Description: "Full definition of a Stigmer MCP server, identified by organization and slug.",
		MIMEType:    "application/json",
	}
}

// ResourceHandler returns a handler that reads an MCP server resource by
// parsing the org and slug from the request URI.
func ResourceHandler(serverAddress string) mcp.ResourceHandler {
	return domains.NewResourceHandler(Fetch, serverAddress, "mcpservers")
}
