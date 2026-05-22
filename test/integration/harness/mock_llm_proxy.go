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

	bodyBytes, _ := io.ReadAll(r.Body)
	r.Body.Close()

	isStreaming := false
	if len(bodyBytes) > 0 {
		var reqBody map[string]any
		if json.Unmarshal(bodyBytes, &reqBody) == nil {
			if v, ok := reqBody["stream"]; ok {
				if b, ok := v.(bool); ok && b {
					isStreaming = true
				}
			}
		}
	}

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

	isAnthropic := pathContains(path, "/v1/messages") || pathContains(path, "anthropic")
	isOpenAI := pathContains(path, "/chat/completions") || pathContains(path, "openai")

	if isStreaming && isAnthropic {
		m.writeAnthropicSSE(w, resp)
		return
	}
	if isStreaming && isOpenAI {
		m.writeOpenAISSE(w, resp)
		return
	}

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

// writeAnthropicSSE converts a recorded Anthropic response into SSE events
// that the @langchain/anthropic streaming parser expects.
func (m *MockLLMProxyServer) writeAnthropicSSE(w http.ResponseWriter, resp RecordedLLMResponse) {
	body, ok := resp.Body.(map[string]any)
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(200)

	flusher, _ := w.(http.Flusher)

	writeSSE := func(event, data string) {
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
		if flusher != nil {
			flusher.Flush()
		}
	}

	usage, _ := body["usage"].(map[string]any)
	inputTokens := intVal(usage, "input_tokens")
	outputTokens := intVal(usage, "output_tokens")

	msgStart := map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id":            body["id"],
			"type":          "message",
			"role":          "assistant",
			"content":       []any{},
			"model":         body["model"],
			"stop_reason":   nil,
			"stop_sequence": nil,
			"usage":         map[string]any{"input_tokens": inputTokens, "output_tokens": 0},
		},
	}
	b, _ := json.Marshal(msgStart)
	writeSSE("message_start", string(b))

	content := toAnySlice(body["content"])
	for idx, block := range content {
		blockMap, ok := block.(map[string]any)
		if !ok {
			continue
		}

		blockType, _ := blockMap["type"].(string)

		switch blockType {
		case "text":
			text, _ := blockMap["text"].(string)
			cbStart, _ := json.Marshal(map[string]any{
				"type":          "content_block_start",
				"index":         idx,
				"content_block": map[string]any{"type": "text", "text": ""},
			})
			writeSSE("content_block_start", string(cbStart))

			delta, _ := json.Marshal(map[string]any{
				"type":  "content_block_delta",
				"index": idx,
				"delta": map[string]any{"type": "text_delta", "text": text},
			})
			writeSSE("content_block_delta", string(delta))

			cbStop, _ := json.Marshal(map[string]any{"type": "content_block_stop", "index": idx})
			writeSSE("content_block_stop", string(cbStop))

		case "tool_use":
			inputBytes, _ := json.Marshal(blockMap["input"])
			cbStart, _ := json.Marshal(map[string]any{
				"type":  "content_block_start",
				"index": idx,
				"content_block": map[string]any{
					"type":  "tool_use",
					"id":    blockMap["id"],
					"name":  blockMap["name"],
					"input": map[string]any{},
				},
			})
			writeSSE("content_block_start", string(cbStart))

			delta, _ := json.Marshal(map[string]any{
				"type":  "content_block_delta",
				"index": idx,
				"delta": map[string]any{
					"type":         "input_json_delta",
					"partial_json": string(inputBytes),
				},
			})
			writeSSE("content_block_delta", string(delta))

			cbStop, _ := json.Marshal(map[string]any{"type": "content_block_stop", "index": idx})
			writeSSE("content_block_stop", string(cbStop))
		}
	}

	stopReason := "end_turn"
	if sr, ok := body["stop_reason"].(string); ok {
		stopReason = sr
	}

	msgDelta, _ := json.Marshal(map[string]any{
		"type":  "message_delta",
		"delta": map[string]any{"stop_reason": stopReason, "stop_sequence": nil},
		"usage": map[string]any{"output_tokens": outputTokens},
	})
	writeSSE("message_delta", string(msgDelta))

	msgStop, _ := json.Marshal(map[string]any{"type": "message_stop"})
	writeSSE("message_stop", string(msgStop))
}

// writeOpenAISSE converts a recorded OpenAI response into SSE events.
func (m *MockLLMProxyServer) writeOpenAISSE(w http.ResponseWriter, resp RecordedLLMResponse) {
	body, ok := resp.Body.(map[string]any)
	if !ok {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(200)

	flusher, _ := w.(http.Flusher)

	choices, _ := body["choices"].([]any)
	if len(choices) == 0 {
		return
	}
	choice, _ := choices[0].(map[string]any)
	message, _ := choice["message"].(map[string]any)
	content, _ := message["content"].(string)

	chunk := map[string]any{
		"id":      body["id"],
		"object":  "chat.completion.chunk",
		"created": body["created"],
		"model":   body["model"],
		"choices": []map[string]any{
			{
				"index": 0,
				"delta": map[string]any{
					"role":    "assistant",
					"content": content,
				},
				"finish_reason": nil,
			},
		},
	}
	b, _ := json.Marshal(chunk)
	fmt.Fprintf(w, "data: %s\n\n", string(b))
	if flusher != nil {
		flusher.Flush()
	}

	doneChunk := map[string]any{
		"id":      body["id"],
		"object":  "chat.completion.chunk",
		"created": body["created"],
		"model":   body["model"],
		"choices": []map[string]any{
			{
				"index":         0,
				"delta":         map[string]any{},
				"finish_reason": "stop",
			},
		},
		"usage": body["usage"],
	}
	b2, _ := json.Marshal(doneChunk)
	fmt.Fprintf(w, "data: %s\n\n", string(b2))
	if flusher != nil {
		flusher.Flush()
	}

	fmt.Fprintf(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

func intVal(m map[string]any, key string) int {
	if m == nil {
		return 0
	}
	v, ok := m[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
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

// toAnySlice converts typed slices (e.g., []map[string]any) to []any.
// In-memory entries from BuildLLMEntry use concrete Go types that don't
// satisfy the []any type assertion; JSON-deserialized fixtures use []any.
func toAnySlice(v any) []any {
	if v == nil {
		return nil
	}
	if s, ok := v.([]any); ok {
		return s
	}
	if s, ok := v.([]map[string]any); ok {
		out := make([]any, len(s))
		for i, item := range s {
			out[i] = item
		}
		return out
	}
	return nil
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

// OpenAITextResponse builds a minimal OpenAI chat completion API response body.
func OpenAITextResponse(text string, promptTokens, completionTokens int) map[string]any {
	return map[string]any{
		"id":      fmt.Sprintf("chatcmpl-mock-%d", promptTokens),
		"object":  "chat.completion",
		"created": 1700000000,
		"model":   "gpt-4o-mini",
		"choices": []map[string]any{
			{
				"index": 0,
				"message": map[string]any{
					"role":    "assistant",
					"content": text,
				},
				"finish_reason": "stop",
			},
		},
		"usage": map[string]any{
			"prompt_tokens":     promptTokens,
			"completion_tokens": completionTokens,
			"total_tokens":      promptTokens + completionTokens,
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
