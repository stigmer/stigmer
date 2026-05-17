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

	anthropic "github.com/liushuangls/go-anthropic/v2"
)

// AnthropicProvider wraps the Anthropic API client.
type AnthropicProvider struct {
	client *anthropic.Client
}

func NewAnthropicProvider(apiKey string) *AnthropicProvider {
	return &AnthropicProvider{client: anthropic.NewClient(apiKey)}
}

func (p *AnthropicProvider) Name() string { return "anthropic" }

func (p *AnthropicProvider) Call(ctx context.Context, req Request) (*Response, error) {
	messages := []anthropic.Message{
		{
			Role:    anthropic.RoleUser,
			Content: []anthropic.MessageContent{{Type: anthropic.MessagesContentTypeText, Text: &req.Prompt}},
		},
	}

	msgReq := anthropic.MessagesRequest{
		Model:    anthropic.Model(req.Model),
		Messages: messages,
	}

	if req.SystemPrompt != "" {
		msgReq.System = req.SystemPrompt
	}
	if req.Temperature > 0 {
		temp := float32(req.Temperature)
		msgReq.Temperature = &temp
	}
	if req.MaxTokens > 0 {
		msgReq.MaxTokens = int(req.MaxTokens)
	} else {
		msgReq.MaxTokens = 4096
	}

	resp, err := p.client.CreateMessages(ctx, msgReq)
	if err != nil {
		return nil, fmt.Errorf("Anthropic API call failed: %w", err)
	}

	var content string
	for _, block := range resp.Content {
		if block.Type == anthropic.MessagesContentTypeText && block.Text != nil {
			content += *block.Text
		}
	}

	result := &Response{
		Content:          content,
		PromptTokens:     int64(resp.Usage.InputTokens),
		CompletionTokens: int64(resp.Usage.OutputTokens),
		TotalTokens:      int64(resp.Usage.InputTokens + resp.Usage.OutputTokens),
	}

	if len(req.ResponseSchema) > 0 {
		var structured json.RawMessage
		if err := json.Unmarshal([]byte(content), &structured); err == nil {
			result.Structured = structured
		}
	}

	return result, nil
}
