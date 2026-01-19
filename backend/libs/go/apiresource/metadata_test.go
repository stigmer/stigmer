package apiresource

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestGetKindEnum(t *testing.T) {
	tests := []struct {
		name     string
		msg      *agentv1.Agent
		expected apiresourcekind.ApiResourceKind
		wantErr  bool
	}{
		{
			name: "valid agent kind",
			msg: &agentv1.Agent{
				Kind: "Agent",
			},
			expected: apiresourcekind.ApiResourceKind_agent,
			wantErr:  false,
		},
		{
			name:     "nil message",
			msg:      nil,
			expected: apiresourcekind.ApiResourceKind_api_resource_kind_unknown,
			wantErr:  true,
		},
		{
			name: "empty kind",
			msg: &agentv1.Agent{
				Kind: "",
			},
			expected: apiresourcekind.ApiResourceKind_api_resource_kind_unknown,
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetKindEnum(tt.msg)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetKindEnum() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.expected {
				t.Errorf("GetKindEnum() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestGetKindMeta(t *testing.T) {
	tests := []struct {
		name    string
		kind    apiresourcekind.ApiResourceKind
		wantErr bool
	}{
		{
			name:    "agent kind",
			kind:    apiresourcekind.ApiResourceKind_agent,
			wantErr: false,
		},
		{
			name:    "agent_instance kind",
			kind:    apiresourcekind.ApiResourceKind_agent_instance,
			wantErr: false,
		},
		{
			name:    "workflow kind",
			kind:    apiresourcekind.ApiResourceKind_workflow,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			meta, err := GetKindMeta(tt.kind)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetKindMeta() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr {
				if meta == nil {
					t.Error("GetKindMeta() returned nil metadata")
					return
				}
				// Verify metadata has expected fields
				if meta.Name == "" {
					t.Error("GetKindMeta() metadata has empty Name")
				}
				if meta.IdPrefix == "" {
					t.Error("GetKindMeta() metadata has empty IdPrefix")
				}
			}
		})
	}
}

func TestGetIdPrefix(t *testing.T) {
	tests := []struct {
		name     string
		kind     apiresourcekind.ApiResourceKind
		expected string
		wantErr  bool
	}{
		{
			name:     "agent kind",
			kind:     apiresourcekind.ApiResourceKind_agent,
			expected: "agt",
			wantErr:  false,
		},
		{
			name:     "agent_instance kind",
			kind:     apiresourcekind.ApiResourceKind_agent_instance,
			expected: "ain",
			wantErr:  false,
		},
		{
			name:     "workflow kind",
			kind:     apiresourcekind.ApiResourceKind_workflow,
			expected: "wfl",
			wantErr:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetIdPrefix(tt.kind)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetIdPrefix() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.expected {
				t.Errorf("GetIdPrefix() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestGetKindName(t *testing.T) {
	tests := []struct {
		name     string
		kind     apiresourcekind.ApiResourceKind
		expected string
		wantErr  bool
	}{
		{
			name:     "agent kind",
			kind:     apiresourcekind.ApiResourceKind_agent,
			expected: "Agent",
			wantErr:  false,
		},
		{
			name:     "agent_instance kind",
			kind:     apiresourcekind.ApiResourceKind_agent_instance,
			expected: "AgentInstance",
			wantErr:  false,
		},
		{
			name:     "workflow kind",
			kind:     apiresourcekind.ApiResourceKind_workflow,
			expected: "Workflow",
			wantErr:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetKindName(tt.kind)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetKindName() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.expected {
				t.Errorf("GetKindName() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestToSnakeCase(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Agent", "agent"},
		{"AgentInstance", "agent_instance"},
		{"WorkflowExecution", "workflow_execution"},
		{"IAMPolicy", "i_a_m_policy"},
		{"", ""},
		{"a", "a"},
		{"AB", "a_b"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := toSnakeCase(tt.input)
			if got != tt.expected {
				t.Errorf("toSnakeCase(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
