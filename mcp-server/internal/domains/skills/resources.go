package skills

import (
	"context"
	"fmt"

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
	return func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		org, slug, err := domains.ParseResourceURI(req.Params.URI)
		if err != nil {
			return nil, fmt.Errorf("skills resource: %w", err)
		}

		text, err := Fetch(ctx, serverAddress, org, slug, "")
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
