package root

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
)

// TestVerbSupport_Matrix validates the complete verb support matrix
// for all CLI-relevant resource types.
func TestVerbSupport_Matrix(t *testing.T) {
	reg := types.DefaultRegistry()

	// Define the expected verb support matrix
	// This should match the matrix in verb_support.go
	tests := []struct {
		kind        apiresourcekind.ApiResourceKind
		verb        types.Verb
		wantSupport bool
	}{
		// Organization: supports apply, get, list, delete
		{apiresourcekind.ApiResourceKind_organization, types.VerbApply, true},
		{apiresourcekind.ApiResourceKind_organization, types.VerbValidate, false},
		{apiresourcekind.ApiResourceKind_organization, types.VerbGet, true},
		{apiresourcekind.ApiResourceKind_organization, types.VerbList, true},
		{apiresourcekind.ApiResourceKind_organization, types.VerbDelete, true},
		{apiresourcekind.ApiResourceKind_organization, types.VerbRun, false},
		{apiresourcekind.ApiResourceKind_organization, types.VerbSearch, false},
		{apiresourcekind.ApiResourceKind_organization, types.VerbPush, false},

		// Agent: supports all verbs except push
		{apiresourcekind.ApiResourceKind_agent, types.VerbApply, true},
		{apiresourcekind.ApiResourceKind_agent, types.VerbValidate, true},
		{apiresourcekind.ApiResourceKind_agent, types.VerbGet, true},
		{apiresourcekind.ApiResourceKind_agent, types.VerbList, true},
		{apiresourcekind.ApiResourceKind_agent, types.VerbDelete, true},
		{apiresourcekind.ApiResourceKind_agent, types.VerbRun, true},
		{apiresourcekind.ApiResourceKind_agent, types.VerbSearch, true},
		{apiresourcekind.ApiResourceKind_agent, types.VerbPush, false},

		// Workflow: supports all verbs except push
		{apiresourcekind.ApiResourceKind_workflow, types.VerbApply, true},
		{apiresourcekind.ApiResourceKind_workflow, types.VerbValidate, true},
		{apiresourcekind.ApiResourceKind_workflow, types.VerbGet, true},
		{apiresourcekind.ApiResourceKind_workflow, types.VerbList, true},
		{apiresourcekind.ApiResourceKind_workflow, types.VerbDelete, true},
		{apiresourcekind.ApiResourceKind_workflow, types.VerbRun, true},
		{apiresourcekind.ApiResourceKind_workflow, types.VerbSearch, true},
		{apiresourcekind.ApiResourceKind_workflow, types.VerbPush, false},

		// Skill: supports get, list, delete, push only
		{apiresourcekind.ApiResourceKind_skill, types.VerbApply, false},
		{apiresourcekind.ApiResourceKind_skill, types.VerbValidate, false},
		{apiresourcekind.ApiResourceKind_skill, types.VerbGet, true},
		{apiresourcekind.ApiResourceKind_skill, types.VerbList, true},
		{apiresourcekind.ApiResourceKind_skill, types.VerbDelete, true},
		{apiresourcekind.ApiResourceKind_skill, types.VerbRun, false},
		{apiresourcekind.ApiResourceKind_skill, types.VerbSearch, false},
		{apiresourcekind.ApiResourceKind_skill, types.VerbPush, true},

		// McpServer: supports apply, validate, get, list, delete only
		{apiresourcekind.ApiResourceKind_mcp_server, types.VerbApply, true},
		{apiresourcekind.ApiResourceKind_mcp_server, types.VerbValidate, true},
		{apiresourcekind.ApiResourceKind_mcp_server, types.VerbGet, true},
		{apiresourcekind.ApiResourceKind_mcp_server, types.VerbList, true},
		{apiresourcekind.ApiResourceKind_mcp_server, types.VerbDelete, true},
		{apiresourcekind.ApiResourceKind_mcp_server, types.VerbRun, false},
		{apiresourcekind.ApiResourceKind_mcp_server, types.VerbSearch, false},
		{apiresourcekind.ApiResourceKind_mcp_server, types.VerbPush, false},

		// Project: supports apply, validate, get, list, delete only
		{apiresourcekind.ApiResourceKind_project, types.VerbApply, true},
		{apiresourcekind.ApiResourceKind_project, types.VerbValidate, true},
		{apiresourcekind.ApiResourceKind_project, types.VerbGet, true},
		{apiresourcekind.ApiResourceKind_project, types.VerbList, true},
		{apiresourcekind.ApiResourceKind_project, types.VerbDelete, true},
		{apiresourcekind.ApiResourceKind_project, types.VerbRun, false},
		{apiresourcekind.ApiResourceKind_project, types.VerbSearch, false},
		{apiresourcekind.ApiResourceKind_project, types.VerbPush, false},
	}

	for _, tt := range tests {
		name := tt.kind.String() + "_" + tt.verb.String()
		t.Run(name, func(t *testing.T) {
			result := reg.SupportsVerb(tt.kind, tt.verb)
			if result != tt.wantSupport {
				t.Errorf("SupportsVerb(%s, %s) = %v, want %v",
					tt.kind, tt.verb, result, tt.wantSupport)
			}
		})
	}
}

// TestVerbSupport_TypesForVerb validates that TypesForVerb returns
// the correct set of types for each verb.
func TestVerbSupport_TypesForVerb(t *testing.T) {
	reg := types.DefaultRegistry()

	tests := []struct {
		verb          types.Verb
		expectedKinds []apiresourcekind.ApiResourceKind
	}{
		{
			verb: types.VerbRun,
			expectedKinds: []apiresourcekind.ApiResourceKind{
				apiresourcekind.ApiResourceKind_agent,
				apiresourcekind.ApiResourceKind_workflow,
			},
		},
		{
			verb: types.VerbPush,
			expectedKinds: []apiresourcekind.ApiResourceKind{
				apiresourcekind.ApiResourceKind_skill,
			},
		},
		{
			verb: types.VerbSearch,
			expectedKinds: []apiresourcekind.ApiResourceKind{
				apiresourcekind.ApiResourceKind_agent,
				apiresourcekind.ApiResourceKind_workflow,
			},
		},
		{
			verb: types.VerbApply,
			expectedKinds: []apiresourcekind.ApiResourceKind{
				apiresourcekind.ApiResourceKind_organization,
				apiresourcekind.ApiResourceKind_agent,
				apiresourcekind.ApiResourceKind_workflow,
				apiresourcekind.ApiResourceKind_mcp_server,
				apiresourcekind.ApiResourceKind_project,
				apiresourcekind.ApiResourceKind_identity_provider,
				apiresourcekind.ApiResourceKind_oauth_app,
				apiresourcekind.ApiResourceKind_environment,
				apiresourcekind.ApiResourceKind_agent_instance,
				apiresourcekind.ApiResourceKind_workflow_instance,
				apiresourcekind.ApiResourceKind_session,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.verb.String(), func(t *testing.T) {
			kinds := reg.TypesForVerb(tt.verb)
			if len(kinds) != len(tt.expectedKinds) {
				t.Errorf("TypesForVerb(%s) returned %d types, want %d",
					tt.verb, len(kinds), len(tt.expectedKinds))
			}

			// Verify all expected kinds are present
			kindSet := make(map[apiresourcekind.ApiResourceKind]bool)
			for _, k := range kinds {
				kindSet[k] = true
			}
			for _, expected := range tt.expectedKinds {
				if !kindSet[expected] {
					t.Errorf("TypesForVerb(%s) missing expected kind %s", tt.verb, expected)
				}
			}
		})
	}
}

// TestVerbSupport_UniversalVerbs validates that get and delete are
// supported by all CLI-relevant types, and list by all except
// WorkflowInstance (which only has getByWorkflow, not a generic list RPC).
func TestVerbSupport_UniversalVerbs(t *testing.T) {
	reg := types.DefaultRegistry()
	allTypes := reg.All()

	for _, info := range allTypes {
		t.Run(info.Name+"_get", func(t *testing.T) {
			if !info.SupportsVerb(types.VerbGet) {
				t.Errorf("%s should support get", info.Name)
			}
		})
		t.Run(info.Name+"_delete", func(t *testing.T) {
			if !info.SupportsVerb(types.VerbDelete) {
				t.Errorf("%s should support delete", info.Name)
			}
		})
		t.Run(info.Name+"_list", func(t *testing.T) {
			if info.ProtoKind == apiresourcekind.ApiResourceKind_workflow_instance {
				if info.SupportsVerb(types.VerbList) {
					t.Errorf("WorkflowInstance should NOT support list (no generic list RPC)")
				}
				return
			}
			if !info.SupportsVerb(types.VerbList) {
				t.Errorf("%s should support list", info.Name)
			}
		})
	}
}

// TestFormatUnsupportedVerbError_ContainsHelpfulMessage validates that
// error messages for unsupported verb+type combinations are actionable.
func TestFormatUnsupportedVerbError_ContainsHelpfulMessage(t *testing.T) {
	reg := types.DefaultRegistry()

	tests := []struct {
		typeName        string
		verb            types.Verb
		wantSubstrings  []string
		wantNotContains []string
	}{
		{
			typeName: "skill",
			verb:     types.VerbRun,
			wantSubstrings: []string{
				"not supported",
				"Skill",
				"run",
				"Hint:",
				"Agent",
				"Workflow",
			},
			wantNotContains: []string{},
		},
		{
			typeName: "agent",
			verb:     types.VerbPush,
			wantSubstrings: []string{
				"not supported",
				"Agent",
				"push",
				"Hint:",
				"Skill",
			},
			wantNotContains: []string{},
		},
		{
			typeName: "project",
			verb:     types.VerbRun,
			wantSubstrings: []string{
				"not supported",
				"Project",
				"run",
			},
			wantNotContains: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.typeName+"_"+tt.verb.String(), func(t *testing.T) {
			info, ok := reg.GetByAlias(tt.typeName)
			if !ok {
				t.Fatalf("failed to resolve type %s", tt.typeName)
			}

			err := formatUnsupportedVerbError(info, tt.verb)
			if err == nil {
				t.Fatal("expected error, got nil")
			}

			errMsg := err.Error()

			for _, want := range tt.wantSubstrings {
				if !strings.Contains(errMsg, want) {
					t.Errorf("error message should contain %q, got: %s", want, errMsg)
				}
			}

			for _, notWant := range tt.wantNotContains {
				if strings.Contains(errMsg, notWant) {
					t.Errorf("error message should not contain %q, got: %s", notWant, errMsg)
				}
			}
		})
	}
}

// TestFormatUnsupportedVerbError_SuggestsAlternative validates that
// error messages suggest appropriate alternatives when available.
func TestFormatUnsupportedVerbError_SuggestsAlternative(t *testing.T) {
	reg := types.DefaultRegistry()

	// When trying to apply a skill, should suggest push instead
	skillInfo, _ := reg.GetByAlias("skill")
	err := formatUnsupportedVerbError(skillInfo, types.VerbApply)
	errMsg := err.Error()

	if !strings.Contains(errMsg, "push") {
		t.Errorf("apply error for skill should suggest push, got: %s", errMsg)
	}
}

// TestVerbFromString validates verb parsing from strings.
func TestVerbFromString(t *testing.T) {
	validVerbs := []string{
		"apply", "validate", "get", "list", "delete", "run", "push", "search", "download",
	}

	for _, verbStr := range validVerbs {
		t.Run(verbStr, func(t *testing.T) {
			verb, err := types.VerbFromString(verbStr)
			if err != nil {
				t.Fatalf("VerbFromString(%q) returned error: %v", verbStr, err)
			}
			if verb.String() != verbStr {
				t.Errorf("VerbFromString(%q).String() = %q", verbStr, verb.String())
			}
		})
	}

	invalidVerbs := []string{
		"create", "update", "exec", "execute", "remove", "install", "",
	}

	for _, verbStr := range invalidVerbs {
		t.Run("invalid_"+verbStr, func(t *testing.T) {
			_, err := types.VerbFromString(verbStr)
			if err == nil {
				t.Errorf("VerbFromString(%q) should return error", verbStr)
			}
		})
	}
}

// TestAllVerbs validates that AllVerbs returns all expected verbs.
func TestAllVerbs(t *testing.T) {
	verbs := types.AllVerbs()
	expectedCount := 9 // apply, validate, get, list, delete, run, push, search, download

	if len(verbs) != expectedCount {
		t.Errorf("AllVerbs() returned %d verbs, want %d", len(verbs), expectedCount)
	}

	verbSet := make(map[types.Verb]bool)
	for _, v := range verbs {
		verbSet[v] = true
	}

	expected := []types.Verb{
		types.VerbApply, types.VerbValidate, types.VerbGet, types.VerbList,
		types.VerbDelete, types.VerbRun, types.VerbPush, types.VerbSearch,
		types.VerbDownload,
	}

	for _, v := range expected {
		if !verbSet[v] {
			t.Errorf("AllVerbs() missing verb %s", v)
		}
	}
}
