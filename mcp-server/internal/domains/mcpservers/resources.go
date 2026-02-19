package mcpservers

import (
	"context"
	"fmt"

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
	return func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		org, slug, err := domains.ParseResourceURI(req.Params.URI)
		if err != nil {
			return nil, fmt.Errorf("mcpservers resource: %w", err)
		}

		text, err := Fetch(ctx, serverAddress, org, slug)
		if err != nil {
			return nil, err
		}

		return &mcp.ReadResourceResult{
			Contents: []*mcp.ResourceContents{{
				URI:      req.Params.URI,
				MIMEType: "application/json",
				Text:     text,
			}},
		}, nil
	}
}
