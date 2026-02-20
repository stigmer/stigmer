package agents

import (
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

// Template returns the MCP resource template for agents.
func Template() *mcp.ResourceTemplate {
	return &mcp.ResourceTemplate{
		URITemplate: "stigmer://agents/{org}/{slug}",
		Name:        "stigmer_agent",
		Title:       "Stigmer Agent",
		Description: "Full definition of a Stigmer agent, identified by organization and slug.",
		MIMEType:    "application/json",
	}
}

// ResourceHandler returns a handler that reads an agent resource by parsing
// the org and slug from the request URI.
func ResourceHandler(serverAddress string) mcp.ResourceHandler {
	return domains.NewResourceHandler(Fetch, serverAddress, "agents")
}
