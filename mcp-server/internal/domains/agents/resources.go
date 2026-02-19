package agents

import (
	"context"
	"fmt"

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
	return func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		org, slug, err := domains.ParseResourceURI(req.Params.URI)
		if err != nil {
			return nil, fmt.Errorf("agents resource: %w", err)
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
