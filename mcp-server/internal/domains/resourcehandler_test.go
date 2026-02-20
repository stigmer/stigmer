package domains

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestResourceResult(t *testing.T) {
	result := ResourceResult("stigmer://agents/acme/bot", `{"kind":"Agent"}`)

	if len(result.Contents) != 1 {
		t.Fatalf("Contents len = %d, want 1", len(result.Contents))
	}
	rc := result.Contents[0]
	if rc.URI != "stigmer://agents/acme/bot" {
		t.Errorf("URI = %q, want %q", rc.URI, "stigmer://agents/acme/bot")
	}
	if rc.MIMEType != "application/json" {
		t.Errorf("MIMEType = %q, want %q", rc.MIMEType, "application/json")
	}
	if rc.Text != `{"kind":"Agent"}` {
		t.Errorf("Text = %q, want %q", rc.Text, `{"kind":"Agent"}`)
	}
}

func TestNewResourceHandler_success(t *testing.T) {
	var gotOrg, gotSlug, gotAddr string
	fetchFn := func(_ context.Context, serverAddr, org, slug string) (string, error) {
		gotAddr, gotOrg, gotSlug = serverAddr, org, slug
		return `{"found":true}`, nil
	}

	handler := NewResourceHandler(fetchFn, "addr:1234", "agents")
	result, err := handler(context.Background(), &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://agents/acme/my-agent"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotAddr != "addr:1234" {
		t.Errorf("serverAddr = %q, want %q", gotAddr, "addr:1234")
	}
	if gotOrg != "acme" {
		t.Errorf("org = %q, want %q", gotOrg, "acme")
	}
	if gotSlug != "my-agent" {
		t.Errorf("slug = %q, want %q", gotSlug, "my-agent")
	}
	if len(result.Contents) != 1 {
		t.Fatalf("Contents len = %d, want 1", len(result.Contents))
	}
	if result.Contents[0].Text != `{"found":true}` {
		t.Errorf("Text = %q, want %q", result.Contents[0].Text, `{"found":true}`)
	}
}

func TestNewResourceHandler_malformedURI(t *testing.T) {
	fetchFn := func(_ context.Context, _, _, _ string) (string, error) {
		t.Fatal("fetchFn should not be called for malformed URI")
		return "", nil
	}

	handler := NewResourceHandler(fetchFn, "addr:1234", "agents")
	_, err := handler(context.Background(), &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://agents/just-one-segment"},
	})
	if err == nil {
		t.Fatal("expected error for malformed URI, got nil")
	}
	if !strings.Contains(err.Error(), "agents resource") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "agents resource")
	}
}

func TestNewResourceHandler_fetchError(t *testing.T) {
	fetchFn := func(_ context.Context, _, _, _ string) (string, error) {
		return "", fmt.Errorf("fetch failed")
	}

	handler := NewResourceHandler(fetchFn, "addr:1234", "agents")
	_, err := handler(context.Background(), &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://agents/acme/my-agent"},
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "fetch failed" {
		t.Errorf("error = %q, want %q", err.Error(), "fetch failed")
	}
}

func TestNewVersionedResourceHandler_success(t *testing.T) {
	var gotOrg, gotSlug, gotVersion string
	fetchFn := func(_ context.Context, _, org, slug, version string) (string, error) {
		gotOrg, gotSlug, gotVersion = org, slug, version
		return `{"version":"v1.0"}`, nil
	}

	handler := NewVersionedResourceHandler(fetchFn, "addr:1234", "skills")
	result, err := handler(context.Background(), &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme/my-skill/v1.0"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotOrg != "acme" {
		t.Errorf("org = %q, want %q", gotOrg, "acme")
	}
	if gotSlug != "my-skill" {
		t.Errorf("slug = %q, want %q", gotSlug, "my-skill")
	}
	if gotVersion != "v1.0" {
		t.Errorf("version = %q, want %q", gotVersion, "v1.0")
	}
	if result.Contents[0].Text != `{"version":"v1.0"}` {
		t.Errorf("Text = %q, want %q", result.Contents[0].Text, `{"version":"v1.0"}`)
	}
}

func TestNewVersionedResourceHandler_noVersion(t *testing.T) {
	var gotVersion string
	fetchFn := func(_ context.Context, _, _, _, version string) (string, error) {
		gotVersion = version
		return `{"latest":true}`, nil
	}

	handler := NewVersionedResourceHandler(fetchFn, "addr:1234", "skills")
	result, err := handler(context.Background(), &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "stigmer://skills/acme/my-skill"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotVersion != "" {
		t.Errorf("version = %q, want empty", gotVersion)
	}
	if result.Contents[0].Text != `{"latest":true}` {
		t.Errorf("Text = %q, want %q", result.Contents[0].Text, `{"latest":true}`)
	}
}

func TestNewVersionedResourceHandler_malformedURI(t *testing.T) {
	fetchFn := func(_ context.Context, _, _, _, _ string) (string, error) {
		t.Fatal("fetchFn should not be called for malformed URI")
		return "", nil
	}

	handler := NewVersionedResourceHandler(fetchFn, "addr:1234", "skills")
	_, err := handler(context.Background(), &mcp.ReadResourceRequest{
		Params: &mcp.ReadResourceParams{URI: "http://wrong-scheme/a/b"},
	})
	if err == nil {
		t.Fatal("expected error for malformed URI, got nil")
	}
	if !strings.Contains(err.Error(), "skills versioned resource") {
		t.Errorf("error = %q, want it to contain %q", err.Error(), "skills versioned resource")
	}
}
