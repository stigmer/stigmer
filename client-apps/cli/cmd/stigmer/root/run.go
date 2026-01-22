package root

import (
	"context"
	"fmt"
	"strings"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/AlecAivazis/survey/v2"
	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"google.golang.org/grpc"
)

// NewRunCommand creates the run command for executing agents and workflows
func NewRunCommand() *cobra.Command {
	var message string
	var runtimeEnv []string
	var orgOverride string
	var follow bool

	cmd := &cobra.Command{
		Use:   "run [agent-or-workflow-name-or-id]",
		Short: "Execute an agent or workflow",
		Long: `Execute an agent or workflow by name/ID or from your project directory.

TWO MODES:

1. AUTO-DISCOVERY MODE (no arguments):
   Automatically discovers and deploys agents/workflows from your Stigmer project.
   If multiple resources found, prompts you to select which one to run.
   
   Example: 
     stigmer run

2. REFERENCE MODE (with agent/workflow name or ID):
   Run a specific agent or workflow by name (slug) or ID.
   If in a project directory (has Stigmer.yaml), applies latest code first.
   If outside project directory, runs the deployed resource directly.
   
   Examples:
     stigmer run my-agent           # Agent by name
     stigmer run my-workflow        # Workflow by name  
     stigmer run agt_01abc123       # Agent by ID
     stigmer run wf_01xyz789        # Workflow by ID

Execution can be customized with:
  --message:      Initial prompt to send to the agent/workflow
  --runtime-env:  Runtime environment variables (key=value pairs)
                  Can be specified multiple times for multiple variables
                  Prefix with "secret:" for encrypted values
  --follow:       Stream execution logs in real-time (default: true)
                  Use --no-follow to skip streaming`,
		Example: `  # AUTO-DISCOVERY: Discover, deploy, and run from project
  stigmer run
  stigmer run --message "Execute with this prompt"
  
  # REFERENCE: Run specific agent (applies latest code if in project)
  stigmer run my-agent
  stigmer run my-agent --message "Tell me a joke"
  
  # REFERENCE: Run specific workflow
  stigmer run my-workflow
  stigmer run my-workflow --message "Process data"
  
  # Run without log streaming
  stigmer run my-agent --no-follow
  
  # Run with runtime environment variables
  stigmer run my-agent --runtime-env "API_KEY=abc123" --runtime-env "secret:DB_PASSWORD=supersecret"
  
  # Run by ID
  stigmer run agt_01kewqjbtdy0w4d14bnhhy4yc2
  stigmer run wf_01abc123xyz456
  
  # Override organization
  stigmer run my-agent --org my-org-id`,
		Run: func(cmd *cobra.Command, args []string) {
			hasReference := len(args) > 0

			if hasReference {
				// REFERENCE MODE: Run specific agent/workflow by name/ID
				reference := args[0]
				runReferenceMode(reference, message, orgOverride, runtimeEnv, follow)
			} else {
				// AUTO-DISCOVERY MODE: Discover from Stigmer.yaml and prompt for selection
				runAutoDiscoveryMode(message, orgOverride, runtimeEnv, follow)
			}
		},
	}

	cmd.Flags().StringVar(&message, "message", "", "initial message/prompt for execution")
	cmd.Flags().StringArrayVar(&runtimeEnv, "runtime-env", []string{}, "runtime environment variables (key=value, can be used multiple times, prefix with 'secret:' for secrets)")
	cmd.Flags().BoolVar(&follow, "follow", true, "stream execution logs in real-time (default: true)")
	cmd.Flags().StringVar(&orgOverride, "org", "", "organization ID (overrides Stigmer.yaml and context)")

	return cmd
}

// runReferenceMode runs a specific agent or workflow by reference (name or ID)
func runReferenceMode(reference string, message string, orgOverride string, runtimeEnv []string, follow bool) {
	// Check if we're in a Stigmer project directory
	inProjectDir := config.InStigmerProjectDirectory()

	var deployedAgents []*agentv1.Agent
	var deployedWorkflows []*workflowv1.Workflow

	if inProjectDir {
		// In project directory: apply latest code first
		cliprint.PrintInfo("📁 Detected Stigmer project - applying latest code")
		fmt.Println()

		var err error
		var deployedSkills []*skillv1.Skill
		deployedSkills, deployedAgents, deployedWorkflows, err = ApplyCodeMode(ApplyCodeModeOptions{
			ConfigFile:  "",
			OrgOverride: orgOverride,
			DryRun:      false,
			Quiet:       true,
		})
		_ = deployedSkills // Suppress unused variable warning
		if err != nil {
			cliprint.PrintError("Failed to apply: %s", err)
			return
		}

		// Show deployment result
		totalResources := len(deployedAgents) + len(deployedWorkflows)
		if totalResources > 0 {
			cliprint.PrintSuccess("✓ Deployed %d resource(s)", totalResources)
			fmt.Println()
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
		// Found a workflow - execute it
		executeWorkflow(workflow, orgID, message, runtimeEnv, follow, conn)
		return
	}

	// Workflow not found - try agent
	agent, agentErr := resolveAgent(reference, orgID, conn)

	if agentErr == nil {
		// Found an agent - execute it
		executeAgent(agent, orgID, message, runtimeEnv, follow, conn)
		return
	}

	// Neither workflow nor agent found
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
func runAutoDiscoveryMode(message string, orgOverride string, runtimeEnv []string, follow bool) {
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
	var deploymentMsg string
	if len(deployedAgents) > 0 && len(deployedWorkflows) > 0 {
		deploymentMsg = fmt.Sprintf("Deployed: %d agent(s) and %d workflow(s)", len(deployedAgents), len(deployedWorkflows))
	} else if len(deployedAgents) > 0 {
		deploymentMsg = fmt.Sprintf("Deployed: %d agent(s)", len(deployedAgents))
	} else {
		deploymentMsg = fmt.Sprintf("Deployed: %d workflow(s)", len(deployedWorkflows))
	}
	cliprint.PrintSuccess("%s", deploymentMsg)
	fmt.Println()

	// Build selection options for both agents and workflows
	type resourceOption struct {
		resourceType string // "agent" or "workflow"
		name         string
		description  string
		index        int // index in the original slice
	}

	options := make([]resourceOption, 0, totalResources)
	optionLabels := make([]string, 0, totalResources)

	// Add agents
	for i, agent := range deployedAgents {
		displayName := fmt.Sprintf("[Agent] %s", agent.Metadata.Name)
		if agent.Spec.Description != "" {
			displayName = fmt.Sprintf("[Agent] %s - %s", agent.Metadata.Name, agent.Spec.Description)
		}
		options = append(options, resourceOption{
			resourceType: "agent",
			name:         agent.Metadata.Name,
			description:  agent.Spec.Description,
			index:        i,
		})
		optionLabels = append(optionLabels, displayName)
	}

	// Add workflows
	for i, workflow := range deployedWorkflows {
		displayName := fmt.Sprintf("[Workflow] %s", workflow.Metadata.Name)
		if workflow.Spec.Description != "" {
			displayName = fmt.Sprintf("[Workflow] %s - %s", workflow.Metadata.Name, workflow.Spec.Description)
		}
		options = append(options, resourceOption{
			resourceType: "workflow",
			name:         workflow.Metadata.Name,
			description:  workflow.Spec.Description,
			index:        i,
		})
		optionLabels = append(optionLabels, displayName)
	}

	// If only one resource, auto-select it
	var selectedOption resourceOption
	if totalResources == 1 {
		selectedOption = options[0]
		cliprint.PrintInfo("Auto-selected: %s", selectedOption.name)
		fmt.Println()
	} else {
		// Multiple resources - prompt for selection
		prompt := &survey.Select{
			Message: "Select resource to run:",
			Options: optionLabels,
		}

		var selectedIndex int
		err := survey.AskOne(prompt, &selectedIndex)
		if err != nil {
			cliprint.PrintError("Selection cancelled")
			return
		}

		selectedOption = options[selectedIndex]
		fmt.Println()
	}

	// Connect to backend
	conn, orgID, err := connectToBackend(orgOverride)
	if err != nil {
		return
	}
	defer conn.Close()

	// Execute based on resource type
	switch selectedOption.resourceType {
	case "agent":
		agent := deployedAgents[selectedOption.index]
		executeAgent(agent, orgID, message, runtimeEnv, follow, conn)

	case "workflow":
		workflow := deployedWorkflows[selectedOption.index]
		executeWorkflow(workflow, orgID, message, runtimeEnv, follow, conn)
	}
}

// connectToBackend connects to the backend and returns the connection and organization ID
func connectToBackend(orgOverride string) (*grpc.ClientConn, string, error) {
	// Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		cliprint.PrintError("Failed to load configuration: %s", err)
		return nil, "", err
	}

	// Determine organization ID
	var orgID string
	if orgOverride != "" {
		orgID = orgOverride
	} else if cfg.Backend.Type == config.BackendTypeLocal {
		orgID = "local"
	} else if cfg.Backend.Type == config.BackendTypeCloud && cfg.Backend.Cloud != nil {
		orgID = cfg.Backend.Cloud.OrgID
	}

	if orgID == "" {
		cliprint.PrintError("Organization not set")
		cliprint.PrintInfo("")
		cliprint.PrintInfo("Set organization with:")
		cliprint.PrintInfo("  stigmer context set --org <org-id>")
		cliprint.PrintInfo("")
		cliprint.PrintInfo("Or use --org flag:")
		cliprint.PrintInfo("  stigmer run --org <org-id>")
		fmt.Println()
		return nil, "", fmt.Errorf("organization not set")
	}

	// Connect to backend
	conn, err := backend.NewConnection()
	if err != nil {
		cliprint.PrintError("Failed to connect to backend: %s", err)
		return nil, "", err
	}

	return conn, orgID, nil
}

// resolveAgent resolves an agent by ID or name (slug)
func resolveAgent(reference string, orgID string, conn *grpc.ClientConn) (*agentv1.Agent, error) {
	client := agentv1.NewAgentQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Check if reference looks like an agent ID (starts with "agt_")
	if strings.HasPrefix(reference, "agt_") {
		// Lookup by ID
		agent, err := client.Get(ctx, &agentv1.AgentId{Value: reference})
		if err != nil {
			return nil, fmt.Errorf("agent not found: %w", err)
		}

		return agent, nil
	}

	// Lookup by name (slug) using getByReference
	agent, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   orgID,
		Kind:  apiresourcekind.ApiResourceKind_agent,
		Slug:  reference,
	})

	if err != nil {
		return nil, fmt.Errorf("agent not found: %w", err)
	}

	return agent, nil
}

// resolveWorkflow resolves a workflow by ID or name (slug)
func resolveWorkflow(reference string, orgID string, conn *grpc.ClientConn) (*workflowv1.Workflow, error) {
	client := workflowv1.NewWorkflowQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Check if reference looks like a workflow ID (starts with "wf_")
	if strings.HasPrefix(reference, "wf_") {
		// Lookup by ID
		workflow, err := client.Get(ctx, &workflowv1.WorkflowId{Value: reference})
		if err != nil {
			return nil, fmt.Errorf("workflow not found: %w", err)
		}

		return workflow, nil
	}

	// Lookup by name (slug) using getByReference
	workflow, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   orgID,
		Kind:  apiresourcekind.ApiResourceKind_workflow,
		Slug:  reference,
	})

	if err != nil {
		return nil, fmt.Errorf("workflow not found: %w", err)
	}

	return workflow, nil
}

// executeAgent creates and executes an agent execution
func executeAgent(agent *agentv1.Agent, orgID string, message string, runtimeEnv []string, follow bool, conn *grpc.ClientConn) {
	// Parse runtime environment
	runtimeEnvMap, err := parseRuntimeEnv(runtimeEnv)
	if err != nil {
		cliprint.PrintError("Invalid runtime environment format: %s", err)
		return
	}

	// Create execution
	cliprint.PrintInfo("Creating agent execution...")
	execution, err := createAgentExecution(agent.Metadata.Id, orgID, message, runtimeEnvMap, conn)
	if err != nil {
		cliprint.PrintError("Failed to create execution: %s", err)
		return
	}

	cliprint.PrintSuccess("✓ Agent execution started: %s", agent.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", execution.Metadata.Id)
	fmt.Println()

	// Stream execution logs if --follow flag is set
	if follow {
		streamAgentExecutionLogs(execution.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer run %s --follow", agent.Metadata.Name)
		fmt.Println()
	}
}

// executeWorkflow creates and executes a workflow execution
func executeWorkflow(workflow *workflowv1.Workflow, orgID string, message string, runtimeEnv []string, follow bool, conn *grpc.ClientConn) {
	// Parse runtime environment
	runtimeEnvMap, err := parseRuntimeEnv(runtimeEnv)
	if err != nil {
		cliprint.PrintError("Invalid runtime environment format: %s", err)
		return
	}

	// Create execution
	cliprint.PrintInfo("Creating workflow execution...")
	execution, err := createWorkflowExecution(workflow.Metadata.Id, orgID, message, runtimeEnvMap, conn)
	if err != nil {
		cliprint.PrintError("Failed to create execution: %s", err)
		return
	}

	cliprint.PrintSuccess("✓ Workflow execution started: %s", workflow.Metadata.Name)
	cliprint.PrintInfo("  Execution ID: %s", execution.Metadata.Id)
	fmt.Println()

	// Stream execution logs if --follow flag is set
	if follow {
		streamWorkflowExecutionLogs(execution.Metadata.Id, conn)
	} else {
		cliprint.PrintInfo("View logs: stigmer run %s --follow", workflow.Metadata.Name)
		fmt.Println()
	}
}

// createAgentExecution creates a new agent execution
func createAgentExecution(agentID string, orgID string, message string, runtimeEnv map[string]*executioncontextv1.ExecutionValue, conn *grpc.ClientConn) (*agentexecutionv1.AgentExecution, error) {
	// If no message provided, use default
	if message == "" {
		message = "execute"
	}

	// Generate a unique name for the execution
	executionName := fmt.Sprintf("execution-%d", time.Now().UnixMicro())

	// Build execution spec
	spec := &agentexecutionv1.AgentExecutionSpec{
		AgentId:    agentID,
		Message:    message,
		RuntimeEnv: runtimeEnv,
	}

	// Create execution request
	execution := &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       executionName,
			Org:        orgID,
			OwnerScope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
		},
		Spec: spec,
	}

	client := agentexecutionv1.NewAgentExecutionCommandControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := client.Create(ctx, execution)
	if err != nil {
		return nil, fmt.Errorf("failed to create execution: %w", err)
	}

	return result, nil
}

// createWorkflowExecution creates a new workflow execution
func createWorkflowExecution(workflowID string, orgID string, message string, runtimeEnv map[string]*executioncontextv1.ExecutionValue, conn *grpc.ClientConn) (*workflowexecutionv1.WorkflowExecution, error) {
	// If no message provided, use default
	if message == "" {
		message = "execute"
	}

	// Generate a unique name for the execution
	executionName := fmt.Sprintf("execution-%d", time.Now().UnixMicro())

	// Build execution spec
	spec := &workflowexecutionv1.WorkflowExecutionSpec{
		WorkflowId:     workflowID,
		TriggerMessage: message,
		RuntimeEnv:     runtimeEnv,
	}

	// Create execution request
	execution := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       executionName,
			Org:        orgID,
			OwnerScope: apiresource.ApiResourceOwnerScope_organization,
		},
		Spec: spec,
	}

	client := workflowexecutionv1.NewWorkflowExecutionCommandControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := client.Create(ctx, execution)
	if err != nil {
		return nil, fmt.Errorf("failed to create execution: %w", err)
	}

	return result, nil
}

// streamAgentExecutionLogs subscribes to execution updates and displays them in real-time
func streamAgentExecutionLogs(executionID string, conn *grpc.ClientConn) {
	cliprint.PrintSuccess("Streaming agent execution logs")
	fmt.Println()

	// Create streaming client
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)
	ctx := context.Background()

	// Subscribe to execution updates
	stream, err := client.Subscribe(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		cliprint.PrintError("Failed to subscribe to execution: %v", err)
		return
	}

	// Track last displayed phase
	var lastPhase agentexecutionv1.ExecutionPhase
	messageCount := 0

	// Stream updates until execution completes
	for {
		execution, err := stream.Recv()
		if err != nil {
			// Stream ended
			if err.Error() == "EOF" {
				break
			}
			cliprint.PrintError("Stream error: %v", err)
			break
		}

		// Display phase changes
		if execution.Status.Phase != lastPhase {
			displayAgentPhaseChange(execution.Status.Phase)
			lastPhase = execution.Status.Phase
		}

		// Display new messages
		for i := messageCount; i < len(execution.Status.Messages); i++ {
			displayAgentMessage(execution.Status.Messages[i])
		}
		messageCount = len(execution.Status.Messages)

		// Check if execution reached terminal state
		if isTerminalAgentPhase(execution.Status.Phase) {
			displayAgentExecutionComplete(execution)
			break
		}
	}
}

// streamWorkflowExecutionLogs subscribes to workflow execution updates and displays them in real-time
func streamWorkflowExecutionLogs(executionID string, conn *grpc.ClientConn) {
	cliprint.PrintSuccess("Streaming workflow execution logs")
	fmt.Println()

	// Create streaming client
	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)
	ctx := context.Background()

	// Subscribe to execution updates
	stream, err := client.Subscribe(ctx, &workflowexecutionv1.SubscribeWorkflowExecutionRequest{
		ExecutionId: executionID,
	})
	if err != nil {
		cliprint.PrintError("Failed to subscribe to execution: %v", err)
		return
	}

	// Track last displayed phase and tasks
	var lastPhase workflowexecutionv1.ExecutionPhase
	taskCount := 0

	// Stream updates until execution completes
	for {
		execution, err := stream.Recv()
		if err != nil {
			// Stream ended
			if err.Error() == "EOF" {
				break
			}
			cliprint.PrintError("Stream error: %v", err)
			break
		}

		// Display phase changes
		if execution.Status.Phase != lastPhase {
			displayWorkflowPhaseChange(execution.Status.Phase)
			lastPhase = execution.Status.Phase
		}

		// Display new tasks
		for i := taskCount; i < len(execution.Status.Tasks); i++ {
			displayWorkflowTask(execution.Status.Tasks[i])
		}
		taskCount = len(execution.Status.Tasks)

		// Check if execution reached terminal state
		if isTerminalWorkflowPhase(execution.Status.Phase) {
			displayWorkflowExecutionComplete(execution)
			break
		}
	}
}

// displayAgentPhaseChange shows when agent execution phase changes
func displayAgentPhaseChange(phase agentexecutionv1.ExecutionPhase) {
	switch phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		cliprint.PrintInfo("⏳ Execution pending...")
	case agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		cliprint.PrintSuccess("▶️  Execution started")
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		cliprint.PrintSuccess("✅ Execution completed")
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("❌ Execution failed")
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("⚠️  Execution cancelled")
	}
	fmt.Println()
}

// displayAgentMessage displays a single agent message
func displayAgentMessage(msg *agentexecutionv1.AgentMessage) {
	var icon string
	var label string

	switch msg.Type {
	case agentexecutionv1.MessageType_MESSAGE_HUMAN:
		icon = "💬"
		label = "You"
	case agentexecutionv1.MessageType_MESSAGE_AI:
		icon = "🤖"
		label = "Agent"
	case agentexecutionv1.MessageType_MESSAGE_TOOL:
		icon = "🔧"
		label = "Tool"
	case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
		icon = "ℹ️"
		label = "System"
	}

	fmt.Printf("%s %s: %s\n\n", icon, label, msg.Content)
}

// displayWorkflowPhaseChange shows when workflow execution phase changes
func displayWorkflowPhaseChange(phase workflowexecutionv1.ExecutionPhase) {
	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		cliprint.PrintInfo("⏳ Execution pending...")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		cliprint.PrintSuccess("▶️  Execution started")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		cliprint.PrintSuccess("✅ Execution completed")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("❌ Execution failed")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("⚠️  Execution cancelled")
	}
	fmt.Println()
}

// displayWorkflowTask displays a workflow task's status
func displayWorkflowTask(task *workflowexecutionv1.WorkflowTask) {
	var icon string
	var statusText string

	switch task.Status {
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_PENDING:
		icon = "⏳"
		statusText = "Pending"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS:
		icon = "⚙️"
		statusText = "Running"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED:
		icon = "✓"
		statusText = "Completed"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED:
		icon = "✗"
		statusText = "Failed"
	case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED:
		icon = "⊘"
		statusText = "Skipped"
	}

	fmt.Printf("%s Task: %s [%s]\n", icon, task.TaskName, statusText)

	// Show error if failed
	if task.Error != "" {
		fmt.Printf("   ✗ Error: %s\n", task.Error)
	}

	fmt.Println()
}

// displayAgentExecutionComplete shows final agent execution summary
func displayAgentExecutionComplete(execution *agentexecutionv1.AgentExecution) {
	fmt.Println()
	fmt.Println(strings.Repeat("─", 80))

	switch execution.Status.Phase {
	case agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		cliprint.PrintSuccess("Done!")
	case agentexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("Execution failed")
		if execution.Status.Error != "" {
			cliprint.PrintError("Error: %s", execution.Status.Error)
		}
	case agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("Execution cancelled")
	}

	// Display timing information
	if execution.Status.StartedAt != "" && execution.Status.CompletedAt != "" {
		startTime, _ := time.Parse(time.RFC3339, execution.Status.StartedAt)
		endTime, _ := time.Parse(time.RFC3339, execution.Status.CompletedAt)
		duration := endTime.Sub(startTime)
		cliprint.PrintSuccess("Duration: %s", duration.Round(time.Second))
	}

	// Display summary stats
	cliprint.PrintSuccess("Total messages: %d", len(execution.Status.Messages))
	cliprint.PrintSuccess("Tool calls: %d", len(execution.Status.ToolCalls))

	fmt.Println(strings.Repeat("─", 80))
	fmt.Println()
}

// displayWorkflowExecutionComplete shows final workflow execution summary
func displayWorkflowExecutionComplete(execution *workflowexecutionv1.WorkflowExecution) {
	fmt.Println()
	fmt.Println(strings.Repeat("─", 80))

	switch execution.Status.Phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		cliprint.PrintSuccess("Done!")
	case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		cliprint.PrintError("Workflow execution failed")
		if execution.Status.Error != "" {
			cliprint.PrintError("Error: %s", execution.Status.Error)
		}
	case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		cliprint.PrintWarning("Workflow execution cancelled")
	}

	// Display timing information
	if execution.Status.StartedAt != "" && execution.Status.CompletedAt != "" {
		startTime, _ := time.Parse(time.RFC3339, execution.Status.StartedAt)
		endTime, _ := time.Parse(time.RFC3339, execution.Status.CompletedAt)
		duration := endTime.Sub(startTime)
		cliprint.PrintSuccess("Duration: %s", duration.Round(time.Second))
	}

	// Display summary stats
	totalTasks := len(execution.Status.Tasks)
	completedTasks := 0
	failedTasks := 0
	skippedTasks := 0

	for _, task := range execution.Status.Tasks {
		switch task.Status {
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED:
			completedTasks++
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_FAILED:
			failedTasks++
		case workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_SKIPPED:
			skippedTasks++
		}
	}

	cliprint.PrintSuccess("Total tasks: %d", totalTasks)
	cliprint.PrintSuccess("Completed: %d", completedTasks)
	if failedTasks > 0 {
		cliprint.PrintError("Failed: %d", failedTasks)
	}
	if skippedTasks > 0 {
		cliprint.PrintInfo("Skipped: %d", skippedTasks)
	}

	fmt.Println(strings.Repeat("─", 80))
	fmt.Println()
}

// isTerminalAgentPhase checks if agent execution phase is terminal
func isTerminalAgentPhase(phase agentexecutionv1.ExecutionPhase) bool {
	return phase == agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
}

// isTerminalWorkflowPhase checks if workflow execution phase is terminal
func isTerminalWorkflowPhase(phase workflowexecutionv1.ExecutionPhase) bool {
	return phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
		phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED
}

// parseRuntimeEnv parses runtime environment flags into ExecutionValue map
// Format: "key=value" or "secret:key=value"
func parseRuntimeEnv(envVars []string) (map[string]*executioncontextv1.ExecutionValue, error) {
	result := make(map[string]*executioncontextv1.ExecutionValue)

	for _, envVar := range envVars {
		// Check if it's a secret (prefix: "secret:")
		isSecret := strings.HasPrefix(envVar, "secret:")
		if isSecret {
			envVar = strings.TrimPrefix(envVar, "secret:")
		}

		// Split key=value
		parts := strings.SplitN(envVar, "=", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid format: %s (expected key=value)", envVar)
		}

		key := strings.TrimSpace(parts[0])
		value := parts[1] // Don't trim value (might be intentional whitespace)

		if key == "" {
			return nil, fmt.Errorf("empty key in: %s", envVar)
		}

		result[key] = &executioncontextv1.ExecutionValue{
			Value:    value,
			IsSecret: isSecret,
		}
	}

	return result, nil
}
