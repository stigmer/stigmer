package domains_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

func TestMarshalJSON_validMessage(t *testing.T) {
	ref := &apiresource.ApiResourceReference{
		Org:  "acme",
		Kind: apiresourcekind.ApiResourceKind_agent,
		Slug: "code-reviewer",
	}

	got, err := domains.MarshalJSON(ref)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v\ngot: %s", err, got)
	}

	if parsed["org"] != "acme" {
		t.Errorf("org = %v, want %q", parsed["org"], "acme")
	}
	if parsed["slug"] != "code-reviewer" {
		t.Errorf("slug = %v, want %q", parsed["slug"], "code-reviewer")
	}
}

func TestMarshalJSON_usesProtoNames(t *testing.T) {
	ref := &apiresource.ApiResourceReference{
		Org:  "acme",
		Kind: apiresourcekind.ApiResourceKind_agent,
		Slug: "code-reviewer",
	}

	got, err := domains.MarshalJSON(ref)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if strings.Contains(got, "apiVersion") {
		t.Error("output uses camelCase field names; expected snake_case (UseProtoNames: true)")
	}
}

func TestMarshalJSON_nilMessage(t *testing.T) {
	got, err := domains.MarshalJSON(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if strings.TrimSpace(got) != "{}" {
		t.Errorf("MarshalJSON(nil) = %q, want %q", got, "{}")
	}
}

func TestUnmarshalJSON_validMessage(t *testing.T) {
	input := `{"org": "acme", "kind": "agent", "slug": "code-reviewer"}`
	var ref apiresource.ApiResourceReference
	if err := domains.UnmarshalJSON(input, &ref); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ref.Org != "acme" {
		t.Errorf("Org = %q, want %q", ref.Org, "acme")
	}
	if ref.Slug != "code-reviewer" {
		t.Errorf("Slug = %q, want %q", ref.Slug, "code-reviewer")
	}
}

func TestUnmarshalJSON_discardsUnknownFields(t *testing.T) {
	input := `{"org": "acme", "slug": "code-reviewer", "unknown_field": "ignored"}`
	var ref apiresource.ApiResourceReference
	if err := domains.UnmarshalJSON(input, &ref); err != nil {
		t.Fatalf("expected unknown fields to be discarded, got error: %v", err)
	}
	if ref.Org != "acme" {
		t.Errorf("Org = %q, want %q", ref.Org, "acme")
	}
}

func TestUnmarshalJSON_invalidJSON(t *testing.T) {
	if err := domains.UnmarshalJSON("{not valid json", &apiresource.ApiResourceReference{}); err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}
