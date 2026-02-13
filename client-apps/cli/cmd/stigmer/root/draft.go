package root

import (
	"github.com/spf13/cobra"
)

// NewDraftCommand creates the draft command group for AI-assisted resource creation.
func NewDraftCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "draft <resource-type>",
		Short: "Create resource configurations with AI assistance",
		Long: `Draft creates resource configurations using AI-powered agents.

The draft command invokes specialized system agents to help you create
well-structured configuration files for various Stigmer resources.

Currently supported resource types:
  - skill: Create SKILL.md files using the skill-creator-agent

Each draft command:
  - Invokes the appropriate system agent
  - Accepts input files via --attach for context
  - Waits for completion and downloads the generated artifacts`,
		Example: `  # Create a new skill
  stigmer draft skill -m "Create a skill for validating Kubernetes manifests"

  # Create a skill with context files
  stigmer draft skill --attach ./example-skill.md -m "Create similar for Terraform"`,
	}

	// Add subcommands for each resource type
	cmd.AddCommand(NewDraftSkillCommand())
	// Future: NewDraftAgentCommand(), NewDraftWorkflowCommand(), NewDraftMcpServerCommand()

	return cmd
}
