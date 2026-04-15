// Package execution provides CLI utilities for managing Agent Execution resources.
package execution

import (
	"context"

	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"google.golang.org/grpc"
)

const (
	// DefaultPageSize is the default number of executions per page.
	DefaultPageSize = 20

	// MaxPageSize is the maximum allowed page size.
	MaxPageSize = 100
)

// ListOptions contains options for listing executions.
type ListOptions struct {
	// Conn is the gRPC connection to the backend. Required.
	Conn grpc.ClientConnInterface

	// Phase filters executions by phase (optional).
	// Use agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED for no filter.
	Phase agentexecutionv1.ExecutionPhase

	// Tags filters executions by tags (optional).
	Tags []string

	// PageSize is the maximum number of results to return. Default: 20, Max: 100.
	PageSize int32

	// PageToken is the token for pagination (from previous response).
	PageToken string
}

// List retrieves agent executions with optional filtering.
// Unlike other resources, executions use their own dedicated list RPC,
// not the unified SearchService.
//
// Returns the AgentExecutionList proto or an error with context.
func List(opts *ListOptions) (*agentexecutionv1.AgentExecutionList, error) {
	if opts == nil {
		return nil, errors.New("list options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, errors.New("gRPC connection cannot be nil")
	}

	// Apply defaults
	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}

	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(opts.Conn)
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	req := &agentexecutionv1.ListAgentExecutionsRequest{
		PageSize:  pageSize,
		PageToken: opts.PageToken,
	}

	// Apply phase filter if specified
	if opts.Phase != agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED {
		req.Phase = opts.Phase
	}

	// Apply tags filter if specified
	if len(opts.Tags) > 0 {
		req.Tags = opts.Tags
	}

	result, err := client.List(ctx, req)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list executions")
	}

	return result, nil
}

// ListBySessionOptions contains options for listing executions in a session.
type ListBySessionOptions struct {
	// Conn is the gRPC connection to the backend. Required.
	Conn grpc.ClientConnInterface

	// SessionID is the session to filter by. Required.
	SessionID string

	// PageSize is the maximum number of results to return.
	PageSize int32

	// PageToken is the token for pagination.
	PageToken string
}

// ListBySession retrieves all executions in a specific session.
func ListBySession(opts *ListBySessionOptions) (*agentexecutionv1.AgentExecutionList, error) {
	if opts == nil {
		return nil, errors.New("list options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, errors.New("gRPC connection cannot be nil")
	}
	if opts.SessionID == "" {
		return nil, errors.New("session ID cannot be empty")
	}

	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}

	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(opts.Conn)
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	result, err := client.ListBySession(ctx, &agentexecutionv1.ListAgentExecutionsBySessionRequest{
		SessionId: opts.SessionID,
		PageSize:  pageSize,
		PageToken: opts.PageToken,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to list executions for session '%s'", opts.SessionID)
	}

	return result, nil
}
