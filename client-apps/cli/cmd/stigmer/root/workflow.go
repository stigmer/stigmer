package root

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	workflowv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/workflow/v1"
	apiresourcev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
)

// NewWorkflowCommand creates the workflow command
func NewWorkflowCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "workflow",
		Short: "Manage workflows",
		Long:  `Create, list, and manage workflows.`,
	}

	cmd.AddCommand(newWorkflowCreateCommand())
	cmd.AddCommand(newWorkflowListCommand())
	cmd.AddCommand(newWorkflowGetCommand())
	cmd.AddCommand(newWorkflowDeleteCommand())

	return cmd
}

func newWorkflowCreateCommand() *cobra.Command {
	var name string
	var description string

	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new workflow",
		Example: `  # Create a workflow
  stigmer workflow create --name my-workflow --description "Process customer data"`,
		Run: func(cmd *cobra.Command, args []string) {
			handleWorkflowCreate(name, description)
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "Workflow name (required)")
	cmd.Flags().StringVar(&description, "description", "", "Workflow description")
	cmd.MarkFlagRequired("name")

	return cmd
}

func newWorkflowListCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all workflows",
		Run: func(cmd *cobra.Command, args []string) {
			handleWorkflowList()
		},
	}
}

func newWorkflowGetCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "get <workflow-id>",
		Short: "Get workflow details",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			handleWorkflowGet(args[0])
		},
	}
}

func newWorkflowDeleteCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <workflow-id>",
		Short: "Delete a workflow",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			handleWorkflowDelete(args[0])
		},
	}
}

func handleWorkflowCreate(name, description string) {
	client, err := getClient()
	if err != nil {
		clierr.Handle(err)
		return
	}
	defer client.Close()

	ctx := context.Background()

	// Create workflow
	workflow := &workflowv1.Workflow{
		Metadata: &apiresourcev1.ApiResourceMetadata{
			Name: name,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: description,
			// TODO: Add workflow spec fields (tasks, etc.)
		},
	}

	created, err := client.CreateWorkflow(ctx, workflow)
	if err != nil {
		cliprint.Error("Failed to create workflow")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Workflow created successfully")
	cliprint.Info("  ID:   %s", created.Metadata.Id)
	cliprint.Info("  Name: %s", created.Metadata.Name)
}

func handleWorkflowList() {
	client, err := getClient()
	if err != nil {
		clierr.Handle(err)
		return
	}
	defer client.Close()

	ctx := context.Background()

	workflows, err := client.ListWorkflows(ctx)
	if err != nil {
		cliprint.Error("Failed to list workflows")
		clierr.Handle(err)
		return
	}

	if len(workflows) == 0 {
		cliprint.Info("No workflows found")
		cliprint.Info("")
		cliprint.Info("Create one:")
		cliprint.Info("  stigmer workflow create --name my-workflow")
		return
	}

	fmt.Println("Workflows:")
	fmt.Println("─────────────────────────────────────")
	for _, workflow := range workflows {
		fmt.Printf("  • %s (%s)\n", workflow.Metadata.Name, workflow.Metadata.Id)
	}
}

func handleWorkflowGet(id string) {
	client, err := getClient()
	if err != nil {
		clierr.Handle(err)
		return
	}
	defer client.Close()

	ctx := context.Background()

	workflow, err := client.GetWorkflow(ctx, id)
	if err != nil {
		cliprint.Error("Failed to get workflow")
		clierr.Handle(err)
		return
	}

	fmt.Println("Workflow Details:")
	fmt.Println("─────────────────────────────────────")
	cliprint.Info("  ID:   %s", workflow.Metadata.Id)
	cliprint.Info("  Name: %s", workflow.Metadata.Name)
	if workflow.Spec != nil && workflow.Spec.Description != "" {
		cliprint.Info("  Description: %s", workflow.Spec.Description)
	}
}

func handleWorkflowDelete(id string) {
	client, err := getClient()
	if err != nil {
		clierr.Handle(err)
		return
	}
	defer client.Close()

	ctx := context.Background()

	if err := client.DeleteWorkflow(ctx, id); err != nil {
		cliprint.Error("Failed to delete workflow")
		clierr.Handle(err)
		return
	}

	cliprint.Success("Workflow deleted successfully")
}
