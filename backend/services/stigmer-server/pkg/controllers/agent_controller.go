package controllers

import (
	"context"
	"fmt"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/sqlite"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

// AgentController implements AgentCommandController and AgentQueryController
type AgentController struct {
	agentv1.UnimplementedAgentCommandControllerServer
	agentv1.UnimplementedAgentQueryControllerServer
	store *sqlite.Store
}

// NewAgentController creates a new AgentController
func NewAgentController(store *sqlite.Store) *AgentController {
	return &AgentController{store: store}
}

// Create creates a new agent using the pipeline framework
func (c *AgentController) Create(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, agent)

	p := pipeline.NewPipeline[*agentv1.Agent]("agent-create").
		AddStep(steps.NewResolveSlugStep[*agentv1.Agent]()).
		AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, "Agent")).
		AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]("agent")).
		AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, "Agent")).
		Build()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// Update updates an existing agent using the pipeline framework
func (c *AgentController) Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	reqCtx := pipeline.NewRequestContext(ctx, agent)

	p := pipeline.NewPipeline[*agentv1.Agent]("agent-update").
		AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, "Agent")).
		Build()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

// Delete deletes an agent
func (c *AgentController) Delete(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error) {
	if agentId == nil || agentId.Value == "" {
		return nil, grpclib.InvalidArgumentError("agent id is required")
	}

	// Get agent before deletion (to return it)
	agent := &agentv1.Agent{}
	if err := c.store.GetResource(ctx, agentId.Value, agent); err != nil {
		return nil, grpclib.NotFoundError("Agent", agentId.Value)
	}

	// Delete agent
	if err := c.store.DeleteResource(ctx, agentId.Value); err != nil {
		return nil, grpclib.InternalError(err, "failed to delete agent")
	}

	return agent, nil
}

// Get retrieves an agent by ID
func (c *AgentController) Get(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error) {
	if agentId == nil || agentId.Value == "" {
		return nil, grpclib.InvalidArgumentError("agent id is required")
	}

	agent := &agentv1.Agent{}
	if err := c.store.GetResource(ctx, agentId.Value, agent); err != nil {
		return nil, grpclib.NotFoundError("Agent", agentId.Value)
	}

	return agent, nil
}

// GetByReference retrieves an agent by reference (slug)
func (c *AgentController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*agentv1.Agent, error) {
	if ref == nil {
		return nil, grpclib.InvalidArgumentError("reference is required")
	}

	// Try to get by slug
	if ref.Slug != "" {
		return c.findByName(ctx, ref.Slug, ref.Org)
	}

	return nil, grpclib.InvalidArgumentError("slug is required")
}

// findByName finds an agent by name (helper function)
func (c *AgentController) findByName(ctx context.Context, name string, orgID string) (*agentv1.Agent, error) {
	// List all agents and filter by name
	// Note: This is not efficient for large datasets, but acceptable for local usage
	var resources [][]byte
	var err error

	if orgID != "" {
		resources, err = c.store.ListResourcesByOrg(ctx, "Agent", orgID)
	} else {
		resources, err = c.store.ListResources(ctx, "Agent")
	}

	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list agents")
	}

	for _, data := range resources {
		agent := &agentv1.Agent{}
		if err := protojson.Unmarshal(data, agent); err != nil {
			continue
		}

		if agent.Metadata.Name == name {
			// Check org filter if provided
			if orgID != "" && agent.Metadata.Org != orgID {
				continue
			}
			return agent, nil
		}
	}

	return nil, grpclib.WrapError(nil, codes.NotFound, fmt.Sprintf("agent not found with name: %s", name))
}
