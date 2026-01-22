package deploy

import (
	"context"
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/synthesis"
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
	DeployedSkills    []*skillv1.Skill
	DeployedAgents    []*agentv1.Agent
	DeployedWorkflows []*workflowv1.Workflow
}

// Deployer handles deploying skills, agents, and workflows to the backend
type Deployer struct {
	opts *DeployOptions
}

// NewDeployer creates a new deployer with the given options
func NewDeployer(opts *DeployOptions) *Deployer {
	return &Deployer{opts: opts}
}

// Deploy deploys all resources from the synthesis result in dependency order.
//
// Deployment order:
//  1. Skills (agents depend on them)
//  2. Agents (workflows might depend on them)
//  3. Workflows
//
// The dependencies map is currently informational - topological sorting
// will be implemented in a future iteration.
func (d *Deployer) Deploy(synthesisResult *synthesis.Result) (*DeployResult, error) {
	result := &DeployResult{
		DeployedSkills:    make([]*skillv1.Skill, 0),
		DeployedAgents:    make([]*agentv1.Agent, 0),
		DeployedWorkflows: make([]*workflowv1.Workflow, 0),
	}

	// Deploy skills first (agents depend on them)
	if len(synthesisResult.Skills) > 0 {
		skills, err := d.deploySkills(synthesisResult.Skills)
		if err != nil {
			return nil, err
		}
		result.DeployedSkills = skills
	}

	// Deploy agents
	if len(synthesisResult.Agents) > 0 {
		agents, err := d.deployAgents(synthesisResult.Agents)
		if err != nil {
			return nil, err
		}
		result.DeployedAgents = agents
	}

	// Deploy workflows
	if len(synthesisResult.Workflows) > 0 {
		workflows, err := d.deployWorkflows(synthesisResult.Workflows)
		if err != nil {
			return nil, err
		}
		result.DeployedWorkflows = workflows
	}

	return result, nil
}

// deploySkills deploys all skills
func (d *Deployer) deploySkills(skills []*skillv1.Skill) ([]*skillv1.Skill, error) {
	client := skillv1.NewSkillCommandControllerClient(d.opts.Conn)
	deployedSkills := make([]*skillv1.Skill, 0, len(skills))

	for i, skill := range skills {
		// Ensure metadata is initialized and org is set
		if skill.Metadata == nil {
			skill.Metadata = &apiresource.ApiResourceMetadata{}
		}
		skill.Metadata.Org = d.opts.OrgID
		if skill.Metadata.OwnerScope == apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified {
			skill.Metadata.OwnerScope = apiresource.ApiResourceOwnerScope_organization
		}

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("Deploying skill %d/%d: %s", i+1, len(skills), skill.Metadata.Name))
		}

		// Call apply RPC (creates or updates)
		deployed, err := client.Apply(context.Background(), skill)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to deploy skill '%s'", skill.Metadata.Name)
		}

		deployedSkills = append(deployedSkills, deployed)

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("✓ Skill deployed: %s (ID: %s)", deployed.Metadata.Name, deployed.Metadata.Id))
		}
	}

	return deployedSkills, nil
}

// deployAgents deploys all agents
func (d *Deployer) deployAgents(agents []*agentv1.Agent) ([]*agentv1.Agent, error) {
	client := agentv1.NewAgentCommandControllerClient(d.opts.Conn)
	deployedAgents := make([]*agentv1.Agent, 0, len(agents))

	for i, agent := range agents {
		// Ensure metadata is initialized and org is set
		if agent.Metadata == nil {
			agent.Metadata = &apiresource.ApiResourceMetadata{}
		}
		agent.Metadata.Org = d.opts.OrgID
		if agent.Metadata.OwnerScope == apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified {
			agent.Metadata.OwnerScope = apiresource.ApiResourceOwnerScope_organization
		}

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("Deploying agent %d/%d: %s", i+1, len(agents), agent.Metadata.Name))
		}

		// Call apply RPC (creates or updates)
		// The agent already has full spec from SDK (skills, MCP servers, etc.)
		deployed, err := client.Apply(context.Background(), agent)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to deploy agent '%s'", agent.Metadata.Name)
		}

		deployedAgents = append(deployedAgents, deployed)

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("✓ Agent deployed: %s (ID: %s)", deployed.Metadata.Name, deployed.Metadata.Id))
		}
	}

	return deployedAgents, nil
}

// deployWorkflows deploys all workflows
func (d *Deployer) deployWorkflows(workflows []*workflowv1.Workflow) ([]*workflowv1.Workflow, error) {
	client := workflowv1.NewWorkflowCommandControllerClient(d.opts.Conn)
	deployedWorkflows := make([]*workflowv1.Workflow, 0, len(workflows))

	for i, workflow := range workflows {
		// Ensure metadata is initialized
		if workflow.Metadata == nil {
			workflow.Metadata = &apiresource.ApiResourceMetadata{}
		}

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("Deploying workflow %d/%d: %s", i+1, len(workflows), workflow.Metadata.Name))
		}

		// The workflow is already in the correct format from SDK
		// Just need to ensure org is set
		workflow.Metadata.Org = d.opts.OrgID
		if workflow.Metadata.OwnerScope == apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified {
			workflow.Metadata.OwnerScope = apiresource.ApiResourceOwnerScope_organization
		}

		// Call apply RPC (creates or updates)
		deployed, err := client.Apply(context.Background(), workflow)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to deploy workflow '%s'", workflow.Metadata.Name)
		}

		deployedWorkflows = append(deployedWorkflows, deployed)

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("✓ Workflow deployed: %s (ID: %s)", deployed.Metadata.Name, deployed.Metadata.Id))
		}
	}

	return deployedWorkflows, nil
}
