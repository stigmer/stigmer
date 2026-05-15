package harness

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type mcpJSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type mcpJSONRPCResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id"`
	Result  any       `json:"result,omitempty"`
	Error   *mcpError `json:"error,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpInitResult struct {
	ProtocolVersion string         `json:"protocolVersion"`
	Capabilities    map[string]any `json:"capabilities"`
	ServerInfo      struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	} `json:"serverInfo"`
}

type mcpToolInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"inputSchema"`
}

type mcpToolsListResult struct {
	Tools []mcpToolInfo `json:"tools"`
}

type mcpCallToolParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type mcpToolResult struct {
	Content []mcpContentItem `json:"content"`
	IsError bool             `json:"isError,omitempty"`
}

type mcpContentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

var httpMcpTools = []mcpToolInfo{
	{
		Name:        "echo",
		Description: "Returns the input unchanged. For deterministic assertion testing.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"input": map[string]any{"type": "string", "description": "The value to echo back"},
			},
			"required": []string{"input"},
		},
	},
	{
		Name:        "add",
		Description: "Returns the sum of two numbers.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"a": map[string]any{"type": "number", "description": "First operand"},
				"b": map[string]any{"type": "number", "description": "Second operand"},
			},
			"required": []string{"a", "b"},
		},
	},
	{
		Name:        "fail",
		Description: "Always fails with the given error message. For error handling tests.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"message": map[string]any{"type": "string", "description": "Error message to return"},
			},
			"required": []string{"message"},
		},
	},
	{
		Name:        "slow",
		Description: "Sleeps for the given number of seconds then returns 'done'. For timeout testing.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"seconds": map[string]any{"type": "number", "description": "Seconds to sleep"},
			},
			"required": []string{"seconds"},
		},
	},
}

// StartHTTPMcpServer starts an in-process HTTP+SSE MCP test server.
// The server implements MCP JSON-RPC over HTTP with the same tools as
// the stdio test server (echo, add, fail, slow). The server is
// automatically closed on test cleanup.
func StartHTTPMcpServer(t *testing.T) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()
	mux.HandleFunc("/sse", handleSSE)
	mux.HandleFunc("/message", handleMessage)

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	t.Logf("HTTP MCP test server started at %s", server.URL)
	return server
}

func handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	messageEndpoint := fmt.Sprintf("%s/message", r.Host)
	fmt.Fprintf(w, "event: endpoint\ndata: %s\n\n", messageEndpoint)
	flusher.Flush()

	<-r.Context().Done()
}

func handleMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read body", http.StatusBadRequest)
		return
	}

	// Handle newline-delimited JSON-RPC (may contain multiple requests)
	scanner := bufio.NewScanner(strings.NewReader(string(body)))
	var responses []mcpJSONRPCResponse

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var req mcpJSONRPCRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			responses = append(responses, mcpJSONRPCResponse{
				JSONRPC: "2.0",
				Error:   &mcpError{Code: -32700, Message: "Parse error: " + err.Error()},
			})
			continue
		}
		resp := handleMcpRequest(&req)
		if resp != nil {
			responses = append(responses, *resp)
		}
	}

	// If body was a single JSON object (not newline-delimited)
	if len(responses) == 0 {
		var req mcpJSONRPCRequest
		if err := json.Unmarshal(body, &req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		resp := handleMcpRequest(&req)
		if resp != nil {
			responses = append(responses, *resp)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	for _, resp := range responses {
		data, _ := json.Marshal(resp)
		w.Write(data)
		w.Write([]byte("\n"))
	}
}

func handleMcpRequest(req *mcpJSONRPCRequest) *mcpJSONRPCResponse {
	switch req.Method {
	case "initialize":
		result := mcpInitResult{
			ProtocolVersion: "2024-11-05",
			Capabilities:    map[string]any{"tools": map[string]any{"listChanged": false}},
		}
		result.ServerInfo.Name = "mcp-test-server-http"
		result.ServerInfo.Version = "1.0.0"
		return &mcpJSONRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: result}

	case "notifications/initialized":
		return nil

	case "tools/list":
		return &mcpJSONRPCResponse{JSONRPC: "2.0", ID: req.ID,
			Result: mcpToolsListResult{Tools: httpMcpTools}}

	case "tools/call":
		var params mcpCallToolParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return &mcpJSONRPCResponse{JSONRPC: "2.0", ID: req.ID,
				Error: &mcpError{Code: -32602, Message: "Invalid params: " + err.Error()}}
		}
		return handleHttpToolCall(req.ID, &params)

	case "ping":
		return &mcpJSONRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: map[string]any{}}

	default:
		return &mcpJSONRPCResponse{JSONRPC: "2.0", ID: req.ID,
			Error: &mcpError{Code: -32601, Message: "Method not found: " + req.Method}}
	}
}

func handleHttpToolCall(id any, params *mcpCallToolParams) *mcpJSONRPCResponse {
	var result mcpToolResult

	switch params.Name {
	case "echo":
		input, _ := params.Arguments["input"].(string)
		result = mcpToolResult{Content: []mcpContentItem{{Type: "text", Text: input}}}

	case "add":
		a, _ := params.Arguments["a"].(float64)
		b, _ := params.Arguments["b"].(float64)
		result = mcpToolResult{Content: []mcpContentItem{{Type: "text", Text: fmt.Sprintf("%g", a+b)}}}

	case "fail":
		msg, _ := params.Arguments["message"].(string)
		if msg == "" {
			msg = "tool execution failed"
		}
		result = mcpToolResult{Content: []mcpContentItem{{Type: "text", Text: "Error: " + msg}}, IsError: true}

	case "slow":
		seconds, _ := params.Arguments["seconds"].(float64)
		if seconds > 0 {
			time.Sleep(time.Duration(seconds * float64(time.Second)))
		}
		result = mcpToolResult{Content: []mcpContentItem{{Type: "text", Text: "done"}}}

	default:
		return &mcpJSONRPCResponse{JSONRPC: "2.0", ID: id,
			Error: &mcpError{Code: -32602, Message: "Unknown tool: " + params.Name}}
	}

	return &mcpJSONRPCResponse{JSONRPC: "2.0", ID: id, Result: result}
}
