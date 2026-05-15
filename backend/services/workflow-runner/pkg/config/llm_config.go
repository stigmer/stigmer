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

package config

import (
	"fmt"
	"os"
	"strings"
)

// LlmProxyConfig holds configuration for LLM API calls, supporting both
// direct provider keys (OSS mode) and the Side-Channel Proxy (cloud mode).
//
// When ProxyEndpoint is set, LLM calls route through the Stigmer proxy
// which injects platform-owned API keys server-side. Runners never need
// provider secrets in cloud mode — only STIGMER_TOKEN / STIGMER_API_KEY.
//
// This mirrors the agent-runner LLMConfig.load_from_env(proxy_active=...)
// and cursor-runner loadConfig() patterns.
type LlmProxyConfig struct {
	// ProxyEndpoint is the Side-Channel Proxy base URL.
	// When set, LLM calls route through {ProxyEndpoint}/v1/proxy/llm/{provider}/...
	// and AuthToken is used for authentication.
	// Example: https://api.stigmer.ai
	ProxyEndpoint string

	// AuthToken is the Stigmer authentication token used as Bearer token
	// for proxy requests. Read from STIGMER_TOKEN or STIGMER_API_KEY.
	AuthToken string

	// ProxyActive is true when ProxyEndpoint is set and non-empty.
	// When true, provider API keys are not required.
	ProxyActive bool

	// AnthropicAPIKey is the direct Anthropic API key for OSS mode.
	// Only required when ProxyActive is false and Anthropic models are used.
	AnthropicAPIKey string

	// OpenAIAPIKey is the direct OpenAI API key for OSS mode.
	// Only required when ProxyActive is false and OpenAI models are used.
	OpenAIAPIKey string
}

// LoadLlmConfig loads LLM proxy/direct configuration from environment variables.
//
// Environment variables:
//   - STIGMER_PROXY_ENDPOINT: Side-Channel Proxy URL (enables cloud mode)
//   - STIGMER_TOKEN / STIGMER_API_KEY: Auth token for proxy (required in cloud mode)
//   - ANTHROPIC_API_KEY: Direct Anthropic key (required in OSS mode for claude-* models)
//   - OPENAI_API_KEY: Direct OpenAI key (required in OSS mode for gpt-* models)
func LoadLlmConfig() *LlmProxyConfig {
	proxyEndpoint := strings.TrimSpace(os.Getenv("STIGMER_PROXY_ENDPOINT"))
	proxyActive := proxyEndpoint != ""

	authToken := os.Getenv("STIGMER_TOKEN")
	if authToken == "" {
		authToken = os.Getenv("STIGMER_API_KEY")
	}

	return &LlmProxyConfig{
		ProxyEndpoint:   proxyEndpoint,
		AuthToken:       authToken,
		ProxyActive:     proxyActive,
		AnthropicAPIKey: os.Getenv("ANTHROPIC_API_KEY"),
		OpenAIAPIKey:    os.Getenv("OPENAI_API_KEY"),
	}
}

// ResolveAnthropicBaseURL returns the base URL for Anthropic API calls.
// In proxy mode: {ProxyEndpoint}/v1/proxy/llm/anthropic
// In direct mode: empty string (SDK default).
func (c *LlmProxyConfig) ResolveAnthropicBaseURL() string {
	if !c.ProxyActive {
		return ""
	}
	return strings.TrimRight(c.ProxyEndpoint, "/") + "/v1/proxy/llm/anthropic"
}

// ResolveOpenAIBaseURL returns the base URL for OpenAI API calls.
// In proxy mode: {ProxyEndpoint}/v1/proxy/llm/openai/v1
// In direct mode: empty string (SDK default).
func (c *LlmProxyConfig) ResolveOpenAIBaseURL() string {
	if !c.ProxyActive {
		return ""
	}
	return strings.TrimRight(c.ProxyEndpoint, "/") + "/v1/proxy/llm/openai/v1"
}

// ResolveAnthropicAPIKey returns the API key for Anthropic calls.
// In proxy mode: the Stigmer auth token (proxy validates it, not Anthropic).
// In direct mode: ANTHROPIC_API_KEY.
func (c *LlmProxyConfig) ResolveAnthropicAPIKey() string {
	if c.ProxyActive {
		return c.AuthToken
	}
	return c.AnthropicAPIKey
}

// ResolveOpenAIAPIKey returns the API key for OpenAI calls.
// In proxy mode: the Stigmer auth token (proxy validates it, not OpenAI).
// In direct mode: OPENAI_API_KEY.
func (c *LlmProxyConfig) ResolveOpenAIAPIKey() string {
	if c.ProxyActive {
		return c.AuthToken
	}
	return c.OpenAIAPIKey
}

// ValidateForProvider checks that the config is valid for the given provider.
func (c *LlmProxyConfig) ValidateForProvider(provider string) error {
	if c.ProxyActive {
		if c.AuthToken == "" {
			return fmt.Errorf(
				"STIGMER_TOKEN or STIGMER_API_KEY is required when STIGMER_PROXY_ENDPOINT is set")
		}
		return nil
	}

	switch provider {
	case "anthropic":
		if c.AnthropicAPIKey == "" {
			return fmt.Errorf(
				"ANTHROPIC_API_KEY is required for model (set it directly, or set STIGMER_PROXY_ENDPOINT for proxy mode)")
		}
	case "openai":
		if c.OpenAIAPIKey == "" {
			return fmt.Errorf(
				"OPENAI_API_KEY is required for model (set it directly, or set STIGMER_PROXY_ENDPOINT for proxy mode)")
		}
	}
	return nil
}
