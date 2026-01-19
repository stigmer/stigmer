package workflowinstance

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresourcecommons "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/protobuf/encoding/protojson"
)

// Context keys for query operations
const (
	WorkflowInstanceListKey = "workflow_instance_list"
)

// Get retrieves a workflow instance by ID using the pipeline framework
func (c *WorkflowInstanceController) Get(ctx context.Context, workflowInstanceId *workflowinstancev1.WorkflowInstanceId) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, workflowInstanceId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded workflow instance from context
	workflowInstance := reqCtx.Get(steps.TargetResourceKey).(*workflowinstancev1.WorkflowInstance)
	return workflowInstance, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
func (c *WorkflowInstanceController) buildGetPipeline() *pipeline.Pipeline[*workflowinstancev1.WorkflowInstanceId] {
	return pipeline.NewPipeline[*workflowinstancev1.WorkflowInstanceId]("workflow-instance-get").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.WorkflowInstanceId]()).                                       // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*workflowinstancev1.WorkflowInstanceId, *workflowinstancev1.WorkflowInstance](c.store)). // 2. Load by ID
		Build()
}

// GetByReference retrieves a workflow instance by ApiResourceReference (slug-based lookup) using the pipeline framework
func (c *WorkflowInstanceController) GetByReference(ctx context.Context, ref *apiresourcecommons.ApiResourceReference) (*workflowinstancev1.WorkflowInstance, error) {
	reqCtx := pipeline.NewRequestContext(ctx, ref)

	p := c.buildGetByReferencePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded workflow instance from context
	workflowInstance := reqCtx.Get(steps.TargetResourceKey).(*workflowinstancev1.WorkflowInstance)
	return workflowInstance, nil
}

// buildGetByReferencePipeline constructs the pipeline for get-by-reference operations
func (c *WorkflowInstanceController) buildGetByReferencePipeline() *pipeline.Pipeline[*apiresourcecommons.ApiResourceReference] {
	return pipeline.NewPipeline[*apiresourcecommons.ApiResourceReference]("workflow-instance-get-by-reference").
		AddStep(steps.NewValidateProtoStep[*apiresourcecommons.ApiResourceReference]()).                  // 1. Validate input
		AddStep(steps.NewLoadByReferenceStep[*workflowinstancev1.WorkflowInstance](c.store)). // 2. Load by slug
		Build()
}

// GetByWorkflow retrieves all instances of a specific workflow template
//
// This implements the custom query handler for listing workflow instances filtered by workflow_id.
//
// Note: Compared to Stigmer Cloud (Java), OSS simplifies this:
// - Cloud: Queries IAM Policy service for authorized IDs, then filters by workflow_id in MongoDB
// - OSS: Lists all instances and filters in-memory by workflow_id (acceptable for local usage)
//
// Authorization in Cloud (informational only, not implemented in OSS):
// - QueryAuthorizedIds step: Queries IAM Policy for workflow_instance IDs caller can view
// - LoadFromRepo step: Loads instances filtered by authorized IDs AND workflow_id
// - This ensures users only see instances they have access to, even if parent workflow is shared
//
// Pipeline (Stigmer OSS):
// 1. ValidateFieldConstraints - Validate input workflow ID
// 2. LoadFromRepo - Load instances filtered by workflow_id from repository
func (c *WorkflowInstanceController) GetByWorkflow(ctx context.Context, request *workflowinstancev1.GetWorkflowInstancesByWorkflowRequest) (*workflowinstancev1.WorkflowInstanceList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, request)

	p := c.buildGetByWorkflowPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve workflow instance list from context
	listVal := reqCtx.Get(WorkflowInstanceListKey)
	if listVal == nil {
		return &workflowinstancev1.WorkflowInstanceList{}, nil
	}

	return listVal.(*workflowinstancev1.WorkflowInstanceList), nil
}

// buildGetByWorkflowPipeline constructs the pipeline for get-by-workflow operations
func (c *WorkflowInstanceController) buildGetByWorkflowPipeline() *pipeline.Pipeline[*workflowinstancev1.GetWorkflowInstancesByWorkflowRequest] {
	return pipeline.NewPipeline[*workflowinstancev1.GetWorkflowInstancesByWorkflowRequest]("workflow-instance-get-by-workflow").
		AddStep(steps.NewValidateProtoStep[*workflowinstancev1.GetWorkflowInstancesByWorkflowRequest]()). // 1. Validate input
		AddStep(newLoadByWorkflowStep(c.store)).                                                            // 2. Load from repo filtered by workflow_id
		Build()
}

// ============================================================================
// Pipeline Steps for GetByWorkflow
// ============================================================================

// loadByWorkflowStep loads workflow instances filtered by workflow_id.
//
// This step:
// 1. Reads workflow_id from request
// 2. Lists all workflow instances from repository
// 3. Filters by workflow_id (in-memory)
// 4. Stores filtered list in context
//
// Note: In OSS, we filter in-memory after loading all instances. This is acceptable
// for local usage. In Cloud (Java), this uses a combined MongoDB query with
// authorized IDs AND workflow_id for efficiency at scale.
type loadByWorkflowStep struct {
	store store.Store
}

func newLoadByWorkflowStep(s store.Store) *loadByWorkflowStep {
	return &loadByWorkflowStep{store: s}
}

func (s *loadByWorkflowStep) Name() string {
	return "LoadByWorkflow"
}

func (s *loadByWorkflowStep) Execute(ctx *pipeline.RequestContext[*workflowinstancev1.GetWorkflowInstancesByWorkflowRequest]) error {
	request := ctx.Input()
	workflowID := request.GetWorkflowId()

	log.Debug().
		Str("workflow_id", workflowID).
		Msg("Loading workflow instances for workflow")

	// Get api_resource_kind from request context
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// Get kind name from the enum
	kindName, err := apiresource.GetKindName(kind)
	if err != nil {
		log.Error().
			Err(err).
			Msg("Failed to get kind name")
		return grpclib.InternalError(err, "failed to get kind name")
	}

	// List all workflow instances
	data, err := s.store.ListResources(ctx.Context(), kindName)
	if err != nil {
		log.Error().
			Err(err).
			Str("workflow_id", workflowID).
			Msg("Failed to list workflow instances")
		return grpclib.InternalError(err, "failed to list workflow instances")
	}

	// Filter by workflow_id
	var filteredInstances []*workflowinstancev1.WorkflowInstance
	for _, d := range data {
		instance := &workflowinstancev1.WorkflowInstance{}
		if err := protojson.Unmarshal(d, instance); err != nil {
			log.Warn().
				Err(err).
				Msg("Failed to unmarshal workflow instance, skipping")
			continue
		}

		// Filter by workflow_id
		if instance.GetSpec().GetWorkflowId() == workflowID {
			filteredInstances = append(filteredInstances, instance)
		}
	}

	log.Info().
		Str("workflow_id", workflowID).
		Int("count", len(filteredInstances)).
		Msg("Found workflow instances for workflow")

	// Store in context
	list := &workflowinstancev1.WorkflowInstanceList{
		Entries: filteredInstances,
	}
	ctx.Set(WorkflowInstanceListKey, list)

	return nil
}

// findByWorkflowID is a helper function that filters instances by workflow_id
// This is used by GetByWorkflow handler
func (c *WorkflowInstanceController) findByWorkflowID(ctx context.Context, workflowID string) ([]*workflowinstancev1.WorkflowInstance, error) {
	// Get api_resource_kind from request context
	kind := apiresourceinterceptor.GetApiResourceKind(ctx)

	// Get kind name from the enum
	kindName, err := apiresource.GetKindName(kind)
	if err != nil {
		return nil, fmt.Errorf("failed to get kind name: %w", err)
	}

	// List all instances
	data, err := c.store.ListResources(ctx, kindName)
	if err != nil {
		return nil, fmt.Errorf("failed to list workflow instances: %w", err)
	}

	var instances []*workflowinstancev1.WorkflowInstance
	for _, d := range data {
		instance := &workflowinstancev1.WorkflowInstance{}
		if err := protojson.Unmarshal(d, instance); err != nil {
			continue
		}

		// Filter by workflow_id
		if instance.GetSpec().GetWorkflowId() == workflowID {
			instances = append(instances, instance)
		}
	}

	return instances, nil
}
