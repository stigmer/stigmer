package domains

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// FetchFunc is the signature shared by domain Fetch and Delete functions that
// take org + slug and return a JSON string.
type FetchFunc func(ctx context.Context, serverAddr, org, slug string) (string, error)

// TextResult wraps a plain text string into the CallToolResult structure
// expected by MCP tool handlers.
func TextResult(text string) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
	}, nil, nil
}

// CallFetch calls fn and wraps its output in a CallToolResult. Use this in
// tool handlers for get and delete operations that take org + slug.
func CallFetch(fn FetchFunc, ctx context.Context, serverAddr, org, slug string) (*mcp.CallToolResult, any, error) {
	text, err := fn(ctx, serverAddr, org, slug)
	if err != nil {
		return nil, nil, err
	}
	return TextResult(text)
}
