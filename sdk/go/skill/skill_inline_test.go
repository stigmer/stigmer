package skill

import (
	"testing"
)

func TestNew(t *testing.T) {
	tests := []struct {
		name      string
		skillName string
		args      *SkillArgs
		wantErr   bool
		errType   error
	}{
		{
			name:      "valid inline skill",
			skillName: "code-analyzer",
			args: &SkillArgs{
				MarkdownContent: "# Code Analysis\n\nThis skill analyzes code quality.",
			},
			wantErr: false,
		},
		{
			name:      "valid inline skill with description",
			skillName: "security-checker",
			args: &SkillArgs{
				Description:     "Security analysis skill",
				MarkdownContent: "# Security\n\nCheck code for security vulnerabilities.",
			},
			wantErr: false,
		},
		{
			name:      "missing name",
			skillName: "",
			args: &SkillArgs{
				MarkdownContent: "# Content\n\nSome content.",
			},
			wantErr: true,
			errType: ErrSkillNameRequired,
		},
		{
			name:      "missing markdown",
			skillName: "test-skill",
			args:      &SkillArgs{},
			wantErr:   true,
			errType:   ErrSkillMarkdownRequired,
		},
		{
			name:      "nil args",
			skillName: "test-skill",
			args:      nil,
			wantErr:   true,
			errType:   ErrSkillMarkdownRequired,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			skill, err := New(tt.skillName, tt.args)

			if tt.wantErr {
				if err == nil {
					t.Errorf("New() expected error but got none")
					return
				}
				if tt.errType != nil && err != tt.errType {
					t.Errorf("New() error = %v, want %v", err, tt.errType)
				}
			} else {
				if err != nil {
					t.Errorf("New() unexpected error = %v", err)
					return
				}
				if skill == nil {
					t.Error("New() returned nil skill")
					return
				}
				if !skill.IsInline {
					t.Error("New() skill.IsInline = false, want true")
				}
			}
		})
	}
}

func TestInlineSkill_Fields(t *testing.T) {
	skill, err := New("test-skill", &SkillArgs{
		Description:     "Test skill description",
		MarkdownContent: "# Test\n\nTest content.",
	})

	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Verify all fields are set correctly
	if skill.Name != "test-skill" {
		t.Errorf("Name = %q, want %q", skill.Name, "test-skill")
	}
	if skill.Description != "Test skill description" {
		t.Errorf("Description = %q, want %q", skill.Description, "Test skill description")
	}
	if skill.MarkdownContent != "# Test\n\nTest content." {
		t.Errorf("MarkdownContent = %q, want %q", skill.MarkdownContent, "# Test\n\nTest content.")
	}
	if !skill.IsInline {
		t.Error("IsInline = false, want true")
	}

	// For inline skills, slug is auto-generated from name, org is empty
	if skill.Slug == "" {
		t.Error("Slug should be auto-generated from name, got empty string")
	}
	if skill.Slug != "test-skill" {
		t.Errorf("Slug = %q, want %q (auto-generated from name)", skill.Slug, "test-skill")
	}
	if skill.Org != "" {
		t.Errorf("Org = %q, want empty string", skill.Org)
	}
}

func TestInlineSkill_IsPlatformReference_IsOrganizationReference(t *testing.T) {
	inlineSkill, _ := New("test-skill", &SkillArgs{
		MarkdownContent: "# Test\n\nTest content.",
	})

	// Inline skills are neither platform nor organization references
	if inlineSkill.IsPlatformReference() {
		t.Error("IsPlatformReference() = true, want false for inline skill")
	}
	if inlineSkill.IsOrganizationReference() {
		t.Error("IsOrganizationReference() = true, want false for inline skill")
	}
}

func TestInlineSkill_String(t *testing.T) {
	skill, _ := New("code-analyzer", &SkillArgs{
		Description:     "Analyzes code",
		MarkdownContent: "# Code Analysis\n\nContent.",
	})

	result := skill.String()
	expected := "Skill(inline:code-analyzer)"

	if result != expected {
		t.Errorf("String() = %q, want %q", result, expected)
	}
}

func TestInlineVsReferencedSkills(t *testing.T) {
	// Create inline skill
	inlineSkill, err := New("my-inline-skill", &SkillArgs{
		MarkdownContent: "# Inline\n\nInline content.",
	})
	if err != nil {
		t.Fatalf("Failed to create inline skill: %v", err)
	}

	// Create referenced skills
	platformSkill := Platform("coding-best-practices")
	orgSkill := Organization("my-org", "internal-docs")

	// Verify inline vs referenced
	if !inlineSkill.IsInline {
		t.Error("inlineSkill.IsInline = false, want true")
	}
	if platformSkill.IsInline {
		t.Error("platformSkill.IsInline = true, want false")
	}
	if orgSkill.IsInline {
		t.Error("orgSkill.IsInline = true, want false")
	}

	// Inline skills have Name and MarkdownContent
	if inlineSkill.Name == "" {
		t.Error("inlineSkill.Name is empty")
	}
	if inlineSkill.MarkdownContent == "" {
		t.Error("inlineSkill.MarkdownContent is empty")
	}

	// Referenced skills have Slug
	if platformSkill.Slug == "" {
		t.Error("platformSkill.Slug is empty")
	}
	if orgSkill.Slug == "" {
		t.Error("orgSkill.Slug is empty")
	}
}
