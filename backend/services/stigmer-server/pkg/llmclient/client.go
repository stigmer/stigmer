package llmclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Client provides non-streaming LLM chat completions for stigmer-server.
//
// This is a standalone client separate from workflow-runner's pkg/llm/ —
// stigmer-server is a different binary and should not depend on the runner.
// The client supports OpenAI and Anthropic providers via their HTTP APIs.
type Client struct {
	httpClient *http.Client
	timeout    time.Duration
}

// NewClient creates a new LLM client with the given timeout.
func NewClient(timeout time.Duration) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: timeout,
		},
		timeout: timeout,
	}
}

// ChatCompletionRequest contains the parameters for a chat completion call.
type ChatCompletionRequest struct {
	Provider     string
	Model        string
	SystemPrompt string
	UserPrompt   string
	MaxTokens    int
	Temperature  float64
}

// ChatCompletionResponse contains the result of a chat completion call.
type ChatCompletionResponse struct {
	Content      string
	Model        string
	InputTokens  int64
	OutputTokens int64
}

// ChatCompletion executes a non-streaming chat completion against the
// specified provider. It reads API keys from environment variables
// (OPENAI_API_KEY, ANTHROPIC_API_KEY).
func (c *Client) ChatCompletion(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	provider := req.Provider
	if provider == "" {
		provider = resolveProvider(req.Model)
	}

	apiKey, err := resolveAPIKey(provider)
	if err != nil {
		return nil, err
	}

	baseURL := resolveBaseURL(provider)
	endpoint := resolveEndpoint(provider, baseURL)

	body, err := buildRequestBody(provider, req)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to build LLM request: %v", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create HTTP request: %v", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	setProviderAuth(httpReq, provider, apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, status.Errorf(codes.Unavailable, "LLM provider request failed: %v", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, status.Errorf(codes.Unavailable, "failed to read LLM response: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, status.Errorf(codes.Unavailable,
			"LLM provider returned HTTP %d: %s", resp.StatusCode, truncate(string(respBody), 300))
	}

	return parseResponse(provider, respBody)
}

// ResolveDefaultModel returns a reasonable default model for the provider
// that has an API key configured. Prefers Anthropic when both are available.
func ResolveDefaultModel() (provider, model string, err error) {
	if os.Getenv("ANTHROPIC_API_KEY") != "" {
		return "anthropic", "claude-sonnet-4-6", nil
	}
	if os.Getenv("OPENAI_API_KEY") != "" {
		return "openai", "gpt-4o", nil
	}
	return "", "", status.Error(codes.FailedPrecondition,
		"no LLM API key configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY")
}

func resolveProvider(model string) string {
	if model == "" {
		return ""
	}
	m := strings.ToLower(model)
	switch {
	case strings.HasPrefix(m, "claude"):
		return "anthropic"
	case strings.HasPrefix(m, "gpt"), strings.HasPrefix(m, "o1"), strings.HasPrefix(m, "o3"), strings.HasPrefix(m, "o4"):
		return "openai"
	default:
		return "openai"
	}
}

func resolveAPIKey(provider string) (string, error) {
	var envVar string
	switch provider {
	case "anthropic":
		envVar = "ANTHROPIC_API_KEY"
	case "openai":
		envVar = "OPENAI_API_KEY"
	default:
		envVar = "OPENAI_API_KEY"
	}

	key := os.Getenv(envVar)
	if key == "" {
		return "", status.Errorf(codes.FailedPrecondition,
			"LLM API key not configured — set %s environment variable", envVar)
	}
	return key, nil
}

func resolveBaseURL(provider string) string {
	switch provider {
	case "anthropic":
		if u := os.Getenv("ANTHROPIC_BASE_URL"); u != "" {
			return u
		}
		return "https://api.anthropic.com"
	default:
		if u := os.Getenv("OPENAI_BASE_URL"); u != "" {
			return u
		}
		return "https://api.openai.com"
	}
}

func resolveEndpoint(provider, baseURL string) string {
	switch provider {
	case "anthropic":
		return baseURL + "/v1/messages"
	default:
		return baseURL + "/v1/chat/completions"
	}
}

func setProviderAuth(req *http.Request, provider, apiKey string) {
	switch provider {
	case "anthropic":
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	default:
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
}

// buildRequestBody constructs the JSON request body for the LLM provider.
func buildRequestBody(provider string, req ChatCompletionRequest) ([]byte, error) {
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	temp := req.Temperature
	if temp <= 0 {
		temp = 0.2
	}

	if provider == "anthropic" {
		body := map[string]any{
			"model":      req.Model,
			"max_tokens": maxTokens,
			"temperature": temp,
			"system":     req.SystemPrompt,
			"messages": []map[string]string{
				{"role": "user", "content": req.UserPrompt},
			},
		}
		return json.Marshal(body)
	}

	body := map[string]any{
		"model":       req.Model,
		"max_tokens":  maxTokens,
		"temperature": temp,
		"stream":      false,
		"messages": []map[string]string{
			{"role": "system", "content": req.SystemPrompt},
			{"role": "user", "content": req.UserPrompt},
		},
	}
	return json.Marshal(body)
}

// parseResponse extracts the content and usage from the LLM response.
func parseResponse(provider string, body []byte) (*ChatCompletionResponse, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to parse LLM response JSON: %v", err)
	}

	result := &ChatCompletionResponse{}

	if m, ok := raw["model"]; ok {
		_ = json.Unmarshal(m, &result.Model)
	}

	content, err := extractContent(provider, raw)
	if err != nil {
		return nil, err
	}
	result.Content = content

	extractUsage(raw, result)

	return result, nil
}

func extractContent(provider string, raw map[string]json.RawMessage) (string, error) {
	if provider == "anthropic" {
		return extractAnthropicContent(raw)
	}
	return extractOpenAIContent(raw)
}

func extractOpenAIContent(raw map[string]json.RawMessage) (string, error) {
	choicesRaw, ok := raw["choices"]
	if !ok {
		return "", status.Error(codes.Internal, "LLM response missing 'choices' field")
	}
	var choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(choicesRaw, &choices); err != nil || len(choices) == 0 {
		return "", status.Error(codes.Internal, "LLM response has invalid 'choices' structure")
	}
	return choices[0].Message.Content, nil
}

func extractAnthropicContent(raw map[string]json.RawMessage) (string, error) {
	contentRaw, ok := raw["content"]
	if !ok {
		return "", status.Error(codes.Internal, "LLM response missing 'content' field")
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(contentRaw, &blocks); err != nil || len(blocks) == 0 {
		return "", status.Error(codes.Internal, "LLM response has invalid 'content' structure")
	}
	for _, b := range blocks {
		if b.Type == "text" {
			return b.Text, nil
		}
	}
	return "", status.Error(codes.Internal, "LLM response contains no text content blocks")
}

func extractUsage(raw map[string]json.RawMessage, result *ChatCompletionResponse) {
	usageRaw, ok := raw["usage"]
	if !ok {
		return
	}
	var usage struct {
		InputTokens      int64 `json:"input_tokens"`
		OutputTokens     int64 `json:"output_tokens"`
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
	}
	if err := json.Unmarshal(usageRaw, &usage); err != nil {
		return
	}
	if usage.InputTokens > 0 {
		result.InputTokens = usage.InputTokens
	} else {
		result.InputTokens = usage.PromptTokens
	}
	if usage.OutputTokens > 0 {
		result.OutputTokens = usage.OutputTokens
	} else {
		result.OutputTokens = usage.CompletionTokens
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// ExtractYAMLFromResponse strips markdown code fences from an LLM response
// that may wrap the YAML in ```yaml ... ``` blocks.
func ExtractYAMLFromResponse(content string) string {
	content = strings.TrimSpace(content)

	if strings.HasPrefix(content, "```") {
		lines := strings.SplitN(content, "\n", 2)
		if len(lines) == 2 {
			content = lines[1]
		}
		if idx := strings.LastIndex(content, "```"); idx >= 0 {
			content = content[:idx]
		}
		content = strings.TrimSpace(content)
	}
	return content
}

// SplitYAMLAndExplanation separates YAML and explanation from an LLM response
// that contains both in a structured format. The expected format is:
//
//	```yaml
//	<workflow yaml>
//	```
//	<explanation text>
//
// If no code fence is found, the entire content is treated as YAML.
func SplitYAMLAndExplanation(content string) (yaml, explanation string) {
	content = strings.TrimSpace(content)

	yamlStart := -1
	yamlEnd := -1

	lines := strings.Split(content, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if yamlStart == -1 && strings.HasPrefix(trimmed, "```") {
			yamlStart = i
			continue
		}
		if yamlStart >= 0 && yamlEnd == -1 && trimmed == "```" {
			yamlEnd = i
			break
		}
	}

	if yamlStart >= 0 && yamlEnd > yamlStart {
		yamlLines := lines[yamlStart+1 : yamlEnd]
		yaml = strings.TrimSpace(strings.Join(yamlLines, "\n"))
		if yamlEnd+1 < len(lines) {
			explanation = strings.TrimSpace(strings.Join(lines[yamlEnd+1:], "\n"))
		}
		return yaml, explanation
	}

	return content, ""
}

// FormatValidationErrorsForRetry formats validation errors into a prompt
// appendix for retry attempts.
func FormatValidationErrorsForRetry(errors []string) string {
	if len(errors) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("\n\nThe previously generated YAML had the following validation errors. ")
	sb.WriteString("Please fix these issues and regenerate a valid workflow YAML:\n\n")
	for i, e := range errors {
		fmt.Fprintf(&sb, "%d. %s\n", i+1, e)
	}
	return sb.String()
}
