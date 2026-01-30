/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package grpc_client

import (
	"context"
	"fmt"

	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/config"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// ExecutionContextClient retrieves merged environment variables from Stigmer backend.
//
// The ExecutionContext contains environment variables that were merged from:
//  1. Workflow template env_spec (defaults)
//  2. WorkflowInstance env_refs (layered environment configs)
//  3. WorkflowExecution runtime_env (runtime overrides)
//
// This client queries the ExecutionContext by execution ID to retrieve
// the decrypted environment variables for use during workflow execution.
//
// Usage:
//
//	client := NewExecutionContextClient(cfg)
//	defer client.Close()
//
//	// Get merged environment for execution
//	ctx, err := client.GetByExecutionId(ctx, executionID)
//	if err != nil {
//	    if errors.Is(err, ErrExecutionContextNotFound) {
//	        // Fall back to existing flow (backward compatibility)
//	    }
//	}
//	// Use ctx.Spec.Data for environment variables
type ExecutionContextClient struct {
	conn        *grpc.ClientConn
	queryClient executioncontextv1.ExecutionContextQueryControllerClient
	apiKey      string
}

// ErrExecutionContextNotFound indicates no ExecutionContext exists for the given execution.
// This is expected for executions created before ExecutionContext support was added.
var ErrExecutionContextNotFound = fmt.Errorf("execution context not found")

// NewExecutionContextClient creates a new client for retrieving ExecutionContext.
func NewExecutionContextClient(cfg *config.StigmerConfig) (*ExecutionContextClient, error) {
	var opts []grpc.DialOption

	// Configure TLS
	if cfg.UseTLS {
		creds := credentials.NewTLS(nil)
		opts = append(opts, grpc.WithTransportCredentials(creds))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}

	// Create connection
	conn, err := grpc.NewClient(cfg.Endpoint, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create gRPC client: %w", err)
	}

	return &ExecutionContextClient{
		conn:        conn,
		queryClient: executioncontextv1.NewExecutionContextQueryControllerClient(conn),
		apiKey:      cfg.APIKey,
	}, nil
}

// GetByExecutionId retrieves the ExecutionContext for a given execution ID.
//
// The returned ExecutionContext contains:
//   - spec.execution_id: The execution ID this context belongs to
//   - spec.data: Map of environment variables with decrypted secret values
//
// Returns ErrExecutionContextNotFound if no context exists for the execution.
// This allows callers to fall back to the existing environment resolution flow
// for backward compatibility with executions created before ExecutionContext support.
//
// Example:
//
//	execCtx, err := client.GetByExecutionId(ctx, executionID)
//	if err != nil {
//	    if errors.Is(err, ErrExecutionContextNotFound) {
//	        // Fall back to existing flow
//	        return resolveEnvironmentOldWay(execution)
//	    }
//	    return nil, err
//	}
//
//	// Use merged environment from ExecutionContext
//	for key, value := range execCtx.Spec.Data {
//	    env[key] = value.Value
//	}
func (c *ExecutionContextClient) GetByExecutionId(
	ctx context.Context,
	executionID string,
) (*executioncontextv1.ExecutionContext, error) {
	if executionID == "" {
		return nil, fmt.Errorf("execution_id cannot be empty")
	}

	// Add API key to request metadata (operator access required)
	if c.apiKey != "" {
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+c.apiKey)
	}

	// Build input message
	input := &executioncontextv1.ExecutionContextExecutionIdInput{
		ExecutionId: executionID,
	}

	// Call getByExecutionId RPC
	execCtx, err := c.queryClient.GetByExecutionId(ctx, input)
	if err != nil {
		// Check for NOT_FOUND error (expected for backward compatibility)
		if status.Code(err) == codes.NotFound {
			log.Debug().
				Str("execution_id", executionID).
				Msg("ExecutionContext not found - will use fallback environment resolution")
			return nil, ErrExecutionContextNotFound
		}

		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to get ExecutionContext")
		return nil, fmt.Errorf("getByExecutionId RPC failed: %w", err)
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("context_id", execCtx.Metadata.Id).
		Int("data_count", len(execCtx.Spec.Data)).
		Msg("Successfully retrieved ExecutionContext")

	return execCtx, nil
}

// Close closes the gRPC connection.
func (c *ExecutionContextClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
