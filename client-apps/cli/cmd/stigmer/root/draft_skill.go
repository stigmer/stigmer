package root

import (
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
)

const (
	// System agent for skill creation (from seedpack bootstrap).
	// Bootstrap creates system agents in "local" org for single-tenant local mode.
	skillCreatorAgentName = "skill-creator-agent"
	skillCreatorAgentOrg  = "local"
)

// NewDraftSkillCommand creates the draft skill subcommand.
func NewDraftSkillCommand() *cobra.Command {
	var message string
	var attachFlags []string
	var outputDir string
	var follow bool
	var model string

	cmd := &cobra.Command{
		Use:   "skill",
		Short: "Create a skill with AI assistance",
		Long: `Draft a new skill using the skill-creator-agent.

The skill-creator-agent uses Anthropic's SKILL.md format guidelines to help
you create well-structured skills that extend agent capabilities.

You can provide context files (examples, requirements, references) via --attach
to help the agent understand what you want to build.

The agent will:
1. Understand your requirements from the message and attached files
2. Generate a complete SKILL.md file following best practices
3. Publish the result as an artifact for download

The generated skill will be saved to the output directory (default: current directory).`,
		Example: `  # Create a skill interactively
  stigmer draft skill -m "Create a skill for validating Kubernetes manifests"

  # Provide context files as examples
  stigmer draft skill --attach ./example-skill.md -m "Create similar skill for Terraform"

  # Provide multiple context files
  stigmer draft skill --attach ./requirements.md --attach ./examples/ -m "Build skill from these"

  # Save to specific directory
  stigmer draft skill -m "Create a YAML validator skill" --output ./skills/yaml-validator/

  # Stream agent logs during creation
  stigmer draft skill -m "Create a skill for X" --follow

  # Use a specific model
  stigmer draft skill -m "Create a skill for X" --model claude-sonnet-4-20250514`,
		Run: func(cmd *cobra.Command, args []string) {
			err := executeDraftSkill(draftSkillOptions{
				Message:     message,
				AttachFlags: attachFlags,
				OutputDir:   outputDir,
				Follow:      follow,
				Model:       model,
			})
			clierr.Handle(err)
		},
	}

	// Message flag (required)
	cmd.Flags().StringVarP(&message, "message", "m", "",
		"description of the skill you want to create (required)")

	// Attachment flags for context files
	cmd.Flags().StringArrayVar(&attachFlags, "attach", []string{},
		"file or directory to attach as context (can be repeated)")

	// Output directory
	cmd.Flags().StringVarP(&outputDir, "output", "o", ".",
		"directory to save the generated skill")

	// Follow flag for streaming logs
	cmd.Flags().BoolVar(&follow, "follow", false,
		"stream agent logs during skill creation")

	// Model flag for specifying LLM model
	cmd.Flags().StringVar(&model, "model", "",
		"LLM model to use (e.g., claude-sonnet-4-20250514)")

	// Mark message as required
	cmd.MarkFlagRequired("message")

	return cmd
}
