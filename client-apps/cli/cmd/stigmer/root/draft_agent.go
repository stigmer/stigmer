package root

import (
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
)

var agentCreatorConfig = draftConfig{
	AgentName:    "agent-creator",
	ResourceType: "Agent",
}

// NewDraftAgentCommand creates the draft agent subcommand.
func NewDraftAgentCommand() *cobra.Command {
	var opts draftOptions

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
  stigmer draft agent -m "Create an agent for X" --model claude-sonnet-4-6

  # Run with a workspace (agent can inspect your code)
  stigmer draft agent --workspace . -m "Create an agent based on this project"

  # Override organization
  stigmer draft agent -m "Create an agent for X" --org acme-corp`,
		Run: func(cmd *cobra.Command, args []string) {
			opts.OrgOverride = GetOrgFlag(cmd)
			clierr.Handle(executeDraft(agentCreatorConfig, opts))
		},
	}

	registerDraftFlags(cmd, &opts, agentCreatorConfig.ResourceType)

	return cmd
}
