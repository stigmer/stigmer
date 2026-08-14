package harness

import (
	"context"
	"encoding/base64"
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

// imageParams is intentionally empty: the image tool takes no arguments. A
// dedicated type is still required because mcp.AddTool derives the tool's input
// schema from it.
type imageParams struct{}

// onePixelPNG is a minimal valid 1x1 PNG. We carry real (if tiny) image bytes so
// the test exercises the exact MCP image-content path a computer-use screenshot
// takes, not a stand-in. mcp.ImageContent.Data is raw bytes; the SDK base64-
// encodes it on the wire.
var onePixelPNG = mustDecodeBase64(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
)

func mustDecodeBase64(s string) []byte {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		panic("mcp_http_server: invalid base64 image fixture: " + err.Error())
	}
	return b
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

// imageTool returns a multimodal tool result: a short text block followed by an
// MCP ImageContent block — the spec-defined way a server returns an image
// alongside descriptive text (e.g. a computer-use screenshot with a status
// line). It is the deterministic stand-in for tools like open-computer-use's
// get_app_state, which return both the app-state text and a screenshot. The
// text block is what lets the calling agent treat the call as "done" and move
// on (a pure-image result gives the model nothing to read, so it tends to
// abandon the call); the image block is what the UI must render inline rather
// than as raw JSON. Used to reproduce and guard the image-result pipeline across
// both harnesses.
func imageTool(_ context.Context, _ *mcp.CallToolRequest, _ *imageParams) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: "Screen captured. App state: ready."},
			&mcp.ImageContent{Data: onePixelPNG, MIMEType: "image/png"},
		},
	}, nil, nil
}

// newStreamableMcpHandler builds the Streamable HTTP handler exposing the
// same tools as the stdio test server (echo, add, fail, slow, image).
// Shared by the open and auth-gated server constructors below.
func newStreamableMcpHandler() http.Handler {
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
	mcp.AddTool(server, &mcp.Tool{
		Name:        "image",
		Description: "Captures the current screen and returns a status line plus a PNG screenshot as MCP image content. For testing inline image rendering of tool results.",
	}, imageTool)

	return mcp.NewStreamableHTTPHandler(func(_ *http.Request) *mcp.Server {
		return server
	}, nil)
}

func startHTTPServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	httpServer := httptest.NewServer(handler)
	t.Cleanup(func() {
		httpServer.CloseClientConnections()
		httpServer.Close()
	})
	t.Logf("HTTP MCP test server (streamable) started at %s", httpServer.URL)
	return httpServer
}

// StartHTTPMcpServer starts an in-process Streamable HTTP MCP test server.
// The server exposes the same tools as the stdio test server (echo, add, fail,
// slow) using the official MCP Go SDK transport expected by the native
// agent-runner (streamable_http).
func StartHTTPMcpServer(t *testing.T) *httptest.Server {
	t.Helper()
	return startHTTPServer(t, newStreamableMcpHandler())
}

// StartHTTPMcpServerRequiringAuth is StartHTTPMcpServer behind an
// Authorization gate: every request must carry exactly
// expectedAuthorization or is refused with 401 before reaching the MCP
// handler. Fail-closed by construction — discovery against this server can
// only succeed when the resolved header actually delivered the credential,
// which is what makes it the pin for the is_secret delivery path
// (issue #579): a redacted or placeholder-literal value never discovers.
func StartHTTPMcpServerRequiringAuth(t *testing.T, expectedAuthorization string) *httptest.Server {
	t.Helper()

	inner := newStreamableMcpHandler()
	gated := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != expectedAuthorization {
			t.Logf("HTTP MCP auth gate: refusing request with Authorization=%q", r.Header.Get("Authorization"))
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		inner.ServeHTTP(w, r)
	})
	return startHTTPServer(t, gated)
}
