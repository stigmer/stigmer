// Package mcpserver provides CLI utilities for managing MCP server resources.
package mcpserver

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
)

// GetFromBackend fetches an MCP server from the backend by reference.
// The reference can be a slug (e.g., "github"), org/slug (e.g., "stigmer/github"),
// or a resource ID (e.g., "mcp_abc123").
func GetFromBackend(client *stigmer.Client, orgID, ref string) (*mcpserverv1.McpServer, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid MCP server reference")
	}

	ctx := context.Background()

	var result *mcpserverv1.McpServer

	if parsed.IsID {
		result, err = client.McpServer.Get(ctx, parsed.ID)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get MCP server by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.McpServer.GetByReference(ctx, stigmer.ResourceRef{
			Org:  parsed.Org,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get MCP server '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}

// GetOptions contains options for fetching an MCP server.
type GetOptions struct {
	Reference string
	OrgID     string
	Client    *stigmer.Client
}

// Get fetches an MCP server from the backend using the provided options.
func Get(opts *GetOptions) (*mcpserverv1.McpServer, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Client == nil {
		return nil, fmt.Errorf("client cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("MCP server reference cannot be empty")
	}
	return GetFromBackend(opts.Client, opts.OrgID, opts.Reference)
}
