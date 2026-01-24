package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/skill"
)

func TestAgentWithSingleSkill(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skill using builder method
	agent.AddSkill(skill.Platform("coding-best-practices"))

	if len(agent.Skills) != 1 {
		t.Errorf("New() skills count = %d, want 1", len(agent.Skills))
	}

	if agent.Skills[0].Slug != "coding-best-practices" {
		t.Errorf("New() skill[0].Slug = %v, want coding-best-practices", agent.Skills[0].Slug)
	}
}

func TestAgentWithMultipleSkills(t *testing.T) {
	skills := []skill.Skill{
		skill.Platform("coding-best-practices"),
		skill.Platform("security-analysis"),
		skill.Organization("my-org", "internal-docs"),
	}

	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for agent",
	})
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

	// Add skills using builder method
	agent.AddSkills(skills...)

	if len(agent.Skills) != 3 {
		t.Errorf("New() skills count = %d, want 3", len(agent.Skills))
	}

	// Verify all skills are present
	for i, expectedSkill := range skills {
		if agent.Skills[i].Slug != expectedSkill.Slug {
			t.Errorf("New() skill[%d].Slug = %v, want %v", i, agent.Skills[i].Slug, expectedSkill.Slug)
		}
		if agent.Skills[i].Org != expectedSkill.Org {
			t.Errorf("New() skill[%d].Org = %v, want %v", i, agent.Skills[i].Org, expectedSkill.Org)
		}
	}
}

// Helper function for test (shared with agent_test.go)
func stringPtr(s string) *string {
	return &s
}
