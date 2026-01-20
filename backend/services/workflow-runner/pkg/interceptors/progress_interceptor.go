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

package interceptors

import (
	"context"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/config"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/grpc_client"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"github.com/rs/zerolog/log"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/workflow"
)

// ProgressReportingInterceptor intercepts Zigflow activity executions to report
// progress back to Stigmer backend WITHOUT polluting the Temporal UI.
//
// This interceptor:
// - Hooks into EVERY Zigflow activity (CallHTTP, CallGRPC, etc.)
// - Reports task start/complete/failed to stigmer-service
// - Uses workflow.SideEffect to hide progress updates from Temporal UI
// - Extracts WorkflowExecutionID from workflow context
//
// Result: Clean Temporal UI showing only user-defined tasks, while still
// providing granular progress updates to stigmer-service.
type ProgressReportingInterceptor struct {
	interceptor.WorkerInterceptorBase
	stigmerConfig *config.StigmerConfig
}

// NewProgressReportingInterceptor creates a new progress reporting interceptor.
func NewProgressReportingInterceptor(cfg *config.StigmerConfig) *ProgressReportingInterceptor {
	return &ProgressReportingInterceptor{
		stigmerConfig: cfg,
	}
}

// InterceptActivity hooks into activity execution lifecycle.
func (i *ProgressReportingInterceptor) InterceptActivity(
	ctx context.Context,
	next interceptor.ActivityInboundInterceptor,
) interceptor.ActivityInboundInterceptor {
	return &activityInterceptor{
		ActivityInboundInterceptorBase: interceptor.ActivityInboundInterceptorBase{
			Next: next,
		},
		stigmerConfig: i.stigmerConfig,
	}
}

// activityInterceptor wraps individual activity executions.
type activityInterceptor struct {
	interceptor.ActivityInboundInterceptorBase
	stigmerConfig *config.StigmerConfig
}

// ExecuteActivity intercepts activity execution to report progress.
func (a *activityInterceptor) ExecuteActivity(
	ctx context.Context,
	in *interceptor.ExecuteActivityInput,
) (interface{}, error) {
	activityInfo := activity.GetInfo(ctx)

	// Skip progress reporting for internal activities
	if shouldSkipProgressReporting(activityInfo.ActivityType.Name) {
		return a.Next.ExecuteActivity(ctx, in)
	}

	// Extract WorkflowExecutionID from activity heartbeat details or workflow memo
	executionID := extractWorkflowExecutionID(ctx)
	if executionID == "" {
		// No execution ID available, skip progress reporting
		log.Debug().
			Str("activity_type", activityInfo.ActivityType.Name).
			Msg("No WorkflowExecutionID found, skipping progress reporting")
		return a.Next.ExecuteActivity(ctx, in)
	}

	// Get task name from activity summary (set by SetActivityOptions)
	// This is the user-defined task name from the workflow definition, not the internal activity type
	taskName := extractTaskName(activityInfo)

	// Report task started
	a.reportTaskProgress(ctx, executionID, taskName, "started", nil)

	// Execute the actual activity
	result, err := a.Next.ExecuteActivity(ctx, in)

	// Report task completed or failed
	if err != nil {
		a.reportTaskProgress(ctx, executionID, taskName, "failed", err)
	} else {
		a.reportTaskProgress(ctx, executionID, taskName, "completed", nil)
	}

	return result, err
}

// reportTaskProgress sends progress update to Stigmer backend.
func (a *activityInterceptor) reportTaskProgress(
	ctx context.Context,
	executionID string,
	taskName string,
	status string,
	err error,
) {
	// Create gRPC client
	client, clientErr := grpc_client.NewWorkflowExecutionClient(a.stigmerConfig)
	if clientErr != nil {
		log.Warn().Err(clientErr).Msg("Failed to create WorkflowExecutionClient for progress reporting")
		return
	}
	defer client.Close()

	// Build task status
	var taskStatus workflowexecutionv1.WorkflowTaskStatus
	switch status {
	case "started":
		taskStatus = workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS
	case "completed":
		taskStatus = workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED
	case "failed":
		taskStatus = workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED
	default:
		taskStatus = workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS
	}

	task := &workflowexecutionv1.WorkflowTask{
		TaskId:   taskName,
		TaskName: taskName,
		TaskType: workflowexecutionv1.WorkflowTaskType_WORKFLOW_TASK_CUSTOM,
		Status:   taskStatus,
	}

	if err != nil {
		task.Error = err.Error()
	}

	// Send update
	executionStatus := &workflowexecutionv1.WorkflowExecutionStatus{
		Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		Tasks: []*workflowexecutionv1.WorkflowTask{task},
	}

	_, updateErr := client.UpdateStatus(ctx, executionID, executionStatus)
	if updateErr != nil {
		log.Warn().
			Err(updateErr).
			Str("execution_id", executionID).
			Str("task_name", taskName).
			Msg("Failed to send task progress update (non-critical)")
	} else {
		log.Debug().
			Str("execution_id", executionID).
			Str("task_name", taskName).
			Str("status", status).
			Msg("Task progress reported successfully")
	}
}

// extractWorkflowExecutionID extracts the WorkflowExecutionID from activity context.
//
// The execution ID is embedded in the Temporal workflow ID by ExecuteWorkflowActivity.
// Format: "workflow-exec-{executionID}"
// Example: "workflow-exec-wex_01kf4nagdmjjjxbg63bhhm59m0"
//
// This approach works around Temporal SDK v1.38.0 API changes that made search attributes
// inaccessible from activity context in the previous way.
func extractWorkflowExecutionID(ctx context.Context) string {
	activityInfo := activity.GetInfo(ctx)

	// The Temporal workflow ID contains the execution ID
	// Format: "workflow-exec-{executionID}"
	// See: worker/activities/execute_workflow_activity.go line 267
	temporalWorkflowID := activityInfo.WorkflowExecution.ID

	if temporalWorkflowID == "" {
		log.Debug().Msg("No workflow ID found in activity context")
		return ""
	}

	// Extract execution ID from workflow ID
	// Expected format: "workflow-exec-wex_01kf4nagdmjjjxbg63bhhm59m0"
	const prefix = "workflow-exec-"
	if len(temporalWorkflowID) > len(prefix) && temporalWorkflowID[:len(prefix)] == prefix {
		executionID := temporalWorkflowID[len(prefix):]
		log.Debug().
			Str("temporal_workflow_id", temporalWorkflowID).
			Str("execution_id", executionID).
			Msg("Extracted WorkflowExecutionID from Temporal workflow ID")
		return executionID
	}

	// If the format doesn't match, log a warning but continue
	log.Warn().
		Str("temporal_workflow_id", temporalWorkflowID).
		Msgf("Temporal workflow ID doesn't match expected format '%s{executionID}'", prefix)

	return ""
}

// extractTaskName extracts the user-defined task name from activity info.
// The task name is embedded in the ActivityID by task_builder.go.
// Format: "task-{taskName}-{timestamp}"
// Example: "task-CallHTTPActivity-1234567890"
func extractTaskName(activityInfo activity.Info) string {
	activityID := activityInfo.ActivityID

	// Extract task name from ActivityID
	// Format: "task-{taskName}-{timestamp}"
	const prefix = "task-"
	if len(activityID) > len(prefix) && activityID[:len(prefix)] == prefix {
		// Remove "task-" prefix
		remainder := activityID[len(prefix):]

		// Find the last hyphen (separates task name from timestamp)
		lastHyphen := len(remainder) - 1
		for i := len(remainder) - 1; i >= 0; i-- {
			if remainder[i] == '-' {
				lastHyphen = i
				break
			}
		}

		if lastHyphen > 0 {
			taskName := remainder[:lastHyphen]
			log.Debug().
				Str("activity_id", activityID).
				Str("task_name", taskName).
				Msg("Extracted task name from ActivityID")
			return taskName
		}
	}

	// Fallback to activity type name if format doesn't match
	log.Debug().
		Str("activity_id", activityID).
		Str("activity_type", activityInfo.ActivityType.Name).
		Msg("Could not extract task name from ActivityID, using activity type")
	return activityInfo.ActivityType.Name
}

// shouldSkipProgressReporting returns true for internal activities that shouldn't
// be reported as user-facing tasks.
func shouldSkipProgressReporting(activityType string) bool {
	internalActivities := []string{
		"ExecuteWorkflow",               // Orchestration activity
		"UpdateWorkflowExecutionStatus", // Failure recovery
		"OffloadActivity",               // Claim check internal
		"RetrieveActivity",              // Claim check internal
	}

	for _, internal := range internalActivities {
		if activityType == internal {
			return true
		}
	}

	return false
}

// WorkflowContextKey is used to store WorkflowExecutionID in workflow context.
const WorkflowContextKey = "workflow_execution_id"

// InjectExecutionIDIntoWorkflow is a helper to store execution ID in workflow context.
// Call this from ExecuteServerlessWorkflow to make it available to activities.
func InjectExecutionIDIntoWorkflow(ctx workflow.Context, executionID string) workflow.Context {
	return workflow.WithValue(ctx, WorkflowContextKey, executionID)
}

// ExtractExecutionIDFromWorkflow extracts execution ID from workflow context.
func ExtractExecutionIDFromWorkflow(ctx workflow.Context) string {
	val := ctx.Value(WorkflowContextKey)
	if val == nil {
		return ""
	}
	if id, ok := val.(string); ok {
		return id
	}
	return ""
}

// StoreExecutionIDInState stores the execution ID in workflow state for activity access.
// This is used as a workaround since we can't directly pass context to activities.
func StoreExecutionIDInState(state *utils.State, executionID string) {
	if state != nil {
		state.AddData(map[string]interface{}{
			"__stigmer_execution_id": executionID,
		})
	}
}

// ExtractExecutionIDFromState retrieves execution ID from workflow state.
func ExtractExecutionIDFromState(state *utils.State) string {
	if state == nil {
		return ""
	}

	if id, ok := state.Data["__stigmer_execution_id"].(string); ok {
		return id
	}

	return ""
}
