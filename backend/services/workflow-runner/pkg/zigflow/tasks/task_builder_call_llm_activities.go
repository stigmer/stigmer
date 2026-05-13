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

package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/llm"
	"go.temporal.io/sdk/activity"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &CallLlmActivities{})
}

// CallLlmActivities implements the Temporal activity for llm_call tasks.
type CallLlmActivities struct{}

// CallLlmActivity executes a direct LLM API call with optional structured
// output validation and retry logic.
//
// API keys are resolved JIT from runtimeEnv to prevent secret leakage
// into Temporal workflow history.
func (a *CallLlmActivities) CallLlmActivity(
	ctx context.Context,
	config *workflowtasks.LlmCallTaskConfig,
	input any,
	runtimeEnv map[string]any,
) (any, error) {
	logger := activity.GetLogger(ctx)

	providerName, apiModelID, err := llm.ResolveProvider(config.Model)
	if err != nil {
		return nil, err
	}

	apiKey, err := resolveAPIKey(providerName, runtimeEnv)
	if err != nil {
		return nil, err
	}

	provider, err := llm.NewProvider(providerName, apiKey)
	if err != nil {
		return nil, err
	}

	var responseSchema json.RawMessage
	if config.ResponseSchema != nil && len(config.ResponseSchema.AsMap()) > 0 {
		responseSchema, _ = json.Marshal(config.ResponseSchema.AsMap())
	}

	timeout := 60 * time.Second
	if config.Timeout > 0 {
		timeout = time.Duration(config.Timeout) * time.Second
	}

	req := llm.Request{
		Model:          apiModelID,
		SystemPrompt:   config.SystemPrompt,
		Prompt:         config.Prompt,
		Temperature:    config.Temperature,
		MaxTokens:      config.MaxTokens,
		ResponseSchema: responseSchema,
	}

	maxAttempts := int32(1)
	if config.OnInvalid == workflowtasks.OnInvalidOutputPolicy_ON_INVALID_RETRY && config.MaxRetries > 0 {
		maxAttempts = config.MaxRetries + 1
	}

	var lastResp *llm.Response
	var validationErr error

	for attempt := int32(1); attempt <= maxAttempts; attempt++ {
		callCtx, cancel := context.WithTimeout(ctx, timeout)
		resp, err := provider.Call(callCtx, req)
		cancel()

		if err != nil {
			return nil, fmt.Errorf("LLM call failed (attempt %d/%d): %w", attempt, maxAttempts, err)
		}

		lastResp = resp

		if len(responseSchema) == 0 {
			break
		}

		if resp.Structured != nil {
			schemaMap := config.ResponseSchema.AsMap()
			_, schemaErr := validateJSONSchema(schemaMap, resp.Structured)
			if schemaErr == nil {
				validationErr = nil
				break
			}
			validationErr = schemaErr
		} else {
			validationErr = fmt.Errorf("LLM did not return valid JSON for structured output")
		}

		if attempt < maxAttempts {
			logger.Warn("LLM output failed schema validation, retrying",
				"attempt", attempt,
				"error", validationErr)
			req.Prompt = fmt.Sprintf(
				"%s\n\nYour previous response failed validation: %s\nPlease correct your response to match the expected JSON schema.",
				config.Prompt, validationErr)
		}
	}

	if validationErr != nil {
		switch config.OnInvalid {
		case workflowtasks.OnInvalidOutputPolicy_ON_INVALID_FALLBACK:
			if config.FallbackTask != "" {
				output := buildLlmOutput(lastResp)
				output["__stigmer_branch_override"] = config.FallbackTask
				output["validation_error"] = validationErr.Error()
				return output, nil
			}
			return nil, fmt.Errorf("LLM output schema validation failed (no fallback_task set): %w", validationErr)

		case workflowtasks.OnInvalidOutputPolicy_ON_INVALID_RETRY:
			if config.FallbackTask != "" {
				output := buildLlmOutput(lastResp)
				output["__stigmer_branch_override"] = config.FallbackTask
				output["validation_error"] = validationErr.Error()
				return output, nil
			}
			return nil, fmt.Errorf("LLM output schema validation failed after %d attempts: %w", maxAttempts, validationErr)

		default:
			return nil, fmt.Errorf("LLM output schema validation failed: %w", validationErr)
		}
	}

	return buildLlmOutput(lastResp), nil
}

func buildLlmOutput(resp *llm.Response) map[string]any {
	output := map[string]any{
		"content": resp.Content,
		"usage": map[string]any{
			"prompt_tokens":     resp.PromptTokens,
			"completion_tokens": resp.CompletionTokens,
			"total_tokens":      resp.TotalTokens,
			"cost_micros":       resp.CostMicros,
		},
		"__stigmer_cost_micros": resp.CostMicros,
		"__stigmer_tokens":      int64(resp.TotalTokens),
	}

	if resp.Structured != nil {
		var parsed any
		if json.Unmarshal(resp.Structured, &parsed) == nil {
			output["structured"] = parsed
		}
	}

	return output
}

// resolveAPIKey extracts the LLM provider's API key from the runtime environment.
// Convention: OPENAI_API_KEY for OpenAI, ANTHROPIC_API_KEY for Anthropic.
func resolveAPIKey(providerName string, runtimeEnv map[string]any) (string, error) {
	keyNames := map[string]string{
		"openai":    "OPENAI_API_KEY",
		"anthropic": "ANTHROPIC_API_KEY",
	}

	envKey, ok := keyNames[providerName]
	if !ok {
		return "", fmt.Errorf("no API key convention for provider '%s'", providerName)
	}

	if runtimeEnv == nil {
		return "", fmt.Errorf("%s not found in runtime environment (env is nil)", envKey)
	}

	val, exists := runtimeEnv[envKey]
	if !exists {
		return "", fmt.Errorf("%s not found in runtime environment", envKey)
	}

	if valueMap, ok := val.(map[string]interface{}); ok {
		if v, ok := valueMap["value"].(string); ok {
			return v, nil
		}
	}
	if s, ok := val.(string); ok {
		return s, nil
	}

	return "", fmt.Errorf("%s has invalid format in runtime environment", envKey)
}
