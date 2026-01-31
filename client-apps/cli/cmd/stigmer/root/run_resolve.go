package root

import (
	"context"
	"fmt"
	"time"

	"github.com/AlecAivazis/survey/v2"
	"github.com/pkg/errors"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
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

// resolveAgent resolves an agent by ID, org/slug, or slug (with context org).
//
// Supported reference formats:
//   - "agt_xxx": Agent ID (direct lookup)
//   - "org/slug": Explicit organization and slug
//   - "slug": Uses orgID as the organization context
func resolveAgent(ref string, orgID string, conn *grpc.ClientConn) (*agentv1.Agent, error) {
	client := agentv1.NewAgentQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Parse the reference (handles ID detection and org/slug parsing)
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid agent reference")
	}

	// If it's an ID, fetch directly
	if parsed.IsID {
		agent, err := client.Get(ctx, &agentv1.AgentId{Value: parsed.ID})
		if err != nil {
			return nil, errors.Wrap(err, "agent not found")
		}
		return agent, nil
	}

	// Lookup by org/slug using GetByReference
	agent, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
		Org:  parsed.Org,
		Kind: apiresourcekind.ApiResourceKind_agent,
		Slug: parsed.Slug,
	})
	if err != nil {
		return nil, errors.Wrap(err, "agent not found")
	}

	return agent, nil
}

// resolveWorkflow resolves a workflow by ID, org/slug, or slug (with context org).
//
// Supported reference formats:
//   - "wf_xxx": Workflow ID (direct lookup)
//   - "org/slug": Explicit organization and slug
//   - "slug": Uses orgID as the organization context
func resolveWorkflow(ref string, orgID string, conn *grpc.ClientConn) (*workflowv1.Workflow, error) {
	client := workflowv1.NewWorkflowQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Parse the reference (handles ID detection and org/slug parsing)
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid workflow reference")
	}

	// If it's an ID, fetch directly
	if parsed.IsID {
		workflow, err := client.Get(ctx, &workflowv1.WorkflowId{Value: parsed.ID})
		if err != nil {
			return nil, errors.Wrap(err, "workflow not found")
		}
		return workflow, nil
	}

	// Lookup by org/slug using GetByReference
	workflow, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
		Org:  parsed.Org,
		Kind: apiresourcekind.ApiResourceKind_workflow,
		Slug: parsed.Slug,
	})
	if err != nil {
		return nil, errors.Wrap(err, "workflow not found")
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
