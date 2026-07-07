package session

import (
	"context"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	sessionsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/session/controller/steps"
)

// ListByAgentInstance retrieves all sessions for a specific agent instance using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate input ListSessionsByAgentInstanceRequest
// 2. FilterByAgentInstance - Load sessions filtered by agent_instance_id
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorization filtering (no IAM system)
// - Pagination support (simple list all)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// In a production multi-tenant system, this would:
// 1. Query IAM Policy service for authorized session IDs
// 2. Filter those by agent_instance_id in a single MongoDB query
//
// For OSS local usage, we simply filter by agent_instance_id.
func (c *SessionController) ListByAgentInstance(ctx context.Context, req *sessionv1.ListSessionsByAgentInstanceRequest) (*sessionv1.SessionList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListByAgentInstancePipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve list from context
	sessionList := reqCtx.Get(listResultKey).(*sessionv1.SessionList)
	return sessionList, nil
}

// buildListByAgentInstancePipeline constructs the pipeline for list-by-agent-instance operations
func (c *SessionController) buildListByAgentInstancePipeline() *pipeline.Pipeline[*sessionv1.ListSessionsByAgentInstanceRequest] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*sessionv1.ListSessionsByAgentInstanceRequest]("session-list-by-agent-instance").
		AddStep(steps.NewValidateProtoStep[*sessionv1.ListSessionsByAgentInstanceRequest]()). // 1. Validate input
		AddStep(sessionsteps.NewFilterByAgentInstanceStep(c.store)).                          // 2. Filter by agent_instance_id
		Build()
}
