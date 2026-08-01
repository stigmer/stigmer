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
// the AgentChannel resource controllers (the DatastoreRecordController
// split).
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
