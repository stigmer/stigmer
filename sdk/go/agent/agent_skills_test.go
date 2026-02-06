package agent

import (
	"testing"
)

func TestAgentWithSingleSkill(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skill using new smart parsing API
	agent.AddSkill("stigmer/coding-best-practices")

	if len(agent.SkillRefs()) != 1 {
		t.Errorf("New() skills count = %d, want 1", len(agent.SkillRefs()))
	}

	if agent.SkillRefs()[0].Slug != "coding-best-practices" {
		t.Errorf("New() skill[0].Slug = %v, want coding-best-practices", agent.SkillRefs()[0].Slug)
	}

	if agent.SkillRefs()[0].Org != "stigmer" {
		t.Errorf("New() skill[0].Org = %v, want stigmer", agent.SkillRefs()[0].Org)
	}
}

func TestAgentWithMultipleSkills(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skills using new smart parsing API
	agent.AddSkills(
		"stigmer/coding-best-practices",
		"stigmer/security-analysis",
		"my-org/internal-docs",
	)

	if len(agent.SkillRefs()) != 3 {
		t.Errorf("New() skills count = %d, want 3", len(agent.SkillRefs()))
	}

	// Verify all skills are present
	expectedSlugs := []string{"coding-best-practices", "security-analysis", "internal-docs"}
	for i, slug := range expectedSlugs {
		if agent.SkillRefs()[i].Slug != slug {
			t.Errorf("New() skill[%d].Slug = %v, want %v", i, agent.SkillRefs()[i].Slug, slug)
		}
	}

	// Verify org skill has correct org
	if agent.SkillRefs()[2].Org != "my-org" {
		t.Errorf("New() skill[2].Org = %v, want my-org", agent.SkillRefs()[2].Org)
	}
}

func TestAgentWithSlugOnlySkills(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Set agent org for slug-only references
	agent.Org = "my-org"

	// Add skill using slug-only reference (should use agent.Org)
	agent.AddSkill("internal-docs")

	if len(agent.SkillRefs()) != 1 {
		t.Errorf("New() skills count = %d, want 1", len(agent.SkillRefs()))
	}

	if agent.SkillRefs()[0].Slug != "internal-docs" {
		t.Errorf("New() skill[0].Slug = %v, want internal-docs", agent.SkillRefs()[0].Slug)
	}

	if agent.SkillRefs()[0].Org != "my-org" {
		t.Errorf("New() skill[0].Org = %v, want my-org (from agent.Org)", agent.SkillRefs()[0].Org)
	}
}

func TestAgentWithVersionedSkills(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skill with version in string
	agent.AddSkill("stigmer/coding-best-practices@v2.0")

	if len(agent.SkillRefs()) != 1 {
		t.Errorf("New() skills count = %d, want 1", len(agent.SkillRefs()))
	}

	if agent.SkillRefs()[0].Version != "v2.0" {
		t.Errorf("New() skill[0].Version = %v, want v2.0", agent.SkillRefs()[0].Version)
	}
}

// Helper function for test (shared with agent_test.go)
func stringPtr(s string) *string {
	return &s
}
