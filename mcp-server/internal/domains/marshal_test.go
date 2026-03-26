package domains_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/proto/ai/stigmer/commons/apiresource/apiresourcekind"
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
