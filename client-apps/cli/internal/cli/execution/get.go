// Package execution provides CLI utilities for managing Agent Execution resources.
package execution

import (
	"context"
	"fmt"
	"time"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

const (
	// DefaultTimeout is the default context timeout for execution operations.
	DefaultTimeout = 30 * time.Second
)

// GetFromBackend fetches an agent execution from the backend by ID.
// Unlike other resources, executions are always referenced by ID (aex_xxx),
// not by org/slug. This is because executions are ephemeral resources.
func GetFromBackend(client *stigmer.Client, executionID string) (*agentexecutionv1.AgentExecution, error) {
	if !reference.IsAgentExecutionID(executionID) {
		return nil, fmt.Errorf("invalid execution ID format: %s (expected aex_xxx)", executionID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	result, err := client.AgentExecution.Get(ctx, executionID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to get execution '%s'", executionID)
	}

	return result, nil
}

// GetOptions contains options for fetching an execution.
type GetOptions struct {
	ExecutionID string
	Client      *stigmer.Client
}

// Get fetches an execution from the backend using the provided options.
func Get(opts *GetOptions) (*agentexecutionv1.AgentExecution, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Client == nil {
		return nil, fmt.Errorf("client cannot be nil")
	}
	if opts.ExecutionID == "" {
		return nil, fmt.Errorf("execution ID cannot be empty")
	}
	return GetFromBackend(opts.Client, opts.ExecutionID)
}

// GetArtifactDownloadURL retrieves a presigned download URL for an artifact.
func GetArtifactDownloadURL(client *stigmer.Client, executionID, storageKey string) (string, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	resp, err := client.AgentExecution.GetArtifactDownloadUrl(ctx, &agentexecutionv1.GetArtifactDownloadUrlRequest{
		ExecutionId: executionID,
		StorageKey:  storageKey,
	})
	if err != nil {
		return "", "", errors.Wrapf(err, "failed to get download URL for artifact '%s'", storageKey)
	}

	return resp.GetDownloadUrl(), resp.GetExpiresAt(), nil
}
