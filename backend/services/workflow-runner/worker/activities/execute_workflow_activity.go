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

package activities

import (
	"context"
	"fmt"
	"time"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/config"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/converter"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/grpc_client"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/types"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
)

// ExecuteWorkflowActivity implements the ExecuteWorkflowActivity interface from Java.
//
// This is a Temporal activity that executes Zigflow workflows from WorkflowExecution proto.
// It's called from the Java Temporal workflow (InvokeWorkflowExecutionWorkflowImpl).
//
// Flow:
// 1. Query Stigmer service for complete workflow context (execution → instance → workflow)
// 2. Convert WorkflowSpec proto → YAML (Phase 2 converter)
// 3. Start ExecuteServerlessWorkflow on zigflow_execution queue
// 4. Wait for workflow completion
// 5. Return final status
//
// Task Queue: workflow_execution (orchestration)
type ExecuteWorkflowActivityImpl struct {
	workflowExecutionClient *grpc_client.WorkflowExecutionClient
	workflowInstanceClient  *grpc_client.WorkflowInstanceClient
	workflowClient          *grpc_client.WorkflowClient
	temporalClient          client.Client
	executionTaskQueue      string
}

// NewExecuteWorkflowActivity creates a new ExecuteWorkflowActivity instance.
func NewExecuteWorkflowActivity(
	stigmerCfg *config.StigmerConfig,
	temporalClient client.Client,
	executionTaskQueue string,
) (*ExecuteWorkflowActivityImpl, error) {
	// Create all gRPC clients
	workflowExecutionClient, err := grpc_client.NewWorkflowExecutionClient(stigmerCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create workflow execution client: %w", err)
	}

	workflowInstanceClient, err := grpc_client.NewWorkflowInstanceClient(stigmerCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create workflow instance client: %w", err)
	}

	workflowClient, err := grpc_client.NewWorkflowClient(stigmerCfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create workflow client: %w", err)
	}

	return &ExecuteWorkflowActivityImpl{
		workflowExecutionClient: workflowExecutionClient,
		workflowInstanceClient:  workflowInstanceClient,
		workflowClient:          workflowClient,
		temporalClient:          temporalClient,
		executionTaskQueue:      executionTaskQueue,
	}, nil
}

// ExecuteWorkflow executes a Zigflow workflow from WorkflowExecution proto.
//
// This method signature matches the Java interface:
//   @ActivityMethod(name = "ExecuteWorkflow")
//   WorkflowExecutionStatus executeWorkflow(WorkflowExecution execution);
//
// Implementation steps:
// 1. Extract execution ID and workflow instance ID from input
// 2. Query Stigmer service for WorkflowInstance (contains Workflow reference)
// 3. Query Stigmer service for Workflow (contains WorkflowSpec)
// 4. Convert WorkflowSpec proto to YAML (using Phase 2 converter)
// 5. Execute workflow via Zigflow engine
// 6. Send progressive status updates via gRPC callbacks
// 7. Return final status to Temporal workflow
func (a *ExecuteWorkflowActivityImpl) ExecuteWorkflow(
	ctx context.Context,
	execution *workflowexecutionv1.WorkflowExecution,
) (*workflowexecutionv1.WorkflowExecutionStatus, error) {
	logger := activity.GetLogger(ctx)

	// Extract execution ID
	if execution.Metadata == nil {
		return nil, fmt.Errorf("execution metadata is required")
	}
	executionID := execution.Metadata.Id
	if executionID == "" {
		return nil, fmt.Errorf("execution ID is required")
	}

	logger.Info("ExecuteWorkflow activity started",
		"execution_id", executionID)

	// Update status to IN_PROGRESS
	_, err := a.workflowExecutionClient.UpdateStatus(ctx, executionID, &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
	})
	if err != nil {
		logger.Warn("Failed to update status to IN_PROGRESS", "error", err)
	}

	// Step 1: Resolve WorkflowInstance from execution
	// WorkflowExecution.spec can have either workflow_instance_id OR workflow_id
	if execution.Spec == nil {
		return nil, fmt.Errorf("execution spec is required")
	}

	var workflowInstanceID string
	var workflowID string

	// Check if workflow_instance_id is provided
	if execution.Spec.WorkflowInstanceId != "" {
		workflowInstanceID = execution.Spec.WorkflowInstanceId
		logger.Info("Using workflow_instance_id from execution",
			"instance_id", workflowInstanceID)
	} else if execution.Spec.WorkflowId != "" {
		workflowID = execution.Spec.WorkflowId
		logger.Info("Using workflow_id from execution (will resolve to default instance)",
			"workflow_id", workflowID)
	} else {
		return nil, fmt.Errorf("execution must have either workflow_instance_id or workflow_id")
	}

	// Step 2: Query WorkflowInstance
	var instance *workflowinstancev1.WorkflowInstance
	if workflowInstanceID != "" {
		// Direct instance reference
		instance, err = a.workflowInstanceClient.Get(ctx, workflowInstanceID)
		if err != nil {
			logger.Error("Failed to query workflow instance",
				"instance_id", workflowInstanceID,
				"error", err)

			a.workflowExecutionClient.UpdateStatus(ctx, executionID, &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
				Error: fmt.Sprintf("Failed to query workflow instance: %v", err),
			})

			return nil, fmt.Errorf("failed to query workflow instance %s: %w", workflowInstanceID, err)
		}
		workflowID = instance.Spec.WorkflowId
	} else {
		// Resolve from workflow_id (backend will auto-create default instance)
		// For now, we need to query the workflow's default_instance_id
		// In the future, backend should handle this resolution
		workflow, err := a.workflowClient.Get(ctx, workflowID)
		if err != nil {
			logger.Error("Failed to query workflow",
				"workflow_id", workflowID,
				"error", err)

			a.workflowExecutionClient.UpdateStatus(ctx, executionID, &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
				Error: fmt.Sprintf("Failed to query workflow: %v", err),
			})

			return nil, fmt.Errorf("failed to query workflow %s: %w", workflowID, err)
		}

		// Check if workflow has a default instance
		if workflow.Status == nil || workflow.Status.DefaultInstanceId == "" {
			// No default instance - this should be handled by backend in the future
			// For now, return an error
			err := fmt.Errorf("workflow %s has no default instance configured", workflowID)
			logger.Error("Workflow missing default instance", "workflow_id", workflowID)

			a.workflowExecutionClient.UpdateStatus(ctx, executionID, &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
				Error: err.Error(),
			})

			return nil, err
		}

		// Query the default instance
		workflowInstanceID = workflow.Status.DefaultInstanceId
		instance, err = a.workflowInstanceClient.Get(ctx, workflowInstanceID)
		if err != nil {
			logger.Error("Failed to query default workflow instance",
				"instance_id", workflowInstanceID,
				"error", err)

			a.workflowExecutionClient.UpdateStatus(ctx, executionID, &workflowexecutionv1.WorkflowExecutionStatus{
				Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
				Error: fmt.Sprintf("Failed to query default instance: %v", err),
			})

			return nil, fmt.Errorf("failed to query default instance %s: %w", workflowInstanceID, err)
		}
	}

	logger.Info("Resolved workflow instance",
		"instance_id", workflowInstanceID,
		"instance_name", instance.Metadata.Name,
		"workflow_id", workflowID)

	// Step 3: Query Workflow (template)
	workflow, err := a.workflowClient.Get(ctx, workflowID)
	if err != nil {
		logger.Error("Failed to query workflow",
			"workflow_id", workflowID,
			"error", err)

		a.workflowExecutionClient.UpdateStatus(ctx, executionID, &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error: fmt.Sprintf("Failed to query workflow: %v", err),
		})

		return nil, fmt.Errorf("failed to query workflow %s: %w", workflowID, err)
	}

	logger.Info("Retrieved workflow definition",
		"workflow_id", workflowID,
		"workflow_name", workflow.Metadata.Name,
		"task_count", len(workflow.Spec.Tasks))

	// Step 4: Convert Workflow.spec proto → YAML (Phase 2)
	converter := converter.NewConverter()
	workflowYAML, err := converter.ProtoToYAML(workflow.Spec)
	if err != nil {
		logger.Error("Failed to convert workflow proto to YAML",
			"workflow_id", workflowID,
			"error", err)

		a.workflowExecutionClient.UpdateStatus(ctx, executionID, &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error: fmt.Sprintf("Failed to convert workflow to YAML: %v", err),
		})

		return nil, fmt.Errorf("failed to convert workflow to YAML: %w", err)
	}

	logger.Info("Successfully converted workflow to YAML",
		"workflow_id", workflowID,
		"yaml_length", len(workflowYAML))

	logger.Info("Starting ExecuteServerlessWorkflow on execution queue",
		"execution_id", executionID,
		"task_queue", a.executionTaskQueue)

	// Build runtime environment from execution.Spec.RuntimeEnv
	// This enables just-in-time secret resolution in Zigflow activities
	runtimeEnv := make(map[string]any)
	if execution.Spec != nil && execution.Spec.RuntimeEnv != nil {
		logger.Info("Processing runtime environment variables",
			"execution_id", executionID,
			"env_count", len(execution.Spec.RuntimeEnv))

		for key, execValue := range execution.Spec.RuntimeEnv {
			if execValue == nil {
				logger.Warn("Skipping nil runtime env value",
					"execution_id", executionID,
					"key", key)
				continue
			}

			// Store as map with value and metadata
			// The is_secret flag is preserved for JIT resolution
			runtimeEnv[key] = map[string]interface{}{
				"value":     execValue.Value,
				"is_secret": execValue.IsSecret,
			}

			// Log non-secret values for debugging (NEVER log secret values!)
			if !execValue.IsSecret {
				logger.Debug("Runtime env value (non-secret)",
					"execution_id", executionID,
					"key", key,
					"value", execValue.Value)
			} else {
				logger.Debug("Runtime env value (secret - value hidden)",
					"execution_id", executionID,
					"key", key)
			}
		}
	}

	// Start ExecuteServerlessWorkflow on zigflow_execution queue
	workflowOptions := client.StartWorkflowOptions{
		ID:        fmt.Sprintf("workflow-exec-%s", executionID),
		TaskQueue: a.executionTaskQueue,
		// TODO: Configure timeouts based on workflow spec
		WorkflowExecutionTimeout: 30 * time.Minute,
	}

	workflowInput := &types.TemporalWorkflowInput{
		WorkflowExecutionID: executionID,
		WorkflowYaml:        workflowYAML,
		InitialData:         map[string]interface{}{},
		EnvVars:             runtimeEnv, // ✅ Now populated with runtime environment
		OrgId:               execution.Metadata.Org, // ✅ Organization context from workflow execution
	}

	// Start the workflow
	run, err := a.temporalClient.ExecuteWorkflow(ctx, workflowOptions, "ExecuteServerlessWorkflow", workflowInput)
	if err != nil {
		logger.Error("Failed to start ExecuteServerlessWorkflow",
			"execution_id", executionID,
			"error", err)

		// Update status to FAILED
		a.workflowExecutionClient.UpdateStatus(ctx, executionID, &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error: fmt.Sprintf("Failed to start workflow: %v", err),
		})

		return nil, fmt.Errorf("failed to start ExecuteServerlessWorkflow: %w", err)
	}

	logger.Info("ExecuteServerlessWorkflow started successfully",
		"execution_id", executionID,
		"workflow_id", run.GetID(),
		"run_id", run.GetRunID())

	// Wait for workflow to complete
	var workflowOutput types.TemporalWorkflowOutput
	err = run.Get(ctx, &workflowOutput)
	if err != nil {
		logger.Error("ExecuteServerlessWorkflow failed",
			"execution_id", executionID,
			"error", err)

		// Update status to FAILED
		status := &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
			Error: fmt.Sprintf("Workflow execution failed: %v", err),
		}

		a.workflowExecutionClient.UpdateStatus(ctx, executionID, status)

		return status, nil // Return status instead of error to prevent Java workflow from failing
	}

	logger.Info("ExecuteServerlessWorkflow completed successfully",
		"execution_id", executionID)

	// Return final status
	status := &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
	}

	// Update final status
	a.workflowExecutionClient.UpdateStatus(ctx, executionID, status)

	return status, nil
}

// Close releases resources held by the activity.
func (a *ExecuteWorkflowActivityImpl) Close() error {
	var errs []error

	if a.workflowExecutionClient != nil {
		if err := a.workflowExecutionClient.Close(); err != nil {
			errs = append(errs, fmt.Errorf("workflow execution client: %w", err))
		}
	}

	if a.workflowInstanceClient != nil {
		if err := a.workflowInstanceClient.Close(); err != nil {
			errs = append(errs, fmt.Errorf("workflow instance client: %w", err))
		}
	}

	if a.workflowClient != nil {
		if err := a.workflowClient.Close(); err != nil {
			errs = append(errs, fmt.Errorf("workflow client: %w", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("failed to close clients: %v", errs)
	}

	return nil
}
