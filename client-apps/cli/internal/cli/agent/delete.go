// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"context"

	"github.com/pkg/errors"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"google.golang.org/grpc"
)

// DeleteOptions contains options for deleting an agent.
type DeleteOptions struct {
	// AgentID is the resource ID of the agent to delete.
	AgentID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	// Agent is the deleted agent (returned by server for confirmation).
	Agent *agentv1.Agent
}

// Delete deletes an agent from the backend.
// Returns the deleted agent for display/confirmation purposes.
//
// Parameters:
//   - opts: Delete options including agent ID and connection
//
// Returns the deleted Agent proto or an error with context.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, errors.New("gRPC connection cannot be nil")
	}
	if opts.AgentID == "" {
		return nil, errors.New("agent ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Conn, opts.AgentID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Agent: deleted}, nil
}

// DeleteFromBackend deletes an agent by ID via gRPC.
// This is the low-level function that directly calls the backend.
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - agentID: Resource ID of the agent to delete (e.g., "agt_abc123")
//
// Returns the deleted Agent proto or an error with context.
func DeleteFromBackend(conn grpc.ClientConnInterface, agentID string) (*agentv1.Agent, error) {
	if agentID == "" {
		return nil, errors.New("agent ID is required for delete operation")
	}

	client := agentv1.NewAgentCommandControllerClient(conn)
	ctx := context.Background()

	// Agent API uses AgentId type (different from MCP Server's ApiResourceDeleteInput)
	deleted, err := client.Delete(ctx, &agentv1.AgentId{
		Value: agentID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete agent '%s'", agentID)
	}

	return deleted, nil
}
