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
	"encoding/json"
	"fmt"
	"time"

	"github.com/serverlessworkflow/sdk-go/v3/model"
	wfexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/budget"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/claimcheck"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/events"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/types"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/zigflow"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/zigflow/tasks"
	"go.temporal.io/sdk/log"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ExecuteServerlessWorkflow is the generic Temporal workflow that can execute
// any CNCF Serverless Workflow definition passed as input.
//
// This is the core innovation of Phase 3: instead of registering each serverless
// workflow individually with Temporal (which would require redeployment), we have
// ONE generic workflow that dynamically executes ANY serverless workflow YAML.
//
// Flow:
//  1. Receive workflow YAML as input (runtime, not file-based)
//  2. Parse YAML into serverless workflow definition
//  3. Build task executor dynamically using Zigflow
//  4. Execute tasks with state management
//  5. Return results
func ExecuteServerlessWorkflow(ctx workflow.Context, input *types.TemporalWorkflowInput) (*types.TemporalWorkflowOutput, error) {
	logger := workflow.GetLogger(ctx)

	// Handle nil metadata gracefully
	workflowName := ""
	workflowNamespace := ""
	if input.Metadata != nil {
		workflowName = input.Metadata.Name
		workflowNamespace = input.Metadata.Namespace
	}

	logger.Info("Starting serverless workflow execution",
		"execution_id", input.WorkflowExecutionID,
		"workflow_name", workflowName,
		"workflow_namespace", workflowNamespace)

	// Set WorkflowExecutionID as a search attribute so activities can access it
	// This enables the progress reporting interceptor to extract the execution ID
	// from activity context without needing to modify activity signatures.
	err := workflow.UpsertSearchAttributes(ctx, map[string]interface{}{
		"WorkflowExecutionID": input.WorkflowExecutionID,
	})
	if err != nil {
		logger.Warn("Failed to set WorkflowExecutionID search attribute (non-critical)", "error", err)
	} else {
		logger.Debug("WorkflowExecutionID stored in search attributes", "execution_id", input.WorkflowExecutionID)
	}

	// Note: Progress reporting is now handled by the Activity Interceptor
	// which reports progress for each Zigflow activity execution automatically.
	// This keeps the Temporal UI clean (only user tasks visible) while still
	// providing granular progress updates to stigmer-service.

	// Parse workflow YAML
	workflowDef, err := zigflow.LoadFromString(input.WorkflowYaml)
	if err != nil {
		logger.Error("Failed to parse workflow YAML",
			"error", err,
			"execution_id", input.WorkflowExecutionID,
			"yaml_length", len(input.WorkflowYaml))
		return nil, fmt.Errorf("failed to parse workflow YAML: %w", err)
	}

	logger.Info("Workflow YAML parsed successfully",
		"workflow_name", workflowDef.Document.Name,
		"workflow_version", workflowDef.Document.Version)

	// Initialize workflow state
	state := utils.NewState()
	if input.InitialData != nil {
		state.AddData(input.InitialData)
		logger.Debug("Added initial data to state", "initial_data", input.InitialData)
	}

	// Add environment variables to state if provided
	if input.EnvVars != nil {
		// EnvVars are handled separately in state
		logger.Debug("Environment variables provided", "env_count", len(input.EnvVars))
	}

	// Store original Temporal workflow input for continue-as-new
	// This is critical: when continue-as-new is triggered from within Zigflow tasks,
	// we need to reconstruct the full TemporalWorkflowInput structure
	state.TemporalWorkflowCtx = input

	// Store WorkflowExecutionID and OrgId in state for activity access
	// This allows activities to access execution metadata without explicit parameter passing
	state.AddData(map[string]interface{}{
		"__stigmer_execution_id":             input.WorkflowExecutionID,
		"__stigmer_org_id":                   input.OrgId,
		"__stigmer_invoker_identity_account": input.InvokerIdentityAccountID,
	})

	logger.Debug("Workflow execution context",
		"execution_id", input.WorkflowExecutionID,
		"org_id", input.OrgId)

	// Add org ID to env vars so activities can access it
	// Activities receive state.Env as the runtimeEnv parameter
	envVars := input.EnvVars
	if envVars == nil {
		envVars = make(map[string]any)
	}
	// Add org ID as a special env var (prefixed with __ to avoid conflicts with user-defined env vars)
	envVars["__stigmer_org_id"] = input.OrgId

	// Set state.Env so activities can access runtime environment (including org ID)
	state.Env = envVars

	// Initialize event emitter and budget tracker
	emitter := events.NewEmitter(0)
	tracker := budget.NewTracker(input.Budget, workflow.Now(ctx))
	executionStartTime := workflow.Now(ctx)

	taskCount := int32(0)
	if workflowDef.Do != nil {
		taskCount = int32(len(*workflowDef.Do))
	}

	// Build task executor from workflow definition using Zigflow
	taskBuilder, err := tasks.NewDoTaskBuilder(
		nil, // worker - not needed inside workflow execution
		&model.DoTask{Do: workflowDef.Do},
		workflowDef.Document.Name,
		workflowDef,
		tasks.DoTaskOpts{
			DisableRegisterWorkflow: true,
			Envvars:                 envVars,
			MaxHistoryLength:        0,
			Emitter:                 emitter,
			BudgetTracker:           tracker,
			ExecutionID:             input.WorkflowExecutionID,
			WorkflowID:              input.WorkflowID,
			WorkflowInstanceID:      input.WorkflowInstanceID,
		},
	)
	if err != nil {
		logger.Error("Failed to create task builder", "error", err)
		return nil, fmt.Errorf("failed to create task builder: %w", err)
	}

	workflowFunc, err := taskBuilder.Build()
	if err != nil {
		logger.Error("Failed to build workflow", "error", err)
		return nil, fmt.Errorf("failed to build workflow: %w", err)
	}

	logger.Info("Starting workflow task execution", "task_count", taskCount)

	// Emit execution_started event
	startedEvent := emitter.ExecutionStarted(
		workflow.Now(ctx), taskCount, input.WorkflowID, input.WorkflowInstanceID,
	)
	flushLifecycleEvents(ctx, input.WorkflowExecutionID, startedEvent)

	// Execute workflow tasks
	result, err := workflowFunc(ctx, input.InitialData, state)
	if err != nil {
		durationMs := workflow.Now(ctx).Sub(executionStartTime).Milliseconds()
		failedEvent := emitter.ExecutionFailed(workflow.Now(ctx), err.Error(), "", durationMs)
		flushLifecycleEvents(ctx, input.WorkflowExecutionID, failedEvent)

		logger.Error("Workflow execution failed", "error", err)
		return nil, fmt.Errorf("workflow execution failed: %w", err)
	}

	// Emit execution_completed event
	durationMs := workflow.Now(ctx).Sub(executionStartTime).Milliseconds()
	completedEvent := emitter.ExecutionCompleted(
		workflow.Now(ctx), durationMs,
		tracker.CostMicros, tracker.TotalTokens,
		nil,
	)
	flushLifecycleEvents(ctx, input.WorkflowExecutionID, completedEvent)

	logger.Info("Workflow execution completed successfully",
		"execution_id", input.WorkflowExecutionID,
		"workflow_name", workflowDef.Document.Name,
		"duration_ms", durationMs,
		"cost_micros", tracker.CostMicros,
		"total_tokens", tracker.TotalTokens)

	// Phase 4: Apply Claim Check to large results if enabled
	finalResult := result
	finalState := state.Data
	if claimcheck.IsEnabled() {
		logger.Info("Claim Check enabled - checking result sizes")

		// Handle large result
		resultData, err := serializeToBytes(result)
		if err == nil {
			processedResult, err := processWithClaimCheck(ctx, resultData, "result", logger)
			if err != nil {
				logger.Warn("Failed to process result with Claim Check", "error", err)
			} else {
				finalResult = processedResult
			}
		}

		// Handle large state
		stateData, err := serializeToBytes(state.Data)
		if err == nil {
			processedState, err := processWithClaimCheck(ctx, stateData, "state", logger)
			if err != nil {
				logger.Warn("Failed to process state with Claim Check", "error", err)
			} else {
				// Convert back to map if it's a reference
				if stateMap, ok := processedState.(map[string]any); ok {
					finalState = stateMap
				}
			}
		}
	}

	// Return results
	output := &types.TemporalWorkflowOutput{
		Result:        finalResult,
		FinalState:    finalState,
		WorkflowName:  workflowDef.Document.Name,
		ExecutionID:   input.WorkflowExecutionID,
		ExecutionTime: workflow.Now(ctx),
	}

	return output, nil
}

// serializeToBytes converts any value to bytes for Claim Check processing
func serializeToBytes(value any) ([]byte, error) {
	if data, ok := value.([]byte); ok {
		return data, nil
	}
	return json.Marshal(value)
}

// flushLifecycleEvents sends lifecycle events to the backend via activity.
func flushLifecycleEvents(ctx workflow.Context, executionID string, evts ...*wfexecv1.WorkflowExecutionEvent) {
	if len(evts) == 0 || executionID == "" {
		return
	}

	flushCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 2,
		},
	})

	input := &tasks.FlushEventsInput{
		ExecutionID: executionID,
		Events:      evts,
	}

	err := workflow.ExecuteActivity(flushCtx, tasks.FlushEventsActivity, input).Get(ctx, nil)
	if err != nil {
		logger := workflow.GetLogger(ctx)
		logger.Warn("Failed to flush lifecycle events (non-critical)",
			"execution_id", executionID,
			"event_count", len(evts),
			"error", err)
	}
}

// processWithClaimCheck processes data with Claim Check if it exceeds threshold
func processWithClaimCheck(ctx workflow.Context, data []byte, name string, logger log.Logger) (any, error) {
	mgr := claimcheck.GetGlobalManager()
	if mgr == nil {
		return data, nil
	}

	logger.Info("Processing with Claim Check",
		"name", name,
		"size_bytes", len(data))

	// MaybeOffload will return ClaimCheckRef if data exceeds threshold
	// or return original data if below threshold
	processed, err := mgr.MaybeOffload(ctx, data)
	if err != nil {
		return nil, fmt.Errorf("claim check offload failed: %w", err)
	}

	// Check if it was offloaded (returns ClaimCheckRef)
	if ref, ok := processed.(claimcheck.ClaimCheckRef); ok {
		logger.Info("Data offloaded to storage",
			"name", name,
			"key", ref.Key,
			"original_size", ref.SizeBytes,
			"compressed", ref.Compressed)
	} else {
		logger.Debug("Data below threshold, keeping in state",
			"name", name,
			"size_bytes", len(data))
	}

	return processed, nil
}
