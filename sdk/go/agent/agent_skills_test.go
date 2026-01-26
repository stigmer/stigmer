package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/skillref"
)

func TestAgentWithSingleSkill(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skill using builder method
	agent.AddSkillRef(skillref.Platform("coding-best-practices"))

	if len(agent.SkillRefs) != 1 {
		t.Errorf("New() skills count = %d, want 1", len(agent.SkillRefs))
	}

	if agent.SkillRefs[0].Slug != "coding-best-practices" {
		t.Errorf("New() skill[0].Slug = %v, want coding-best-practices", agent.SkillRefs[0].Slug)
	}
}

func TestAgentWithMultipleSkills(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skills using builder method
	agent.AddSkillRefs(
		skillref.Platform("coding-best-practices"),
		skillref.Platform("security-analysis"),
		skillref.Organization("my-org", "internal-docs"),
	)

	if len(agent.SkillRefs) != 3 {
		t.Errorf("New() skills count = %d, want 3", len(agent.SkillRefs))
	}

	// Verify all skills are present
	expectedSlugs := []string{"coding-best-practices", "security-analysis", "internal-docs"}
	for i, slug := range expectedSlugs {
		if agent.SkillRefs[i].Slug != slug {
			t.Errorf("New() skill[%d].Slug = %v, want %v", i, agent.SkillRefs[i].Slug, slug)
		}
	}

	// Verify org skill has correct org
	if agent.SkillRefs[2].Org != "my-org" {
		t.Errorf("New() skill[2].Org = %v, want my-org", agent.SkillRefs[2].Org)
	}
}

// Helper function for test (shared with agent_test.go)
func stringPtr(s string) *string {
	return &s
}
