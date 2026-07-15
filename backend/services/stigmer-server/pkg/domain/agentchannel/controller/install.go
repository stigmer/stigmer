package agentchannel

import (
	"context"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
)

// installUnavailableMessage is the documented OSS install posture (T02
// §0-b, developer-approved): this edition has no webhook receiver and no
// delivery runtime, so an installed channel could never serve traffic —
// an honest refusal beats a half-connected install. See the package
// comment for the full rationale.
const installUnavailableMessage = "channel installs require Stigmer Cloud"

// InitiateInstall refuses with FAILED_PRECONDITION — provider installs
// are cloud-only (§0-b, see the package comment).
//
// The channel is validated and loaded FIRST so the NOT_FOUND contract is
// identical to the cloud edition's ("AgentChannel not found: <id>" — its
// LoadChannel step): a client's not-found handling works the same against
// both editions, and only the final step diverges — the documented one.
// Nothing is persisted on this path.
func (c *AgentChannelController) InitiateInstall(
	ctx context.Context,
	input *agentchannelv1.InitiateChannelInstallInput,
) (*agentchannelv1.InitiateChannelInstallOutput, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	if err := c.loadChannelForInstall(ctx, input.GetResourceId()); err != nil {
		return nil, err
	}
	return nil, grpclib.FailedPreconditionError(installUnavailableMessage)
}

// CompleteInstall refuses with FAILED_PRECONDITION — provider installs
// are cloud-only (§0-b). Same load-then-refuse contract as
// InitiateInstall; a completion can only be reached with a state token
// from a successful initiate, which this edition never issues.
func (c *AgentChannelController) CompleteInstall(
	ctx context.Context,
	input *agentchannelv1.CompleteChannelInstallInput,
) (*agentchannelv1.AgentChannel, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	if err := c.loadChannelForInstall(ctx, input.GetResourceId()); err != nil {
		return nil, err
	}
	return nil, grpclib.FailedPreconditionError(installUnavailableMessage)
}

// loadChannelForInstall verifies the target channel exists, mirroring the
// cloud edition's LoadChannel step and its exact NOT_FOUND string.
func (c *AgentChannelController) loadChannelForInstall(ctx context.Context, resourceId string) error {
	channel := &agentchannelv1.AgentChannel{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_channel, resourceId, channel); err != nil {
		return grpclib.NotFoundError("AgentChannel", resourceId)
	}
	return nil
}
