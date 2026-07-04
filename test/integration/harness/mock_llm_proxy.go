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
	"time"
)

// RecordedLLMEntry represents a single request/response pair in a fixture file.
type RecordedLLMEntry struct {
	Index    int                 `json:"index"`
	Request  map[string]any      `json:"request"`
	Response RecordedLLMResponse `json:"response"`
}

// RecordedLLMResponse is the HTTP response portion of a recorded entry.
type RecordedLLMResponse struct {
	Status     int               `json:"status"`
	StatusText string            `json:"statusText"`
	Headers    map[string]string `json:"headers"`
	Body       any               `json:"body"`
	// DelayMs holds the response open for the given number of milliseconds
	// before writing. Offline tests use this to keep an execution in
	// IN_PROGRESS long enough for lifecycle actions (cancel/terminate) to
	// observe and act on it — the mocked LLM otherwise responds instantly.
	// The delay is aborted early if the client disconnects.
	DelayMs int `json:"delayMs,omitempty"`
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
	Server   *httptest.Server
	mu       sync.Mutex
	entries  []RecordedLLMEntry
	cursor   int
	requests []map[string]any
	registry []map[string]any
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
		entries:  fixture.Entries,
		registry: defaultMockModelRegistry(),
	}

	m.Server = httptest.NewServer(http.HandlerFunc(m.handleRequest))
	return m, nil
}

// NewMockLLMProxyServerFromEntries creates a mock server from in-memory entries.
func NewMockLLMProxyServerFromEntries(entries []RecordedLLMEntry) *MockLLMProxyServer {
	m := &MockLLMProxyServer{
		entries:  entries,
		registry: defaultMockModelRegistry(),
	}
	m.Server = httptest.NewServer(http.HandlerFunc(m.handleRequest))
	return m
}

func (m *MockLLMProxyServer) handleRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// The runner resolves registry ids (e.g. "claude-haiku-4.5") to provider
	// api ids by fetching the model registry from the same proxy host
	// (STIGMER_CLOUD_API_URL). Serve it here so offline tests exercise real
	// resolution instead of the silent identity fallback.
	if pathContains(path, "/v1/proxy/model-registry") {
		m.mu.Lock()
		reg := m.registry
		m.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"models": reg})
		return
	}

	// Only intercept LLM proxy paths
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

	var reqBody map[string]any
	if len(bodyBytes) > 0 {
		_ = json.Unmarshal(bodyBytes, &reqBody)
	}

	isStreaming := false
	if v, ok := reqBody["stream"]; ok {
		if b, ok := v.(bool); ok && b {
			isStreaming = true
		}
	}

	m.mu.Lock()

	// Capture the request so tests can assert what was actually sent to the
	// provider — most importantly the resolved `model` id.
	if reqBody != nil {
		m.requests = append(m.requests, reqBody)
	}

	if m.cursor >= len(m.entries) {
		m.mu.Unlock()
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("MockLLMProxyServer: no more recorded entries (consumed %d/%d)", m.cursor, len(m.entries)),
		})
		return
	}

	entry := m.entries[m.cursor]
	m.cursor++
	m.mu.Unlock()

	resp := entry.Response

	// Optionally hold the response open (lock released) to keep the execution
	// in a running state for lifecycle tests. Abort early if the client
	// disconnects so server shutdown does not block on an in-flight request.
	if resp.DelayMs > 0 {
		select {
		case <-time.After(time.Duration(resp.DelayMs) * time.Millisecond):
		case <-r.Context().Done():
			return
		}
	}

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

		case "thinking":
			thinking, _ := blockMap["thinking"].(string)
			cbStart, _ := json.Marshal(map[string]any{
				"type":          "content_block_start",
				"index":         idx,
				"content_block": map[string]any{"type": "thinking", "thinking": ""},
			})
			writeSSE("content_block_start", string(cbStart))

			delta, _ := json.Marshal(map[string]any{
				"type":  "content_block_delta",
				"index": idx,
				"delta": map[string]any{"type": "thinking_delta", "thinking": thinking},
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

// Requests returns a copy of every captured LLM request body, in order.
func (m *MockLLMProxyServer) Requests() []map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]map[string]any, len(m.requests))
	copy(out, m.requests)
	return out
}

// LastRequest returns the most recently captured LLM request body, or nil.
func (m *MockLLMProxyServer) LastRequest() map[string]any {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.requests) == 0 {
		return nil
	}
	return m.requests[len(m.requests)-1]
}

// RequestModels returns the `model` field from each captured LLM request, in
// order. This is the id the provider actually received — after registry
// resolution — which is the assertion target for model-id regression tests.
func (m *MockLLMProxyServer) RequestModels() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	models := make([]string, 0, len(m.requests))
	for _, req := range m.requests {
		if v, ok := req["model"].(string); ok {
			models = append(models, v)
		}
	}
	return models
}

// SetModelRegistry overrides the registry served at /v1/proxy/model-registry.
// Pass nil to disable serving (the endpoint then 404s, mimicking an
// unreachable registry).
func (m *MockLLMProxyServer) SetModelRegistry(entries []map[string]any) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.registry = entries
}

// defaultMockModelRegistry mirrors the key rows of stigmer-cloud's
// model-registry.json so the offline runner resolves registry ids
// (dot-notation) to provider api ids exactly as production does. Kept
// intentionally small — extend as tests need more models. The id -> apiModelId
// mappings (e.g. claude-haiku-4.5 -> claude-haiku-4-5-20251001) are the
// contract a model-resolution regression test asserts against.
func defaultMockModelRegistry() []map[string]any {
	price := func(in, out float64) map[string]any {
		return map[string]any{
			"inputPricePerMillion":      in,
			"outputPricePerMillion":     out,
			"cacheWritePricePerMillion": in,
			"cacheReadPricePerMillion":  in / 10,
		}
	}
	return []map[string]any{
		{"id": "claude-sonnet-4.6", "apiModelId": "claude-sonnet-4-6", "provider": "anthropic", "costTier": "standard", "harness": "native", "featured": true, "pricing": price(3, 15)},
		{"id": "claude-sonnet-4.5", "apiModelId": "claude-sonnet-4-5", "provider": "anthropic", "costTier": "standard", "harness": "native", "pricing": price(3, 15)},
		{"id": "claude-haiku-4.5", "apiModelId": "claude-haiku-4-5-20251001", "provider": "anthropic", "costTier": "economy", "harness": "native", "pricing": price(1, 5)},
		{"id": "gpt-4o-mini", "apiModelId": "gpt-4o-mini", "provider": "openai", "costTier": "economy", "harness": "native", "pricing": price(0.15, 0.6)},
		{"id": "gpt-4.1", "apiModelId": "gpt-4.1", "provider": "openai", "costTier": "standard", "harness": "native", "pricing": price(2, 8)},
	}
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
		"model": "claude-sonnet-4-6",
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
		"model": "claude-sonnet-4-6",
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

// ToolUseBlock describes one tool_use content block of a multi-tool assistant
// turn. Several blocks in a single turn surface as co-pending approvals — the
// shape the co-pending idempotency case relies on.
type ToolUseBlock struct {
	ID    string
	Name  string
	Input map[string]any
}

// AnthropicMultiToolUseResponse builds an Anthropic API response that emits N
// tool_use blocks in one assistant turn. The SSE writer already iterates content
// blocks by index, so the blocks stream as N co-pending tool calls — used to
// raise two approval gates from a single turn deterministically (e.g. to prove
// approving one open gate leaves the other pending).
func AnthropicMultiToolUseResponse(blocks []ToolUseBlock, inputTokens, outputTokens int) map[string]any {
	content := make([]map[string]any, 0, len(blocks))
	for _, b := range blocks {
		content = append(content, map[string]any{
			"type": "tool_use", "id": b.ID, "name": b.Name, "input": b.Input,
		})
	}
	return map[string]any{
		"id":          fmt.Sprintf("msg_mock_%d", inputTokens),
		"type":        "message",
		"role":        "assistant",
		"model":       "claude-sonnet-4-6",
		"content":     content,
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

// AnthropicThinkingTextResponse builds an Anthropic API response with both
// a thinking block and a text block. Used for testing extended thinking
// (Anthropic reasoning) where the model emits thinking before the answer.
func AnthropicThinkingTextResponse(thinking, text string, inputTokens, outputTokens int) map[string]any {
	return map[string]any{
		"id":    fmt.Sprintf("msg_mock_%d", inputTokens),
		"type":  "message",
		"role":  "assistant",
		"model": "claude-sonnet-4-6",
		"content": []map[string]any{
			{"type": "thinking", "thinking": thinking},
			{"type": "text", "text": text},
		},
		"stop_reason": "end_turn",
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
