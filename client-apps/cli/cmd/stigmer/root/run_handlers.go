package root

import (
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"google.golang.org/grpc"
)

// runAgent executes an agent.
func runAgent(ref, message string, env envfile.EnvMap, follow bool, orgID string, conn *grpc.ClientConn) error {
	// Resolve agent by reference
	agent, err := resolveAgent(ref, orgID, conn)
	if err != nil {
		displayAgentNotFoundError(ref)
		return err
	}

	// Create agent execution
	cliprint.PrintInfo("Creating agent execution...")
	execution, err := createAgentExecution(agent.Metadata.Id, orgID, message, env, conn)
	if err != nil {
		return errors.Wrap(err, "failed to create execution")
	}

	// Display execution started
	cliprint.PrintSuccess("Agent execution started: %s", agent.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", execution.Metadata.Id)
	fmt.Println()

	// Stream logs if follow is enabled
	if follow {
		streamAgentExecutionLogs(execution.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer run agent %s --follow", agent.Metadata.Name)
		fmt.Println()
	}

	return nil
}

// runWorkflow executes a workflow.
func runWorkflow(ref, message string, env envfile.EnvMap, follow bool, orgID string, conn *grpc.ClientConn) error {
	// Resolve workflow by reference
	workflow, err := resolveWorkflow(ref, orgID, conn)
	if err != nil {
		displayWorkflowNotFoundError(ref)
		return err
	}

	// Create workflow execution
	cliprint.PrintInfo("Creating workflow execution...")
	execution, err := createWorkflowExecution(workflow.Metadata.Id, orgID, message, env, conn)
	if err != nil {
		return errors.Wrap(err, "failed to create execution")
	}

	// Display execution started
	cliprint.PrintSuccess("Workflow execution started: %s", workflow.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", execution.Metadata.Id)
	fmt.Println()

	// Stream logs if follow is enabled
	if follow {
		streamWorkflowExecutionLogs(execution.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer run workflow %s --follow", workflow.Metadata.Name)
		fmt.Println()
	}

	return nil
}

// displayAgentNotFoundError shows a helpful error message when agent is not found.
func displayAgentNotFoundError(ref string) {
	cliprint.PrintError("Agent not found: %s", ref)
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Possible reasons:")
	cliprint.PrintInfo("  - Agent doesn't exist in organization")
	cliprint.PrintInfo("  - Agent hasn't been deployed yet (run: stigmer apply -f agent.yaml)")
	cliprint.PrintInfo("  - Wrong organization context (use --org to override)")
	fmt.Println()
}

// displayWorkflowNotFoundError shows a helpful error message when workflow is not found.
func displayWorkflowNotFoundError(ref string) {
	cliprint.PrintError("Workflow not found: %s", ref)
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Possible reasons:")
	cliprint.PrintInfo("  - Workflow doesn't exist in organization")
	cliprint.PrintInfo("  - Workflow hasn't been deployed yet (run: stigmer apply -f workflow.yaml)")
	cliprint.PrintInfo("  - Wrong organization context (use --org to override)")
	fmt.Println()
}
