// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
)

// DeleteOptions contains options for deleting an agent.
type DeleteOptions struct {
	AgentID string
	Client  *stigmer.Client
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	Agent *agentv1.Agent
}

// Delete deletes an agent from the backend.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Client == nil {
		return nil, errors.New("client cannot be nil")
	}
	if opts.AgentID == "" {
		return nil, errors.New("agent ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Client, opts.AgentID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Agent: deleted}, nil
}

// DeleteFromBackend deletes an agent by ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, agentID string) (*agentv1.Agent, error) {
	if agentID == "" {
		return nil, errors.New("agent ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.Agent.Delete(ctx, agentID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete agent '%s'", agentID)
	}

	return deleted, nil
}
