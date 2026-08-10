// mcp-test-server is a deterministic MCP server for integration tests.
// It communicates over stdio using JSON-RPC 2.0 and exposes five tools:
//   - echo: returns its input unchanged
//   - add: sums two numbers
//   - fail: always returns an error
//   - slow: sleeps for the given duration then returns "done"
//   - crash: exits immediately
//
// Flags:
//   --env-report <path>: at startup, write the NAMES of this process's
//     environment variables to <path>, one per line, sorted. Used by the
//     stdio env-isolation guard (oss#256) to assert what the spawning
//     runner passed into the subprocess.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

// JSON-RPC 2.0 message types

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonRPCResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id"`
	Result  any       `json:"result,omitempty"`
	Error   *rpcError `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// MCP protocol types

type initializeResult struct {
	ProtocolVersion string         `json:"protocolVersion"`
	Capabilities    map[string]any `json:"capabilities"`
	ServerInfo      serverInfo     `json:"serverInfo"`
}

type serverInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type toolInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"inputSchema"`
}

type toolsListResult struct {
	Tools []toolInfo `json:"tools"`
}

type callToolParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type toolResult struct {
	Content []contentItem `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

type contentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

var tools = []toolInfo{
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
	{
		Name:        "crash",
		Description: "Terminates the MCP server process immediately. For testing execution failure and recovery.",
		InputSchema: map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
	},
}

func main() {
	if path := envReportPath(os.Args[1:]); path != "" {
		if err := writeEnvReport(path); err != nil {
			fmt.Fprintf(os.Stderr, "mcp-test-server: env report: %v\n", err)
		}
	}

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var req jsonRPCRequest
		if err := json.Unmarshal(line, &req); err != nil {
			writeError(nil, -32700, "Parse error: "+err.Error())
			continue
		}

		handleRequest(&req)
	}

	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "mcp-test-server: scanner error: %v\n", err)
		os.Exit(1)
	}
}

func handleRequest(req *jsonRPCRequest) {
	switch req.Method {
	case "initialize":
		writeResult(req.ID, initializeResult{
			ProtocolVersion: "2024-11-05",
			Capabilities: map[string]any{
				"tools": map[string]any{"listChanged": false},
			},
			ServerInfo: serverInfo{Name: "mcp-test-server", Version: "1.0.0"},
		})

	case "notifications/initialized":
		// No response needed for notifications

	case "tools/list":
		writeResult(req.ID, toolsListResult{Tools: tools})

	case "tools/call":
		var params callToolParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			writeError(req.ID, -32602, "Invalid params: "+err.Error())
			return
		}
		handleToolCall(req.ID, &params)

	case "ping":
		writeResult(req.ID, map[string]any{})

	default:
		writeError(req.ID, -32601, "Method not found: "+req.Method)
	}
}

func handleToolCall(id any, params *callToolParams) {
	switch params.Name {
	case "echo":
		input, _ := params.Arguments["input"].(string)
		writeResult(id, toolResult{
			Content: []contentItem{{Type: "text", Text: input}},
		})

	case "add":
		a, _ := params.Arguments["a"].(float64)
		b, _ := params.Arguments["b"].(float64)
		writeResult(id, toolResult{
			Content: []contentItem{{Type: "text", Text: fmt.Sprintf("%g", a+b)}},
		})

	case "fail":
		msg, _ := params.Arguments["message"].(string)
		if msg == "" {
			msg = "tool execution failed"
		}
		writeResult(id, toolResult{
			Content: []contentItem{{Type: "text", Text: "Error: " + msg}},
			IsError: true,
		})

	case "slow":
		seconds, _ := params.Arguments["seconds"].(float64)
		if seconds > 0 {
			time.Sleep(time.Duration(seconds * float64(time.Second)))
		}
		writeResult(id, toolResult{
			Content: []contentItem{{Type: "text", Text: "done"}},
		})

	case "crash":
		os.Exit(1)

	default:
		writeError(id, -32602, "Unknown tool: "+params.Name)
	}
}

// envReportPath extracts the --env-report flag value from args, if present.
func envReportPath(args []string) string {
	for i, arg := range args {
		if arg == "--env-report" && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

// writeEnvReport writes the NAMES of this process's environment variables to
// path, one per line, sorted. Names only, never values: the report is read by
// tests asserting env isolation and must stay safe to surface in CI logs even
// when the parent process holds real credentials.
func writeEnvReport(path string) error {
	environ := os.Environ()
	keys := make([]string, 0, len(environ))
	for _, entry := range environ {
		if i := strings.IndexByte(entry, '='); i > 0 {
			keys = append(keys, entry[:i])
		}
	}
	sort.Strings(keys)
	return os.WriteFile(path, []byte(strings.Join(keys, "\n")+"\n"), 0o644)
}

func writeResult(id any, result any) {
	resp := jsonRPCResponse{JSONRPC: "2.0", ID: id, Result: result}
	data, _ := json.Marshal(resp)
	fmt.Println(string(data))
}

func writeError(id any, code int, message string) {
	resp := jsonRPCResponse{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: message}}
	data, _ := json.Marshal(resp)
	fmt.Println(string(data))
}
