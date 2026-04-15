// Package execution provides CLI utilities for managing Agent Execution resources.
package execution

import (
	"context"
	"fmt"
	"time"

	"github.com/pkg/errors"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

const (
	// DefaultTimeout is the default context timeout for execution operations.
	DefaultTimeout = 30 * time.Second
)

// GetFromBackend fetches an agent execution from the backend by ID.
// Unlike other resources, executions are always referenced by ID (aex_xxx),
// not by org/slug. This is because executions are ephemeral resources.
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - executionID: Execution ID (e.g., "aex_01abc123")
//
// Returns the AgentExecution proto or an error with context.
func GetFromBackend(conn grpc.ClientConnInterface, executionID string) (*agentexecutionv1.AgentExecution, error) {
	// Validate that the reference is an execution ID
	if !reference.IsAgentExecutionID(executionID) {
		return nil, fmt.Errorf("invalid execution ID format: %s (expected aex_xxx)", executionID)
	}

	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	result, err := client.Get(ctx, &agentexecutionv1.AgentExecutionId{
		Value: executionID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get execution '%s'", executionID)
	}

	return result, nil
}

// GetOptions contains options for fetching an execution.
type GetOptions struct {
	// ExecutionID is the execution ID (e.g., "aex_01abc123").
	ExecutionID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// Get fetches an execution from the backend using the provided options.
// This is a convenience wrapper around GetFromBackend for structured options.
func Get(opts *GetOptions) (*agentexecutionv1.AgentExecution, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.ExecutionID == "" {
		return nil, fmt.Errorf("execution ID cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.ExecutionID)
}

// GetArtifactDownloadURL retrieves a presigned download URL for an artifact.
// The URL can be used for direct HTTP GET downloads without authentication.
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - executionID: Execution ID that owns the artifact
//   - storageKey: Storage key of the artifact (e.g., "artifacts/{exec_id}/report.pdf")
//
// Returns the presigned URL and expiration time.
func GetArtifactDownloadURL(conn grpc.ClientConnInterface, executionID, storageKey string) (string, string, error) {
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	resp, err := client.GetArtifactDownloadUrl(ctx, &agentexecutionv1.GetArtifactDownloadUrlRequest{
		ExecutionId: executionID,
		StorageKey:  storageKey,
	})
	if err != nil {
		return "", "", errors.Wrapf(err, "failed to get download URL for artifact '%s'", storageKey)
	}

	return resp.GetDownloadUrl(), resp.GetExpiresAt(), nil
}
