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
		// Basic cases
		{"empty query", "", ""},
		{"single word", "kubernetes", `"kubernetes"*`},
		{"multiple words", "kubernetes deployment", `"kubernetes" "deployment"`},
		{"whitespace trimmed", "  hello  ", `"hello"*`},

		// FTS5 operators are neutralized (treated as literal words)
		{"AND treated as literal", "foo AND bar", `"foo" "AND" "bar"`},
		{"OR treated as literal", "foo OR bar", `"foo" "OR" "bar"`},
		{"NOT treated as literal", "foo NOT bar", `"foo" "NOT" "bar"`},
		{"NEAR treated as literal", "foo NEAR bar", `"foo" "NEAR" "bar"`},

		// Column-filter syntax neutralized (the original crash scenario)
		{"colon in single token", "server:skill-creator", `"server:skill-creator"*`},
		{"colon with simple term", "name:kubernetes", `"name:kubernetes"*`},
		{"colon in multi-word query", "find server:something here", `"find" "server:something" "here"`},

		// Dash (FTS5 NOT operator) neutralized
		{"dash in token", "mcp-server", `"mcp-server"*`},
		{"leading dash", "-excluded", `"-excluded"*`},
		{"dash in multi-word", "mcp-server deployment", `"mcp-server" "deployment"`},

		// Other special characters neutralized
		{"asterisk in token", "kube*", `"kube*"*`},
		{"parentheses", "NEAR(a b)", `"NEAR(a" "b)"`},
		{"brackets", "test[0]", `"test[0]"*`},
		{"caret", "^boost", `"^boost"*`},

		// Embedded double quotes are stripped before quoting
		{"embedded quotes stripped", `foo"bar`, `"foobar"*`},
		{"only quotes", `"""`, ""},

		// Multi-word with mixed specials
		{"mixed specials multi-word", `server:x mcp-server kube*`, `"server:x" "mcp-server" "kube*"`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := escapeFTS5Query(tc.input)
			if result != tc.expected {
				t.Errorf("expected %q, got %q", tc.expected, result)
			}
		})
	}
}

func TestParseKind(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected apiresourcekind.ApiResourceKind
		expectOK bool
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

