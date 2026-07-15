package channelapp

import (
	"context"

	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Delete deletes a ChannelApp by id using the pipeline pattern.
//
// Referential integrity: deletion is blocked with FAILED_PRECONDITION
// while any AgentChannel references this app via spec.app_ref — a deleted
// app would break the referencing channels' webhook verification and any
// future re-install. Rebind or delete those channels first.
//
// The deleted ChannelApp is returned for audit purposes (gRPC convention);
// its secret fields are redacted like every other response.
func (c *ChannelAppController) Delete(ctx context.Context, input *apiresource.ApiResourceDeleteInput) (*channelappv1.ChannelApp, error) {
	reqCtx := pipeline.NewRequestContext(ctx, input)

	// ApiResourceDeleteInput carries ResourceId (not Value), so the id is
	// stored manually instead of via ExtractResourceIdStep (the oauthapp
	// delete shape).
	reqCtx.Set(steps.ResourceIdKey, input.ResourceId)

	if err := c.buildDeletePipeline().Execute(reqCtx); err != nil {
		return nil, err
	}

	deletedVal := reqCtx.Get(steps.ExistingResourceKey)
	if deletedVal == nil {
		return nil, grpclib.InternalError(nil, "deleted ChannelApp not found in context")
	}

	deleted := deletedVal.(*channelappv1.ChannelApp)
	RedactChannelApp(deleted)
	return deleted, nil
}

// buildDeletePipeline constructs the pipeline for delete operations.
//
// CheckNoReferencingChannels runs after LoadExistingForDelete so it can
// read the app's org and slug for the referential integrity check.
func (c *ChannelAppController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceDeleteInput] {
	return pipeline.NewPipeline[*apiresource.ApiResourceDeleteInput]("channelapp-delete").
		AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceDeleteInput]()).
		AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceDeleteInput, *channelappv1.ChannelApp](c.store)).
		AddStep(NewCheckNoReferencingChannelsStep(c.store)).
		AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceDeleteInput](c.store)).
		Build()
}
