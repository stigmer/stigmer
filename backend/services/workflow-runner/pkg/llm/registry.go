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
	"fmt"
	"strings"
)

// ResolveProvider returns the provider name and canonical API model ID
// for a given model slug. Phase 1 uses prefix-based detection; full model
// registry integration is deferred.
func ResolveProvider(modelSlug string) (providerName string, apiModelID string, err error) {
	slug := strings.ToLower(modelSlug)

	switch {
	case strings.HasPrefix(slug, "gpt-"),
		strings.HasPrefix(slug, "o1"),
		strings.HasPrefix(slug, "o3"),
		strings.HasPrefix(slug, "o4"),
		strings.HasPrefix(slug, "chatgpt"):
		return "openai", modelSlug, nil

	case strings.HasPrefix(slug, "claude-"):
		return "anthropic", modelSlug, nil

	default:
		return "", "", fmt.Errorf("cannot resolve provider for model '%s': unknown prefix (supported: gpt-*, o1*, o3*, o4*, claude-*)", modelSlug)
	}
}

// NewProvider creates a Provider instance for the given vendor name and API key.
func NewProvider(providerName, apiKey string) (Provider, error) {
	switch providerName {
	case "openai":
		return NewOpenAIProvider(apiKey), nil
	case "anthropic":
		return NewAnthropicProvider(apiKey), nil
	default:
		return nil, fmt.Errorf("unsupported LLM provider: %s", providerName)
	}
}
