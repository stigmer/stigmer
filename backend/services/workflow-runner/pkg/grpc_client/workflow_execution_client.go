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

	workflowexecutionv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/config"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

// WorkflowExecutionClient sends status updates to Stigmer backend.
//
// Pattern matches agent-runner's AgentExecutionClient:
// - Uses updateStatus RPC to send progressive status updates
// - Updates status.tasks[] array as workflow progresses
// - Updates status.phase when workflow completes/fails
//
// Usage:
//
//	client := NewWorkflowExecutionClient(cfg)
//	defer client.Close()
//
//	// Update task status
//	err := client.UpdateStatus(ctx, executionID, status)
type WorkflowExecutionClient struct {
	conn          *grpc.ClientConn
	commandClient workflowexecutionv1.WorkflowExecutionCommandControllerClient
	apiKey        string
}

// NewWorkflowExecutionClient creates a new client for updating WorkflowExecution status.
func NewWorkflowExecutionClient(cfg *config.StigmerConfig) (*WorkflowExecutionClient, error) {
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

	return &WorkflowExecutionClient{
		conn:          conn,
		commandClient: workflowexecutionv1.NewWorkflowExecutionCommandControllerClient(conn),
		apiKey:        cfg.APIKey,
	}, nil
}

// UpdateStatus sends a status update to Stigmer backend.
//
// This method updates the WorkflowExecution.status field including:
// - status.tasks[] - Updated task statuses, outputs, errors
// - status.phase - Updated when workflow completes/fails
// - status.output - Set when workflow completes
// - status.error - Set when workflow fails
//
// The Stigmer backend handler will merge these status updates with the existing execution.
//
// Example:
//
//	status := &workflowexecutionv1.WorkflowExecutionStatus{
//	    Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
//	    Tasks: []*workflowexecutionv1.WorkflowTask{
//	        {
//	            TaskId:     "task-1",
//	            TaskName:   "validate_input",
//	            TaskStatus: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
//	            Output:     &structpb.Struct{...},
//	        },
//	    },
//	}
//	err := client.UpdateStatus(ctx, executionID, status)
func (c *WorkflowExecutionClient) UpdateStatus(
	ctx context.Context,
	executionID string,
	status *workflowexecutionv1.WorkflowExecutionStatus,
) (*workflowexecutionv1.WorkflowExecution, error) {
	if executionID == "" {
		return nil, fmt.Errorf("execution_id cannot be empty")
	}

	// Add API key to request metadata
	if c.apiKey != "" {
		ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+c.apiKey)
	}

	// Build WorkflowExecutionUpdateStatusInput with execution ID and status
	// This is the new contract that avoids validation errors on incomplete metadata
	input := &workflowexecutionv1.WorkflowExecutionUpdateStatusInput{
		ExecutionId: executionID,
		Status:      status,
	}

	// Call updateStatus RPC with the new input message
	updated, err := c.commandClient.UpdateStatus(ctx, input)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Msg("Failed to update workflow execution status")
		return nil, fmt.Errorf("updateStatus RPC failed: %w", err)
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", status.Phase.String()).
		Int("task_count", len(status.Tasks)).
		Msg("Successfully updated workflow execution status")

	return updated, nil
}

// Close closes the gRPC connection.
func (c *WorkflowExecutionClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
