// Package mcpserver provides in-process gRPC calls to the McpServer service.
//
// This client is used by the reconciliation engine and the seedpack bootstrap
// process to manage MCP server resources. It follows the same patterns as other
// downstream clients (agent, workflow) for consistency.
package mcpserver

import (
	"context"

	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the McpServer service.
//
// Architecture Note: This client lives OUTSIDE the mcpserver domain because it's
// infrastructure for calling the mcpserver service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the mcpserver service.
//
// This implementation uses in-process gRPC with bufconn, ensuring:
//   - All gRPC interceptors execute (validation, logging, api_resource_kind injection, etc.)
//   - All middleware runs before handlers
//   - Full gRPC request/response lifecycle
//   - Zero network overhead (in-process communication)
type Client struct {
	conn      *grpc.ClientConn
	cmdClient mcpserverv1.McpServerCommandControllerClient
}

// NewClient creates a new in-process McpServer client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:      conn,
		cmdClient: mcpserverv1.NewMcpServerCommandControllerClient(conn),
	}
}

// Create creates a new MCP server resource.
//
// This makes an in-process gRPC call to McpServerCommandController.Create()
// ensuring all gRPC interceptors run before reaching the handler.
func (c *Client) Create(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	log.Debug().
		Str("name", server.GetMetadata().GetName()).
		Msg("Creating MCP server via in-process gRPC")

	created, err := c.cmdClient.Create(ctx, server)
	if err != nil {
		log.Error().
			Err(err).
			Str("name", server.GetMetadata().GetName()).
			Msg("Failed to create MCP server")
		return nil, err
	}

	log.Debug().
		Str("id", created.GetMetadata().GetId()).
		Str("name", created.GetMetadata().GetName()).
		Msg("Successfully created MCP server")

	return created, nil
}

// Update updates an existing MCP server resource.
//
// This makes an in-process gRPC call to McpServerCommandController.Update()
// ensuring all gRPC interceptors run before reaching the handler.
func (c *Client) Update(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	log.Debug().
		Str("id", server.GetMetadata().GetId()).
		Str("name", server.GetMetadata().GetName()).
		Msg("Updating MCP server via in-process gRPC")

	updated, err := c.cmdClient.Update(ctx, server)
	if err != nil {
		log.Error().
			Err(err).
			Str("id", server.GetMetadata().GetId()).
			Msg("Failed to update MCP server")
		return nil, err
	}

	log.Debug().
		Str("id", updated.GetMetadata().GetId()).
		Str("name", updated.GetMetadata().GetName()).
		Msg("Successfully updated MCP server")

	return updated, nil
}

// Apply creates or updates an MCP server (idempotent operation).
//
// This makes an in-process gRPC call to McpServerCommandController.Apply()
// ensuring all gRPC interceptors run before reaching the handler.
//
// Apply is used for both create and update operations:
//   - If an MCP server with the same name exists, it updates the existing one
//   - If the MCP server doesn't exist, it creates a new one
//
// Use case: Bootstrap applies system MCP servers from seedpack (idempotent on restart).
func (c *Client) Apply(ctx context.Context, mcpServer *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	log.Debug().
		Str("name", mcpServer.GetMetadata().GetName()).
		Msg("Applying MCP server via in-process gRPC")

	applied, err := c.cmdClient.Apply(ctx, mcpServer)
	if err != nil {
		log.Error().
			Err(err).
			Str("name", mcpServer.GetMetadata().GetName()).
			Msg("Failed to apply MCP server")
		return nil, err
	}

	log.Debug().
		Str("id", applied.GetMetadata().GetId()).
		Str("name", applied.GetMetadata().GetName()).
		Msg("Successfully applied MCP server")

	return applied, nil
}

// Delete deletes an MCP server by ID.
//
// This makes an in-process gRPC call to McpServerCommandController.Delete()
// using ApiResourceDeleteInput (the standard delete input pattern for this controller).
func (c *Client) Delete(ctx context.Context, resourceID string) (*mcpserverv1.McpServer, error) {
	log.Debug().
		Str("resource_id", resourceID).
		Msg("Deleting MCP server via in-process gRPC")

	input := &apiresource.ApiResourceDeleteInput{
		ResourceId: resourceID,
	}

	deleted, err := c.cmdClient.Delete(ctx, input)
	if err != nil {
		log.Error().
			Err(err).
			Str("resource_id", resourceID).
			Msg("Failed to delete MCP server")
		return nil, err
	}

	log.Debug().
		Str("id", deleted.GetMetadata().GetId()).
		Msg("Successfully deleted MCP server")

	return deleted, nil
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
