// Package mcpserver provides CLI utilities for managing MCP server resources.
package mcpserver

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
)

// DeleteOptions contains options for deleting an MCP server.
type DeleteOptions struct {
	Reference string
	OrgID     string
	Client    *stigmer.Client
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	McpServer *mcpserverv1.McpServer
}

// Delete deletes an MCP server from the backend.
// First fetches the resource to get its ID and name, then deletes it.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, fmt.Errorf("delete options cannot be nil")
	}
	if opts.Client == nil {
		return nil, fmt.Errorf("client cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("MCP server reference cannot be empty")
	}

	mcpServer, err := GetFromBackend(opts.Client, opts.OrgID, opts.Reference)
	if err != nil {
		return nil, err
	}

	_, err = opts.Client.McpServer.Delete(context.Background(), &stigmer.DeleteResourceInput{
		ResourceID: mcpServer.Metadata.Id,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete MCP server '%s'", mcpServer.Metadata.Name)
	}

	return &DeleteResult{
		McpServer: mcpServer,
	}, nil
}
