package harness

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type echoParams struct {
	Input string `json:"input" jsonschema:"the value to echo back"`
}

type addParams struct {
	A float64 `json:"a" jsonschema:"first operand"`
	B float64 `json:"b" jsonschema:"second operand"`
}

type failParams struct {
	Message string `json:"message" jsonschema:"error message to return"`
}

type slowParams struct {
	Seconds float64 `json:"seconds" jsonschema:"seconds to sleep"`
}

func echoTool(_ context.Context, _ *mcp.CallToolRequest, params *echoParams) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: params.Input}},
	}, nil, nil
}

func addTool(_ context.Context, _ *mcp.CallToolRequest, params *addParams) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("%g", params.A+params.B)}},
	}, nil, nil
}

func failTool(_ context.Context, _ *mcp.CallToolRequest, params *failParams) (*mcp.CallToolResult, any, error) {
	msg := params.Message
	if msg == "" {
		msg = "tool execution failed"
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: "Error: " + msg}},
		IsError: true,
	}, nil, nil
}

func slowTool(_ context.Context, _ *mcp.CallToolRequest, params *slowParams) (*mcp.CallToolResult, any, error) {
	if params.Seconds > 0 {
		time.Sleep(time.Duration(params.Seconds * float64(time.Second)))
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: "done"}},
	}, nil, nil
}

// StartHTTPMcpServer starts an in-process Streamable HTTP MCP test server.
// The server exposes the same tools as the stdio test server (echo, add, fail,
// slow) using the official MCP Go SDK transport expected by the native
// agent-runner (streamable_http).
func StartHTTPMcpServer(t *testing.T) *httptest.Server {
	t.Helper()

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "mcp-test-server-http",
		Version: "1.0.0",
	}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "echo",
		Description: "Returns the input unchanged. For deterministic assertion testing.",
	}, echoTool)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "add",
		Description: "Returns the sum of two numbers.",
	}, addTool)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "fail",
		Description: "Always fails with the given error message. For error handling tests.",
	}, failTool)
	mcp.AddTool(server, &mcp.Tool{
		Name:        "slow",
		Description: "Sleeps for the given number of seconds then returns 'done'. For timeout testing.",
	}, slowTool)

	handler := mcp.NewStreamableHTTPHandler(func(_ *http.Request) *mcp.Server {
		return server
	}, nil)

	httpServer := httptest.NewServer(handler)
	t.Cleanup(func() {
		httpServer.CloseClientConnections()
		httpServer.Close()
	})
	t.Logf("HTTP MCP test server (streamable) started at %s", httpServer.URL)
	return httpServer
}
