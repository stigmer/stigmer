package agentchannel

import (
	"context"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
)

// conversationParticipationUnavailableMessage is the documented OSS
// posture for the conversation participation surface
// (channel-conversations DD-003 D-f): this edition has no channel
// delivery runtime, no participation state machine, and no outbound
// lane, so the honest answer to every command is a refusal — the
// sendMessage posture applied to participation.
const conversationParticipationUnavailableMessage = "conversation participation requires Stigmer Cloud"

// ChannelConversationController implements
// ChannelConversationQueryController and
// ChannelConversationCommandController — the conversation surface beside
// the channel messaging controllers (message.go), on the same runtime
// side of the resource/runtime split.
//
// Queries answer EMPTY and commands refuse FAILED_PRECONDITION, the two
// established postures side by side (channel-conversations DD-003 D-f):
// a conversation list is a discovery-shaped read whose truthful OSS
// answer is "none" (the ListMessagingChannels precedent — conversations
// are created by the cloud channel runtime, which does not run here),
// while every command asks to DO a cloud-only thing. As in message.go,
// there is deliberately no load-then-NOT_FOUND: probing local stores for
// channels this edition never materializes conversations for would
// create an edition divergence, not prevent one. Input validation still
// runs so the INVALID_ARGUMENT contract matches the cloud edition's.
type ChannelConversationController struct {
	agentchannelv1.UnimplementedChannelConversationQueryControllerServer
	agentchannelv1.UnimplementedChannelConversationCommandControllerServer
}

// NewChannelConversationController creates a new ChannelConversationController.
func NewChannelConversationController() *ChannelConversationController {
	return &ChannelConversationController{}
}

// ListConversations answers with an EMPTY list — the discovery-read
// posture (see the type comment): channel conversations exist only where
// the cloud channel runtime materializes them.
func (c *ChannelConversationController) ListConversations(
	ctx context.Context,
	input *agentchannelv1.ListChannelConversationsInput,
) (*agentchannelv1.ChannelConversationList, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return &agentchannelv1.ChannelConversationList{}, nil
}

// GetTimeline answers with an EMPTY timeline — the discovery-read
// posture (see the type comment): with no conversations materialized,
// every timeline is truthfully empty.
func (c *ChannelConversationController) GetTimeline(
	ctx context.Context,
	input *agentchannelv1.GetConversationTimelineInput,
) (*agentchannelv1.ConversationTimeline, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return &agentchannelv1.ConversationTimeline{}, nil
}

// Reply refuses with FAILED_PRECONDITION — staff replies ride the
// cloud-only outbound delivery lane (see the type comment).
func (c *ChannelConversationController) Reply(
	ctx context.Context,
	input *agentchannelv1.ReplyToConversationInput,
) (*agentchannelv1.SendChannelMessageOutput, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return nil, grpclib.FailedPreconditionError(conversationParticipationUnavailableMessage)
}

// TakeOver refuses with FAILED_PRECONDITION — the participation state
// machine is cloud-only runtime (see the type comment).
func (c *ChannelConversationController) TakeOver(
	ctx context.Context,
	input *agentchannelv1.ConversationControlInput,
) (*agentchannelv1.ChannelConversation, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return nil, grpclib.FailedPreconditionError(conversationParticipationUnavailableMessage)
}

// HandBack refuses with FAILED_PRECONDITION — the participation state
// machine is cloud-only runtime (see the type comment).
func (c *ChannelConversationController) HandBack(
	ctx context.Context,
	input *agentchannelv1.ConversationControlInput,
) (*agentchannelv1.ChannelConversation, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return nil, grpclib.FailedPreconditionError(conversationParticipationUnavailableMessage)
}

// ClearAttention refuses with FAILED_PRECONDITION — attention state is
// cloud-only runtime (see the type comment).
func (c *ChannelConversationController) ClearAttention(
	ctx context.Context,
	input *agentchannelv1.ConversationControlInput,
) (*agentchannelv1.ChannelConversation, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return nil, grpclib.FailedPreconditionError(conversationParticipationUnavailableMessage)
}

// Escalate refuses with FAILED_PRECONDITION — escalation ingest is
// cloud-only runtime (see the type comment).
func (c *ChannelConversationController) Escalate(
	ctx context.Context,
	input *agentchannelv1.EscalateConversationInput,
) (*agentchannelv1.ChannelConversation, error) {
	if err := grpclib.SharedValidator().Validate(input); err != nil {
		return nil, grpclib.InvalidArgumentError("%v", err)
	}
	return nil, grpclib.FailedPreconditionError(conversationParticipationUnavailableMessage)
}
