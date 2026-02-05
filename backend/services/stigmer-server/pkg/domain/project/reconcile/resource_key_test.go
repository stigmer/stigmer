package reconcile

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestNewResourceKey_ValidAgent(t *testing.T) {
	key, err := NewResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if key.Kind() != apiresourcekind.ApiResourceKind_agent {
		t.Errorf("expected kind agent, got %v", key.Kind())
	}
	if key.Slug() != "my-agent" {
		t.Errorf("expected slug 'my-agent', got %q", key.Slug())
	}
	if key.String() != "agent:my-agent" {
		t.Errorf("expected string 'agent:my-agent', got %q", key.String())
	}
}

func TestNewResourceKey_ValidWorkflow(t *testing.T) {
	key, err := NewResourceKey(apiresourcekind.ApiResourceKind_workflow, "data-pipeline")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if key.Kind() != apiresourcekind.ApiResourceKind_workflow {
		t.Errorf("expected kind workflow, got %v", key.Kind())
	}
	if key.Slug() != "data-pipeline" {
		t.Errorf("expected slug 'data-pipeline', got %q", key.Slug())
	}
	if key.String() != "workflow:data-pipeline" {
		t.Errorf("expected string 'workflow:data-pipeline', got %q", key.String())
	}
}

func TestNewResourceKey_ValidMcpServer(t *testing.T) {
	key, err := NewResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "postgres-db")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if key.Kind() != apiresourcekind.ApiResourceKind_mcp_server {
		t.Errorf("expected kind mcp_server, got %v", key.Kind())
	}
	if key.Slug() != "postgres-db" {
		t.Errorf("expected slug 'postgres-db', got %q", key.Slug())
	}
	if key.String() != "mcp_server:postgres-db" {
		t.Errorf("expected string 'mcp_server:postgres-db', got %q", key.String())
	}
}

func TestNewResourceKey_ValidSkill(t *testing.T) {
	key, err := NewResourceKey(apiresourcekind.ApiResourceKind_skill, "web-search")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if key.Kind() != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("expected kind skill, got %v", key.Kind())
	}
	if key.Slug() != "web-search" {
		t.Errorf("expected slug 'web-search', got %q", key.Slug())
	}
	if key.String() != "skill:web-search" {
		t.Errorf("expected string 'skill:web-search', got %q", key.String())
	}
}

func TestNewResourceKey_EmptySlug(t *testing.T) {
	_, err := NewResourceKey(apiresourcekind.ApiResourceKind_agent, "")
	if err == nil {
		t.Error("expected error for empty slug, got nil")
	}
}

func TestNewResourceKey_UnsupportedKind(t *testing.T) {
	tests := []struct {
		name string
		kind apiresourcekind.ApiResourceKind
	}{
		{"project", apiresourcekind.ApiResourceKind_project},
		{"organization", apiresourcekind.ApiResourceKind_organization},
		{"unknown", apiresourcekind.ApiResourceKind_api_resource_kind_unknown},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewResourceKey(tt.kind, "test-slug")
			if err == nil {
				t.Errorf("expected error for unsupported kind %v, got nil", tt.kind)
			}
		})
	}
}

func TestResourceKey_String(t *testing.T) {
	tests := []struct {
		kind     apiresourcekind.ApiResourceKind
		slug     string
		expected string
	}{
		{apiresourcekind.ApiResourceKind_agent, "my-agent", "agent:my-agent"},
		{apiresourcekind.ApiResourceKind_workflow, "pipeline", "workflow:pipeline"},
		{apiresourcekind.ApiResourceKind_mcp_server, "db", "mcp_server:db"},
		{apiresourcekind.ApiResourceKind_skill, "search", "skill:search"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			key := MustResourceKey(tt.kind, tt.slug)
			if key.String() != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, key.String())
			}
		})
	}
}

func TestParseResourceKey_Valid(t *testing.T) {
	tests := []struct {
		input        string
		expectedKind apiresourcekind.ApiResourceKind
		expectedSlug string
	}{
		{"agent:my-agent", apiresourcekind.ApiResourceKind_agent, "my-agent"},
		{"workflow:data-pipeline", apiresourcekind.ApiResourceKind_workflow, "data-pipeline"},
		{"mcp_server:postgres-db", apiresourcekind.ApiResourceKind_mcp_server, "postgres-db"},
		{"skill:web-search", apiresourcekind.ApiResourceKind_skill, "web-search"},
		{"agent:slug-with:colon", apiresourcekind.ApiResourceKind_agent, "slug-with:colon"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			key, err := ParseResourceKey(tt.input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if key.Kind() != tt.expectedKind {
				t.Errorf("expected kind %v, got %v", tt.expectedKind, key.Kind())
			}
			if key.Slug() != tt.expectedSlug {
				t.Errorf("expected slug %q, got %q", tt.expectedSlug, key.Slug())
			}
		})
	}
}

func TestParseResourceKey_InvalidFormat(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"no colon", "agentmy-agent"},
		{"empty kind", ":my-agent"},
		{"empty slug", "agent:"},
		{"unknown kind", "project:my-project"},
		{"empty string", ""},
		{"only colon", ":"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseResourceKey(tt.input)
			if err == nil {
				t.Errorf("expected error for input %q, got nil", tt.input)
			}
		})
	}
}

func TestResourceKey_Equality(t *testing.T) {
	key1 := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	key2 := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	key3 := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "other-agent")
	key4 := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "my-agent")

	// Same kind and slug should be equal
	if key1 != key2 {
		t.Error("expected key1 and key2 to be equal")
	}

	// Different slug should not be equal
	if key1 == key3 {
		t.Error("expected key1 and key3 to not be equal")
	}

	// Different kind should not be equal
	if key1 == key4 {
		t.Error("expected key1 and key4 to not be equal")
	}

	// Use as map key
	m := make(map[ResourceKey]string)
	m[key1] = "value1"
	m[key3] = "value3"

	if m[key2] != "value1" {
		t.Error("expected key2 to retrieve value1 from map")
	}
	if m[key3] != "value3" {
		t.Error("expected key3 to retrieve value3 from map")
	}
}

func TestResourceKey_IsZero(t *testing.T) {
	var zeroKey ResourceKey
	if !zeroKey.IsZero() {
		t.Error("expected zero value ResourceKey to be zero")
	}

	nonZeroKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	if nonZeroKey.IsZero() {
		t.Error("expected non-zero ResourceKey to not be zero")
	}
}
