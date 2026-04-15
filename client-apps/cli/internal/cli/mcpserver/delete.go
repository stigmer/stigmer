// Package mcpserver provides CLI utilities for managing MCP server resources.
package mcpserver

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
)

// DeleteOptions contains options for deleting an MCP server.
type DeleteOptions struct {
	// Reference is the MCP server reference (slug, org/slug, or resource ID).
	Reference string
	// OrgID is the organization ID for context.
	OrgID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	// McpServer is the deleted MCP server.
	McpServer *mcpserverv1.McpServer
}

// Delete deletes an MCP server from the backend.
// First fetches the resource to get its ID and name, then deletes it.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, fmt.Errorf("delete options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("MCP server reference cannot be empty")
	}

	// First, get the resource to verify it exists and get its ID
	mcpServer, err := GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
	if err != nil {
		return nil, err
	}

	// Delete the resource by ID
	client := mcpserverv1.NewMcpServerCommandControllerClient(opts.Conn)
	_, err = client.Delete(context.Background(), &apiresource.ApiResourceDeleteInput{
		ResourceId: mcpServer.Metadata.Id,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete MCP server '%s'", mcpServer.Metadata.Name)
	}

	return &DeleteResult{
		McpServer: mcpServer,
	}, nil
}
