package session

import (
	"context"

	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	sessionv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/session/v1"
)

// Get retrieves a session by ID using the pipeline framework
//
// This implements the standard Get operation pattern:
// 1. ValidateProto - Validate input SessionId (ensures value is not empty)
// 2. LoadTarget - Load session from repository by ID
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// - ValidateProto: Validates buf.validate constraints on SessionId
// - LoadTarget: Loads session from BadgerDB by ID, returns NotFound if missing
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - ExtractResourceId step (not needed - ID is already in SessionId.value)
// - Authorize step (no multi-tenant auth in OSS)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// The loaded session is stored in context with key "targetResource" and
// returned by the handler.
func (c *SessionController) Get(ctx context.Context, sessionId *sessionv1.SessionId) (*sessionv1.Session, error) {
	reqCtx := pipeline.NewRequestContext(ctx, sessionId)

	p := c.buildGetPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded session from context
	session := reqCtx.Get(steps.TargetResourceKey).(*sessionv1.Session)
	return session, nil
}

// buildGetPipeline constructs the pipeline for get-by-id operations
//
// This pipeline is generic and reusable across all resources.
// It uses standard steps from the pipeline/steps package.
func (c *SessionController) buildGetPipeline() *pipeline.Pipeline[*sessionv1.SessionId] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*sessionv1.SessionId]("session-get").
		AddStep(steps.NewValidateProtoStep[*sessionv1.SessionId]()).                        // 1. Validate input
		AddStep(steps.NewLoadTargetStep[*sessionv1.SessionId, *sessionv1.Session](c.store)). // 2. Load by ID
		Build()
}
