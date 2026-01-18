package agentinstance

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/badger"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentinstancev1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agentinstance/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// GetByAgent retrieves all agent instances for a specific agent.
//
// This handler lists all instances that belong to the specified agent template.
// In OSS (local usage), all instances are returned without authorization filtering.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints
// 2. LoadByAgent - Load all instances for the specified agent
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization filtering (no multi-user auth - returns all instances)
// - TransformResponse step (no response transformations)
func (c *AgentInstanceController) GetByAgent(ctx context.Context, req *agentinstancev1.GetAgentInstancesByAgentRequest) (*agentinstancev1.AgentInstanceList, error) {
	// Create request context with the request
	reqCtx := pipeline.NewRequestContext(ctx, req)

	// Build and execute pipeline
	p := c.buildGetByAgentPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Get loaded list from context
	list := reqCtx.Get("instanceList")
	if list == nil {
		return nil, grpclib.InternalError(nil, "instance list not found in context")
	}

	return list.(*agentinstancev1.AgentInstanceList), nil
}

// buildGetByAgentPipeline constructs the pipeline for get-by-agent operations
func (c *AgentInstanceController) buildGetByAgentPipeline() *pipeline.Pipeline[*agentinstancev1.GetAgentInstancesByAgentRequest] {
	return pipeline.NewPipeline[*agentinstancev1.GetAgentInstancesByAgentRequest]("agent-instance-get-by-agent").
		AddStep(steps.NewValidateProtoStep[*agentinstancev1.GetAgentInstancesByAgentRequest]()). // 1. Validate field constraints
		AddStep(newLoadByAgentStep(c.store)).                                                    // 2. Load by agent
		Build()
}

// ============================================================================
// Custom Pipeline Step: LoadByAgent
// ============================================================================

// loadByAgentStep loads all agent instances for a specific agent.
//
// This step:
// 1. Validates the agent_id is provided
// 2. Lists all agent instances from the database
// 3. Filters instances by agent_id (from spec.agent_id)
// 4. Returns filtered list
//
// Note: In OSS (local usage), no authorization filtering is applied.
// All instances for the agent are returned.
type loadByAgentStep struct {
	store *badger.Store
}

func newLoadByAgentStep(store *badger.Store) *loadByAgentStep {
	return &loadByAgentStep{store: store}
}

func (s *loadByAgentStep) Name() string {
	return "LoadByAgent"
}

func (s *loadByAgentStep) Execute(ctx *pipeline.RequestContext[*agentinstancev1.GetAgentInstancesByAgentRequest]) error {
	req := ctx.Input()
	agentId := req.GetAgentId()

	if agentId == "" {
		return grpclib.InvalidArgumentError("agent_id is required")
	}

	// List all agent instances and filter by agent_id
	// Note: This is not efficient for large datasets, but acceptable for local usage
	resources, err := s.store.ListResources(ctx.Context(), "AgentInstance")
	if err != nil {
		return grpclib.InternalError(err, "failed to list agent instances")
	}

	// Filter instances by agent_id
	var instances []*agentinstancev1.AgentInstance
	for _, data := range resources {
		instance := &agentinstancev1.AgentInstance{}
		if err := protojson.Unmarshal(data, instance); err != nil {
			continue
		}

		if instance.GetSpec().GetAgentId() == agentId {
			instances = append(instances, instance)
		}
	}

	// Build response list
	list := &agentinstancev1.AgentInstanceList{
		TotalCount: int32(len(instances)),
		Items:      instances,
	}

	// Store in context for response
	ctx.Set("instanceList", list)

	return nil
}
