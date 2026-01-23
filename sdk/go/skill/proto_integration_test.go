package skill

import (
	"testing"
)

// TestSkillToProto_Complete tests full skill with all fields.
func TestSkillToProto_Complete(t *testing.T) {
	skill, err := New(
		WithName("code-analysis"),
		WithSlug("code-analysis"),
		WithDescription("Analyze code for best practices"),
		WithMarkdown("# Code Analysis\n\nAnalyze code quality and suggest improvements."),
	)
	if err != nil {
		t.Fatalf("Failed to create skill: %v", err)
	}

	proto, err := skill.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	if proto == nil {
		t.Fatal("Proto is nil")
	}

	// Verify metadata
	if proto.Metadata == nil {
		t.Fatal("Metadata is nil")
	}
	if proto.Metadata.Name != "code-analysis" {
		t.Errorf("Name = %v, want code-analysis", proto.Metadata.Name)
	}
	if proto.Metadata.Slug != "code-analysis" {
		t.Errorf("Slug = %v, want code-analysis", proto.Metadata.Slug)
	}

	// Verify SDK annotations
	if len(proto.Metadata.Annotations) == 0 {
		t.Error("Expected SDK annotations, got none")
	}
	if proto.Metadata.Annotations[AnnotationSDKLanguage] != "go" {
		t.Error("Expected SDK language annotation to be 'go'")
	}

	// Verify API version and kind
	if proto.ApiVersion != "agentic.stigmer.ai/v1" {
		t.Errorf("ApiVersion = %v, want agentic.stigmer.ai/v1", proto.ApiVersion)
	}
	if proto.Kind != "Skill" {
		t.Errorf("Kind = %v, want Skill", proto.Kind)
	}

	// Verify spec
	if proto.Spec == nil {
		t.Fatal("Spec is nil")
	}
	if proto.Spec.Description != "Analyze code for best practices" {
		t.Errorf("Description mismatch")
	}
	if proto.Spec.MarkdownContent != "# Code Analysis\n\nAnalyze code quality and suggest improvements." {
		t.Errorf("Markdown content mismatch")
	}
}

// TestSkillToProto_Minimal tests minimal skill with only required fields.
func TestSkillToProto_Minimal(t *testing.T) {
	skill, err := New(
		WithName("simple-skill"),
		WithMarkdown("# Simple Skill"),
	)
	if err != nil {
		t.Fatalf("Failed to create skill: %v", err)
	}

	proto, err := skill.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	if proto == nil {
		t.Fatal("Proto is nil")
	}

	// Verify metadata
	if proto.Metadata.Name != "simple-skill" {
		t.Errorf("Name = %v, want simple-skill", proto.Metadata.Name)
	}

	// Verify spec
	if proto.Spec.MarkdownContent != "# Simple Skill" {
		t.Errorf("Markdown content mismatch")
	}

	// Verify optional fields are empty
	if proto.Spec.Description != "" {
		t.Error("Expected empty description")
	}
}

// TestSkillToProto_CustomSlug tests custom slug override.
func TestSkillToProto_CustomSlug(t *testing.T) {
	skill, err := New(
		WithName("my-skill"),
		WithSlug("custom-skill-123"),  // Custom slug
		WithMarkdown("# Test"),
	)
	if err != nil {
		t.Fatalf("Failed to create skill: %v", err)
	}

	proto, err := skill.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify custom slug is used
	if proto.Metadata.Slug != "custom-skill-123" {
		t.Errorf("Slug = %v, want custom-slug-123", proto.Metadata.Slug)
	}
}

// TestSkillToProto_LongMarkdown tests skill with long markdown content.
func TestSkillToProto_LongMarkdown(t *testing.T) {
	longContent := `# Security Guidelines

## Overview
This skill provides comprehensive security analysis.

## Checklist
- SQL injection detection
- XSS vulnerability scanning
- Authentication checks
- Authorization validation
- Data encryption review

## Best Practices
Always follow OWASP guidelines...
`

	skill, err := New(
		WithName("security-analyzer"),
		WithDescription("Comprehensive security analysis"),
		WithMarkdown(longContent),
	)
	if err != nil {
		t.Fatalf("Failed to create skill: %v", err)
	}

	proto, err := skill.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify full content is preserved
	if proto.Spec.MarkdownContent != longContent {
		t.Errorf("Markdown content was modified")
	}
}
