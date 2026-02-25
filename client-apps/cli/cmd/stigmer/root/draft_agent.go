package root

import (
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
)

const (
	// System agent for agent creation (from seedpack bootstrap).
	agentCreatorAgentName = "agent-creator"
)

// NewDraftAgentCommand creates the draft agent subcommand.
func NewDraftAgentCommand() *cobra.Command {
	var message string
	var attachFlags []string
	var outputDir string
	var model string
	var approveDefault string
	var autoApprove bool
	var verbose bool

	cmd := &cobra.Command{
		Use:   "agent",
		Short: "Create an agent with AI assistance",
		Long: `Draft a new agent using the agent-creator system agent.

The agent-creator agent uses the agentic.stigmer.ai/v1 Agent schema and
best practices to help you create well-structured Agent YAML definitions.

You can provide context files (examples, proto schemas, docs) via --attach
to help the agent understand what you want to build.

The agent will:
1. Understand your requirements from the message and attached files
2. Query the platform for available skills, MCP servers, and agents
3. Generate a valid Agent YAML file following best practices
4. Publish the result as an artifact for download

Execution streams in real-time by default. Approval prompts are handled
interactively. The generated agent YAML will be saved to the output directory
(default: current directory).`,
		Example: `  # Create an agent interactively
  stigmer draft agent -m "Create an agent that reviews pull requests"

  # Provide context files
  stigmer draft agent --attach ./proto-schemas/ -m "Create an agent that validates YAML configs"

  # Save to specific directory
  stigmer draft agent -m "Create a code review agent" --output ./agents/

  # Use a specific model
  stigmer draft agent -m "Create an agent for X" --model claude-sonnet-4-20250514`,
		Run: func(cmd *cobra.Command, args []string) {
			err := executeDraftAgent(draftAgentOptions{
				Message:        message,
				AttachFlags:    attachFlags,
				OutputDir:      outputDir,
				Model:          model,
				ApproveDefault: approveDefault,
				AutoApprove:    autoApprove,
				Verbose:        verbose,
			})
			clierr.Handle(err)
		},
	}

	cmd.Flags().StringVarP(&message, "message", "m", "",
		"description of the agent you want to create (required)")

	cmd.Flags().StringArrayVar(&attachFlags, "attach", []string{},
		"file or directory to attach as context (can be repeated)")

	cmd.Flags().StringVarP(&outputDir, "output", "o", ".",
		"directory to save the generated agent YAML")

	cmd.Flags().StringVar(&model, "model", "",
		"LLM model to use (e.g., claude-sonnet-4-20250514)")

	cmd.MarkFlagRequired("message")

	cmd.Flags().StringVar(&approveDefault, "approve-default", "",
		"auto-resolve approval prompts in non-interactive mode (approve, skip, reject)")

	cmd.Flags().BoolVar(&autoApprove, "auto-approve", false,
		"automatically approve all tool executions without prompting (bypasses approval policies)")

	cmd.Flags().BoolVarP(&verbose, "verbose", "v", false,
		"show execution IDs and phase transitions in the TUI transcript")

	return cmd
}
