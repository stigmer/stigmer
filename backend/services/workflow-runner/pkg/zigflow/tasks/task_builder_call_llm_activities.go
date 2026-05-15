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
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/liushuangls/go-anthropic/v2"
	openai "github.com/sashabaranov/go-openai"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"go.temporal.io/sdk/activity"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &CallLlmActivities{})
}

type CallLlmActivities struct{}

// CallLlmActivity makes a direct LLM API call without agent overhead.
// Determines the provider from the model name, calls the appropriate SDK,
// and returns the result with usage metadata.
func (a *CallLlmActivities) CallLlmActivity(
	ctx context.Context,
	cfg *workflowtasks.LlmCallTaskConfig,
) (any, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Starting LLM call activity", "model", cfg.Model)

	provider := resolveProvider(cfg.Model)

	timeout := 60 * time.Second
	if cfg.Timeout > 0 {
		timeout = time.Duration(cfg.Timeout) * time.Second
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var result map[string]any
	var err error

	switch provider {
	case "anthropic":
		result, err = callAnthropic(callCtx, cfg)
	case "openai":
		result, err = callOpenAI(callCtx, cfg)
	default:
		return nil, fmt.Errorf("unsupported LLM provider for model %q: could not determine provider (expected claude-* or gpt-*)", cfg.Model)
	}

	if err != nil {
		logger.Error("LLM call failed", "model", cfg.Model, "provider", provider, "error", err)
		return nil, fmt.Errorf("llm call failed (%s/%s): %w", provider, cfg.Model, err)
	}

	result["model"] = cfg.Model
	result["provider"] = provider

	logger.Info("LLM call completed",
		"model", cfg.Model,
		"provider", provider,
		"input_tokens", result["input_tokens"],
		"output_tokens", result["output_tokens"])

	return result, nil
}

func resolveProvider(model string) string {
	m := strings.ToLower(model)
	if strings.HasPrefix(m, "claude") {
		return "anthropic"
	}
	if strings.HasPrefix(m, "gpt") || strings.HasPrefix(m, "o1") || strings.HasPrefix(m, "o3") || strings.HasPrefix(m, "o4") {
		return "openai"
	}
	return ""
}

func callAnthropic(ctx context.Context, cfg *workflowtasks.LlmCallTaskConfig) (map[string]any, error) {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("ANTHROPIC_API_KEY environment variable is required for model %q", cfg.Model)
	}

	client := anthropic.NewClient(apiKey)

	messages := []anthropic.Message{
		{
			Role:    anthropic.RoleUser,
			Content: []anthropic.MessageContent{anthropic.NewTextMessageContent(cfg.Prompt)},
		},
	}

	maxTokens := 1024
	if cfg.MaxTokens > 0 {
		maxTokens = int(cfg.MaxTokens)
	}

	req := anthropic.MessagesRequest{
		Model:     anthropic.Model(cfg.Model),
		Messages:  messages,
		MaxTokens: maxTokens,
	}

	if cfg.SystemPrompt != "" {
		req.System = cfg.SystemPrompt
	}

	if cfg.Temperature > 0 {
		temp := float32(cfg.Temperature)
		req.Temperature = &temp
	}

	wantJSON := cfg.ResponseSchema != nil && len(cfg.ResponseSchema.AsMap()) > 0

	resp, err := client.CreateMessages(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("anthropic API error: %w", err)
	}

	var textContent string
	for _, block := range resp.Content {
		if block.Type == anthropic.MessagesContentTypeText {
			if block.Text != nil {
				textContent = *block.Text
			}
		}
	}

	result := map[string]any{
		"input_tokens":  resp.Usage.InputTokens,
		"output_tokens": resp.Usage.OutputTokens,
	}

	if wantJSON {
		var parsed any
		if err := json.Unmarshal([]byte(textContent), &parsed); err != nil {
			result["result"] = textContent
			result["parse_error"] = err.Error()
		} else {
			result["result"] = parsed
		}
	} else {
		result["result"] = textContent
	}

	return result, nil
}

func callOpenAI(ctx context.Context, cfg *workflowtasks.LlmCallTaskConfig) (map[string]any, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY environment variable is required for model %q", cfg.Model)
	}

	client := openai.NewClient(apiKey)

	messages := []openai.ChatCompletionMessage{}

	if cfg.SystemPrompt != "" {
		messages = append(messages, openai.ChatCompletionMessage{
			Role:    openai.ChatMessageRoleSystem,
			Content: cfg.SystemPrompt,
		})
	}

	messages = append(messages, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleUser,
		Content: cfg.Prompt,
	})

	req := openai.ChatCompletionRequest{
		Model:    cfg.Model,
		Messages: messages,
	}

	if cfg.MaxTokens > 0 {
		req.MaxTokens = int(cfg.MaxTokens)
	}

	if cfg.Temperature > 0 {
		req.Temperature = cfg.Temperature
	}

	wantJSON := cfg.ResponseSchema != nil && len(cfg.ResponseSchema.AsMap()) > 0
	if wantJSON {
		req.ResponseFormat = &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONObject,
		}
	}

	resp, err := client.CreateChatCompletion(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("openai API error: %w", err)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("openai returned zero choices")
	}

	textContent := resp.Choices[0].Message.Content

	result := map[string]any{
		"input_tokens":  resp.Usage.PromptTokens,
		"output_tokens": resp.Usage.CompletionTokens,
	}

	if wantJSON {
		var parsed any
		if err := json.Unmarshal([]byte(textContent), &parsed); err != nil {
			result["result"] = textContent
			result["parse_error"] = err.Error()
		} else {
			result["result"] = parsed
		}
	} else {
		result["result"] = textContent
	}

	return result, nil
}
