package root

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/AlecAivazis/survey/v2"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"google.golang.org/grpc"
)

// connectToBackend connects to the backend and returns the connection and organization ID
func connectToBackend(orgOverride string) (*grpc.ClientConn, string, error) {
	// Load backend configuration
	cfg, err := config.Load()
	if err != nil {
		cliprint.PrintError("Failed to load configuration: %s", err)
		return nil, "", err
	}

	// Determine organization ID
	orgID := resolveOrgID(orgOverride, cfg)
	if orgID == "" {
		printOrgNotSetError()
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

// resolveOrgID determines the organization ID from override or config
func resolveOrgID(orgOverride string, cfg *config.Config) string {
	if orgOverride != "" {
		return orgOverride
	}
	if cfg.Backend.Type == config.BackendTypeLocal {
		return "local"
	}
	if cfg.Backend.Type == config.BackendTypeCloud && cfg.Backend.Cloud != nil {
		return cfg.Backend.Cloud.OrgID
	}
	return ""
}

// printOrgNotSetError displays the organization not set error message
func printOrgNotSetError() {
	cliprint.PrintError("Organization not set")
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Set organization with:")
	cliprint.PrintInfo("  stigmer context set --org <org-id>")
	cliprint.PrintInfo("")
	cliprint.PrintInfo("Or use --org flag:")
	cliprint.PrintInfo("  stigmer run --org <org-id>")
	fmt.Println()
}

// resolveAgent resolves an agent by ID or name (slug)
func resolveAgent(reference string, orgID string, conn *grpc.ClientConn) (*agentv1.Agent, error) {
	client := agentv1.NewAgentQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Check if reference looks like an agent ID (starts with "agt_")
	if strings.HasPrefix(reference, "agt_") {
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

// selectResourceToRun builds selection options and prompts user to select a resource
// Returns resourceType ("agent" or "workflow") and index, or empty string if cancelled
func selectResourceToRun(agents []*agentv1.Agent, workflows []*workflowv1.Workflow) (string, int) {
	totalResources := len(agents) + len(workflows)

	type resourceOption struct {
		resourceType string
		index        int
	}

	options := make([]resourceOption, 0, totalResources)
	optionLabels := make([]string, 0, totalResources)

	// Add agents
	for i, agent := range agents {
		displayName := fmt.Sprintf("[Agent] %s", agent.Metadata.Name)
		if agent.Spec.Description != "" {
			displayName = fmt.Sprintf("[Agent] %s - %s", agent.Metadata.Name, agent.Spec.Description)
		}
		options = append(options, resourceOption{resourceType: "agent", index: i})
		optionLabels = append(optionLabels, displayName)
	}

	// Add workflows
	for i, workflow := range workflows {
		displayName := fmt.Sprintf("[Workflow] %s", workflow.Metadata.Name)
		if workflow.Spec.Description != "" {
			displayName = fmt.Sprintf("[Workflow] %s - %s", workflow.Metadata.Name, workflow.Spec.Description)
		}
		options = append(options, resourceOption{resourceType: "workflow", index: i})
		optionLabels = append(optionLabels, displayName)
	}

	// If only one resource, auto-select it
	if totalResources == 1 {
		cliprint.PrintInfo("Auto-selected: %s", optionLabels[0])
		fmt.Println()
		return options[0].resourceType, options[0].index
	}

	// Multiple resources - prompt for selection
	prompt := &survey.Select{
		Message: "Select resource to run:",
		Options: optionLabels,
	}

	var selectedIndex int
	err := survey.AskOne(prompt, &selectedIndex)
	if err != nil {
		cliprint.PrintError("Selection cancelled")
		return "", 0
	}

	fmt.Println()
	return options[selectedIndex].resourceType, options[selectedIndex].index
}
