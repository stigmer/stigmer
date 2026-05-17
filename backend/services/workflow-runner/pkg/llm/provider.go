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
)

// Request describes a single LLM prompt-response cycle.
type Request struct {
	Model        string
	SystemPrompt string
	Prompt       string
	Temperature  float32
	MaxTokens    int32
	// When non-nil, the provider should request structured JSON output
	// and the response Content should be valid JSON matching this schema.
	ResponseSchema json.RawMessage
}

// Response holds the LLM reply and usage metadata.
type Response struct {
	Content          string          `json:"content"`
	Structured       json.RawMessage `json:"structured,omitempty"`
	PromptTokens     int64           `json:"prompt_tokens"`
	CompletionTokens int64           `json:"completion_tokens"`
	TotalTokens      int64           `json:"total_tokens"`
	CostMicros       int64           `json:"cost_micros"`
}

// Provider abstracts an LLM vendor's API (OpenAI, Anthropic, etc.).
type Provider interface {
	Call(ctx context.Context, req Request) (*Response, error)
	Name() string
}
