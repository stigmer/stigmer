package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/skill"
)

// TestAgentToProto_Complete tests full agent with all optional fields.
func TestAgentToProto_Complete(t *testing.T) {
	// Create full agent
	agent, err := New(nil,
		WithName("code-reviewer-pro"),
		WithSlug("code-reviewer-pro"),
		WithDescription("Professional code reviewer with security focus"),
		WithIconURL("https://example.com/icon.png"),
		WithInstructions("Review code thoroughly and suggest improvements"),
	)
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Convert to proto
	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify proto structure
	if proto == nil {
		t.Fatal("Proto is nil")
	}

	// Verify metadata
	if proto.Metadata == nil {
		t.Fatal("Metadata is nil")
	}
	if proto.Metadata.Name != "code-reviewer-pro" {
		t.Errorf("Name = %v, want code-reviewer-pro", proto.Metadata.Name)
	}
	if proto.Metadata.Slug != "code-reviewer-pro" {
		t.Errorf("Slug = %v, want code-reviewer-pro", proto.Metadata.Slug)
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
	if proto.Kind != "Agent" {
		t.Errorf("Kind = %v, want Agent", proto.Kind)
	}

	// Verify spec
	if proto.Spec == nil {
		t.Fatal("Spec is nil")
	}
	if proto.Spec.Description != "Professional code reviewer with security focus" {
		t.Errorf("Description mismatch")
	}
	if proto.Spec.Instructions != "Review code thoroughly and suggest improvements" {
		t.Errorf("Instructions mismatch")
	}
	if proto.Spec.IconUrl != "https://example.com/icon.png" {
		t.Errorf("IconURL mismatch")
	}
}

// TestAgentToProto_Minimal tests minimal agent with only required fields.
func TestAgentToProto_Minimal(t *testing.T) {
	agent, err := New(nil,
		WithName("simple-agent"),
		WithInstructions("Do something simple"),
	)
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	if proto == nil {
		t.Fatal("Proto is nil")
	}

	// Verify metadata
	if proto.Metadata.Name != "simple-agent" {
		t.Errorf("Name = %v, want simple-agent", proto.Metadata.Name)
	}

	// Verify spec
	if proto.Spec.Instructions != "Do something simple" {
		t.Errorf("Instructions mismatch")
	}

	// Verify optional fields are empty
	if proto.Spec.Description != "" {
		t.Error("Expected empty description")
	}
	if len(proto.Spec.SkillRefs) != 0 {
		t.Error("Expected no skill references")
	}
	if len(proto.Spec.McpServers) != 0 {
		t.Error("Expected no MCP servers")
	}
	if len(proto.Spec.SubAgents) != 0 {
		t.Error("Expected no sub-agents")
	}
}

// TestAgentToProto_WithSkill tests agent with inline skill.
func TestAgentToProto_WithSkill(t *testing.T) {
	// Create inline skill
	skill1, err := skill.New(
		skill.WithName("code-analysis"),
		skill.WithDescription("Analyze code quality"),
		skill.WithMarkdown("# Code Analysis\nAnalyze code for best practices"),
	)
	if err != nil {
		t.Fatalf("Failed to create skill: %v", err)
	}

	// Create agent with skill
	agent, err := New(nil,
		WithName("code-reviewer-pro"),
		WithSlug("code-reviewer-pro"),
		WithDescription("Professional code reviewer with security focus"),
		WithIconURL("https://example.com/icon.png"),
		WithInstructions("Review code thoroughly and suggest improvements"),
		WithSkills(*skill1),
	)
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Convert to proto
	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify proto structure
	if proto == nil {
		t.Fatal("Proto is nil")
	}

	// Verify metadata
	if proto.Metadata == nil {
		t.Fatal("Metadata is nil")
	}
	if proto.Metadata.Name != "code-reviewer-pro" {
		t.Errorf("Name = %v, want code-reviewer-pro", proto.Metadata.Name)
	}
	if proto.Metadata.Slug != "code-reviewer-pro" {
		t.Errorf("Slug = %v, want code-reviewer-pro", proto.Metadata.Slug)
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
	if proto.Kind != "Agent" {
		t.Errorf("Kind = %v, want Agent", proto.Kind)
	}

	// Verify spec
	if proto.Spec == nil {
		t.Fatal("Spec is nil")
	}
	if proto.Spec.Description != "Professional code reviewer with security focus" {
		t.Errorf("Description mismatch")
	}
	if proto.Spec.Instructions != "Review code thoroughly and suggest improvements" {
		t.Errorf("Instructions mismatch")
	}
	if proto.Spec.IconUrl != "https://example.com/icon.png" {
		t.Errorf("IconURL mismatch")
	}

	// Verify skills
	if len(proto.Spec.SkillRefs) != 1 {
		t.Fatalf("Expected 1 skill reference, got %d", len(proto.Spec.SkillRefs))
	}
	if proto.Spec.SkillRefs[0].Slug != "code-analysis" {
		t.Errorf("Skill slug mismatch")
	}
}

// TestAgentToProto_MultipleSkills tests agent with multiple skills.
func TestAgentToProto_MultipleSkills(t *testing.T) {
	skill1, _ := skill.New(
		skill.WithName("skill1"),
		skill.WithMarkdown("# Skill 1"),
	)
	skill2, _ := skill.New(
		skill.WithName("skill2"),
		skill.WithMarkdown("# Skill 2"),
	)
	skill3, _ := skill.New(
		skill.WithName("skill3"),
		skill.WithMarkdown("# Skill 3"),
	)

	agent, err := New(nil,
		WithName("multi-skill-agent"),
		WithInstructions("Use multiple skills"),
		WithSkills(*skill1, *skill2, *skill3),
	)
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify all skills are referenced
	if len(proto.Spec.SkillRefs) != 3 {
		t.Fatalf("Expected 3 skill references, got %d", len(proto.Spec.SkillRefs))
	}

	expectedSlugs := []string{"skill1", "skill2", "skill3"}
	for i, skillRef := range proto.Spec.SkillRefs {
		if skillRef.Slug != expectedSlugs[i] {
			t.Errorf("Skill %d slug = %v, want %v", i, skillRef.Slug, expectedSlugs[i])
		}
	}
}

// TestAgentToProto_CustomSlug tests custom slug override.
func TestAgentToProto_CustomSlug(t *testing.T) {
	agent, err := New(nil,
		WithName("my-agent"),
		WithSlug("custom-slug-123"),  // Custom slug
		WithInstructions("Test instructions for agent validation"),
	)
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify custom slug is used
	if proto.Metadata.Slug != "custom-slug-123" {
		t.Errorf("Slug = %v, want custom-slug-123", proto.Metadata.Slug)
	}
}
