package domains

import (
	"context"
	"fmt"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestTextResult(t *testing.T) {
	result, meta, err := TextResult("hello world")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if meta != nil {
		t.Errorf("meta = %v, want nil", meta)
	}
	if result == nil {
		t.Fatal("result is nil")
	}
	if len(result.Content) != 1 {
		t.Fatalf("Content len = %d, want 1", len(result.Content))
	}
	tc, ok := result.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("Content[0] is %T, want *mcp.TextContent", result.Content[0])
	}
	if tc.Text != "hello world" {
		t.Errorf("Text = %q, want %q", tc.Text, "hello world")
	}
}

func TestTextResult_emptyString(t *testing.T) {
	result, _, err := TextResult("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	tc := result.Content[0].(*mcp.TextContent)
	if tc.Text != "" {
		t.Errorf("Text = %q, want empty", tc.Text)
	}
}

func TestCallFetch_success(t *testing.T) {
	var gotOrg, gotSlug string
	fetchFn := func(_ context.Context, _ string, org, slug string) (string, error) {
		gotOrg, gotSlug = org, slug
		return `{"found":true}`, nil
	}

	result, _, err := CallFetch(fetchFn, context.Background(), "addr:1234", "acme", "my-resource")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotOrg != "acme" {
		t.Errorf("org = %q, want %q", gotOrg, "acme")
	}
	if gotSlug != "my-resource" {
		t.Errorf("slug = %q, want %q", gotSlug, "my-resource")
	}
	tc := result.Content[0].(*mcp.TextContent)
	if tc.Text != `{"found":true}` {
		t.Errorf("Text = %q, want %q", tc.Text, `{"found":true}`)
	}
}

func TestCallFetch_error(t *testing.T) {
	fetchFn := func(_ context.Context, _, _, _ string) (string, error) {
		return "", fmt.Errorf("not found")
	}

	result, meta, err := CallFetch(fetchFn, context.Background(), "addr", "org", "slug")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if result != nil {
		t.Errorf("result = %v, want nil", result)
	}
	if meta != nil {
		t.Errorf("meta = %v, want nil", meta)
	}
}

func TestCallApply_success(t *testing.T) {
	var gotJSON string
	applyFn := func(_ context.Context, _ string, resourceJSON string) (string, error) {
		gotJSON = resourceJSON
		return `{"applied":true}`, nil
	}

	result, _, err := CallApply(applyFn, context.Background(), "addr:1234", `{"kind":"Agent"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotJSON != `{"kind":"Agent"}` {
		t.Errorf("resourceJSON = %q, want %q", gotJSON, `{"kind":"Agent"}`)
	}
	tc := result.Content[0].(*mcp.TextContent)
	if tc.Text != `{"applied":true}` {
		t.Errorf("Text = %q, want %q", tc.Text, `{"applied":true}`)
	}
}

func TestCallApply_error(t *testing.T) {
	applyFn := func(_ context.Context, _, _ string) (string, error) {
		return "", fmt.Errorf("invalid JSON")
	}

	result, meta, err := CallApply(applyFn, context.Background(), "addr", `{}`)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if result != nil {
		t.Errorf("result = %v, want nil", result)
	}
	if meta != nil {
		t.Errorf("meta = %v, want nil", meta)
	}
}
