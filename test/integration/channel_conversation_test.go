//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
)

// This file covers the conversation READ surface (channel-conversations T02
// Sitting 3) against the cloud backend: getTimeline's declarative can_view
// gate and input contract, and listConversations' in-handler FGA scoping.
//
// The authorization assertions are first-class here, not decoration. The
// declarative rpc.config on getTimeline is metadata that the handler's
// authorize step must consume — nothing applies it implicitly — and
// listConversations is is_skip_authorization, so its in-handler ListObjects
// scan is the ONLY gate. These are the two tests that fail if either gate is
// ever dropped in a refactor.
//
// Timeline CONTENT (the three-store stitch, cursor paging, mixed-precision
// ordering) is deliberately NOT asserted here: it is pinned against real SQL
// by the cloud repo's ChannelTimelineReadPathContractTest, and reproducing it
// would require seeding the JSONB claim-lease stores behind the service's
// back — the storage coupling the identity seeder's carve-out exists to
// contain.

// TestChannelConversation_TimelineAuthorization pins getTimeline's gate and
// input contract: the owner reads an empty timeline (no traffic yet), a
// malformed page token is INVALID_ARGUMENT through the full pipeline, and a
// stranger is denied.
func TestChannelConversation_TimelineAuthorization(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-timeline-authz",
		"You are a test agent for conversation timeline authorization.")
	channel, err := clients.AgentChannelCommand.Apply(ctx,
		channelFor(agent, "conv-timeline-"+agent.GetMetadata().GetSlug(), true))
	require.NoError(t, err, "agentChannel apply should succeed")
	channelID := channel.GetMetadata().GetId()

	// The owner reads an empty timeline: an unknown conversation key is an
	// empty page, never NOT_FOUND — the channel is the trust boundary
	// (DD-003 D-a) and stores can hold items before any aggregate exists.
	timeline, err := clients.ChannelConversationQuery.GetTimeline(ctx,
		&agentchannelv1.GetConversationTimelineInput{
			AgentChannelId:  channelID,
			ConversationKey: "15550001111",
		})
	require.NoError(t, err, "owner getTimeline should succeed")
	assert.Empty(t, timeline.GetItems(), "no traffic yet — empty timeline")
	assert.Empty(t, timeline.GetNextPageToken(), "an exhausted timeline carries no cursor")

	// A malformed cursor is the CALLER's error, surfaced as such through
	// the whole pipeline — never an INTERNAL.
	_, err = clients.ChannelConversationQuery.GetTimeline(ctx,
		&agentchannelv1.GetConversationTimelineInput{
			AgentChannelId:  channelID,
			ConversationKey: "15550001111",
			PageToken:       "not-a-cursor",
		})
	requireStatusCode(t, err, codes.InvalidArgument)

	// The stranger is denied. This is the test that fails if the authorize
	// step is ever dropped from the timeline handler: the proto's
	// declarative config is metadata only, and without the step every
	// authenticated caller reads every org's customer conversations.
	actors := newVisibilityActors(t, ctx)
	stranger := actors.Stranger()
	_, err = stranger.Clients.ChannelConversationQuery.GetTimeline(ctx,
		&agentchannelv1.GetConversationTimelineInput{
			AgentChannelId:  channelID,
			ConversationKey: "15550001111",
		})
	require.Error(t, err, "a caller without can_view must be refused")
	require.True(t, isAccessDenied(err),
		"denial must be PERMISSION_DENIED or NOT_FOUND, got: %v", err)
}

// TestChannelConversation_ListScopesToAuthorizedChannels pins the
// listConversations gate with real rows on the other side of it: the org's
// conversations exist, the owner sees them, and a stranger receives an EMPTY
// list — never an error, and never the rows (DD-010 D-b: the in-handler
// ListObjects scan is the only gate on this org-wide read).
func TestChannelConversation_ListScopesToAuthorizedChannels(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-list-scope",
		"You are a test agent for conversation list scoping.")
	channel, err := clients.AgentChannelCommand.Apply(ctx,
		channelFor(agent, "conv-list-"+agent.GetMetadata().GetSlug(), true))
	require.NoError(t, err)
	channelID := channel.GetMetadata().GetId()
	org := agent.GetMetadata().GetOrg()

	// Conversation rows are runtime facts written only by customer webhook
	// traffic (no RPC writes them until T03), so the seeder is the only door.
	seeder := harness.NewChannelConversationSeeder(testHarness.AppPostgres)
	require.NoError(t, seeder.SeedConversation(ctx, harness.SeedConversationInput{
		AgentChannelID:  channelID,
		ConversationKey: "15550001111",
		Org:             org,
		DisplayName:     "Pat",
		LastActivityAt:  time.Now().Add(-time.Hour),
	}))
	require.NoError(t, seeder.SeedConversation(ctx, harness.SeedConversationInput{
		AgentChannelID:  channelID,
		ConversationKey: "15550002222",
		Org:             org,
		DisplayName:     "Sam",
		LastActivityAt:  time.Now(),
	}))

	// The owner sees the org's conversations, newest activity first.
	list, err := clients.ChannelConversationQuery.ListConversations(ctx,
		&agentchannelv1.ListChannelConversationsInput{Org: org, AgentChannelId: channelID})
	require.NoError(t, err, "owner listConversations should succeed")
	require.Equal(t, int32(2), list.GetTotalCount(),
		"owner must see both seeded conversations")
	assert.Equal(t, "15550002222", list.GetItems()[0].GetConversationKey(),
		"newest activity first")
	assert.Equal(t, "Sam", list.GetItems()[0].GetDisplayName())

	// The stranger gets an EMPTY list while the rows demonstrably exist —
	// the assertion that fails if the ListObjects scoping is ever dropped
	// (the RPC itself is is_skip_authorization; there is no other gate).
	actors := newVisibilityActors(t, ctx)
	stranger := actors.Stranger()
	strangerList, err := stranger.Clients.ChannelConversationQuery.ListConversations(ctx,
		&agentchannelv1.ListChannelConversationsInput{Org: org})
	require.NoError(t, err,
		"an unauthorized caller gets an empty list, never an error (DD-010 D-b)")
	assert.Zero(t, strangerList.GetTotalCount(),
		"a caller who can view no channel must see NO conversations")
	assert.Empty(t, strangerList.GetItems())
}
