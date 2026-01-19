package root

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	apiresourcev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// NewAgentCommand creates the agent command
func NewAgentCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "agent",
		Short: "Manage agents",
		Long:  `Create, list, and manage AI agents.`,
	}

	cmd.AddCommand(newAgentCreateCommand())
	cmd.AddCommand(newAgentListCommand())
	cmd.AddCommand(newAgentGetCommand())
	cmd.AddCommand(newAgentDeleteCommand())

	return cmd
}

func newAgentCreateCommand() *cobra.Command {
	var name string
	var instructions string

	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new agent",
		Example: `  # Create an agent
  stigmer agent create --name support-bot --instructions "You are a helpful support agent"`,
		Run: func(cmd *cobra.Command, args []string) {
			handleAgentCreate(name, instructions)
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "Agent name (required)")
	cmd.Flags().StringVar(&instructions, "instructions", "", "Agent instructions (required)")
	cmd.MarkFlagRequired("name")
	cmd.MarkFlagRequired("instructions")

	return cmd
}

func newAgentListCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all agents",
		Run: func(cmd *cobra.Command, args []string) {
			handleAgentList()
		},
	}
}

func newAgentGetCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "get <agent-id>",
		Short: "Get agent details",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			handleAgentGet(args[0])
		},
	}
}

func newAgentDeleteCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <agent-id>",
		Short: "Delete an agent",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			handleAgentDelete(args[0])
		},
	}
}

func handleAgentCreate(name, instructions string) {
	client, err := getClient()
	if err != nil {
		clierr.Handle(err)
		return
	}
	defer client.Close()

	ctx := context.Background()

	// Create agent
	agent := &agentv1.Agent{
		Metadata: &apiresourcev1.ApiResourceMetadata{
			Name: name,
		},
		Spec: &agentv1.AgentSpec{
			Instructions: instructions,
		},
	}

	created, err := client.CreateAgent(ctx, agent)
	if err != nil {
		cliprint.Error("Failed to create agent")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Agent created successfully")
	cliprint.Info("  ID:   %s", created.Metadata.Id)
	cliprint.Info("  Name: %s", created.Metadata.Name)
}

func handleAgentList() {
	client, err := getClient()
	if err != nil {
		clierr.Handle(err)
		return
	}
	defer client.Close()

	ctx := context.Background()

	agents, err := client.ListAgents(ctx)
	if err != nil {
		cliprint.Error("Failed to list agents")
		clierr.Handle(err)
		return
	}

	if len(agents) == 0 {
		cliprint.Info("No agents found")
		cliprint.Info("")
		cliprint.Info("Create one:")
		cliprint.Info("  stigmer agent create --name my-agent --instructions \"...\"")
		return
	}

	fmt.Println("Agents:")
	fmt.Println("─────────────────────────────────────")
	for _, agent := range agents {
		fmt.Printf("  • %s (%s)\n", agent.Metadata.Name, agent.Metadata.Id)
	}
}

func handleAgentGet(id string) {
	client, err := getClient()
	if err != nil {
		clierr.Handle(err)
		return
	}
	defer client.Close()

	ctx := context.Background()

	agent, err := client.GetAgent(ctx, id)
	if err != nil {
		cliprint.Error("Failed to get agent")
		clierr.Handle(err)
		return
	}

	fmt.Println("Agent Details:")
	fmt.Println("─────────────────────────────────────")
	cliprint.Info("  ID:           %s", agent.Metadata.Id)
	cliprint.Info("  Name:         %s", agent.Metadata.Name)
	cliprint.Info("  Instructions: %s", agent.Spec.Instructions)
}

func handleAgentDelete(id string) {
	client, err := getClient()
	if err != nil {
		clierr.Handle(err)
		return
	}
	defer client.Close()

	ctx := context.Background()

	if err := client.DeleteAgent(ctx, id); err != nil {
		cliprint.Error("Failed to delete agent")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Agent deleted successfully")
}

// getClient creates and connects a backend client
func getClient() (*backend.Client, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	client, err := backend.NewClient(cfg)
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	if err := client.Connect(ctx); err != nil {
		return nil, err
	}

	return client, nil
}
