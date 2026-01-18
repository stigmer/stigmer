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
	tasksv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
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

// convertWaitTask converts WaitTaskConfig to YAML structure
func (c *Converter) convertWaitTask(cfg *tasksv1.WaitTaskConfig) map[string]interface{} {
	return map[string]interface{}{
		"wait": cfg.Seconds,
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
