package skill

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNew(t *testing.T) {
	tests := []struct {
		name    string
		opts    []Option
		wantErr bool
		errType error
	}{
		{
			name: "valid inline skill",
			opts: []Option{
				WithName("code-analyzer"),
				WithMarkdown("# Code Analysis\n\nThis skill analyzes code quality."),
			},
			wantErr: false,
		},
		{
			name: "valid inline skill with description",
			opts: []Option{
				WithName("security-checker"),
				WithDescription("Security analysis skill"),
				WithMarkdown("# Security\n\nCheck code for security vulnerabilities."),
			},
			wantErr: false,
		},
		{
			name: "missing name",
			opts: []Option{
				WithMarkdown("# Content\n\nSome content."),
			},
			wantErr: true,
			errType: ErrSkillNameRequired,
		},
		{
			name: "missing markdown",
			opts: []Option{
				WithName("test-skill"),
			},
			wantErr: true,
			errType: ErrSkillMarkdownRequired,
		},
		{
			name:    "no options",
			opts:    []Option{},
			wantErr: true,
			errType: ErrSkillNameRequired,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			skill, err := New(tt.opts...)

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

func TestWithMarkdownFromFile(t *testing.T) {
	// Create temporary directory for test files
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test-skill.md")

	// Write test content to file
	testContent := "# Test Skill\n\nThis is a test skill with markdown content."
	if err := os.WriteFile(testFile, []byte(testContent), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	tests := []struct {
		name    string
		path    string
		wantErr bool
	}{
		{
			name:    "valid markdown file",
			path:    testFile,
			wantErr: false,
		},
		{
			name:    "non-existent file",
			path:    filepath.Join(tmpDir, "non-existent.md"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			skill, err := New(
				WithName("test-skill"),
				WithMarkdownFromFile(tt.path),
			)

			if tt.wantErr {
				if err == nil {
					t.Errorf("New() expected error but got none")
					return
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

				// Verify markdown was loaded
				if skill.MarkdownContent != testContent {
					t.Errorf("MarkdownContent = %q, want %q", skill.MarkdownContent, testContent)
				}
			}
		})
	}
}

func TestInlineSkill_Fields(t *testing.T) {
	skill, err := New(
		WithName("test-skill"),
		WithDescription("Test skill description"),
		WithMarkdown("# Test\n\nTest content."),
	)

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

	// For inline skills, these should be empty
	if skill.Slug != "" {
		t.Errorf("Slug = %q, want empty string", skill.Slug)
	}
	if skill.Org != "" {
		t.Errorf("Org = %q, want empty string", skill.Org)
	}
}

func TestInlineSkill_IsPlatformReference_IsOrganizationReference(t *testing.T) {
	inlineSkill, _ := New(
		WithName("test-skill"),
		WithMarkdown("# Test\n\nTest content."),
	)

	// Inline skills are neither platform nor organization references
	if inlineSkill.IsPlatformReference() {
		t.Error("IsPlatformReference() = true, want false for inline skill")
	}
	if inlineSkill.IsOrganizationReference() {
		t.Error("IsOrganizationReference() = true, want false for inline skill")
	}
}

func TestInlineSkill_String(t *testing.T) {
	skill, _ := New(
		WithName("code-analyzer"),
		WithDescription("Analyzes code"),
		WithMarkdown("# Code Analysis\n\nContent."),
	)

	result := skill.String()
	expected := "Skill(inline:code-analyzer)"

	if result != expected {
		t.Errorf("String() = %q, want %q", result, expected)
	}
}

func TestInlineVsReferencedSkills(t *testing.T) {
	// Create inline skill
	inlineSkill, err := New(
		WithName("my-inline-skill"),
		WithMarkdown("# Inline\n\nInline content."),
	)
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
