package session

import (
	"context"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	sessionsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/session/controller/steps"
)

// ListByChannel retrieves the conversations an agent channel created using
// the pipeline framework.
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate input ListSessionsByChannelRequest
// 2. FilterByChannel - Load sessions filtered by the stigmer.ai/channel-id label
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - The can_view gate on the agent_channel and the FGA authorized-IDs
//   session filter (no IAM system)
// - Pagination support (simple list all)
//
// This handler exists for contract parity: channel sessions are created by
// the cloud channel runtime (Slack/WhatsApp inbound turns), which stamps the
// stigmer.ai/channel-id label at create time. The OSS runtime has no channel
// broker, so in practice the filter matches nothing — but the RPC honors the
// shared proto contract so clients behave identically across editions.
func (c *SessionController) ListByChannel(ctx context.Context, req *sessionv1.ListSessionsByChannelRequest) (*sessionv1.SessionList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListByChannelPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve list from context
	sessionList := reqCtx.Get(listResultKey).(*sessionv1.SessionList)
	return sessionList, nil
}

// buildListByChannelPipeline constructs the pipeline for list-by-channel operations
func (c *SessionController) buildListByChannelPipeline() *pipeline.Pipeline[*sessionv1.ListSessionsByChannelRequest] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*sessionv1.ListSessionsByChannelRequest]("session-list-by-channel").
		AddStep(steps.NewValidateProtoStep[*sessionv1.ListSessionsByChannelRequest]()). // 1. Validate input
		AddStep(sessionsteps.NewFilterByChannelStep(c.store)).                          // 2. Filter by channel label
		Build()
}
