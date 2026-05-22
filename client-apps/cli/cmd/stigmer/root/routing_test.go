package root

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
)

// TestTypeResolution_AllAliases verifies that all resource type aliases
// resolve correctly to their canonical types.
func TestTypeResolution_AllAliases(t *testing.T) {
	reg := types.DefaultRegistry()

	tests := []struct {
		input    string
		wantName string
	}{
		// Agent aliases
		{"agent", "Agent"},
		{"agents", "Agent"},
		{"agt", "Agent"},
		{"Agent", "Agent"},
		{"AGENT", "Agent"},
		{"AGENTS", "Agent"},

		// Workflow aliases
		{"workflow", "Workflow"},
		{"workflows", "Workflow"},
		{"wfl", "Workflow"},
		{"Workflow", "Workflow"},
		{"WORKFLOW", "Workflow"},

		// Skill aliases
		{"skill", "Skill"},
		{"skills", "Skill"},
		{"skl", "Skill"},
		{"Skill", "Skill"},
		{"SKILL", "Skill"},

		// McpServer aliases (complex case with hyphen/underscore variations)
		{"mcpserver", "McpServer"},
		{"mcp-server", "McpServer"},
		{"mcp_server", "McpServer"},
		{"mcpservers", "McpServer"},
		{"mcp-servers", "McpServer"},
		{"mcp", "McpServer"},
		{"MCP", "McpServer"},
		{"McpServer", "McpServer"},
		{"MCPSERVER", "McpServer"},

		// Project aliases
		{"project", "Project"},
		{"projects", "Project"},
		{"prj", "Project"},
		{"Project", "Project"},
		{"PROJECT", "Project"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			info, ok := reg.GetByAlias(tt.input)
			if !ok {
				t.Fatalf("expected to find type for alias %q, but not found", tt.input)
			}
			if info.Name != tt.wantName {
				t.Errorf("alias %q resolved to %q, want %q", tt.input, info.Name, tt.wantName)
			}
		})
	}
}

// TestTypeResolution_InvalidAliases verifies that unknown aliases
// are correctly rejected.
func TestTypeResolution_InvalidAliases(t *testing.T) {
	reg := types.DefaultRegistry()

	invalidAliases := []string{
		"unknown",
		"foo",
		"bar",
		"agnt",        // typo
		"wrkflow",     // typo
		"server",      // partial match
		"task",        // not a resource type
		"execution",   // not a resource type
		"",            // empty string
		"   ",         // whitespace only
		"agent agent", // multiple words
	}

	for _, alias := range invalidAliases {
		t.Run(alias, func(t *testing.T) {
			_, ok := reg.GetByAlias(alias)
			if ok {
				t.Errorf("expected alias %q to be rejected, but was accepted", alias)
			}
		})
	}
}

// TestTypeResolution_CaseInsensitive verifies that type resolution
// is case-insensitive for all types.
func TestTypeResolution_CaseInsensitive(t *testing.T) {
	reg := types.DefaultRegistry()

	caseVariations := []struct {
		variations []string
		wantName   string
	}{
		{
			variations: []string{"agent", "AGENT", "Agent", "aGeNt"},
			wantName:   "Agent",
		},
		{
			variations: []string{"workflow", "WORKFLOW", "Workflow", "WoRkFlOw"},
			wantName:   "Workflow",
		},
		{
			variations: []string{"mcp", "MCP", "Mcp", "MCP"},
			wantName:   "McpServer",
		},
	}

	for _, tt := range caseVariations {
		for _, variation := range tt.variations {
			t.Run(variation, func(t *testing.T) {
				info, ok := reg.GetByAlias(variation)
				if !ok {
					t.Fatalf("expected case-insensitive match for %q", variation)
				}
				if info.Name != tt.wantName {
					t.Errorf("got %q, want %q", info.Name, tt.wantName)
				}
			})
		}
	}
}

// TestTypeResolution_PluralForms verifies that plural forms resolve
// to the same type as singular forms.
func TestTypeResolution_PluralForms(t *testing.T) {
	reg := types.DefaultRegistry()

	singularPluralPairs := []struct {
		singular string
		plural   string
		wantName string
	}{
		{"agent", "agents", "Agent"},
		{"workflow", "workflows", "Workflow"},
		{"skill", "skills", "Skill"},
		{"project", "projects", "Project"},
		{"mcpserver", "mcpservers", "McpServer"},
		{"mcp-server", "mcp-servers", "McpServer"},
	}

	for _, tt := range singularPluralPairs {
		t.Run(tt.singular+"_"+tt.plural, func(t *testing.T) {
			singularInfo, singularOK := reg.GetByAlias(tt.singular)
			pluralInfo, pluralOK := reg.GetByAlias(tt.plural)

			if !singularOK {
				t.Fatalf("singular %q not found", tt.singular)
			}
			if !pluralOK {
				t.Fatalf("plural %q not found", tt.plural)
			}

			if singularInfo.Name != pluralInfo.Name {
				t.Errorf("singular %q and plural %q resolved to different types: %q vs %q",
					tt.singular, tt.plural, singularInfo.Name, pluralInfo.Name)
			}
			if singularInfo.Name != tt.wantName {
				t.Errorf("resolved to %q, want %q", singularInfo.Name, tt.wantName)
			}
		})
	}
}

// TestTypeResolution_IdPrefixAliases verifies that ID prefix aliases
// (agt, wfl, skl, etc.) resolve correctly.
func TestTypeResolution_IdPrefixAliases(t *testing.T) {
	reg := types.DefaultRegistry()

	tests := []struct {
		idPrefix string
		wantName string
	}{
		{"agt", "Agent"},
		{"wfl", "Workflow"},
		{"skl", "Skill"},
		{"mcp", "McpServer"},
		{"prj", "Project"},
	}

	for _, tt := range tests {
		t.Run(tt.idPrefix, func(t *testing.T) {
			info, ok := reg.GetByAlias(tt.idPrefix)
			if !ok {
				t.Fatalf("ID prefix %q not found", tt.idPrefix)
			}
			if info.Name != tt.wantName {
				t.Errorf("ID prefix %q resolved to %q, want %q", tt.idPrefix, info.Name, tt.wantName)
			}
		})
	}
}

// TestTypeResolution_RegistryCompleteness verifies that all CLI-relevant
// types are registered and have required metadata.
func TestTypeResolution_RegistryCompleteness(t *testing.T) {
	reg := types.DefaultRegistry()
	allTypes := reg.All()

	// Verify we have exactly 13 CLI-relevant types (7 original + 6 T02 additions)
	if len(allTypes) != 13 {
		t.Errorf("expected 13 CLI-relevant types, got %d", len(allTypes))
	}

	expectedTypes := []string{
		"Organization", "Agent", "Workflow", "Skill", "McpServer", "Project", "ApiKey",
		"IdentityProvider", "OAuthApp", "Environment", "AgentInstance", "WorkflowInstance", "Session",
	}
	found := make(map[string]bool)

	for _, info := range allTypes {
		found[info.Name] = true

		// Verify required metadata
		if info.Name == "" {
			t.Error("type has empty Name")
		}
		if info.DisplayName == "" {
			t.Errorf("type %s has empty DisplayName", info.Name)
		}
		if info.IdPrefix == "" {
			t.Errorf("type %s has empty IdPrefix", info.Name)
		}
		if info.Singular == "" {
			t.Errorf("type %s has empty Singular", info.Name)
		}
		if info.Plural == "" {
			t.Errorf("type %s has empty Plural", info.Name)
		}
		if len(info.Aliases) == 0 {
			t.Errorf("type %s has no aliases", info.Name)
		}
		if info.SupportedVerbs == nil {
			t.Errorf("type %s has nil SupportedVerbs", info.Name)
		}

		// Verify singular is lowercase of Name
		if !strings.EqualFold(info.Singular, strings.ToLower(info.Name)) {
			// McpServer -> mcpserver is expected
			if info.Name == "McpServer" && info.Singular == "mcpserver" {
				// OK
			} else if info.Singular != strings.ToLower(info.Name) {
				t.Errorf("type %s: singular %q should be lowercase of name", info.Name, info.Singular)
			}
		}
	}

	// Verify all expected types are present
	for _, expected := range expectedTypes {
		if !found[expected] {
			t.Errorf("expected type %s not found in registry", expected)
		}
	}
}
