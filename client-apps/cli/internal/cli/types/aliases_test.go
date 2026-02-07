package types

import (
	"testing"
)

func TestGenerateAliases_McpServer(t *testing.T) {
	aliases := GenerateAliases("McpServer", "MCP Server", "mcp")

	// These are the unique lowercase forms that should be generated
	// The lookup is case-insensitive, so we check normalized forms
	expected := map[string]bool{
		"mcpserver":   true, // lowercase(name)
		"mcp-server":  true, // kebab-case(name)
		"mcp_server":  true, // snake_case(name)
		"mcp":         true, // display_name word[0] / idPrefix
		"mcpservers":  true, // pluralize(mcpserver)
		"mcp-servers": true, // pluralize(mcp-server)
		"mcp_servers": true, // pluralize(mcp_server)
		"mcps":        true, // pluralize(mcp)
	}

	found := make(map[string]bool)
	for _, alias := range aliases {
		found[NormalizeAlias(alias)] = true
	}

	for exp := range expected {
		if !found[exp] {
			t.Errorf("expected alias %q not generated", exp)
		}
	}
}

func TestGenerateAliases_Agent(t *testing.T) {
	aliases := GenerateAliases("Agent", "Agent", "agt")

	// Check normalized (lowercase) forms
	expected := map[string]bool{
		"agent":  true,
		"agt":    true,
		"agents": true,
		"agts":   true,
	}

	found := make(map[string]bool)
	for _, alias := range aliases {
		found[NormalizeAlias(alias)] = true
	}

	for exp := range expected {
		if !found[exp] {
			t.Errorf("expected alias %q not generated", exp)
		}
	}
}

func TestGenerateAliases_Workflow(t *testing.T) {
	aliases := GenerateAliases("Workflow", "Workflow", "wfl")

	// Check normalized (lowercase) forms
	expected := map[string]bool{
		"workflow":  true,
		"wfl":       true,
		"workflows": true,
		"wfls":      true,
	}

	found := make(map[string]bool)
	for _, alias := range aliases {
		found[NormalizeAlias(alias)] = true
	}

	for exp := range expected {
		if !found[exp] {
			t.Errorf("expected alias %q not generated", exp)
		}
	}
}

func TestGenerateAliases_NoDuplicates(t *testing.T) {
	aliases := GenerateAliases("Agent", "Agent", "agent")

	seen := make(map[string]int)
	for _, alias := range aliases {
		lower := NormalizeAlias(alias)
		seen[lower]++
	}

	for alias, count := range seen {
		if count > 1 {
			t.Errorf("duplicate alias %q found %d times", alias, count)
		}
	}
}

func TestToKebabCase(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"McpServer", "mcp-server"},
		{"Agent", "agent"},
		{"AgentInstance", "agent-instance"},
		{"WorkflowExecution", "workflow-execution"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := toKebabCase(tt.input)
			if result != tt.expected {
				t.Errorf("toKebabCase(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestToSnakeCase(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"McpServer", "mcp_server"},
		{"Agent", "agent"},
		{"AgentInstance", "agent_instance"},
		{"WorkflowExecution", "workflow_execution"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := toSnakeCase(tt.input)
			if result != tt.expected {
				t.Errorf("toSnakeCase(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestPluralize(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"agent", "agents"},
		{"workflow", "workflows"},
		{"mcpserver", "mcpservers"},
		{"agents", "agents"}, // Already plural
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := pluralize(tt.input)
			if result != tt.expected {
				t.Errorf("pluralize(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestNormalizeAlias(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Agent", "agent"},
		{"  agent  ", "agent"},
		{"MCP-Server", "mcp-server"},
		{"WORKFLOW", "workflow"},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := NormalizeAlias(tt.input)
			if result != tt.expected {
				t.Errorf("NormalizeAlias(%q) = %q, expected %q", tt.input, result, tt.expected)
			}
		})
	}
}
