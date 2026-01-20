package deploy

import (
	"context"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/agent"
	"google.golang.org/grpc"
)

// DeployOptions contains options for deploying resources
type DeployOptions struct {
	OrgID            string
	Conn             *grpc.ClientConn
	Quiet            bool
	DryRun           bool
	ProgressCallback func(string)
}

// DeployResult contains the results of a deployment
type DeployResult struct {
	DeployedAgents    []*agentv1.Agent
	DeployedWorkflows []*workflowv1.Workflow
}

// Deployer handles deploying agents and workflows to the backend
type Deployer struct {
	opts *DeployOptions
}

// NewDeployer creates a new deployer with the given options
func NewDeployer(opts *DeployOptions) *Deployer {
	return &Deployer{opts: opts}
}

// Deploy deploys all resources from the manifest result
func (d *Deployer) Deploy(manifestResult *agent.ManifestResult) (*DeployResult, error) {
	result := &DeployResult{
		DeployedAgents:    make([]*agentv1.Agent, 0),
		DeployedWorkflows: make([]*workflowv1.Workflow, 0),
	}

	// Deploy agents first
	if manifestResult.AgentManifest != nil {
		agents, err := d.deployAgents(manifestResult.AgentManifest)
		if err != nil {
			return nil, err
		}
		result.DeployedAgents = agents
	}

	// Deploy workflows
	if manifestResult.WorkflowManifest != nil {
		workflows, err := d.deployWorkflows(manifestResult.WorkflowManifest)
		if err != nil {
			return nil, err
		}
		result.DeployedWorkflows = workflows
	}

	return result, nil
}

// deployAgents deploys all agents from the manifest
func (d *Deployer) deployAgents(manifest *agentv1.AgentManifest) ([]*agentv1.Agent, error) {
	client := agentv1.NewAgentCommandControllerClient(d.opts.Conn)
	deployedAgents := make([]*agentv1.Agent, 0, len(manifest.Agents))

	for i, blueprint := range manifest.Agents {
		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("Deploying agent %d/%d: %s", i+1, len(manifest.Agents), blueprint.Name))
		}

		// Convert blueprint to Agent API resource
		agentResource := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: blueprint.Name,
				Org:  d.opts.OrgID,
				// Use organization scope (2) - platform scope would be 1
				OwnerScope: apiresource.ApiResourceOwnerScope_organization,
			},
			Spec: &agentv1.AgentSpec{
				Instructions: blueprint.Instructions,
				Description:  blueprint.Description,
				// Note: Skills, MCP servers, sub-agents would be converted here
				// For now, we're keeping it simple
			},
		}

		// Call apply RPC (creates or updates)
		deployed, err := client.Apply(context.Background(), agentResource)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to deploy agent '%s'", blueprint.Name)
		}

		deployedAgents = append(deployedAgents, deployed)

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("✓ Agent deployed: %s (ID: %s)", deployed.Metadata.Name, deployed.Metadata.Id))
		}
	}

	return deployedAgents, nil
}

// deployWorkflows deploys all workflows from the manifest
func (d *Deployer) deployWorkflows(manifest *workflowv1.WorkflowManifest) ([]*workflowv1.Workflow, error) {
	client := workflowv1.NewWorkflowCommandControllerClient(d.opts.Conn)
	deployedWorkflows := make([]*workflowv1.Workflow, 0, len(manifest.Workflows))

	for i, workflowBlueprint := range manifest.Workflows {
		// Ensure metadata is initialized
		if workflowBlueprint.Metadata == nil {
			workflowBlueprint.Metadata = &apiresource.ApiResourceMetadata{}
		}

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("Deploying workflow %d/%d: %s", i+1, len(manifest.Workflows), workflowBlueprint.Metadata.Name))
		}

		// The workflow blueprint is already in the correct format
		// Just need to ensure org is set
		workflowBlueprint.Metadata.Org = d.opts.OrgID
		if workflowBlueprint.Metadata.OwnerScope == apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified {
			workflowBlueprint.Metadata.OwnerScope = apiresource.ApiResourceOwnerScope_organization
		}

		// Call apply RPC (creates or updates)
		deployed, err := client.Apply(context.Background(), workflowBlueprint)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to deploy workflow '%s'", workflowBlueprint.Metadata.Name)
		}

		deployedWorkflows = append(deployedWorkflows, deployed)

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("✓ Workflow deployed: %s (ID: %s)", deployed.Metadata.Name, deployed.Metadata.Id))
		}
	}

	return deployedWorkflows, nil
}
