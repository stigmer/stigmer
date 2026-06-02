package root

import (
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
)

var mcpServerCreatorConfig = draftConfig{
	AgentName:    "mcp-server-creator",
	ResourceType: "McpServer",
}

// NewDraftMcpServerCommand creates the draft mcp-server subcommand.
func NewDraftMcpServerCommand() *cobra.Command {
	var opts draftOptions

	cmd := &cobra.Command{
		Use:   "mcp-server",
		Short: "Create an MCP server with AI assistance",
		Long: `Draft a new MCP server using the mcp-server-creator system agent.

The mcp-server-creator agent uses the agentic.stigmer.ai/v1 McpServer schema
and best practices to help you create well-structured McpServer YAML definitions.

You can provide context files (docs, existing server configs) via --attach
to help the agent understand what you want to build.

The agent will:
1. Understand your requirements from the message and attached files
2. Query the platform for existing MCP servers to avoid duplication
3. Choose the correct transport (stdio or http) for your use case
4. Generate a valid McpServer YAML with env_spec, tool gates, and approval policies
5. Publish the result as an artifact for download

Execution streams in real-time by default. Approval prompts are handled
interactively. The generated McpServer YAML will be saved to the output
directory (default: current directory).`,
		Example: `  # Create an MCP server interactively
  stigmer draft mcp-server -m "Create a GitHub MCP server"

  # Provide context files
  stigmer draft mcp-server --attach ./docs/ -m "Create an MCP server for our internal API"

  # Save to specific directory
  stigmer draft mcp-server -m "Create a Slack MCP server" --output ./mcp-servers/

  # Use a specific model
  stigmer draft mcp-server -m "Create an MCP server for X" --model claude-sonnet-4-6

  # Run with a workspace (agent can inspect your code)
  stigmer draft mcp-server --workspace . -m "Create an MCP server based on this project"

  # Override organization
  stigmer draft mcp-server -m "Create an MCP server for X" --org acme-corp`,
		Run: func(cmd *cobra.Command, args []string) {
			opts.OrgOverride = GetOrgFlag(cmd)
			clierr.Handle(executeDraft(mcpServerCreatorConfig, opts))
		},
	}

	registerDraftFlags(cmd, &opts, mcpServerCreatorConfig.ResourceType)

	return cmd
}
