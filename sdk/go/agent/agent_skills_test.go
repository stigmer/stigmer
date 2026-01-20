package agent

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/skill"
)

func TestWithSkill(t *testing.T) {
	tests := []struct {
		name          string
		skills        []skill.Skill
		expectedCount int
	}{
		{
			name: "single skill",
			skills: []skill.Skill{
				skill.Platform("coding-best-practices"),
			},
			expectedCount: 1,
		},
		{
			name: "multiple skills",
			skills: []skill.Skill{
				skill.Platform("coding-best-practices"),
				skill.Organization("my-org", "internal-docs"),
			},
			expectedCount: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opts := []Option{
				WithName("test-agent"),
				WithInstructions("Test instructions for agent"),
			}

			for _, s := range tt.skills {
				opts = append(opts, WithSkill(s))
			}

			agent, err := New(


				nil, // No context needed for tests
		opts...)
			if err != nil {
				t.Fatalf("New() unexpected error = %v", err)
			}

			if len(agent.Skills) != tt.expectedCount {
				t.Errorf("New() skills count = %d, want %d", len(agent.Skills), tt.expectedCount)
			}

			// Verify skills match
			for i, expectedSkill := range tt.skills {
				if agent.Skills[i].Slug != expectedSkill.Slug {
					t.Errorf("New() skill[%d].Slug = %v, want %v", i, agent.Skills[i].Slug, expectedSkill.Slug)
				}
				if agent.Skills[i].Org != expectedSkill.Org {
					t.Errorf("New() skill[%d].Org = %v, want %v", i, agent.Skills[i].Org, expectedSkill.Org)
				}
			}
		})
	}
}

func TestWithSkills(t *testing.T) {
	skills := []skill.Skill{
		skill.Platform("coding-best-practices"),
		skill.Platform("security-analysis"),
		skill.Organization("my-org", "internal-docs"),
	}

	agent, err := New(


		nil, // No context needed for tests
		WithName("test-agent"),
		WithInstructions("Test instructions for agent"),
		WithSkills(skills...),
	)
	if err != nil {
		t.Fatalf("New() unexpected error = %v", err)
	}

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
