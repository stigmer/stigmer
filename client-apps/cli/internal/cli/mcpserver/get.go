// Package mcpserver provides CLI utilities for managing MCP server resources.
package mcpserver

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches an MCP server from the backend by reference.
// The reference can be a slug (e.g., "github"), org/slug (e.g., "stigmer/github"),
// or a resource ID (e.g., "mcp_abc123").
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - orgID: Organization ID for context (used when reference is slug-only)
//   - ref: Resource reference string
//
// Returns the McpServer proto or an error with context.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*mcpserverv1.McpServer, error) {
	// Parse the reference (handles slug, org/slug, and resource ID)
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid MCP server reference")
	}

	client := mcpserverv1.NewMcpServerQueryControllerClient(conn)
	ctx := context.Background()

	var result *mcpserverv1.McpServer

	if parsed.IsID {
		// Get by resource ID
		result, err = client.Get(ctx, &apiresource.ApiResourceId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get MCP server by ID '%s'", parsed.ID)
		}
	} else {
		// Get by org/slug reference
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_mcp_server,
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
	// Reference is the MCP server reference (slug, org/slug, or resource ID).
	Reference string
	// OrgID is the organization ID for context (used when reference is slug-only).
	OrgID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// Get fetches an MCP server from the backend using the provided options.
// This is a convenience wrapper around GetFromBackend for structured options.
func Get(opts *GetOptions) (*mcpserverv1.McpServer, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("MCP server reference cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
}
