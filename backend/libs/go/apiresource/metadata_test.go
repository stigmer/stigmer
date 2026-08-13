package apiresource

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
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
			// The oss#545 repro: OAuthApp is the only kind whose PascalCase
			// name has consecutive capitals — no character-class split can
			// recover "oauth_app" because "OAuth" being one word is recorded
			// only in the proto's kind_meta.
			name: "kind with consecutive capitals (OAuthApp)",
			msg: &agentv1.Agent{
				Kind: "OAuthApp",
			},
			expected: apiresourcekind.ApiResourceKind_oauth_app,
			wantErr:  false,
		},
		{
			// Cloud's ApiResourceKindExtractor.extract accepts snake_case
			// spellings; both editions must resolve the same inputs.
			name: "snake_case spelling resolves (cloud parity)",
			msg: &agentv1.Agent{
				Kind: "oauth_app",
			},
			expected: apiresourcekind.ApiResourceKind_oauth_app,
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

func TestDefaultVisibilityFor(t *testing.T) {
	tests := []struct {
		name     string
		kind     apiresourcekind.ApiResourceKind
		expected apiresourcepb.ApiResourceVisibility
	}{
		{
			name:     "skill blueprint defaults to org",
			kind:     apiresourcekind.ApiResourceKind_skill,
			expected: apiresourcepb.ApiResourceVisibility_visibility_org,
		},
		{
			name:     "workflow blueprint defaults to org",
			kind:     apiresourcekind.ApiResourceKind_workflow,
			expected: apiresourcepb.ApiResourceVisibility_visibility_org,
		},
		{
			name:     "session (no visibility config) defaults to private",
			kind:     apiresourcekind.ApiResourceKind_session,
			expected: apiresourcepb.ApiResourceVisibility_visibility_private,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DefaultVisibilityFor(tt.kind)
			if err != nil {
				t.Fatalf("DefaultVisibilityFor(%v) unexpected error: %v", tt.kind, err)
			}
			if got != tt.expected {
				t.Errorf("DefaultVisibilityFor(%v) = %v, want %v", tt.kind, got, tt.expected)
			}
		})
	}
}

func TestSupportedVisibilityLevels(t *testing.T) {
	tests := []struct {
		name     string
		kind     apiresourcekind.ApiResourceKind
		expected string
	}{
		{
			name:     "blueprint supports every level",
			kind:     apiresourcekind.ApiResourceKind_agent,
			expected: "visibility_private, visibility_org, visibility_public, visibility_platform",
		},
		{
			name:     "instance supports org and public, never platform",
			kind:     apiresourcekind.ApiResourceKind_agent_instance,
			expected: "visibility_private, visibility_org, visibility_public",
		},
		{
			name:     "environment caps out at org",
			kind:     apiresourcekind.ApiResourceKind_environment,
			expected: "visibility_private, visibility_org",
		},
		{
			name:     "kind with no visibility config is private-only",
			kind:     apiresourcekind.ApiResourceKind_session,
			expected: "visibility_private",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := SupportedVisibilityLevels(tt.kind)
			if err != nil {
				t.Fatalf("SupportedVisibilityLevels(%v) unexpected error: %v", tt.kind, err)
			}
			if got != tt.expected {
				t.Errorf("SupportedVisibilityLevels(%v) = %q, want %q", tt.kind, got, tt.expected)
			}
		})
	}
}

// TestGetKindEnumResolvesEveryDeclaredKind pins the structural guarantee that
// motivated the kind_meta lookup (stigmer/stigmer#545): every kind the proto
// declares resolves through GetKindEnum, by construction. A future kind with
// unusual capitalization cannot regress silently — this test picks it up from
// the proto with no code change.
func TestGetKindEnumResolvesEveryDeclaredKind(t *testing.T) {
	values := apiresourcekind.ApiResourceKind(0).Descriptor().Values()
	checked := 0
	for i := 0; i < values.Len(); i++ {
		valueDesc := values.Get(i)
		opts := valueDesc.Options()
		if opts == nil || !proto.HasExtension(opts, apiresourcekind.E_KindMeta) {
			// Only the unknown zero value carries no kind_meta.
			if valueDesc.Number() != 0 {
				t.Errorf("enum value %s (%d) has no kind_meta — every real kind must declare one", valueDesc.Name(), valueDesc.Number())
			}
			continue
		}
		meta := proto.GetExtension(opts, apiresourcekind.E_KindMeta).(*apiresourcekind.ApiResourceKindMeta)
		want := apiresourcekind.ApiResourceKind(valueDesc.Number())

		got, err := GetKindEnum(&agentv1.Agent{Kind: meta.GetName()})
		if err != nil {
			t.Errorf("GetKindEnum(kind=%q) failed for declared kind %s: %v", meta.GetName(), valueDesc.Name(), err)
			continue
		}
		if got != want {
			t.Errorf("GetKindEnum(kind=%q) = %v, want %v", meta.GetName(), got, want)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no enum values carried kind_meta — the reflection walk is broken")
	}
}

// TestKindMetaNamesAreCanonicallyUnique pins the lookup's correctness
// precondition: no two kinds may share a canonical name. This guards the
// cross-edition contract, not just this package — Cloud's
// ApiResourceKindExtractor compares with the same canonicalization, so a
// collision would make kind resolution ambiguous on both editions.
func TestKindMetaNamesAreCanonicallyUnique(t *testing.T) {
	values := apiresourcekind.ApiResourceKind(0).Descriptor().Values()
	seen := make(map[string]string)
	for i := 0; i < values.Len(); i++ {
		valueDesc := values.Get(i)
		opts := valueDesc.Options()
		if opts == nil || !proto.HasExtension(opts, apiresourcekind.E_KindMeta) {
			continue
		}
		meta := proto.GetExtension(opts, apiresourcekind.E_KindMeta).(*apiresourcekind.ApiResourceKindMeta)
		key := canonicalKindName(meta.GetName())
		if prior, dup := seen[key]; dup {
			t.Errorf("kinds %q and %q canonicalize to the same name %q — kind resolution is ambiguous in both editions", prior, meta.GetName(), key)
		}
		seen[key] = meta.GetName()
	}
}
