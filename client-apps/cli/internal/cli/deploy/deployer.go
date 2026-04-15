package deploy

import (
	"context"
	"fmt"
	"sync"

	"github.com/pkg/errors"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/artifact"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/synthesis"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

// DeployOptions contains options for deploying resources
type DeployOptions struct {
	OrgID            string
	Conn             *grpc.ClientConn
	Quiet            bool
	DryRun           bool
	ProgressCallback func(string)
	// EnableParallelDeployment enables parallel resource creation within each depth level.
	// When true, resources at the same dependency depth are created concurrently.
	// When false, all resources are created sequentially (legacy behavior).
	EnableParallelDeployment bool
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
// When EnableParallelDeployment is true:
//   - Resources are grouped by dependency depth
//   - Resources at the same depth are deployed concurrently
//   - Waits for all resources at one depth before moving to the next
//
// When EnableParallelDeployment is false:
//   - Resources are deployed sequentially in dependency order
//   - Legacy behavior for compatibility
func (d *Deployer) Deploy(synthesisResult *synthesis.Result) (*DeployResult, error) {
	// Choose deployment strategy based on options
	if d.opts.EnableParallelDeployment {
		return d.deployParallel(synthesisResult)
	}

	return d.deploySequential(synthesisResult)
}

// deploySequential deploys resources sequentially (legacy behavior).
func (d *Deployer) deploySequential(synthesisResult *synthesis.Result) (*DeployResult, error) {
	result := &DeployResult{
		DeployedSkills:    make([]*skillv1.Skill, 0),
		DeployedAgents:    make([]*agentv1.Agent, 0),
		DeployedWorkflows: make([]*workflowv1.Workflow, 0),
	}

	// Deploy skill synths first (skills are typically dependencies)
	if len(synthesisResult.SkillSynths) > 0 {
		skills, err := d.deploySkillSynths(synthesisResult.SkillSynths)
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

// deployParallel deploys resources in parallel by dependency depth.
func (d *Deployer) deployParallel(synthesisResult *synthesis.Result) (*DeployResult, error) {
	result := &DeployResult{
		DeployedSkills:    make([]*skillv1.Skill, 0),
		DeployedAgents:    make([]*agentv1.Agent, 0),
		DeployedWorkflows: make([]*workflowv1.Workflow, 0),
	}

	// Validate dependencies first
	if err := synthesisResult.ValidateDependencies(); err != nil {
		return nil, errors.Wrap(err, "dependency validation failed")
	}

	// Group resources by dependency depth
	depthGroups, err := synthesisResult.GetResourcesByDepth()
	if err != nil {
		return nil, errors.Wrap(err, "failed to group resources by depth")
	}

	// Deploy each depth level sequentially, but resources within each level in parallel
	for depthLevel, resources := range depthGroups {
		if len(resources) == 0 {
			continue
		}

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("Deploying depth level %d: %d resource(s)", depthLevel, len(resources)))
		}

		// Deploy all resources at this depth level in parallel
		deployed, err := d.deployResourceGroup(resources)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to deploy depth level %d", depthLevel)
		}

		// Categorize deployed resources
		for _, res := range deployed {
			switch r := res.(type) {
			case *skillv1.Skill:
				result.DeployedSkills = append(result.DeployedSkills, r)
			case *agentv1.Agent:
				result.DeployedAgents = append(result.DeployedAgents, r)
			case *workflowv1.Workflow:
				result.DeployedWorkflows = append(result.DeployedWorkflows, r)
			}
		}
	}

	return result, nil
}

// deployResourceGroup deploys a group of resources in parallel.
// All resources in the group are at the same dependency depth and can be deployed concurrently.
//
// Returns the deployed resources or an error if any deployment fails.
func (d *Deployer) deployResourceGroup(resources []*synthesis.ResourceWithID) ([]proto.Message, error) {
	if len(resources) == 0 {
		return []proto.Message{}, nil
	}

	// Use channels to collect results and errors
	type deployResult struct {
		resource proto.Message
		err      error
	}

	results := make(chan deployResult, len(resources))
	var wg sync.WaitGroup

	// Deploy each resource in a goroutine
	for _, res := range resources {
		wg.Add(1)

		// Capture loop variable
		resource := res

		go func() {
			defer wg.Done()

			deployed, err := d.deployResource(resource)
			results <- deployResult{
				resource: deployed,
				err:      err,
			}
		}()
	}

	// Wait for all deployments to complete
	wg.Wait()
	close(results)

	// Collect results and check for errors
	deployed := make([]proto.Message, 0, len(resources))
	var firstError error

	for result := range results {
		if result.err != nil && firstError == nil {
			firstError = result.err
		}
		if result.resource != nil {
			deployed = append(deployed, result.resource)
		}
	}

	if firstError != nil {
		return nil, firstError
	}

	return deployed, nil
}

// deployResource deploys a single resource based on its type.
func (d *Deployer) deployResource(res *synthesis.ResourceWithID) (proto.Message, error) {
	switch r := res.Resource.(type) {
	case *skillv1.SkillSynth:
		return d.deploySkillSynth(r)
	case *agentv1.Agent:
		return d.deployAgent(r)
	case *workflowv1.Workflow:
		return d.deployWorkflow(r)
	default:
		return nil, errors.Errorf("unknown resource type: %T", res.Resource)
	}
}

// deploySkillSynth processes a SkillSynth to create an artifact and push it to the backend.
// This handles both local directory and git repository sources.
func (d *Deployer) deploySkillSynth(synth *skillv1.SkillSynth) (*skillv1.Skill, error) {
	quiet := d.opts.ProgressCallback == nil

	// Determine source type and process accordingly
	if local := synth.GetLocal(); local != nil {
		// Local directory source
		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("Processing skill from local directory: %s", local.Path))
		}

		result, err := artifact.PushSkill(&artifact.SkillArtifactOptions{
			Directory: local.Path,
			OrgID:     d.opts.OrgID,
			Tag:       synth.Tag,
			Conn:      d.opts.Conn,
			Quiet:     quiet,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to push skill from %s", local.Path)
		}

		if d.opts.ProgressCallback != nil {
			d.opts.ProgressCallback(fmt.Sprintf("✓ Skill deployed: %s (hash: %s)", result.SkillName, result.VersionHash[:12]))
		}

		// Return a minimal Skill proto with the result info
		return &skillv1.Skill{
			Spec: &skillv1.SkillSpec{
				Name: result.SkillName,
				Tag:  result.Tag,
			},
			Status: &skillv1.SkillStatus{
				VersionHash:        result.VersionHash,
				ArtifactStorageKey: result.StorageKey,
			},
		}, nil
	}

	if git := synth.GetGit(); git != nil {
		// Git repository source - this requires cloning the repo first
		// For now, we'll return an error since this requires more infrastructure
		// TODO: Implement git clone and PushSkillFromGit
		return nil, errors.New("deploying skills from git repositories is not yet implemented in this flow - use 'stigmer skill push --git' command instead")
	}

	return nil, errors.New("skill synth has neither local nor git source")
}

// deploySkillSynths deploys all skill synths sequentially.
func (d *Deployer) deploySkillSynths(synths []*skillv1.SkillSynth) ([]*skillv1.Skill, error) {
	deployedSkills := make([]*skillv1.Skill, 0, len(synths))

	for i, synth := range synths {
		if d.opts.ProgressCallback != nil {
			source := "unknown"
			if synth.GetLocal() != nil {
				source = synth.GetLocal().Path
			} else if synth.GetGit() != nil {
				source = synth.GetGit().Url
			}
			d.opts.ProgressCallback(fmt.Sprintf("Deploying skill %d/%d from: %s", i+1, len(synths), source))
		}

		deployed, err := d.deploySkillSynth(synth)
		if err != nil {
			return nil, err
		}

		deployedSkills = append(deployedSkills, deployed)
	}

	return deployedSkills, nil
}

// deployAgent deploys a single agent.
func (d *Deployer) deployAgent(agent *agentv1.Agent) (*agentv1.Agent, error) {
	// Ensure metadata is initialized and org is set
	if agent.Metadata == nil {
		agent.Metadata = &apiresource.ApiResourceMetadata{}
	}
	agent.Metadata.Org = d.opts.OrgID

	if d.opts.ProgressCallback != nil {
		d.opts.ProgressCallback(fmt.Sprintf("Deploying agent: %s", agent.Metadata.Name))
	}

	client := agentv1.NewAgentCommandControllerClient(d.opts.Conn)
	deployed, err := client.Apply(context.Background(), agent)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to deploy agent '%s'", agent.Metadata.Name)
	}

	if d.opts.ProgressCallback != nil {
		d.opts.ProgressCallback(fmt.Sprintf("✓ Agent deployed: %s (ID: %s)", deployed.Metadata.Name, deployed.Metadata.Id))
	}

	return deployed, nil
}

// deployWorkflow deploys a single workflow.
func (d *Deployer) deployWorkflow(workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	// Ensure metadata is initialized
	if workflow.Metadata == nil {
		workflow.Metadata = &apiresource.ApiResourceMetadata{}
	}
	workflow.Metadata.Org = d.opts.OrgID

	if d.opts.ProgressCallback != nil {
		d.opts.ProgressCallback(fmt.Sprintf("Deploying workflow: %s", workflow.Metadata.Name))
	}

	client := workflowv1.NewWorkflowCommandControllerClient(d.opts.Conn)
	deployed, err := client.Apply(context.Background(), workflow)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to deploy workflow '%s'", workflow.Metadata.Name)
	}

	if d.opts.ProgressCallback != nil {
		d.opts.ProgressCallback(fmt.Sprintf("✓ Workflow deployed: %s (ID: %s)", deployed.Metadata.Name, deployed.Metadata.Id))
	}

	return deployed, nil
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
