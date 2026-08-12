package agentchannel

import (
	"context"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
)

// proactiveMessagingUnavailableMessage is the documented OSS posture for
// the channel messaging surface (proactive-messaging DD-002/DD-003,
// decision 001 D-g): this edition has no outbound delivery runtime and
// no provider registry reads, so the honest answer is a refusal — the
// install posture applied to messaging.
const proactiveMessagingUnavailableMessage = "proactive channel messaging requires Stigmer Cloud"

// ChannelMessageController implements ChannelMessageCommandController and
// ChannelMessageQueryController — the runtime messaging surface beside
// the AgentChannel resource controllers, kept off the resource CRUD
// surface.
//
// Both RPCs are cloud-only runtime and refuse with FAILED_PRECONDITION.
// Unlike the install refusal (install.go), there is deliberately NO
// load-then-NOT_FOUND here: the cloud send handler fails closed with
// PERMISSION_DENIED for an unknown channel (DD-002 D4's error table, no
// existence leak), so probing the store first would create an edition
// divergence rather than prevent one. Input validation still runs so the
// INVALID_ARGUMENT contract matches the cloud edition's.
type ChannelMessageController struct {
	agentchannelv1.UnimplementedChannelMessageCommandControllerServer
	agentchannelv1.UnimplementedChannelMessageQueryControllerServer
}

// NewChannelMessageController creates a new ChannelMessageController.
func NewChannelMessageController() *ChannelMessageController {
	return &ChannelMessageController{}
}

// SendMessage refuses with FAILED_PRECONDITION — business-initiated
// channel messaging is cloud-only runtime (see the type comment).
func (c *ChannelMessageController) SendMessage(
	ctx context.Context,
	input *agentchannelv1.SendChannelMessageInput,
) (*agentchannelv1.SendChannelMessageOutput, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return nil, grpclib.FailedPreconditionError(proactiveMessagingUnavailableMessage)
}

// ListTemplates refuses with FAILED_PRECONDITION — provider registry
// reads are cloud-only runtime (see the type comment). Consumers degrade
// to honest absence: the runner injects no template section and the
// console renders its typed error state.
func (c *ChannelMessageController) ListTemplates(
	ctx context.Context,
	input *agentchannelv1.ListChannelTemplatesInput,
) (*agentchannelv1.ChannelTemplates, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return nil, grpclib.FailedPreconditionError(proactiveMessagingUnavailableMessage)
}

// ListMessagingChannels answers with an EMPTY list — a deliberate
// divergence from its refusing siblings (proactive-messaging DD-006 D3).
//
// The siblings refuse because their caller asked to DO a cloud-only
// thing; this is a capability-DISCOVERY read whose truthful OSS answer is
// "none" (channels exist here, but no business-initiated send runtime
// does). The runner issues this read on every agent execution to decide
// whether to attach the send_channel_message tool — an expected-error
// path in that hot loop would be noise, and the empty list produces the
// identical, honest outcome: no tool, no prompt section.
func (c *ChannelMessageController) ListMessagingChannels(
	ctx context.Context,
	input *agentchannelv1.ListMessagingChannelsInput,
) (*agentchannelv1.MessagingChannels, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return &agentchannelv1.MessagingChannels{}, nil
}
