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

	workflowv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/config"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

// WorkflowClient queries Workflow resources from Stigmer backend.
//
// Provides read access to workflow templates, which contain the orchestration
// blueprint (tasks, flow control, etc.).
//
// Usage:
//
//	client := NewWorkflowClient(cfg)
//	defer client.Close()
//
//	workflow, err := client.Get(ctx, workflowID)
type WorkflowClient struct {
	conn        *grpc.ClientConn
	queryClient workflowv1.WorkflowQueryControllerClient
	apiKey      string
}

// NewWorkflowClient creates a new client for querying Workflow resources.
func NewWorkflowClient(cfg *config.StigmerConfig) (*WorkflowClient, error) {
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

	return &WorkflowClient{
		conn:        conn,
		queryClient: workflowv1.NewWorkflowQueryControllerClient(conn),
		apiKey:      cfg.APIKey,
	}, nil
}

// Get retrieves a Workflow by ID.
//
// Returns the complete Workflow resource including:
// - metadata (id, name, slug, labels, tags)
// - spec (workflow definition with tasks)
// - status (audit info, default_instance_id)
//
// Example:
//
//	workflow, err := client.Get(ctx, "wfl-abc123")
//	if err != nil {
//	    return fmt.Errorf("failed to get workflow: %w", err)
//	}
func (c *WorkflowClient) Get(ctx context.Context, workflowID string) (*workflowv1.Workflow, error) {
	if workflowID == "" {
		return nil, fmt.Errorf("workflow_id cannot be empty")
	}

	// Add API key to request metadata
	if c.apiKey != "" {
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+c.apiKey)
	}

	// Call get RPC
	workflow, err := c.queryClient.Get(ctx, &workflowv1.WorkflowId{
		Value: workflowID,
	})
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Msg("Failed to get workflow")
		return nil, fmt.Errorf("get workflow RPC failed: %w", err)
	}

	log.Debug().
		Str("workflow_id", workflowID).
		Str("workflow_name", workflow.Metadata.Name).
		Msg("Successfully retrieved workflow")

	return workflow, nil
}

// Close closes the gRPC connection.
func (c *WorkflowClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
