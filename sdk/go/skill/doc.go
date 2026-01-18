// Package skill provides Skill reference configuration for agents.
//
// Skills provide knowledge and capabilities to agents. They can be:
//   - Platform skills: Shared across the platform
//   - Organization skills: Private to a specific organization
//
// # Basic Usage
//
//	// Platform skill
//	skill := skill.Platform("coding-best-practices")
//
//	// Organization skill
//	skill := skill.Organization("my-org", "internal-docs")
//
// # Integration with Agent
//
// Skills are added to agents using the WithSkill or WithSkills options:
//
//	agent, err := agent.New(
//	    agent.WithName("code-reviewer"),
//	    agent.WithInstructions("Review code"),
//	    agent.WithSkill(skill.Platform("coding-best-practices")),
//	    agent.WithSkill(skill.Organization("my-org", "security-guidelines")),
//	)
//
// # Proto Conversion
//
// Skills convert to ApiResourceReference proto messages with kind = 43 (skill enum value).
package skill
