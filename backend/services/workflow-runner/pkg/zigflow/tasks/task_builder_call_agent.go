/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/graphs/contributors>
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

	"github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/utils"
	"github.com/rs/zerolog/log"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
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
	agentConfig *tasks.AgentCallTaskConfig
}

// Build creates a Temporal workflow function that executes an agent call.
// It parses the task configuration and delegates to the agent execution activity.
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

		logger.Info("Executing agent call activity",
			"agent", t.agentConfig.Agent,
			"scope", t.agentConfig.Scope,
			"task", t.GetTaskName())

		return t.executeActivity(ctx, (*CallAgentActivities).CallAgentActivity, input, state)
	}, nil
}

// parseConfig unmarshals the CallFunction.With field into AgentCallTaskConfig.
// The With field contains a JSON object matching the AgentCallTaskConfig proto.
func (t *CallAgentTaskBuilder) parseConfig() error {
	// Convert With (map[string]any) to JSON
	withBytes, err := json.Marshal(t.task.With)
	if err != nil {
		return fmt.Errorf("failed to marshal task.With: %w", err)
	}

	// Unmarshal into AgentCallTaskConfig
	t.agentConfig = &tasks.AgentCallTaskConfig{}
	if err := json.Unmarshal(withBytes, t.agentConfig); err != nil {
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
	return len(value) > 10 && value[:11] == "${.secrets." ||
		len(value) > 12 && value[:13] == "${.env_vars."
}

// evaluateTaskArguments is required by the builder interface but not used for agent tasks.
// Agent task expression evaluation is handled in evaluateExpressions above.
// This is here to satisfy the generic builder[T] interface.
func (t *CallAgentTaskBuilder) evaluateTaskArguments(ctx workflow.Context, state *utils.State) (*model.CallFunction, error) {
	// Not used - expression evaluation happens in evaluateExpressions
	// But we need this method to satisfy the builder interface pattern
	return t.task, nil
}
