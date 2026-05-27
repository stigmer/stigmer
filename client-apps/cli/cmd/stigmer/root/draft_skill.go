package root

import (
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
)

var skillCreatorConfig = draftConfig{
	AgentName:    "skill-creator",
	ResourceType: "Skill",
}

// NewDraftSkillCommand creates the draft skill subcommand.
func NewDraftSkillCommand() *cobra.Command {
	var opts draftOptions

	cmd := &cobra.Command{
		Use:   "skill",
		Short: "Create a skill with AI assistance",
		Long: `Draft a new skill using the skill-creator system agent.

The skill-creator agent uses Anthropic's SKILL.md format guidelines to help
you create well-structured skills that extend agent capabilities.

You can provide context files (examples, requirements, references) via --attach
to help the agent understand what you want to build.

The agent will:
1. Understand your requirements from the message and attached files
2. Generate a complete SKILL.md file following best practices
3. Publish the result as an artifact for download

Execution streams in real-time by default. Approval prompts are handled
interactively. The generated skill will be saved to the output directory
(default: current directory).`,
		Example: `  # Create a skill interactively
  stigmer draft skill -m "Create a skill for validating Kubernetes manifests"

  # Provide context files as examples
  stigmer draft skill --attach ./example-skill.md -m "Create similar skill for Terraform"

  # Provide multiple context files
  stigmer draft skill --attach ./requirements.md --attach ./examples/ -m "Build skill from these"

  # Save to specific directory
  stigmer draft skill -m "Create a YAML validator skill" --output ./skills/yaml-validator/

  # Use a specific model
  stigmer draft skill -m "Create a skill for X" --model claude-sonnet-4-6

  # Run with a workspace (agent can inspect your code)
  stigmer draft skill --workspace . -m "Create a skill based on this project"

  # Run with environment variables for MCP servers
  stigmer draft skill -m "Create a skill for X" --env GITHUB_TOKEN=ghp_xxx`,
		Run: func(cmd *cobra.Command, args []string) {
			opts.OrgOverride = GetOrgFlag(cmd)
			clierr.Handle(executeDraft(skillCreatorConfig, opts))
		},
	}

	registerDraftFlags(cmd, &opts, skillCreatorConfig.ResourceType)

	return cmd
}
