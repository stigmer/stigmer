package harness

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
)

// RecordedLLMEntry represents a single request/response pair in a fixture file.
type RecordedLLMEntry struct {
	Index    int                    `json:"index"`
	Request  map[string]any         `json:"request"`
	Response RecordedLLMResponse    `json:"response"`
}

// RecordedLLMResponse is the HTTP response portion of a recorded entry.
type RecordedLLMResponse struct {
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	Headers    map[string]string `json:"headers"`
	Body       any               `json:"body"`
}

// RecordedLLMFixture represents a complete fixture file.
type RecordedLLMFixture struct {
	Name       string             `json:"name"`
	RecordedAt string             `json:"recordedAt"`
	Entries    []RecordedLLMEntry `json:"entries"`
}

// MockLLMProxyServer serves sequential recorded LLM responses.
// It handles requests to /v1/proxy/llm/anthropic/v1/messages and
// /v1/proxy/llm/openai/v1/chat/completions, returning the next
// recorded response in order.
//
// Non-LLM requests (gRPC status updates, etc.) are rejected with 404
// since those go through the real Java service.
type MockLLMProxyServer struct {
	Server  *httptest.Server
	mu      sync.Mutex
	entries []RecordedLLMEntry
	cursor  int
}

// NewMockLLMProxyServer creates a mock server from a fixture file.
func NewMockLLMProxyServer(fixturePath string) (*MockLLMProxyServer, error) {
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		return nil, fmt.Errorf("read fixture %s: %w", fixturePath, err)
	}

	var fixture RecordedLLMFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		return nil, fmt.Errorf("parse fixture %s: %w", fixturePath, err)
	}

	m := &MockLLMProxyServer{
		entries: fixture.Entries,
	}

	m.Server = httptest.NewServer(http.HandlerFunc(m.handleRequest))
	return m, nil
}

// NewMockLLMProxyServerFromEntries creates a mock server from in-memory entries.
func NewMockLLMProxyServerFromEntries(entries []RecordedLLMEntry) *MockLLMProxyServer {
	m := &MockLLMProxyServer{
		entries: entries,
	}
	m.Server = httptest.NewServer(http.HandlerFunc(m.handleRequest))
	return m
}

func (m *MockLLMProxyServer) handleRequest(w http.ResponseWriter, r *http.Request) {
	// Only intercept LLM proxy paths
	path := r.URL.Path
	isLLM := pathContains(path, "/v1/messages") ||
		pathContains(path, "/chat/completions") ||
		pathContains(path, "/v1/proxy/llm/")
	if !isLLM {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("MockLLMProxyServer: unhandled path %s", path),
		})
		return
	}

	// Consume the request body (important for connection management)
	io.ReadAll(r.Body)
	r.Body.Close()

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cursor >= len(m.entries) {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("MockLLMProxyServer: no more recorded entries (consumed %d/%d)", m.cursor, len(m.entries)),
		})
		return
	}

	entry := m.entries[m.cursor]
	m.cursor++

	resp := entry.Response
	for k, v := range resp.Headers {
		w.Header().Set(k, v)
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}

	status := resp.Status
	if status == 0 {
		status = 200
	}
	w.WriteHeader(status)

	if resp.Body != nil {
		json.NewEncoder(w).Encode(resp.Body)
	}
}

// URL returns the base URL of the mock server.
func (m *MockLLMProxyServer) URL() string {
	return m.Server.URL
}

// Close shuts down the mock server.
func (m *MockLLMProxyServer) Close() {
	m.Server.Close()
}

// Consumed returns how many entries have been served.
func (m *MockLLMProxyServer) Consumed() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cursor
}

// Remaining returns how many entries are left.
func (m *MockLLMProxyServer) Remaining() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.entries) - m.cursor
}

func pathContains(path, substr string) bool {
	return len(path) >= len(substr) && contains(path, substr)
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// LoadLLMFixture reads a fixture file from the testdata directory.
func LoadLLMFixture(name string) string {
	return filepath.Join(findTestdataDir(), "llm-responses", name+".json")
}

func findTestdataDir() string {
	candidates := []string{
		"testdata",
		"../testdata",
		"test/integration/testdata",
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		if _, err := os.Stat(abs); err == nil {
			return abs
		}
	}
	return "testdata"
}

// AnthropicTextResponse builds a minimal Anthropic API response body
// with a single text content block.
func AnthropicTextResponse(text string, inputTokens, outputTokens int) map[string]any {
	return map[string]any{
		"id":    fmt.Sprintf("msg_mock_%d", inputTokens),
		"type":  "message",
		"role":  "assistant",
		"model": "claude-sonnet-4-20250514",
		"content": []map[string]any{
			{"type": "text", "text": text},
		},
		"stop_reason": "end_turn",
		"usage": map[string]any{
			"input_tokens":  inputTokens,
			"output_tokens": outputTokens,
		},
	}
}

// AnthropicToolUseResponse builds an Anthropic API response with a tool_use block.
func AnthropicToolUseResponse(toolID, toolName string, toolInput map[string]any, inputTokens, outputTokens int) map[string]any {
	return map[string]any{
		"id":    fmt.Sprintf("msg_mock_%d", inputTokens),
		"type":  "message",
		"role":  "assistant",
		"model": "claude-sonnet-4-20250514",
		"content": []map[string]any{
			{"type": "tool_use", "id": toolID, "name": toolName, "input": toolInput},
		},
		"stop_reason": "tool_use",
		"usage": map[string]any{
			"input_tokens":  inputTokens,
			"output_tokens": outputTokens,
		},
	}
}

// BuildLLMEntry creates a RecordedLLMEntry for use in mock servers.
func BuildLLMEntry(index int, responseBody map[string]any) RecordedLLMEntry {
	return RecordedLLMEntry{
		Index: index,
		Response: RecordedLLMResponse{
			Status:     200,
			StatusText: "OK",
			Headers:    map[string]string{"content-type": "application/json"},
			Body:       responseBody,
		},
	}
}
