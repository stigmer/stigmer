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

package executor

import (
	"context"
	"fmt"

	workflowexecutionv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	runnerv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflowrunner/v1"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/grpc_client"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/utils"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/zigflow"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/zigflow/tasks"
	"github.com/rs/zerolog/log"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// WorkflowExecutor executes workflows and reports status via updateStatus RPC
type WorkflowExecutor struct {
	executionClient *grpc_client.WorkflowExecutionClient
	// Track tasks as we build them
	tasks []*workflowexecutionv1.WorkflowTask
}

// NewWorkflowExecutor creates a new workflow executor with execution client for status updates
func NewWorkflowExecutor(executionClient *grpc_client.WorkflowExecutionClient) *WorkflowExecutor {
	return &WorkflowExecutor{
		executionClient: executionClient,
		tasks:           make([]*workflowexecutionv1.WorkflowTask, 0),
	}
}

// Execute executes a workflow from the input and reports status via updateStatus RPC
func (e *WorkflowExecutor) Execute(ctx context.Context, input *runnerv1.WorkflowExecuteInput) error {
	// Validate input
	if input.WorkflowYaml == "" {
		return fmt.Errorf("workflow YAML is required in input")
	}

	executionID := input.WorkflowExecutionId

	log.Info().
		Str("execution_id", executionID).
		Msg("Starting workflow execution")

	// Update status: workflow started
	if err := e.updateStatus(ctx, executionID, workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS); err != nil {
		log.Warn().Err(err).Msg("Failed to update status to IN_PROGRESS (continuing anyway)")
	}

	// Parse workflow YAML
	workflowDef, err := zigflow.LoadFromString(input.WorkflowYaml)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Int("yaml_length", len(input.WorkflowYaml)).
			Msg("Failed to parse workflow YAML")
		e.updateStatusWithError(ctx, executionID, fmt.Sprintf("Failed to parse workflow YAML: %v", err))
		return fmt.Errorf("failed to parse workflow YAML: %w", err)
	}

	// Validate workflow
	if err := e.validateWorkflow(ctx, input, workflowDef); err != nil {
		log.Error().Err(err).Msg("Workflow validation failed")
		e.updateStatusWithError(ctx, executionID, fmt.Sprintf("Workflow validation failed: %v", err))
		return fmt.Errorf("workflow validation failed: %w", err)
	}

	// Execute workflow (placeholder for Phase 1.5)
	if err := e.executeWorkflowTasks(ctx, input, workflowDef); err != nil {
		log.Error().Err(err).Msg("Workflow execution failed")
		e.updateStatusWithError(ctx, executionID, fmt.Sprintf("Workflow execution failed: %v", err))
		return fmt.Errorf("workflow execution failed: %w", err)
	}

	// Update status: workflow completed
	if err := e.updateStatus(ctx, executionID, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED); err != nil {
		log.Warn().Err(err).Msg("Failed to update status to COMPLETED (continuing anyway)")
	}

	log.Info().
		Str("execution_id", executionID).
		Str("workflow_name", workflowDef.Document.Name).
		Msg("Workflow execution completed successfully")

	return nil
}

// validateWorkflow validates the workflow definition
func (e *WorkflowExecutor) validateWorkflow(ctx context.Context, input *runnerv1.WorkflowExecuteInput, workflowDef *model.Workflow) error {
	// Add validation task
	taskID := e.addTask("workflow_validation", "Workflow Validation", workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS)
	e.updateStatus(ctx, input.WorkflowExecutionId, workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)

	// Basic validation
	if workflowDef.Document.Name == "" {
		e.updateTaskStatus(taskID, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED, "Workflow name is required")
		e.updateStatus(ctx, input.WorkflowExecutionId, workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
		return fmt.Errorf("workflow name is required")
	}
	if workflowDef.Document.Namespace == "" {
		e.updateTaskStatus(taskID, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED, "Workflow namespace is required")
		e.updateStatus(ctx, input.WorkflowExecutionId, workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
		return fmt.Errorf("workflow namespace is required")
	}
	// Phase 1.5: Skip task count validation
	// Task structure will be properly validated in Phase 2+ when we implement execution

	// Mark validation complete
	e.updateTaskStatus(taskID, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED, "Workflow validation passed")
	e.updateStatus(ctx, input.WorkflowExecutionId, workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
	return nil
}

// executeWorkflowTasks executes all tasks in the workflow using Zigflow engine
func (e *WorkflowExecutor) executeWorkflowTasks(ctx context.Context, input *runnerv1.WorkflowExecuteInput, workflowDef *model.Workflow) error {
	workflowName := workflowDef.Document.Name
	taskCount := 0
	if workflowDef.Do != nil {
		taskCount = len(*workflowDef.Do)
	}

	log.Info().
		Str("workflow_name", workflowName).
		Int("task_count", taskCount).
		Msg("Executing workflow tasks with Zigflow engine")

	// Phase 3: Build task executor from workflow definition
	// Note: We pass nil for worker since gRPC mode doesn't register activities
	// Temporal mode (production) uses temporal_workflow.go which has proper worker
	log.Debug().Msg("Creating task builder from workflow definition")
	taskBuilder, err := tasks.NewDoTaskBuilder(
		nil, // worker - not needed for gRPC mode
		&model.DoTask{Do: workflowDef.Do},
		workflowDef.Document.Name,
		workflowDef,
		tasks.DoTaskOpts{
			Envvars:                 make(map[string]any), // Empty env vars for now
			DisableRegisterWorkflow: true,                 // Don't register in gRPC mode
		},
	)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create task builder")
		e.updateStatusWithError(ctx, input.WorkflowExecutionId, fmt.Sprintf("Failed to create task builder: %v", err))
		return fmt.Errorf("failed to create task builder: %w", err)
	}

	// Build workflow execution function (validates structure)
	log.Debug().Msg("Building workflow execution function")
	_, err = taskBuilder.Build()
	if err != nil {
		log.Error().Err(err).Msg("Failed to build workflow")
		e.updateStatusWithError(ctx, input.WorkflowExecutionId, fmt.Sprintf("Failed to build workflow: %v", err))
		return fmt.Errorf("failed to build workflow: %w", err)
	}

	// Initialize state (Phase 2+: Will be populated from Stigmer service query)
	log.Debug().Msg("Initializing workflow state")
	state := utils.NewState()
	state.Env = make(map[string]any) // Empty env vars for Phase 1.5

	// Phase 3 Day 2: Validate workflow structure
	// gRPC mode: We can validate the task structure but can't execute Temporal activities
	// For actual execution, use Temporal mode (production)
	log.Info().
		Str("workflow_name", workflowName).
		Msg("Workflow structure built successfully - execution requires Temporal mode")

	// Report task structure analysis
	e.reportTaskStructure(ctx, input, workflowDef)

	// Note: Full task execution with activities happens in Temporal mode
	// (see pkg/executor/temporal_workflow.go for production execution)
	// gRPC mode is for validation and structure analysis only

	log.Info().
		Str("workflow_name", workflowName).
		Str("namespace", workflowDef.Document.Namespace).
		Str("version", workflowDef.Document.Version).
		Msg("Workflow ready for execution - use Temporal mode for production")

	// Mark workflow as ready (task already added by reportTaskStructure)
	log.Info().
		Str("workflow_name", workflowName).
		Msg("Workflow ready for execution")

	return nil
}

// reportTaskStructure analyzes and reports the workflow task structure
func (e *WorkflowExecutor) reportTaskStructure(ctx context.Context, input *runnerv1.WorkflowExecuteInput, workflowDef *model.Workflow) {
	taskID := e.addTask("task_analysis", "Task Structure Analysis", workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS)

	if workflowDef.Do == nil {
		log.Info().Msg("Workflow has no tasks")
		e.updateTaskStatus(taskID, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED, "Workflow contains 0 tasks")
		e.updateStatus(ctx, input.WorkflowExecutionId, workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
		return
	}

	taskCount := len(*workflowDef.Do)

	log.Info().
		Int("task_count", taskCount).
		Msg("Analyzing workflow task structure")

	// Analyze task types
	taskTypes := make(map[string]int)
	for _, taskItem := range *workflowDef.Do {
		taskType := getTaskType(taskItem.Task)
		taskTypes[taskType]++

		log.Debug().
			Str("task_name", taskItem.Key).
			Str("task_type", taskType).
			Msg("Task detected")
	}

	// Build summary message
	summary := fmt.Sprintf("Analyzed %d top-level tasks", taskCount)
	e.updateTaskStatus(taskID, workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED, summary)
	e.updateStatus(ctx, input.WorkflowExecutionId, workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS)
}

// getTaskType returns a human-readable task type string
func getTaskType(task model.Task) string {
	switch task.(type) {
	case *model.CallHTTP:
		return "http"
	case *model.CallGRPC:
		return "grpc"
	case *model.SetTask:
		return "set"
	case *model.ForTask:
		return "for"
	case *model.ForkTask:
		return "fork"
	case *model.SwitchTask:
		return "switch"
	case *model.WaitTask:
		return "wait"
	case *model.RaiseTask:
		return "raise"
	case *model.TryTask:
		return "try"
	case *model.ListenTask:
		return "listen"
	case *model.DoTask:
		return "do"
	case *model.CallFunction:
		return "call"
	default:
		return "unknown"
	}
}

// convertToAnyMap converts map[string]string to map[string]any
func convertToAnyMap(m map[string]string) map[string]any {
	if m == nil {
		return make(map[string]any)
	}
	result := make(map[string]any, len(m))
	for k, v := range m {
		result[k] = v
	}
	return result
}

// addTask adds a new task to the status and returns its ID for later updates
func (e *WorkflowExecutor) addTask(taskID, taskName string, status workflowexecutionv1.WorkflowTaskStatus) string {
	task := &workflowexecutionv1.WorkflowTask{
		TaskId:    taskID,
		TaskName:  taskName,
		Status:    status,
		StartedAt: timestamppb.Now().String(),
	}
	e.tasks = append(e.tasks, task)

	log.Debug().
		Str("task_id", taskID).
		Str("task_name", taskName).
		Str("status", status.String()).
		Msg("Added task to status")

	return taskID
}

// updateTaskStatus updates an existing task's status and message
func (e *WorkflowExecutor) updateTaskStatus(taskID string, status workflowexecutionv1.WorkflowTaskStatus, message string) {
	for _, task := range e.tasks {
		if task.TaskId == taskID {
			task.Status = status
			if status == workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED ||
				status == workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED {
				task.CompletedAt = timestamppb.Now().String()
			}
			if message != "" {
				if status == workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED {
					task.Error = message
				}
			}

			log.Debug().
				Str("task_id", taskID).
				Str("status", status.String()).
				Str("message", message).
				Msg("Updated task status")

			return
		}
	}

	log.Warn().
		Str("task_id", taskID).
		Msg("Task not found when updating status")
}

// updateStatus calls the updateStatus RPC with current phase and tasks
func (e *WorkflowExecutor) updateStatus(ctx context.Context, executionID string, phase workflowexecutionv1.ExecutionPhase) error {
	status := &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: phase,
		Tasks: e.tasks,
	}

	_, err := e.executionClient.UpdateStatus(ctx, executionID, status)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Str("phase", phase.String()).
			Msg("Failed to update status")
		return err
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("phase", phase.String()).
		Int("task_count", len(e.tasks)).
		Msg("Updated execution status")

	return nil
}

// updateStatusWithError updates status to FAILED with error details
func (e *WorkflowExecutor) updateStatusWithError(ctx context.Context, executionID, errorMessage string) {
	status := &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED,
		Tasks: e.tasks,
		Error: errorMessage,
	}

	_, err := e.executionClient.UpdateStatus(ctx, executionID, status)
	if err != nil {
		log.Error().
			Err(err).
			Str("execution_id", executionID).
			Str("error_message", errorMessage).
			Msg("Failed to update status with error")
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("error_message", errorMessage).
		Msg("Updated execution status with error")
}
