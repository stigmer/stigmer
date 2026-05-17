/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/stigmer/stigmer/backend/services/workflow-runner/graphs/contributors>
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

package tasks

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/rs/zerolog/log"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
)

// NewCallAgentTaskBuilder creates a new task builder for AGENT_CALL tasks.
// The task must use call type "agent" in the CallFunction task.
func NewCallAgentTaskBuilder(
	temporalWorker worker.Worker,
	task *model.CallFunction,
	taskName string,
	doc *model.Workflow,
) (*CallAgentTaskBuilder, error) {
	if task.Call != customCallFunctionAgent {
		return nil, fmt.Errorf("unsupported call task '%s' for agent builder", task.Call)
	}

	return &CallAgentTaskBuilder{
		builder: builder[*model.CallFunction]{
			doc:            doc,
			name:           taskName,
			task:           task,
			temporalWorker: temporalWorker,
		},
	}, nil
}

// CallAgentTaskBuilder handles AGENT_CALL tasks.
// It parses the AgentCallTaskConfig from the CallFunction.With field,
// evaluates workflow expressions, and schedules the agent execution activity.
type CallAgentTaskBuilder struct {
	builder[*model.CallFunction]

	// Parsed agent call configuration from task.With
	agentConfig *workflowtasks.AgentCallTaskConfig
}

// Build creates a Temporal workflow function that executes an agent call.
// It parses the task configuration and delegates to the agent execution activity.
//
// ## Events-Based Approval Notification (Phase 5.1)
//
// When the child agent requires tool approval (enters WAITING_FOR_APPROVAL phase),
// the Java agent execution workflow signals this workflow via "child_approval_required".
// This function listens for that signal while waiting for the activity to complete.
//
// ## Signal Handling Pattern
//
// 1. Start agent activity (async completion pattern)
// 2. Listen for "child_approval_required" signal in parallel
// 3. When signal received: update workflow task status to WAITING_APPROVAL
// 4. Continue listening until activity completes
// 5. On completion: clear any pending approval state
func (t *CallAgentTaskBuilder) Build() (TemporalWorkflowFunc, error) {
	log.Debug().Str("task", t.GetTaskName()).Msg("Building call agent task")

	if err := t.parseConfig(); err != nil {
		log.Error().Err(err).Msg("Error parsing agent call configuration")
		return nil, err
	}

	return func(ctx workflow.Context, input any, state *utils.State) (any, error) {
		logger := workflow.GetLogger(ctx)

		// Evaluate workflow expressions in the agent config
		// This resolves things like: message: "Review ${ .fetchCode.body }"
		// But DOES NOT resolve runtime placeholders like: env: "${.secrets.TOKEN}"
		// Those are resolved JIT in the activity for security
		if err := t.evaluateExpressions(ctx, state); err != nil {
			logger.Error("Error evaluating agent task expressions", "error", err)
			return nil, fmt.Errorf("error evaluating agent task expressions: %w", err)
		}

		// Get parent workflow ID for events-based approval notification
		// The child agent will signal this workflow when it requires approval
		workflowInfo := workflow.GetInfo(ctx)
		parentWorkflowId := workflowInfo.WorkflowExecution.ID

		logger.Info("Executing agent call activity with parent workflow context",
			"agent", t.agentConfig.Agent,
			"org", t.agentConfig.Org,
			"task", t.GetTaskName(),
			"parent_workflow_id", parentWorkflowId)

		var res any
		future := workflow.ExecuteActivity(ctx, (*CallAgentActivities).CallAgentActivity,
			t.agentConfig, input, state.Env, parentWorkflowId)

		// Setup signal channel for child approval notifications
		// The Java agent execution workflow sends this signal when the agent
		// enters WAITING_FOR_APPROVAL phase
		approvalSignalCh := workflow.GetSignalChannel(ctx, SignalChildApprovalRequired)

		// Track activity completion and approval signal state (Phase 5.4 observability)
		activityDone := false
		approvalSignalCount := 0
		var receivedApprovals []*agentexecv1.PendingApproval

		// Listen for signals while waiting for activity completion
		// This follows the pattern from task_builder_listen.go
		for !activityDone {
			// Use selector to wait for either activity completion or approval signal
			selector := workflow.NewNamedSelector(ctx, "approval-or-completion")

			// Add activity future to selector
			selector.AddFuture(future, func(f workflow.Future) {
				activityDone = true
			})

			// Add signal channel to selector
			selector.AddReceive(approvalSignalCh, func(c workflow.ReceiveChannel, more bool) {
				var notification agentexecv1.ChildApprovalNotification
				c.Receive(ctx, &notification)

				approvalSignalCount++
				pendingCount := len(notification.PendingApprovals)
				firstToolName := ""
				if pendingCount > 0 {
					firstToolName = notification.PendingApprovals[0].GetToolName()
				}
				logger.Info("Received child approval notification",
					"execution_id", notification.ExecutionId,
					"pending_count", pendingCount,
					"first_tool_name", firstToolName,
					"signal_count", approvalSignalCount,
					"task", t.GetTaskName())

				receivedApprovals = append(receivedApprovals, notification.PendingApprovals...)

				// Update workflow task status to WAITING_APPROVAL
				if err := t.updateTaskApprovalStatus(ctx, state, &notification); err != nil {
					logger.Error("Failed to update task approval status",
						"error", err,
						"task", t.GetTaskName())
				}
			})

			// Wait for one of the conditions
			selector.Select(ctx)
		}

		// Activity completed - get result
		if err := future.Get(ctx, &res); err != nil {
			// Handle workflow cancellation gracefully
			if temporal.IsCanceledError(err) {
				logger.Debug("Agent call activity cancelled")
				return nil, nil
			}
			logger.Error("Agent call activity failed", "error", err)
			return nil, fmt.Errorf("agent call activity failed: %w", err)
		}

		// Clear any pending approval state on successful completion
		// Phase 5.4: Enhanced logging for observability
		t.clearTaskApprovalStatus(ctx, state, approvalSignalCount)

		// Store result in state
		state.AddData(map[string]any{
			t.GetTaskName(): res,
		})

		return res, nil
	}, nil
}

// updateTaskApprovalStatus updates the workflow task to WAITING_APPROVAL state
// and sends a status update to stigmer-service with the pending approval details.
//
// This is called when a child agent signals that it requires approval.
// The status update allows the UI to display the approval request at the
// workflow level, not just at the agent execution level.
func (t *CallAgentTaskBuilder) updateTaskApprovalStatus(
	ctx workflow.Context,
	state *utils.State,
	notification *agentexecv1.ChildApprovalNotification,
) error {
	logger := workflow.GetLogger(ctx)

	// Extract workflow execution ID from state
	// This was stored by temporal_workflow.go when the workflow started
	executionId := getExecutionIdFromState(state)
	if executionId == "" {
		logger.Warn("Workflow execution ID not found in state - cannot update approval status",
			"task", t.GetTaskName())
		return nil // Non-fatal
	}

	pendingCount := len(notification.PendingApprovals)
	logger.Info("Updating workflow task to WAITING_APPROVAL",
		"task", t.GetTaskName(),
		"execution_id", executionId,
		"agent_execution_id", notification.ExecutionId,
		"pending_count", pendingCount)

	// Execute local activity to update workflow execution status
	// Local activities run in-process without going through task queues
	localCtx := workflow.WithLocalActivityOptions(ctx, getLocalActivityOptions())

	err := workflow.ExecuteLocalActivity(localCtx,
		(*CallAgentActivities).UpdateWorkflowTaskApprovalStatus,
		executionId,
		t.GetTaskName(),
		notification,
	).Get(ctx, nil)

	if err != nil {
		logger.Error("Failed to execute UpdateWorkflowTaskApprovalStatus activity",
			"error", err,
			"task", t.GetTaskName())
		// Non-fatal: continue execution even if status update fails
		// The approval can still be submitted via the AgentExecution API
		return err
	}

	logger.Info("Successfully updated workflow task approval status",
		"task", t.GetTaskName())
	return nil
}

// clearTaskApprovalStatus clears pending approval state when the task completes
// by sending an empty list via the full-replace protocol.
func (t *CallAgentTaskBuilder) clearTaskApprovalStatus(
	ctx workflow.Context,
	state *utils.State,
	approvalSignalCount int,
) {
	logger := workflow.GetLogger(ctx)

	executionId := getExecutionIdFromState(state)
	if executionId == "" {
		logger.Debug("Workflow execution ID not found - skipping approval status clear",
			"task", t.GetTaskName())
		return
	}

	hadApprovalSignal := approvalSignalCount > 0
	logger.Info("Clearing workflow approval status after agent completion",
		"task", t.GetTaskName(),
		"execution_id", executionId,
		"had_approval_signal", hadApprovalSignal,
		"approval_signal_count", approvalSignalCount)

	localCtx := workflow.WithLocalActivityOptions(ctx, getLocalActivityOptions())

	err := workflow.ExecuteLocalActivity(localCtx,
		(*CallAgentActivities).ClearWorkflowApprovalStatus,
		executionId,
	).Get(ctx, nil)

	if err != nil {
		logger.Warn("Failed to clear workflow approval status",
			"error", err,
			"task", t.GetTaskName(),
			"had_approval_signal", hadApprovalSignal)
	} else if hadApprovalSignal {
		logger.Info("Successfully cleared workflow approval status after approval flow",
			"task", t.GetTaskName(),
			"execution_id", executionId,
			"approval_cycles", approvalSignalCount)
	}
}

// getExecutionIdFromState extracts the workflow execution ID from state.Data.
// The execution ID is stored by temporal_workflow.go when the workflow starts.
func getExecutionIdFromState(state *utils.State) string {
	if state == nil || state.Data == nil {
		return ""
	}

	if execId, ok := state.Data["__stigmer_execution_id"]; ok {
		if execIdStr, ok := execId.(string); ok {
			return execIdStr
		}
	}

	return ""
}

// parseConfig unmarshals the CallFunction.With field into AgentCallTaskConfig.
// The With field contains a JSON object matching the AgentCallTaskConfig proto.
func (t *CallAgentTaskBuilder) parseConfig() error {
	with := t.task.With

	// Normalize harness shorthand: "native"/"cursor" → proto enum names.
	// Workflow YAML uses human-friendly values; protojson expects full names.
	if h, ok := with["harness"]; ok {
		if hs, isStr := h.(string); isStr {
			switch strings.ToLower(hs) {
			case "native":
				with["harness"] = "HARNESS_NATIVE"
			case "cursor":
				with["harness"] = "HARNESS_CURSOR"
			}
		}
	}

	withBytes, err := json.Marshal(with)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	t.agentConfig = &workflowtasks.AgentCallTaskConfig{}
	if err := protojson.Unmarshal(withBytes, t.agentConfig); err != nil {
		return fmt.Errorf("failed to unmarshal agent call config: %w", err)
	}

	// Validate required fields
	if t.agentConfig.Agent == "" {
		return fmt.Errorf("agent field is required in agent call config")
	}
	if t.agentConfig.Message == "" {
		return fmt.Errorf("message field is required in agent call config")
	}

	log.Debug().
		Str("task", t.GetTaskName()).
		Str("agent", t.agentConfig.Agent).
		Msg("Agent call config parsed successfully")

	return nil
}

// evaluateExpressions evaluates workflow expressions in the agent config.
// This includes message interpolation and env var expressions (non-runtime placeholders).
//
// IMPORTANT: This does NOT evaluate runtime placeholders like ${.secrets.KEY}.
// Those are left as-is and resolved JIT in the activity to prevent secret leakage.
func (t *CallAgentTaskBuilder) evaluateExpressions(ctx workflow.Context, state *utils.State) error {
	logger := workflow.GetLogger(ctx)
	logger.Debug("Evaluating agent task expressions in workflow context")

	// 1. Evaluate message if it contains workflow expressions
	// Example: "Review this code: ${ .fetchCode.body }"
	if model.IsStrictExpr(t.agentConfig.Message) {
		evaluated, err := utils.EvaluateString(t.agentConfig.Message, nil, state)
		if err != nil {
			return fmt.Errorf("error evaluating message expression: %w", err)
		}
		if evaluatedStr, ok := evaluated.(string); ok {
			t.agentConfig.Message = evaluatedStr
		} else {
			return fmt.Errorf("message expression must evaluate to string, got %T", evaluated)
		}
	}

	// 2. Evaluate env var values (but leave runtime placeholders intact)
	// For env vars, we evaluate workflow context expressions but NOT runtime placeholders.
	// Example transformations:
	//   - "${ .workflow.var }" → evaluated value (workflow expression)
	//   - "${.secrets.TOKEN}" → left as-is (runtime placeholder, resolved in activity)
	//   - "static-value" → left as-is (static value)
	if len(t.agentConfig.Env) > 0 {
		for key, value := range t.agentConfig.Env {
			// Only evaluate if it's a ServerlessWorkflow expression (${ ... })
			// Skip runtime placeholders (${. ... }) - they're resolved in activity
			if model.IsStrictExpr(value) && !isRuntimePlaceholder(value) {
				evaluated, err := utils.EvaluateString(value, nil, state)
				if err != nil {
					return fmt.Errorf("error evaluating env[%s] expression: %w", key, err)
				}
				if evaluatedStr, ok := evaluated.(string); ok {
					t.agentConfig.Env[key] = evaluatedStr
				}
				// If not a string, leave original value
			}
		}
	}

	logger.Debug("Agent task expressions evaluated successfully")
	return nil
}

// isRuntimePlaceholder checks if a value is a runtime placeholder.
// Runtime placeholders are in the format: ${.secrets.KEY} or ${.env_vars.VAR}
// These are resolved JIT in activities, not in workflow context.
func isRuntimePlaceholder(value string) bool {
	// Runtime placeholders: ${.secrets.XXX} or ${.env_vars.XXX}
	// Workflow expressions: ${ .context.field } or ${ .data.something }
	//
	// Key distinction: runtime placeholders have NO space after ${
	// We use a simple heuristic: if it starts with ${.secrets or ${.env_vars, it's runtime
	//
	// String lengths:
	// - "${.secrets." = 11 characters (need at least 12 for a valid placeholder)
	// - "${.env_vars." = 12 characters (need at least 13 for a valid placeholder)
	const secretsPrefix = "${.secrets."
	const envVarsPrefix = "${.env_vars."

	if len(value) > len(secretsPrefix) && value[:len(secretsPrefix)] == secretsPrefix {
		return true
	}
	if len(value) > len(envVarsPrefix) && value[:len(envVarsPrefix)] == envVarsPrefix {
		return true
	}
	return false
}

// evaluateTaskArguments is required by the builder interface but not used for agent tasks.
// Agent task expression evaluation is handled in evaluateExpressions above.
// This is here to satisfy the generic builder[T] interface.
func (t *CallAgentTaskBuilder) evaluateTaskArguments(ctx workflow.Context, state *utils.State) (*model.CallFunction, error) {
	// Not used - expression evaluation happens in evaluateExpressions
	// But we need this method to satisfy the builder interface pattern
	return t.task, nil
}
