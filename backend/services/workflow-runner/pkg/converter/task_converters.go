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

package converter

import (
	"time"

	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
)

// Type-safe task converters for Phase 3.
//
// These methods convert typed proto messages to YAML-compatible map structures.
// They provide compile-time type safety and better error messages compared to
// the generic map-based approach.

// convertSetTask converts SetTaskConfig to YAML structure
func (c *Converter) convertSetTask(cfg *tasksv1.SetTaskConfig) map[string]interface{} {
	return map[string]interface{}{
		"set": cfg.Variables,
	}
}

// convertHttpCallTask converts HttpCallTaskConfig to YAML structure
func (c *Converter) convertHttpCallTask(cfg *tasksv1.HttpCallTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"method": cfg.Method,
	}

	// Add endpoint (required)
	if cfg.Endpoint != nil {
		endpoint := map[string]interface{}{
			"uri": cfg.Endpoint.Uri,
		}
		with["endpoint"] = endpoint
	}

	// Add optional headers at task level (not endpoint level)
	if len(cfg.Headers) > 0 {
		with["headers"] = cfg.Headers
	}

	// Add optional fields
	if cfg.TimeoutSeconds > 0 {
		with["timeout_seconds"] = cfg.TimeoutSeconds
	}
	if cfg.Body != nil && len(cfg.Body.AsMap()) > 0 {
		with["body"] = cfg.Body.AsMap()
	}

	return map[string]interface{}{
		"call": "http",
		"with": with,
	}
}

// convertGrpcCallTask converts GrpcCallTaskConfig to YAML structure
func (c *Converter) convertGrpcCallTask(cfg *tasksv1.GrpcCallTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"service": cfg.Service,
		"method":  cfg.Method,
	}

	// Add optional request field
	if cfg.Request != nil && len(cfg.Request.AsMap()) > 0 {
		with["request"] = cfg.Request.AsMap()
	}

	return map[string]interface{}{
		"call": "grpc",
		"with": with,
	}
}

// convertSwitchTask converts SwitchTaskConfig to YAML structure
func (c *Converter) convertSwitchTask(cfg *tasksv1.SwitchTaskConfig) map[string]interface{} {
	// Convert cases
	cases := make([]map[string]interface{}, len(cfg.Cases))
	for i, switchCase := range cfg.Cases {
		caseMap := map[string]interface{}{}
		if switchCase.Name != "" {
			caseMap["name"] = switchCase.Name
		}
		if switchCase.When != "" {
			caseMap["when"] = switchCase.When
		}
		if switchCase.Then != "" {
			caseMap["then"] = switchCase.Then
		}
		cases[i] = caseMap
	}

	return map[string]interface{}{
		"switch": map[string]interface{}{
			"cases": cases,
		},
	}
}

// convertForTask converts ForTaskConfig to YAML structure
// Note: For tasks have nested WorkflowTask arrays which need special handling
func (c *Converter) convertForTask(cfg *tasksv1.ForTaskConfig) map[string]interface{} {
	forMap := map[string]interface{}{
		"in": cfg.In,
	}

	// Add optional fields
	if cfg.Each != "" {
		forMap["each"] = cfg.Each
	}
	// Note: cfg.Do is []*WorkflowTask - would need recursive conversion
	// For now, this is handled by the existing generic converter logic

	return map[string]interface{}{
		"for": forMap,
	}
}

// convertForkTask converts ForkTaskConfig to YAML structure
// Note: Fork tasks have nested WorkflowTask arrays which need special handling
func (c *Converter) convertForkTask(cfg *tasksv1.ForkTaskConfig) map[string]interface{} {
	// Convert branches
	branches := make([]map[string]interface{}, len(cfg.Branches))
	for i, branch := range cfg.Branches {
		branchMap := map[string]interface{}{
			"name": branch.Name,
		}
		// Note: branch.Do is []*WorkflowTask - would need recursive conversion
		// For now, this is handled by the existing generic converter logic
		branches[i] = branchMap
	}

	return map[string]interface{}{
		"fork": map[string]interface{}{
			"branches": branches,
		},
	}
}

// convertTryTask converts TryTaskConfig to YAML structure
// Note: Try tasks have nested WorkflowTask arrays which need special handling
func (c *Converter) convertTryTask(cfg *tasksv1.TryTaskConfig) map[string]interface{} {
	tryMap := map[string]interface{}{}
	// Note: cfg.Try is []*WorkflowTask - would need recursive conversion
	// For now, this is handled by the existing generic converter logic

	// Add catch block if present (single block, not array)
	if cfg.Catch != nil {
		catchMap := map[string]interface{}{}
		if cfg.Catch.As != "" {
			catchMap["as"] = cfg.Catch.As
		}
		// Note: cfg.Catch.Do is []*WorkflowTask - would need recursive conversion
		tryMap["catch"] = catchMap
	}

	return map[string]interface{}{
		"try": tryMap,
	}
}

// convertListenTask converts ListenTaskConfig to YAML structure
// Note: Listen tasks have a nested ListenTo structure
func (c *Converter) convertListenTask(cfg *tasksv1.ListenTaskConfig) map[string]interface{} {
	// Note: cfg.To is *ListenTo - would need to be converted based on its structure
	// For now, this is handled by the existing generic converter logic
	return map[string]interface{}{
		"listen": map[string]interface{}{},
	}
}

// convertWaitTask converts WaitTaskConfig to YAML structure.
//
// Supports two wait types:
//   - Duration: relative wait (e.g., { days: 7 } = wait 1 week)
//   - Until: absolute timestamp (e.g., wait until "2026-03-01T09:00:00Z")
//
// The Serverless Workflow SDK accepts either:
//   - Duration object: { days: N, hours: N, minutes: N, seconds: N, milliseconds: N }
//   - ISO 8601 timestamp string for absolute waits
func (c *Converter) convertWaitTask(cfg *tasksv1.WaitTaskConfig) map[string]interface{} {
	switch w := cfg.GetWaitType().(type) {
	case *tasksv1.WaitTaskConfig_Duration:
		// Relative duration: convert to SDK Duration structure
		// Only include non-zero fields to keep YAML clean
		duration := make(map[string]interface{})
		if w.Duration.GetDays() > 0 {
			duration["days"] = w.Duration.GetDays()
		}
		if w.Duration.GetHours() > 0 {
			duration["hours"] = w.Duration.GetHours()
		}
		if w.Duration.GetMinutes() > 0 {
			duration["minutes"] = w.Duration.GetMinutes()
		}
		if w.Duration.GetSeconds() > 0 {
			duration["seconds"] = w.Duration.GetSeconds()
		}
		if w.Duration.GetMilliseconds() > 0 {
			duration["milliseconds"] = w.Duration.GetMilliseconds()
		}
		return map[string]interface{}{
			"wait": duration,
		}

	case *tasksv1.WaitTaskConfig_Until:
		// Absolute timestamp: convert to ISO 8601 string
		// The SDK accepts RFC3339 format for absolute waits
		return map[string]interface{}{
			"wait": w.Until.AsTime().Format(time.RFC3339),
		}

	default:
		// Fallback: zero duration (should not happen with validation)
		return map[string]interface{}{
			"wait": map[string]interface{}{"seconds": 0},
		}
	}
}

// convertRaiseTask converts RaiseTaskConfig to YAML structure
func (c *Converter) convertRaiseTask(cfg *tasksv1.RaiseTaskConfig) map[string]interface{} {
	raiseMap := map[string]interface{}{
		"error": cfg.Error,
	}

	// Add optional message
	if cfg.Message != "" {
		raiseMap["message"] = cfg.Message
	}

	return map[string]interface{}{
		"raise": raiseMap,
	}
}

// convertRunTask converts RunTaskConfig to YAML structure
func (c *Converter) convertRunTask(cfg *tasksv1.RunTaskConfig) map[string]interface{} {
	run := map[string]interface{}{
		"workflow": cfg.Workflow,
	}

	// Add optional input
	if cfg.Input != nil && len(cfg.Input.AsMap()) > 0 {
		run["with"] = cfg.Input.AsMap()
	}

	return map[string]interface{}{
		"run": run,
	}
}

// convertLlmCallTask converts LlmCallTaskConfig to YAML structure.
// Maps to call: "llm" with the LLM-specific configuration.
func (c *Converter) convertLlmCallTask(cfg *tasksv1.LlmCallTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"model":  cfg.Model,
		"prompt": cfg.Prompt,
	}

	if cfg.SystemPrompt != "" {
		with["system_prompt"] = cfg.SystemPrompt
	}
	if cfg.ResponseSchema != nil && len(cfg.ResponseSchema.AsMap()) > 0 {
		with["response_schema"] = cfg.ResponseSchema.AsMap()
	}
	if cfg.Temperature != 0 {
		with["temperature"] = cfg.Temperature
	}
	if cfg.MaxTokens > 0 {
		with["max_tokens"] = cfg.MaxTokens
	}
	if cfg.Timeout > 0 {
		with["timeout"] = cfg.Timeout
	}
	if cfg.OnInvalid != tasksv1.OnInvalidOutputPolicy_ON_INVALID_POLICY_UNSPECIFIED {
		with["on_invalid"] = cfg.OnInvalid.String()
	}
	if cfg.MaxRetries > 0 {
		with["max_retries"] = cfg.MaxRetries
	}
	if cfg.FallbackTask != "" {
		with["fallback_task"] = cfg.FallbackTask
	}
	if cfg.MaxCostMicros > 0 {
		with["max_cost_micros"] = cfg.MaxCostMicros
	}
	if cfg.MaxTotalTokens > 0 {
		with["max_total_tokens"] = cfg.MaxTotalTokens
	}

	return map[string]interface{}{
		"call": "llm",
		"with": with,
	}
}

// convertTransformTask converts TransformTaskConfig to YAML structure.
// Maps to call: "transform" with engine, expression, and optional input.
func (c *Converter) convertTransformTask(cfg *tasksv1.TransformTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"engine":     cfg.Engine.String(),
		"expression": cfg.Expression,
	}

	if cfg.Input != "" {
		with["input"] = cfg.Input
	}

	return map[string]interface{}{
		"call": "transform",
		"with": with,
	}
}

// convertHumanInputTask converts HumanInputTaskConfig to YAML structure.
// Maps to call: "human_input" with approval gate configuration.
func (c *Converter) convertHumanInputTask(cfg *tasksv1.HumanInputTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"prompt": cfg.Prompt,
	}

	if cfg.FormSchema != nil && len(cfg.FormSchema.AsMap()) > 0 {
		with["form_schema"] = cfg.FormSchema.AsMap()
	}
	if len(cfg.Outcomes) > 0 {
		outcomes := make([]map[string]interface{}, 0, len(cfg.Outcomes))
		for _, o := range cfg.Outcomes {
			om := map[string]interface{}{"name": o.Name}
			if o.Label != "" {
				om["label"] = o.Label
			}
			if o.Then != "" {
				om["then"] = o.Then
			}
			outcomes = append(outcomes, om)
		}
		with["outcomes"] = outcomes
	}
	if len(cfg.Approvers) > 0 {
		with["approvers"] = cfg.Approvers
	}
	if cfg.Timeout > 0 {
		with["timeout"] = cfg.Timeout
	}
	if cfg.OnTimeout != tasksv1.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_POLICY_UNSPECIFIED {
		with["on_timeout"] = cfg.OnTimeout.String()
	}
	if len(cfg.NotificationChannels) > 0 {
		with["notification_channels"] = cfg.NotificationChannels
	}

	return map[string]interface{}{
		"call": "human_input",
		"with": with,
	}
}

// convertValidateTask converts ValidateTaskConfig to YAML structure.
// Maps to call: "validate" with schema and business rule configuration.
func (c *Converter) convertValidateTask(cfg *tasksv1.ValidateTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"input": cfg.Input,
	}

	if cfg.Schema != nil && len(cfg.Schema.AsMap()) > 0 {
		with["schema"] = cfg.Schema.AsMap()
	}
	if len(cfg.Rules) > 0 {
		rules := make([]map[string]interface{}, 0, len(cfg.Rules))
		for _, r := range cfg.Rules {
			rm := map[string]interface{}{
				"name":       r.Name,
				"expression": r.Expression,
			}
			if r.Message != "" {
				rm["message"] = r.Message
			}
			rules = append(rules, rm)
		}
		with["rules"] = rules
	}
	if cfg.OnFail != tasksv1.ValidationFailPolicy_VALIDATION_FAIL_POLICY_UNSPECIFIED {
		with["on_fail"] = cfg.OnFail.String()
	}
	if cfg.FallbackTask != "" {
		with["fallback_task"] = cfg.FallbackTask
	}

	return map[string]interface{}{
		"call": "validate",
		"with": with,
	}
}

// convertEmitEventTask converts EmitEventTaskConfig to YAML structure.
// Maps to call: "emit_event" with the CloudEvents envelope specification.
func (c *Converter) convertEmitEventTask(cfg *tasksv1.EmitEventTaskConfig) map[string]interface{} {
	event := map[string]interface{}{
		"type": cfg.Event.Type,
	}

	if cfg.Event.Source != "" {
		event["source"] = cfg.Event.Source
	}
	if cfg.Event.Subject != "" {
		event["subject"] = cfg.Event.Subject
	}
	if cfg.Event.Data != nil && len(cfg.Event.Data.AsMap()) > 0 {
		event["data"] = cfg.Event.Data.AsMap()
	}

	return map[string]interface{}{
		"call": "emit_event",
		"with": map[string]interface{}{
			"event": event,
		},
	}
}

// convertNotificationTask converts NotificationTaskConfig to YAML structure.
// Maps to call: "notification" with channel, recipients, and content.
func (c *Converter) convertNotificationTask(cfg *tasksv1.NotificationTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"channel":    cfg.Channel,
		"recipients": cfg.Recipients,
		"body":       cfg.Body,
	}

	if cfg.Subject != "" {
		with["subject"] = cfg.Subject
	}
	if cfg.Template != "" {
		with["template"] = cfg.Template
	}
	if len(cfg.Metadata) > 0 {
		with["metadata"] = cfg.Metadata
	}

	return map[string]interface{}{
		"call": "notification",
		"with": with,
	}
}

// convertAgentCallTask converts AgentCallTaskConfig to YAML structure
func (c *Converter) convertAgentCallTask(cfg *tasksv1.AgentCallTaskConfig) map[string]interface{} {
	with := map[string]interface{}{
		"agent":   cfg.Agent,
		"message": cfg.Message,
	}

	// Add env variables if present
	if len(cfg.Env) > 0 {
		with["env"] = cfg.Env
	}

	// Add config if present
	if cfg.Config != nil {
		config := map[string]interface{}{}
		if cfg.Config.Model != "" {
			config["model"] = cfg.Config.Model
		}
		if cfg.Config.Timeout > 0 {
			config["timeout"] = cfg.Config.Timeout
		}
		if cfg.Config.Temperature != 0 {
			config["temperature"] = cfg.Config.Temperature
		}
		if len(config) > 0 {
			with["config"] = config
		}
	}

	return map[string]interface{}{
		"call": "agent",
		"with": with,
	}
}
