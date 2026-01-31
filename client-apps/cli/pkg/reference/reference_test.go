package reference

import (
	"errors"
	"testing"
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

		// Resource IDs
		{
			name: "agent ID",
			ref:  "agt_abc123",
			want: &ParsedReference{IsID: true, ID: "agt_abc123"},
		},
		{
			name: "workflow ID",
			ref:  "wf_xyz789",
			want: &ParsedReference{IsID: true, ID: "wf_xyz789"},
		},
		{
			name: "mcp server ID with prefix",
			ref:  "mcp-github-server",
			want: &ParsedReference{IsID: true, ID: "mcp-github-server"},
		},
		{
			name: "UUID format",
			ref:  "12345678-1234-1234-1234-123456789abc",
			want: &ParsedReference{IsID: true, ID: "12345678-1234-1234-1234-123456789abc"},
		},
		{
			name: "agent execution ID",
			ref:  "agtexec_run123",
			want: &ParsedReference{IsID: true, ID: "agtexec_run123"},
		},
		{
			name: "workflow execution ID",
			ref:  "wfexec_run456",
			want: &ParsedReference{IsID: true, ID: "wfexec_run456"},
		},
		{
			name: "skill ID",
			ref:  "skill_abc",
			want: &ParsedReference{IsID: true, ID: "skill_abc"},
		},
		{
			name: "agent instance ID",
			ref:  "agtinst_inst1",
			want: &ParsedReference{IsID: true, ID: "agtinst_inst1"},
		},
		{
			name: "workflow instance ID",
			ref:  "wfinst_inst2",
			want: &ParsedReference{IsID: true, ID: "wfinst_inst2"},
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
	tests := []struct {
		ref  string
		want bool
	}{
		{"agt_abc123", true},
		{"agt_", true},
		{"agt_longer_id_here", true},
		{"AGT_abc123", false}, // case sensitive
		{"wf_abc123", false},
		{"stigmer/agent", false},
		{"", false},
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
	tests := []struct {
		ref  string
		want bool
	}{
		{"wf_xyz789", true},
		{"wf_", true},
		{"wf_longer_workflow_id", true},
		{"WF_xyz789", false}, // case sensitive
		{"agt_abc123", false},
		{"stigmer/workflow", false},
		{"", false},
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
	tests := []struct {
		ref  string
		want bool
	}{
		{"mcp-github", true},
		{"mcp-", true},
		{"mcp-server-name", true},
		{"12345678-1234-1234-1234-123456789abc", true}, // UUID
		{"12345678-1234-1234-1234-123456789ABC", true}, // UUID uppercase
		{"MCP-github", false},                          // case sensitive prefix
		{"agt_abc123", false},
		{"stigmer/mcp", false},
		{"", false},
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
	tests := []struct {
		ref  string
		want bool
	}{
		{"agtexec_run123", true},
		{"agtexec_", true},
		{"AGTEXEC_run", false}, // case sensitive
		{"agt_abc", false},
		{"", false},
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
	tests := []struct {
		ref  string
		want bool
	}{
		{"wfexec_run456", true},
		{"wfexec_", true},
		{"WFEXEC_run", false}, // case sensitive
		{"wf_abc", false},
		{"", false},
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
	tests := []struct {
		ref  string
		want bool
	}{
		{"skill_abc", true},
		{"skill_", true},
		{"SKILL_abc", false}, // case sensitive
		{"agt_abc", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.ref, func(t *testing.T) {
			if got := IsSkillID(tt.ref); got != tt.want {
				t.Errorf("IsSkillID(%q) = %v, want %v", tt.ref, got, tt.want)
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
		{"12345678123412341234123456789abc", false},     // no dashes
		{"12345678-1234-1234-1234-12345678", false},     // too short
		{"12345678-1234-1234-1234-123456789abcd", false}, // too long
		{"g2345678-1234-1234-1234-123456789abc", false}, // invalid hex
		{"12345678_1234_1234_1234_123456789abc", false}, // wrong separator
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
