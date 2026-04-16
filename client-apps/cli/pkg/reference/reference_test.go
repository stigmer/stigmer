package reference

import (
	"errors"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestParse(t *testing.T) {
	tests := []struct {
		name       string
		ref        string
		contextOrg string
		want       *ParsedReference
		wantErr    error
	}{
		// Basic org/slug format
		{
			name: "org/slug",
			ref:  "stigmer/web-search",
			want: &ParsedReference{Org: "stigmer", Slug: "web-search"},
		},
		{
			name: "org/slug with dashes",
			ref:  "acme-corp/code-reviewer",
			want: &ParsedReference{Org: "acme-corp", Slug: "code-reviewer"},
		},
		{
			name: "org/slug with version",
			ref:  "stigmer/web-search@v1.0",
			want: &ParsedReference{Org: "stigmer", Slug: "web-search", Version: "v1.0"},
		},
		{
			name: "org/slug with latest version",
			ref:  "stigmer/code-review@latest",
			want: &ParsedReference{Org: "stigmer", Slug: "code-review", Version: "latest"},
		},
		{
			name: "org/slug with hash version",
			ref:  "stigmer/skill@abc123def456",
			want: &ParsedReference{Org: "stigmer", Slug: "skill", Version: "abc123def456"},
		},

		// Slug-only with context org
		{
			name:       "slug-only with context org",
			ref:        "web-search",
			contextOrg: "my-org",
			want:       &ParsedReference{Org: "my-org", Slug: "web-search"},
		},
		{
			name:       "slug-only with context org and version",
			ref:        "code-review@stable",
			contextOrg: "acme",
			want:       &ParsedReference{Org: "acme", Slug: "code-review", Version: "stable"},
		},

		// Resource IDs - using prefixes from ApiResourceKind enum
		// Format: prefix + separator (underscore or hyphen) + 26-char ULID
		{
			name: "agent ID with underscore",
			ref:  "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "agent ID with hyphen",
			ref:  "agt-01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "agt-01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "workflow ID with underscore",
			ref:  "wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "workflow ID with hyphen",
			ref:  "wfl-01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "wfl-01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "mcp server ID with underscore",
			ref:  "mcp_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "mcp_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "mcp server ID with hyphen",
			ref:  "mcp-01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "mcp-01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "UUID format",
			ref:  "12345678-1234-1234-1234-123456789abc",
			want: &ParsedReference{IsID: true, ID: "12345678-1234-1234-1234-123456789abc"},
		},
		{
			name: "agent execution ID with underscore",
			ref:  "aex_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "aex_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "agent execution ID with hyphen",
			ref:  "aex-01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "aex-01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "workflow execution ID with underscore",
			ref:  "wex_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "wex_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "workflow execution ID with hyphen",
			ref:  "wex-01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "wex-01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "skill ID with underscore",
			ref:  "skl_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "skl_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "skill ID with hyphen",
			ref:  "skl-01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "skl-01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "agent instance ID with underscore",
			ref:  "ain_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "ain_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "agent instance ID with hyphen",
			ref:  "ain-01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "ain-01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "workflow instance ID with underscore",
			ref:  "win_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "win_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "workflow instance ID with hyphen",
			ref:  "win-01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "win-01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "session ID with underscore",
			ref:  "ses_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "ses_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},
		{
			name: "environment ID with underscore",
			ref:  "env_01ARZ3NDEKTSV4RRFFQ69G5FAV",
			want: &ParsedReference{IsID: true, ID: "env_01ARZ3NDEKTSV4RRFFQ69G5FAV"},
		},

		// Slugs that happen to start with a known ID prefix should be treated as slugs, not IDs
		{
			name:       "mcp-prefixed slug treated as slug",
			ref:        "mcp-server-stigmer",
			contextOrg: "default",
			want:       &ParsedReference{Org: "default", Slug: "mcp-server-stigmer"},
		},
		{
			name:       "env-prefixed slug treated as slug",
			ref:        "env-production",
			contextOrg: "my-org",
			want:       &ParsedReference{Org: "my-org", Slug: "env-production"},
		},
		{
			name:       "incomplete ID prefix treated as slug",
			ref:        "agt_short",
			contextOrg: "my-org",
			want:       &ParsedReference{Org: "my-org", Slug: "agt_short"},
		},

		// Edge cases
		{
			name: "whitespace trimmed",
			ref:  "  stigmer/web-search  ",
			want: &ParsedReference{Org: "stigmer", Slug: "web-search"},
		},
		{
			name: "multiple slashes in slug",
			ref:  "org/path/to/resource",
			want: &ParsedReference{Org: "org", Slug: "path/to/resource"},
		},
		{
			name: "at symbol in version",
			ref:  "stigmer/skill@v1.0@beta",
			want: &ParsedReference{Org: "stigmer", Slug: "skill@v1.0", Version: "beta"},
		},

		// Error cases
		{
			name:    "empty reference",
			ref:     "",
			wantErr: ErrEmptyReference,
		},
		{
			name:    "whitespace only",
			ref:     "   ",
			wantErr: ErrEmptyReference,
		},
		{
			name:    "empty org in org/slug",
			ref:     "/web-search",
			wantErr: ErrEmptyOrg,
		},
		{
			name:    "empty slug in org/slug",
			ref:     "stigmer/",
			wantErr: ErrEmptySlug,
		},
		{
			name:    "slug-only without context org",
			ref:     "web-search",
			wantErr: ErrOrgRequired,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.ref, tt.contextOrg)

			if tt.wantErr != nil {
				if err == nil {
					t.Errorf("Parse() expected error %v, got nil", tt.wantErr)
					return
				}
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("Parse() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Errorf("Parse() unexpected error: %v", err)
				return
			}

			if got.Org != tt.want.Org {
				t.Errorf("Parse().Org = %q, want %q", got.Org, tt.want.Org)
			}
			if got.Slug != tt.want.Slug {
				t.Errorf("Parse().Slug = %q, want %q", got.Slug, tt.want.Slug)
			}
			if got.Version != tt.want.Version {
				t.Errorf("Parse().Version = %q, want %q", got.Version, tt.want.Version)
			}
			if got.IsID != tt.want.IsID {
				t.Errorf("Parse().IsID = %v, want %v", got.IsID, tt.want.IsID)
			}
			if got.ID != tt.want.ID {
				t.Errorf("Parse().ID = %q, want %q", got.ID, tt.want.ID)
			}
		})
	}
}

func TestMustParse(t *testing.T) {
	t.Run("valid reference", func(t *testing.T) {
		result := MustParse("stigmer/web-search", "")
		if result.Org != "stigmer" || result.Slug != "web-search" {
			t.Errorf("MustParse() = %+v, want org=stigmer, slug=web-search", result)
		}
	})

	t.Run("panics on invalid reference", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("MustParse() should panic on invalid reference")
			}
		}()
		MustParse("", "")
	})
}

func TestIsAgentID(t *testing.T) {
	// Agent prefix from enum: "agt"
	tests := []struct {
		ref  string
		want bool
	}{
		{"agt_abc123", true},         // underscore separator
		{"agt-abc123", true},         // hyphen separator
		{"agt_", true},               // minimal with underscore
		{"agt-", true},               // minimal with hyphen
		{"agt_longer_id_here", true}, // longer ID
		{"AGT_abc123", false},        // case sensitive
		{"wfl_abc123", false},        // different kind
		{"stigmer/agent", false},     // org/slug format
		{"", false},                  // empty
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsAgentID(tt.ref); got != tt.want {
				t.Errorf("IsAgentID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestIsWorkflowID(t *testing.T) {
	// Workflow prefix from enum: "wfl"
	tests := []struct {
		ref  string
		want bool
	}{
		{"wfl_xyz789", true},             // underscore separator
		{"wfl-xyz789", true},             // hyphen separator
		{"wfl_", true},                   // minimal with underscore
		{"wfl-", true},                   // minimal with hyphen
		{"wfl_longer_workflow_id", true}, // longer ID
		{"WFL_xyz789", false},            // case sensitive
		{"agt_abc123", false},            // different kind
		{"stigmer/workflow", false},      // org/slug format
		{"", false},                      // empty
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsWorkflowID(tt.ref); got != tt.want {
				t.Errorf("IsWorkflowID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestIsMcpServerID(t *testing.T) {
	// MCP server prefix from enum: "mcp"
	tests := []struct {
		ref  string
		want bool
	}{
		{"mcp_github", true},                            // underscore separator
		{"mcp-github", true},                            // hyphen separator
		{"mcp_", true},                                  // minimal with underscore
		{"mcp-", true},                                  // minimal with hyphen
		{"mcp_server-name", true},                       // longer ID
		{"mcp-server-name", true},                       // hyphen separator with dashes in value
		{"12345678-1234-1234-1234-123456789abc", true},  // UUID
		{"12345678-1234-1234-1234-123456789ABC", true},  // UUID uppercase
		{"MCP_github", false},                           // case sensitive prefix
		{"agt_abc123", false},                           // different kind
		{"stigmer/mcp", false},                          // org/slug format
		{"", false},                                     // empty
		{"12345678-1234-1234-1234-12345678", false},     // invalid UUID (too short)
		{"12345678123412341234123456789abc", false},     // UUID without dashes
		{"g2345678-1234-1234-1234-123456789abc", false}, // invalid hex
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsMcpServerID(tt.ref); got != tt.want {
				t.Errorf("IsMcpServerID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestIsAgentExecutionID(t *testing.T) {
	// Agent execution prefix from enum: "aex"
	tests := []struct {
		ref  string
		want bool
	}{
		{"aex_run123", true}, // underscore separator
		{"aex-run123", true}, // hyphen separator
		{"aex_", true},       // minimal with underscore
		{"aex-", true},       // minimal with hyphen
		{"AEX_run", false},   // case sensitive
		{"agt_abc", false},   // different kind
		{"", false},          // empty
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsAgentExecutionID(tt.ref); got != tt.want {
				t.Errorf("IsAgentExecutionID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestIsWorkflowExecutionID(t *testing.T) {
	// Workflow execution prefix from enum: "wex"
	tests := []struct {
		ref  string
		want bool
	}{
		{"wex_run456", true}, // underscore separator
		{"wex-run456", true}, // hyphen separator
		{"wex_", true},       // minimal with underscore
		{"wex-", true},       // minimal with hyphen
		{"WEX_run", false},   // case sensitive
		{"wfl_abc", false},   // different kind
		{"", false},          // empty
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsWorkflowExecutionID(tt.ref); got != tt.want {
				t.Errorf("IsWorkflowExecutionID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestIsSkillID(t *testing.T) {
	// Skill prefix from enum: "skl"
	tests := []struct {
		ref  string
		want bool
	}{
		{"skl_abc", true},  // underscore separator
		{"skl-abc", true},  // hyphen separator
		{"skl_", true},     // minimal with underscore
		{"skl-", true},     // minimal with hyphen
		{"SKL_abc", false}, // case sensitive
		{"agt_abc", false}, // different kind
		{"", false},        // empty
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsSkillID(tt.ref); got != tt.want {
				t.Errorf("IsSkillID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestIsAgentInstanceID(t *testing.T) {
	// Agent instance prefix from enum: "ain"
	tests := []struct {
		ref  string
		want bool
	}{
		{"ain_inst1", true}, // underscore separator
		{"ain-inst1", true}, // hyphen separator
		{"ain_", true},      // minimal with underscore
		{"ain-", true},      // minimal with hyphen
		{"AIN_inst", false}, // case sensitive
		{"agt_abc", false},  // different kind
		{"", false},         // empty
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsAgentInstanceID(tt.ref); got != tt.want {
				t.Errorf("IsAgentInstanceID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestIsWorkflowInstanceID(t *testing.T) {
	// Workflow instance prefix from enum: "win"
	tests := []struct {
		ref  string
		want bool
	}{
		{"win_inst2", true}, // underscore separator
		{"win-inst2", true}, // hyphen separator
		{"win_", true},      // minimal with underscore
		{"win-", true},      // minimal with hyphen
		{"WIN_inst", false}, // case sensitive
		{"wfl_abc", false},  // different kind
		{"", false},         // empty
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsWorkflowInstanceID(tt.ref); got != tt.want {
				t.Errorf("IsWorkflowInstanceID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestIsSessionID(t *testing.T) {
	// Session prefix from enum: "ses"
	tests := []struct {
		ref  string
		want bool
	}{
		{"ses_session123", true}, // underscore separator
		{"ses-session123", true}, // hyphen separator
		{"ses_", true},           // minimal with underscore
		{"ses-", true},           // minimal with hyphen
		{"SES_session", false},   // case sensitive
		{"agt_abc", false},       // different kind
		{"", false},              // empty
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsSessionID(tt.ref); got != tt.want {
				t.Errorf("IsSessionID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestIsEnvironmentID(t *testing.T) {
	// Environment prefix from enum: "env"
	tests := []struct {
		ref  string
		want bool
	}{
		{"env_myenv", true},  // underscore separator
		{"env-myenv", true},  // hyphen separator
		{"env_", true},       // minimal with underscore
		{"env-", true},       // minimal with hyphen
		{"ENV_myenv", false}, // case sensitive
		{"agt_abc", false},   // different kind
		{"", false},          // empty
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsEnvironmentID(tt.ref); got != tt.want {
				t.Errorf("IsEnvironmentID(%q) = %v, want %v", tt.ref, got, tt.want)
			}
		})
	}
}

func TestParseError(t *testing.T) {
	t.Run("error message with input", func(t *testing.T) {
		err := newParseError("bad-ref", "something went wrong", ErrEmptyOrg)
		want := `reference: something went wrong: "bad-ref"`
		if got := err.Error(); got != want {
			t.Errorf("Error() = %q, want %q", got, want)
		}
	})

	t.Run("error message without input", func(t *testing.T) {
		err := newParseError("", "reference is empty", ErrEmptyReference)
		want := "reference: reference is empty"
		if got := err.Error(); got != want {
			t.Errorf("Error() = %q, want %q", got, want)
		}
	})

	t.Run("unwrap returns underlying error", func(t *testing.T) {
		err := newParseError("bad", "org empty", ErrEmptyOrg)
		if !errors.Is(err, ErrEmptyOrg) {
			t.Error("errors.Is() should return true for underlying error")
		}
	})
}

func TestExtractVersion(t *testing.T) {
	tests := []struct {
		ref         string
		wantRef     string
		wantVersion string
	}{
		{"skill@v1.0", "skill", "v1.0"},
		{"org/skill@latest", "org/skill", "latest"},
		{"no-version", "no-version", ""},
		{"multi@at@symbols", "multi@at", "symbols"},
		{"@only-version", "", "only-version"},
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			gotRef, gotVersion := extractVersion(tt.ref)
			if gotRef != tt.wantRef {
				t.Errorf("extractVersion(%q) ref = %q, want %q", tt.ref, gotRef, tt.wantRef)
			}
			if gotVersion != tt.wantVersion {
				t.Errorf("extractVersion(%q) version = %q, want %q", tt.ref, gotVersion, tt.wantVersion)
			}
		})
	}
}

func TestIsUUID(t *testing.T) {
	tests := []struct {
		s    string
		want bool
	}{
		{"12345678-1234-1234-1234-123456789abc", true},
		{"ABCDEF12-3456-7890-ABCD-EF1234567890", true},
		{"abcdef12-3456-7890-abcd-ef1234567890", true},
		{"12345678123412341234123456789abc", false},      // no dashes
		{"12345678-1234-1234-1234-12345678", false},      // too short
		{"12345678-1234-1234-1234-123456789abcd", false}, // too long
		{"g2345678-1234-1234-1234-123456789abc", false},  // invalid hex
		{"12345678_1234_1234_1234_123456789abc", false},  // wrong separator
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.s, func(t *testing.T) {
			if got := isUUID(tt.s); got != tt.want {
				t.Errorf("isUUID(%q) = %v, want %v", tt.s, got, tt.want)
			}
		})
	}
}

// TestIsResourceIDWithKind verifies that isResourceIDWithKind correctly uses enum prefixes.
func TestIsResourceIDWithKind(t *testing.T) {
	tests := []struct {
		name string
		ref  string
		kind apiresourcekind.ApiResourceKind
		want bool
	}{
		{
			name: "agent with underscore",
			ref:  "agt_abc123",
			kind: apiresourcekind.ApiResourceKind_agent,
			want: true,
		},
		{
			name: "agent with hyphen",
			ref:  "agt-abc123",
			kind: apiresourcekind.ApiResourceKind_agent,
			want: true,
		},
		{
			name: "workflow with underscore",
			ref:  "wfl_xyz789",
			kind: apiresourcekind.ApiResourceKind_workflow,
			want: true,
		},
		{
			name: "workflow with hyphen",
			ref:  "wfl-xyz789",
			kind: apiresourcekind.ApiResourceKind_workflow,
			want: true,
		},
		{
			name: "mcp server with underscore",
			ref:  "mcp_server1",
			kind: apiresourcekind.ApiResourceKind_mcp_server,
			want: true,
		},
		{
			name: "mcp server with hyphen",
			ref:  "mcp-server1",
			kind: apiresourcekind.ApiResourceKind_mcp_server,
			want: true,
		},
		{
			name: "wrong kind prefix",
			ref:  "agt_abc123",
			kind: apiresourcekind.ApiResourceKind_workflow,
			want: false,
		},
		{
			name: "unknown kind",
			ref:  "agt_abc123",
			kind: apiresourcekind.ApiResourceKind_api_resource_kind_unknown,
			want: false,
		},
		{
			name: "empty ref",
			ref:  "",
			kind: apiresourcekind.ApiResourceKind_agent,
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isResourceIDWithKind(tt.ref, tt.kind); got != tt.want {
				t.Errorf("isResourceIDWithKind(%q, %v) = %v, want %v", tt.ref, tt.kind, got, tt.want)
			}
		})
	}
}
