package root

import (
	"fmt"
	"os"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"google.golang.org/grpc"
)

// runReferenceMode runs a specific agent or workflow by reference (name or ID)
func runReferenceMode(reference string, message string, orgOverride string, runtimeEnv envfile.EnvMap, follow bool) {
	// Check if we're in a Stigmer project directory
	inProjectDir := config.InStigmerProjectDirectory()

	var deployedAgents []*agentv1.Agent
	var deployedWorkflows []*workflowv1.Workflow

	if inProjectDir {
		var err error
		deployedAgents, deployedWorkflows, err = applyProjectCode(orgOverride)
		if err != nil {
			return
		}
	}

	// Connect to backend
	conn, orgID, err := connectToBackend(orgOverride)
	if err != nil {
		return
	}
	defer conn.Close()

	// Try to resolve as workflow first (workflows are checked first)
	workflow, workflowErr := resolveWorkflow(reference, orgID, conn)
	if workflowErr == nil {
		executeWorkflow(workflow, orgID, message, runtimeEnv, follow, conn)
		return
	}

	// Workflow not found - try agent
	agent, agentErr := resolveAgent(reference, orgID, conn)
	if agentErr == nil {
		executeAgent(agent, orgID, message, runtimeEnv, follow, conn)
		return
	}

	// Neither workflow nor agent found
	printResourceNotFoundError(reference)
	os.Exit(1)
}

// applyProjectCode applies the latest code from a Stigmer project directory
func applyProjectCode(orgOverride string) ([]*agentv1.Agent, []*workflowv1.Workflow, error) {
	cliprint.PrintInfo("📁 Detected Stigmer project - applying latest code")
	fmt.Println()

	var deployedSkills []*skillv1.Skill
	deployedSkills, deployedAgents, deployedWorkflows, err := ApplyCodeMode(ApplyCodeModeOptions{
		ConfigFile:  "",
		OrgOverride: orgOverride,
		DryRun:      false,
		Quiet:       true,
	})
	_ = deployedSkills // Suppress unused variable warning

	if err != nil {
		cliprint.PrintError("Failed to apply: %s", err)
		return nil, nil, err
	}

	// Show deployment result
	totalResources := len(deployedAgents) + len(deployedWorkflows)
	if totalResources > 0 {
		cliprint.PrintSuccess("✓ Deployed %d resource(s)", totalResources)
		fmt.Println()
	}

	return deployedAgents, deployedWorkflows, nil
}

// printResourceNotFoundError displays the resource not found error message
func printResourceNotFoundError(reference string) {
	cliprint.PrintError("Agent or Workflow not found: %s", reference)
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Checked for:")
	cliprint.PrintInfo("  • Workflow with ID/name: %s", reference)
	cliprint.PrintInfo("  • Agent with ID/name: %s", reference)
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Possible reasons:")
	cliprint.PrintInfo("  • Resource doesn't exist in organization")
	cliprint.PrintInfo("  • Resource hasn't been deployed yet (run: stigmer apply)")
	cliprint.PrintInfo("  • Wrong organization context")
	fmt.Println()
}

// runAutoDiscoveryMode discovers agents and workflows from Stigmer.yaml and prompts user to select one to run
func runAutoDiscoveryMode(message string, orgOverride string, runtimeEnv envfile.EnvMap, follow bool) {
	// Check if we're in a Stigmer project directory
	if !config.InStigmerProjectDirectory() {
		cliprint.PrintError("No Stigmer.yaml found in current directory")
		cliprint.PrintInfo("")
		cliprint.PrintInfo("Either:")
		cliprint.PrintInfo("  • Run from a Stigmer project directory")
		cliprint.PrintInfo("  • Or specify agent/workflow: stigmer run <name-or-id>")
		fmt.Println()
		return
	}

	// Apply changes with progress display (deploy/update agents and workflows)
	deployedSkills, deployedAgents, deployedWorkflows, err := ApplyCodeMode(ApplyCodeModeOptions{
		ConfigFile:  "",
		OrgOverride: orgOverride,
		DryRun:      false,
		Quiet:       true,
	})
	_ = deployedSkills // Suppress unused variable warning
	if err != nil {
		cliprint.PrintError("Failed to deploy: %s", err)
		return
	}

	// Check if we have any resources
	totalResources := len(deployedAgents) + len(deployedWorkflows)
	if totalResources == 0 {
		cliprint.PrintWarning("No agents or workflows found")
		return
	}

	// Show deployment result
	printDeploymentResult(len(deployedAgents), len(deployedWorkflows))

	// Build and select resource
	selectedType, selectedIndex := selectResourceToRun(deployedAgents, deployedWorkflows)
	if selectedType == "" {
		return // Selection cancelled
	}

	// Connect to backend
	conn, orgID, err := connectToBackend(orgOverride)
	if err != nil {
		return
	}
	defer conn.Close()

	// Execute based on resource type
	switch selectedType {
	case "agent":
		agent := deployedAgents[selectedIndex]
		executeAgent(agent, orgID, message, runtimeEnv, follow, conn)
	case "workflow":
		workflow := deployedWorkflows[selectedIndex]
		executeWorkflow(workflow, orgID, message, runtimeEnv, follow, conn)
	}
}

// printDeploymentResult displays the deployment summary
func printDeploymentResult(agentCount, workflowCount int) {
	var deploymentMsg string
	if agentCount > 0 && workflowCount > 0 {
		deploymentMsg = fmt.Sprintf("Deployed: %d agent(s) and %d workflow(s)", agentCount, workflowCount)
	} else if agentCount > 0 {
		deploymentMsg = fmt.Sprintf("Deployed: %d agent(s)", agentCount)
	} else {
		deploymentMsg = fmt.Sprintf("Deployed: %d workflow(s)", workflowCount)
	}
	cliprint.PrintSuccess("%s", deploymentMsg)
	fmt.Println()
}

// executeAgent creates and executes an agent execution
func executeAgent(agent *agentv1.Agent, orgID string, message string, runtimeEnv envfile.EnvMap, follow bool, conn *grpc.ClientConn) {
	cliprint.PrintInfo("Creating agent execution...")
	execution, err := createAgentExecution(agent.Metadata.Id, orgID, message, runtimeEnv, conn)
	if err != nil {
		cliprint.PrintError("Failed to create execution: %s", err)
		return
	}

	cliprint.PrintSuccess("✓ Agent execution started: %s", agent.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", execution.Metadata.Id)
	fmt.Println()

	if follow {
		streamAgentExecutionLogs(execution.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer run %s --follow", agent.Metadata.Name)
		fmt.Println()
	}
}

// executeWorkflow creates and executes a workflow execution
func executeWorkflow(workflow *workflowv1.Workflow, orgID string, message string, runtimeEnv envfile.EnvMap, follow bool, conn *grpc.ClientConn) {
	cliprint.PrintInfo("Creating workflow execution...")
	execution, err := createWorkflowExecution(workflow.Metadata.Id, orgID, message, runtimeEnv, conn)
	if err != nil {
		cliprint.PrintError("Failed to create execution: %s", err)
		return
	}

	cliprint.PrintSuccess("✓ Workflow execution started: %s", workflow.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", execution.Metadata.Id)
	fmt.Println()

	if follow {
		streamWorkflowExecutionLogs(execution.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer run %s --follow", workflow.Metadata.Name)
		fmt.Println()
	}
}

