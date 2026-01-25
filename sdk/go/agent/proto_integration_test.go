package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/skillref"
)

// TestAgentToProto_Complete tests full agent with all optional fields.
func TestAgentToProto_Complete(t *testing.T) {
	// Create full agent
	agent, err := New(nil, "code-reviewer-pro", &AgentArgs{
		Description:  "Professional code reviewer with security focus",
		IconUrl:      "https://example.com/icon.png",
		Instructions: "Review code thoroughly and suggest improvements",
	})
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
	agent, err := New(nil, "simple-agent", &AgentArgs{
		Instructions: "Do something simple",
	})
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

// TestAgentToProto_WithSkill tests agent with skill reference.
func TestAgentToProto_WithSkill(t *testing.T) {
	// Create agent with skill
	agent, err := New(nil, "code-reviewer-pro", &AgentArgs{
		Description:  "Professional code reviewer with security focus",
		IconUrl:      "https://example.com/icon.png",
		Instructions: "Review code thoroughly and suggest improvements",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Add skill using builder method
	agent.AddSkillRef(skillref.Platform("code-analysis"))

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

// TestAgentToProto_MultipleSkills tests agent with multiple skill references.
func TestAgentToProto_MultipleSkills(t *testing.T) {
	agent, err := New(nil, "multi-skill-agent", &AgentArgs{
		Instructions: "Use multiple skills",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Add skills using builder method
	agent.AddSkillRefs(
		skillref.Platform("skill1"),
		skillref.Platform("skill2"),
		skillref.Organization("my-org", "skill3"),
	)

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
	agent, err := New(nil, "my-agent", &AgentArgs{
		Instructions: "Test instructions for agent validation",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Set custom slug directly on agent (builder pattern)
	agent.Slug = "custom-slug-123"

	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed: %v", err)
	}

	// Verify custom slug is used
	if proto.Metadata.Slug != "custom-slug-123" {
		t.Errorf("Slug = %v, want custom-slug-123", proto.Metadata.Slug)
	}
}
