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

package llm

import (
	"context"
	"encoding/json"
	"fmt"

	openai "github.com/sashabaranov/go-openai"
)

// OpenAIProvider wraps the OpenAI API client.
type OpenAIProvider struct {
	client *openai.Client
}

func NewOpenAIProvider(apiKey string) *OpenAIProvider {
	return &OpenAIProvider{client: openai.NewClient(apiKey)}
}

func (p *OpenAIProvider) Name() string { return "openai" }

func (p *OpenAIProvider) Call(ctx context.Context, req Request) (*Response, error) {
	messages := make([]openai.ChatCompletionMessage, 0, 2)
	if req.SystemPrompt != "" {
		messages = append(messages, openai.ChatCompletionMessage{
			Role:    openai.ChatMessageRoleSystem,
			Content: req.SystemPrompt,
		})
	}
	messages = append(messages, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleUser,
		Content: req.Prompt,
	})

	chatReq := openai.ChatCompletionRequest{
		Model:    req.Model,
		Messages: messages,
	}

	if req.Temperature > 0 {
		chatReq.Temperature = req.Temperature
	}
	if req.MaxTokens > 0 {
		chatReq.MaxTokens = int(req.MaxTokens)
	}

	if len(req.ResponseSchema) > 0 {
		chatReq.ResponseFormat = &openai.ChatCompletionResponseFormat{
			Type: openai.ChatCompletionResponseFormatTypeJSONObject,
		}
	}

	resp, err := p.client.CreateChatCompletion(ctx, chatReq)
	if err != nil {
		return nil, fmt.Errorf("OpenAI API call failed: %w", err)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("OpenAI returned no choices")
	}

	content := resp.Choices[0].Message.Content

	result := &Response{
		Content:          content,
		PromptTokens:     int64(resp.Usage.PromptTokens),
		CompletionTokens: int64(resp.Usage.CompletionTokens),
		TotalTokens:      int64(resp.Usage.TotalTokens),
	}

	if len(req.ResponseSchema) > 0 {
		var structured json.RawMessage
		if err := json.Unmarshal([]byte(content), &structured); err == nil {
			result.Structured = structured
		}
	}

	return result, nil
}
