package types

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestDefaultRegistry_ReturnsAllCLIRelevantTypes(t *testing.T) {
	reg := DefaultRegistry()
	all := reg.All()

	// Should have exactly 14 CLI-relevant types (7 original + 6 T02 additions + runner)
	if len(all) != 14 {
		t.Errorf("expected 14 types, got %d", len(all))
	}

	// Verify expected types are present
	expectedKinds := map[apiresourcekind.ApiResourceKind]bool{
		apiresourcekind.ApiResourceKind_organization:      false,
		apiresourcekind.ApiResourceKind_agent:             false,
		apiresourcekind.ApiResourceKind_workflow:          false,
		apiresourcekind.ApiResourceKind_skill:             false,
		apiresourcekind.ApiResourceKind_mcp_server:        false,
		apiresourcekind.ApiResourceKind_project:           false,
		apiresourcekind.ApiResourceKind_api_key:           false,
		apiresourcekind.ApiResourceKind_identity_provider: false,
		apiresourcekind.ApiResourceKind_oauth_app:         false,
		apiresourcekind.ApiResourceKind_environment:       false,
		apiresourcekind.ApiResourceKind_agent_instance:    false,
		apiresourcekind.ApiResourceKind_workflow_instance: false,
		apiresourcekind.ApiResourceKind_session:           false,
		apiresourcekind.ApiResourceKind_runner:            false,
	}

	for _, info := range all {
		if _, ok := expectedKinds[info.ProtoKind]; ok {
			expectedKinds[info.ProtoKind] = true
		}
	}

	for kind, found := range expectedKinds {
		if !found {
			t.Errorf("expected kind %v not found in registry", kind)
		}
	}
}

func TestRegistry_GetByProtoKind(t *testing.T) {
	reg := DefaultRegistry()

	tests := []struct {
		kind         apiresourcekind.ApiResourceKind
		expectedName string
	}{
		{apiresourcekind.ApiResourceKind_agent, "Agent"},
		{apiresourcekind.ApiResourceKind_workflow, "Workflow"},
		{apiresourcekind.ApiResourceKind_skill, "Skill"},
		{apiresourcekind.ApiResourceKind_mcp_server, "McpServer"},
		{apiresourcekind.ApiResourceKind_project, "Project"},
	}

	for _, tt := range tests {
		t.Run(tt.expectedName, func(t *testing.T) {
			info := reg.GetByProtoKind(tt.kind)
			if info == nil {
				t.Fatalf("expected info for %v, got nil", tt.kind)
			}
			if info.Name != tt.expectedName {
				t.Errorf("expected name %q, got %q", tt.expectedName, info.Name)
			}
		})
	}
}

func TestRegistry_GetByAlias_McpServer(t *testing.T) {
	reg := DefaultRegistry()

	// All these should resolve to McpServer
	aliases := []string{
		"mcpserver",
		"mcp-server",
		"mcp_server",
		"McpServer",
		"MCP",
		"mcp",
		"mcpservers",
		"mcp-servers",
		"MCPSERVER",
		"Mcp-Server",
	}

	for _, alias := range aliases {
		t.Run(alias, func(t *testing.T) {
			info, ok := reg.GetByAlias(alias)
			if !ok {
				t.Fatalf("expected to find type for alias %q", alias)
			}
			if info.Name != "McpServer" {
				t.Errorf("expected McpServer, got %q for alias %q", info.Name, alias)
			}
		})
	}
}

func TestRegistry_GetByAlias_Agent(t *testing.T) {
	reg := DefaultRegistry()

	aliases := []string{
		"agent",
		"Agent",
		"agents",
		"AGENT",
		"agt",
	}

	for _, alias := range aliases {
		t.Run(alias, func(t *testing.T) {
			info, ok := reg.GetByAlias(alias)
			if !ok {
				t.Fatalf("expected to find type for alias %q", alias)
			}
			if info.Name != "Agent" {
				t.Errorf("expected Agent, got %q for alias %q", info.Name, alias)
			}
		})
	}
}

func TestRegistry_GetByAlias_Workflow(t *testing.T) {
	reg := DefaultRegistry()

	aliases := []string{
		"workflow",
		"Workflow",
		"workflows",
		"WORKFLOW",
		"wfl",
	}

	for _, alias := range aliases {
		t.Run(alias, func(t *testing.T) {
			info, ok := reg.GetByAlias(alias)
			if !ok {
				t.Fatalf("expected to find type for alias %q", alias)
			}
			if info.Name != "Workflow" {
				t.Errorf("expected Workflow, got %q for alias %q", info.Name, alias)
			}
		})
	}
}

func TestRegistry_GetByAlias_Skill(t *testing.T) {
	reg := DefaultRegistry()

	aliases := []string{
		"skill",
		"Skill",
		"skills",
		"SKILL",
		"skl",
	}

	for _, alias := range aliases {
		t.Run(alias, func(t *testing.T) {
			info, ok := reg.GetByAlias(alias)
			if !ok {
				t.Fatalf("expected to find type for alias %q", alias)
			}
			if info.Name != "Skill" {
				t.Errorf("expected Skill, got %q for alias %q", info.Name, alias)
			}
		})
	}
}

func TestRegistry_GetByAlias_Project(t *testing.T) {
	reg := DefaultRegistry()

	aliases := []string{
		"project",
		"Project",
		"projects",
		"PROJECT",
		"prj",
	}

	for _, alias := range aliases {
		t.Run(alias, func(t *testing.T) {
			info, ok := reg.GetByAlias(alias)
			if !ok {
				t.Fatalf("expected to find type for alias %q", alias)
			}
			if info.Name != "Project" {
				t.Errorf("expected Project, got %q for alias %q", info.Name, alias)
			}
		})
	}
}

func TestRegistry_GetByAlias_NotFound(t *testing.T) {
	reg := DefaultRegistry()

	aliases := []string{
		"unknown",
		"notaresource",
		"",
		"foo",
	}

	for _, alias := range aliases {
		t.Run(alias, func(t *testing.T) {
			_, ok := reg.GetByAlias(alias)
			if ok {
				t.Errorf("expected not to find type for alias %q", alias)
			}
		})
	}
}

func TestRegistry_GetByYAMLKind(t *testing.T) {
	reg := DefaultRegistry()

	tests := []struct {
		yamlKind     string
		expectedName string
		shouldFind   bool
	}{
		{"Agent", "Agent", true},
		{"Workflow", "Workflow", true},
		{"Skill", "Skill", true},
		{"McpServer", "McpServer", true},
		{"Project", "Project", true},
		{"agent", "", false},      // Must be exact match
		{"mcp-server", "", false}, // Must be exact match
		{"Unknown", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.yamlKind, func(t *testing.T) {
			info, ok := reg.GetByYAMLKind(tt.yamlKind)
			if ok != tt.shouldFind {
				t.Errorf("expected found=%v, got found=%v for %q", tt.shouldFind, ok, tt.yamlKind)
			}
			if ok && info.Name != tt.expectedName {
				t.Errorf("expected name %q, got %q", tt.expectedName, info.Name)
			}
		})
	}
}

func TestRegistry_SupportsVerb(t *testing.T) {
	reg := DefaultRegistry()

	tests := []struct {
		kind     apiresourcekind.ApiResourceKind
		verb     Verb
		expected bool
	}{
		// Agent supports all verbs except push
		{apiresourcekind.ApiResourceKind_agent, VerbApply, true},
		{apiresourcekind.ApiResourceKind_agent, VerbRun, true},
		{apiresourcekind.ApiResourceKind_agent, VerbPush, false},

		// Skill supports push but not apply or run
		{apiresourcekind.ApiResourceKind_skill, VerbPush, true},
		{apiresourcekind.ApiResourceKind_skill, VerbApply, false},
		{apiresourcekind.ApiResourceKind_skill, VerbRun, false},

		// Project supports apply but not run or push
		{apiresourcekind.ApiResourceKind_project, VerbApply, true},
		{apiresourcekind.ApiResourceKind_project, VerbRun, false},
		{apiresourcekind.ApiResourceKind_project, VerbPush, false},
	}

	for _, tt := range tests {
		name := tt.kind.String() + "_" + tt.verb.String()
		t.Run(name, func(t *testing.T) {
			result := reg.SupportsVerb(tt.kind, tt.verb)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestRegistry_TypesForVerb(t *testing.T) {
	reg := DefaultRegistry()

	tests := []struct {
		verb          Verb
		expectedCount int
	}{
		{VerbApply, 12},   // Original 5 + 6 T02 resources + runner
		{VerbRun, 2},      // Agent, Workflow
		{VerbPush, 1},     // Skill only
		{VerbSearch, 2},   // Agent, Workflow
		{VerbGet, 14},     // All 14 types
		{VerbList, 13},    // All except WorkflowInstance (no generic list RPC)
		{VerbDelete, 14},  // All 14 types
		{VerbValidate, 4}, // Agent, Workflow, McpServer, Project
	}

	for _, tt := range tests {
		t.Run(tt.verb.String(), func(t *testing.T) {
			kinds := reg.TypesForVerb(tt.verb)
			if len(kinds) != tt.expectedCount {
				t.Errorf("expected %d types for verb %s, got %d", tt.expectedCount, tt.verb, len(kinds))
			}
		})
	}
}

func TestTypeInfo_SupportedVerbList(t *testing.T) {
	reg := DefaultRegistry()
	info := reg.GetByProtoKind(apiresourcekind.ApiResourceKind_agent)
	if info == nil {
		t.Fatal("expected agent info")
	}

	verbs := info.SupportedVerbList()
	if len(verbs) == 0 {
		t.Error("expected non-empty verb list")
	}

	// Agent should support Run
	hasRun := false
	for _, v := range verbs {
		if v == VerbRun {
			hasRun = true
			break
		}
	}
	if !hasRun {
		t.Error("expected agent to support Run verb")
	}
}
