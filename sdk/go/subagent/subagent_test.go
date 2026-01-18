package subagent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/skill"
)

func TestInline(t *testing.T) {
	tests := []struct {
		name    string
		opts    []InlineOption
		wantErr bool
		check   func(*testing.T, SubAgent)
	}{
		{
			name: "basic inline sub-agent",
			opts: []InlineOption{
				WithName("code-analyzer"),
				WithInstructions("Analyze code for bugs and security issues"),
			},
			wantErr: false,
			check: func(t *testing.T, s SubAgent) {
				if !s.IsInline() {
					t.Error("expected inline sub-agent")
				}
				if s.IsReference() {
					t.Error("expected not reference")
				}
				if s.Name() != "code-analyzer" {
					t.Errorf("Name() = %q, want %q", s.Name(), "code-analyzer")
				}
			},
		},
		{
			name: "inline with description",
			opts: []InlineOption{
				WithName("security-checker"),
				WithInstructions("Check code for security vulnerabilities"),
				WithDescription("Security analysis sub-agent"),
			},
			wantErr: false,
			check: func(t *testing.T, s SubAgent) {
				if s.description != "Security analysis sub-agent" {
					t.Errorf("description = %q, want %q", s.description, "Security analysis sub-agent")
				}
			},
		},
		{
			name: "inline with MCP servers",
			opts: []InlineOption{
				WithName("github-bot"),
				WithInstructions("Interact with GitHub repositories"),
				WithMCPServer("github"),
				WithMCPServer("gitlab"),
			},
			wantErr: false,
			check: func(t *testing.T, s SubAgent) {
				if len(s.mcpServers) != 2 {
					t.Errorf("len(mcpServers) = %d, want 2", len(s.mcpServers))
				}
				if s.mcpServers[0] != "github" || s.mcpServers[1] != "gitlab" {
					t.Errorf("mcpServers = %v, want [github gitlab]", s.mcpServers)
				}
			},
		},
		{
			name: "inline with tool selections",
			opts: []InlineOption{
				WithName("selective-bot"),
				WithInstructions("Use specific GitHub tools only"),
				WithMCPServer("github"),
				WithToolSelection("github", "create_issue", "list_repos"),
			},
			wantErr: false,
			check: func(t *testing.T, s SubAgent) {
				if len(s.mcpToolSelections) != 1 {
					t.Errorf("len(mcpToolSelections) = %d, want 1", len(s.mcpToolSelections))
				}
				tools, ok := s.mcpToolSelections["github"]
				if !ok {
					t.Error("mcpToolSelections missing 'github' key")
				}
				if len(tools) != 2 {
					t.Errorf("len(tools) = %d, want 2", len(tools))
				}
			},
		},
		{
			name: "inline with skills",
			opts: []InlineOption{
				WithName("knowledgeable-bot"),
				WithInstructions("Use coding knowledge to analyze code"),
				WithSkill(skill.Platform("coding-best-practices")),
				WithSkill(skill.Organization("my-org", "internal-apis")),
			},
			wantErr: false,
			check: func(t *testing.T, s SubAgent) {
				if len(s.skillRefs) != 2 {
					t.Errorf("len(skillRefs) = %d, want 2", len(s.skillRefs))
				}
			},
		},
		{
			name: "inline with multiple MCP servers at once",
			opts: []InlineOption{
				WithName("multi-server-bot"),
				WithInstructions("Use multiple servers"),
				WithMCPServers("github", "gitlab", "aws"),
			},
			wantErr: false,
			check: func(t *testing.T, s SubAgent) {
				if len(s.mcpServers) != 3 {
					t.Errorf("len(mcpServers) = %d, want 3", len(s.mcpServers))
				}
			},
		},
		{
			name: "inline with multiple skills at once",
			opts: []InlineOption{
				WithName("skilled-bot"),
				WithInstructions("Use multiple skills"),
				WithSkills(
					skill.Platform("skill1"),
					skill.Platform("skill2"),
					skill.Organization("org", "skill3"),
				),
			},
			wantErr: false,
			check: func(t *testing.T, s SubAgent) {
				if len(s.skillRefs) != 3 {
					t.Errorf("len(skillRefs) = %d, want 3", len(s.skillRefs))
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub, err := Inline(tt.opts...)
			
			if (err != nil) != tt.wantErr {
				t.Errorf("Inline() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if tt.check != nil && !tt.wantErr {
				tt.check(t, sub)
			}
		})
	}
}

func TestReference(t *testing.T) {
	tests := []struct {
		name             string
		subName          string
		agentInstanceRef string
		wantErr          bool
	}{
		{
			name:             "valid reference",
			subName:          "security-checker",
			agentInstanceRef: "sec-checker-prod",
			wantErr:          false,
		},
		{
			name:             "reference with empty name",
			subName:          "",
			agentInstanceRef: "some-agent",
			wantErr:          true,
		},
		{
			name:             "reference with empty ref",
			subName:          "checker",
			agentInstanceRef: "",
			wantErr:          true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub := Reference(tt.subName, tt.agentInstanceRef)

			if !sub.IsReference() {
				t.Error("expected reference sub-agent")
			}
			if sub.IsInline() {
				t.Error("expected not inline")
			}
			if sub.Name() != tt.subName {
				t.Errorf("Name() = %q, want %q", sub.Name(), tt.subName)
			}

			err := sub.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateInline(t *testing.T) {
	tests := []struct {
		name    string
		opts    []InlineOption
		wantErr bool
		errMsg  string
	}{
		{
			name: "valid inline sub-agent",
			opts: []InlineOption{
				WithName("analyzer"),
				WithInstructions("Analyze code for issues"),
			},
			wantErr: false,
		},
		{
			name: "missing name",
			opts: []InlineOption{
				WithInstructions("Some instructions"),
			},
			wantErr: true,
			errMsg:  "name is required",
		},
		{
			name: "missing instructions",
			opts: []InlineOption{
				WithName("analyzer"),
			},
			wantErr: true,
			errMsg:  "instructions are required",
		},
		{
			name: "instructions too short",
			opts: []InlineOption{
				WithName("analyzer"),
				WithInstructions("short"),
			},
			wantErr: true,
			errMsg:  "instructions must be at least 10 characters",
		},
		{
			name: "invalid skill reference",
			opts: []InlineOption{
				WithName("analyzer"),
				WithInstructions("Analyze code for issues"),
				WithSkill(skill.Platform("")), // invalid empty skill ID
			},
			wantErr: true,
			errMsg:  "skill_refs",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub, createErr := Inline(tt.opts...)
			if createErr != nil {
				t.Fatalf("Inline() unexpected creation error = %v", createErr)
			}
			
			err := sub.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if tt.wantErr && err != nil && tt.errMsg != "" {
				if !containsString(err.Error(), tt.errMsg) {
					t.Errorf("Validate() error = %q, want to contain %q", err.Error(), tt.errMsg)
				}
			}
		})
	}
}

func TestString(t *testing.T) {
	tests := []struct {
		name    string
		opts    interface{} // Can be []InlineOption or Reference args
		want    string
		isInline bool
	}{
		{
			name: "inline sub-agent",
			opts: []InlineOption{
				WithName("analyzer"),
				WithInstructions("Analyze code"),
			},
			want:    "SubAgent(analyzer inline)",
			isInline: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var sub SubAgent
			var err error
			
			if tt.isInline {
				sub, err = Inline(tt.opts.([]InlineOption)...)
				if err != nil {
					t.Fatalf("Inline() error = %v", err)
				}
			}
			
			got := sub.String()
			if got != tt.want {
				t.Errorf("String() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestString_Reference(t *testing.T) {
	sub := Reference("security", "sec-prod")
	want := "SubAgent(security -> sec-prod)"
	
	got := sub.String()
	if got != want {
		t.Errorf("String() = %q, want %q", got, want)
	}
}

// Helper function to check if a string contains a substring
func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || 
		(len(s) > 0 && len(substr) > 0 && contains(s, substr)))
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
