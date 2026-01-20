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

	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/config"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

// WorkflowInstanceClient queries WorkflowInstance resources from Stigmer backend.
//
// Provides read access to workflow instances, which contain configuration and
// environment bindings for workflow templates.
//
// Usage:
//
//	client := NewWorkflowInstanceClient(cfg)
//	defer client.Close()
//
//	instance, err := client.Get(ctx, instanceID)
type WorkflowInstanceClient struct {
	conn        *grpc.ClientConn
	queryClient workflowinstancev1.WorkflowInstanceQueryControllerClient
	apiKey      string
}

// NewWorkflowInstanceClient creates a new client for querying WorkflowInstance resources.
func NewWorkflowInstanceClient(cfg *config.StigmerConfig) (*WorkflowInstanceClient, error) {
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

	return &WorkflowInstanceClient{
		conn:        conn,
		queryClient: workflowinstancev1.NewWorkflowInstanceQueryControllerClient(conn),
		apiKey:      cfg.APIKey,
	}, nil
}

// Get retrieves a WorkflowInstance by ID.
//
// Returns the complete WorkflowInstance resource including:
// - metadata (id, name, slug, labels, tags)
// - spec (workflow_id, description, env_refs)
// - status (audit info: created_at, updated_at, version)
//
// Example:
//
//	instance, err := client.Get(ctx, "wfi-abc123")
//	if err != nil {
//	    return fmt.Errorf("failed to get instance: %w", err)
//	}
func (c *WorkflowInstanceClient) Get(ctx context.Context, instanceID string) (*workflowinstancev1.WorkflowInstance, error) {
	if instanceID == "" {
		return nil, fmt.Errorf("instance_id cannot be empty")
	}

	// Add API key to request metadata
	if c.apiKey != "" {
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+c.apiKey)
	}

	// Call get RPC
	instance, err := c.queryClient.Get(ctx, &workflowinstancev1.WorkflowInstanceId{
		Value: instanceID,
	})
	if err != nil {
		log.Error().
			Err(err).
			Str("instance_id", instanceID).
			Msg("Failed to get workflow instance")
		return nil, fmt.Errorf("get workflow instance RPC failed: %w", err)
	}

	log.Debug().
		Str("instance_id", instanceID).
		Str("instance_name", instance.Metadata.Name).
		Str("workflow_id", instance.Spec.WorkflowId).
		Msg("Successfully retrieved workflow instance")

	return instance, nil
}

// Close closes the gRPC connection.
func (c *WorkflowInstanceClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
