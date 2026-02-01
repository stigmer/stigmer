package store

import (
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestEscapeFTS5Query(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty query", "", ""},
		{"single word", "kubernetes", "kubernetes*"},
		{"multiple words", "kubernetes deployment", "kubernetes deployment"},
		{"whitespace trimmed", "  hello  ", "hello*"},
		{"complex query with AND", "foo AND bar", "foo AND bar"},
		{"complex query with OR", "foo OR bar", "foo OR bar"},
		{"query with special char quote", `foo"bar`, `foo"bar`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := escapeFTS5Query(tc.input)
			if result != tc.expected {
				t.Errorf("expected '%s', got '%s'", tc.expected, result)
			}
		})
	}
}

func TestParseKind(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		expected  apiresourcekind.ApiResourceKind
		expectOK  bool
	}{
		{"agent", "agent", apiresourcekind.ApiResourceKind_agent, true},
		{"skill", "skill", apiresourcekind.ApiResourceKind_skill, true},
		{"mcp_server", "mcp_server", apiresourcekind.ApiResourceKind_mcp_server, true},
		{"workflow", "workflow", apiresourcekind.ApiResourceKind_workflow, true},
		{"invalid", "invalid_kind", 0, false},
		{"empty", "", 0, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result, ok := parseKind(tc.input)
			if ok != tc.expectOK {
				t.Errorf("expected ok=%v, got ok=%v", tc.expectOK, ok)
			}
			if ok && result != tc.expected {
				t.Errorf("expected %v, got %v", tc.expected, result)
			}
		})
	}
}

func TestNormalizeScore(t *testing.T) {
	tests := []struct {
		name      string
		bm25Score float64
		minScore  float32
		maxScore  float32
	}{
		{"zero score", 0, 1.0, 1.0},
		{"positive score", 1.0, 1.0, 1.0},
		{"negative score -1", -1.0, 0.8, 1.0},
		{"negative score -5", -5.0, 0.4, 0.6},
		{"very negative", -15.0, 0, 0.1},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := normalizeScore(tc.bm25Score)
			if result < tc.minScore || result > tc.maxScore {
				t.Errorf("score %f not in range [%f, %f]", result, tc.minScore, tc.maxScore)
			}
		})
	}
}

func TestCreateEmptyProtoForKind(t *testing.T) {
	tests := []struct {
		name     string
		kind     apiresourcekind.ApiResourceKind
		expectNil bool
	}{
		{"agent", apiresourcekind.ApiResourceKind_agent, false},
		{"skill", apiresourcekind.ApiResourceKind_skill, false},
		{"mcp_server", apiresourcekind.ApiResourceKind_mcp_server, false},
		{"workflow", apiresourcekind.ApiResourceKind_workflow, false},
		{"unsupported", apiresourcekind.ApiResourceKind_session, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := createEmptyProtoForKind(tc.kind)
			if tc.expectNil && result != nil {
				t.Error("expected nil for unsupported kind")
			}
			if !tc.expectNil && result == nil {
				t.Error("expected non-nil proto for supported kind")
			}
		})
	}
}
