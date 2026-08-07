//go:build integration

package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
)

// This file covers the conversation surface against the cloud backend: the
// READ side (channel-conversations T02 Sitting 3 — getTimeline's declarative
// can_view gate and input contract, listConversations' in-handler FGA
// scoping) and the PARTICIPATION COMMANDS (T03 Sitting 2 —
// takeOver/handBack/reply through real OpenFGA, the first end-to-end proof
// of the participant relation).
//
// The authorization assertions are first-class here, not decoration. The
// declarative rpc.config on getTimeline and on every command is metadata
// that the handler's authorize step must consume — nothing applies it
// implicitly — and listConversations is is_skip_authorization, so its
// in-handler ListObjects scan is the ONLY gate. These are the tests that
// fail if any gate is ever dropped in a refactor.
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

// ─────────────────────────────────────────────────────────────────────────────
// The participation commands (T03 Sitting 2)
// ─────────────────────────────────────────────────────────────────────────────

// whatsAppFixture is one WhatsApp ChannelApp + AgentChannel pair, carrying
// everything the front-door tests need: the webhook URL segment (the app
// id), the plaintext app secret the test itself stored (the HMAC signing
// key), and the phone number id (the inbound routing key and the mock
// Graph's send route).
type whatsAppFixture struct {
	ChannelID     string
	ChannelAppID  string
	AppSecret     string
	PhoneNumberID string
}

// applyWhatsAppChannel creates a WhatsApp ChannelApp and an AgentChannel
// bound to it. Human participation is structurally WhatsApp-only in v1
// (one ProactiveMessageSender implementation exists), so the command tests
// need this arm; channelFor's Slack arm is the SENDERLESS case. The app is
// required at write time (spec.app_ref, DD-WA-2); the channel stays
// pending_install until a test runs initiateInstall against the mock Graph.
func applyWhatsAppChannel(t *testing.T, ctx context.Context, clients *harness.Clients,
	agent *agentv1.Agent, name string) whatsAppFixture {
	t.Helper()
	const appSecret = "integration-app-secret"
	app, err := clients.ChannelAppCommand.Apply(ctx, &channelappv1.ChannelApp{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "ChannelApp",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name + "-app",
			Org:  agent.GetMetadata().GetOrg(),
		},
		Spec: &channelappv1.ChannelAppSpec{
			ProviderConfig: &channelappv1.ChannelAppSpec_Whatsapp{
				Whatsapp: &channelappv1.WhatsAppChannelAppConfig{
					AppId:       "1234567890",
					AppSecret:   appSecret,
					AccessToken: "integration-access-token",
					VerifyToken: "integration-verify-token",
				},
			},
		},
	})
	require.NoError(t, err, "whatsapp channel app apply should succeed")

	// Unique per fixture: install enforces one channel per
	// (phone number, channel app), and the webhook routes on
	// (phone_number_id, channel_app_id, installed).
	phoneNumberID := fmt.Sprintf("1%014d", time.Now().UnixNano()%100000000000000)

	channel := channelFor(agent, name, true)
	channel.Spec.ProviderConfig = &agentchannelv1.AgentChannelSpec_Whatsapp{
		Whatsapp: &agentchannelv1.WhatsAppChannelConfig{PhoneNumberId: phoneNumberID},
	}
	channel.Spec.AppRef = &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_channel_app,
		Slug: app.GetMetadata().GetSlug(),
	}
	created, err := clients.AgentChannelCommand.Apply(ctx, channel)
	require.NoError(t, err, "whatsapp agent channel apply should succeed")
	return whatsAppFixture{
		ChannelID:     created.GetMetadata().GetId(),
		ChannelAppID:  app.GetMetadata().GetId(),
		AppSecret:     appSecret,
		PhoneNumberID: phoneNumberID,
	}
}

// grantChannelRole grants one relation on an agent_channel to an identity
// account through the real IamPolicy RPC — the exact path a channel owner
// walks in the console (DD-010: zero new grant RPCs; participant rides the
// generic IamPolicy resource).
func grantChannelRole(t *testing.T, ctx context.Context, clients *harness.Clients,
	channelID, accountID, relation string) {
	t.Helper()
	_, err := clients.IamPolicyCommand.Create(ctx, &iampolicyv1.IamPolicySpec{
		Principal: &iampolicyv1.ApiResourceRef{Kind: "identity_account", Id: accountID},
		Resource:  &iampolicyv1.ApiResourceRef{Kind: "agent_channel", Id: channelID},
		Relation:  relation,
	})
	require.NoError(t, err, "granting %s on channel %s to %s", relation, channelID, accountID)
}

// TestChannelConversation_TakeOverAndHandBack walks the control token
// through its whole lifecycle over real RPCs: takeover, the self-takeover
// lost CAS answered with state, handback clearing the holder, the
// redundant handback answered with state, and the unknown-conversation
// NOT_FOUND (DD-007 D-f's transition table through the front door).
func TestChannelConversation_TakeOverAndHandBack(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-takeover",
		"You are a test agent for conversation takeover.")
	channelID := applyWhatsAppChannel(t, ctx, clients, agent,
		"conv-takeover-"+agent.GetMetadata().GetSlug()).ChannelID

	seeder := harness.NewChannelConversationSeeder(testHarness.AppPostgres)
	require.NoError(t, seeder.SeedConversation(ctx, harness.SeedConversationInput{
		AgentChannelID:  channelID,
		ConversationKey: "15550001111",
		Org:             agent.GetMetadata().GetOrg(),
		DisplayName:     "Pat",
		LastActivityAt:  time.Now(),
	}))
	controlInput := &agentchannelv1.ConversationControlInput{
		AgentChannelId:  channelID,
		ConversationKey: "15550001111",
	}

	// Take over: the owner holds can_participate (owner ⊆ participant).
	held, err := clients.ChannelConversationCommand.TakeOver(ctx, controlInput)
	require.NoError(t, err, "owner takeOver should succeed")
	assert.Equal(t, agentchannelv1.ConversationControl_control_human, held.GetControl())
	assert.Equal(t, harness.OwnerAccountID, held.GetControlledBy(),
		"the taker becomes the holder")
	assert.NotNil(t, held.GetControlChangedAt(), "the flip stamps its instant")

	// Taking over a conversation you already hold is a lost CAS answered
	// with the fresh state — an answer, never an error (DD-003 D-c).
	stillHeld, err := clients.ChannelConversationCommand.TakeOver(ctx, controlInput)
	require.NoError(t, err, "self-takeover must answer, not error")
	assert.Equal(t, harness.OwnerAccountID, stillHeld.GetControlledBy())

	// Hand back: control returns to the agent, the holder clears.
	released, err := clients.ChannelConversationCommand.HandBack(ctx, controlInput)
	require.NoError(t, err, "handBack should succeed")
	assert.Equal(t, agentchannelv1.ConversationControl_control_agent, released.GetControl())
	assert.Empty(t, released.GetControlledBy(), "handback clears the holder")

	// Handing back an agent-held conversation: lost CAS, answered with
	// state — flapping is a legal sequence of independent flips (DD-007).
	stillAgent, err := clients.ChannelConversationCommand.HandBack(ctx, controlInput)
	require.NoError(t, err, "redundant handBack must answer, not error")
	assert.Equal(t, agentchannelv1.ConversationControl_control_agent, stillAgent.GetControl())

	// A conversation that never existed is NOT_FOUND.
	_, err = clients.ChannelConversationCommand.TakeOver(ctx,
		&agentchannelv1.ConversationControlInput{
			AgentChannelId:  channelID,
			ConversationKey: "15559999999",
		})
	requireStatusCode(t, err, codes.NotFound)
}

// TestChannelConversation_ParticipantGrantGatesTakeover is the first
// end-to-end proof of the participant relation (DD-010): an outside
// identity is denied, gains exactly can_participate through the real
// IamPolicy grant path, takes a conversation over, and a viewer-only
// identity stays denied — the negative that pins the authorize step's
// presence (the declarative rpc.config is metadata only; viewer is widened
// to INCLUDE participant, never the reverse).
func TestChannelConversation_ParticipantGrantGatesTakeover(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-participant",
		"You are a test agent for participant authorization.")
	channelID := applyWhatsAppChannel(t, ctx, clients, agent,
		"conv-participant-"+agent.GetMetadata().GetSlug()).ChannelID

	seeder := harness.NewChannelConversationSeeder(testHarness.AppPostgres)
	require.NoError(t, seeder.SeedConversation(ctx, harness.SeedConversationInput{
		AgentChannelID:  channelID,
		ConversationKey: "15550003333",
		Org:             agent.GetMetadata().GetOrg(),
		DisplayName:     "Ravi",
		LastActivityAt:  time.Now(),
	}))
	controlInput := &agentchannelv1.ConversationControlInput{
		AgentChannelId:  channelID,
		ConversationKey: "15550003333",
	}

	actors := newVisibilityActors(t, ctx)

	// A trainer-shaped principal: no org role, no channel grants yet.
	trainer := actors.Stranger()
	_, err := trainer.Clients.ChannelConversationCommand.TakeOver(ctx, controlInput)
	require.Error(t, err, "an ungranted caller must be refused")
	require.True(t, isAccessDenied(err),
		"denial must be PERMISSION_DENIED or NOT_FOUND, got: %v", err)

	// The participant grant — the console's Manage Access path, no new RPC.
	grantChannelRole(t, ctx, clients, channelID, trainer.AccountID, "participant")
	trainer.RequirePermission(t, ctx, "agent_channel", channelID, "can_participate", true)
	trainer.RequirePermission(t, ctx, "agent_channel", channelID, "can_view", true)

	held, err := trainer.Clients.ChannelConversationCommand.TakeOver(ctx, controlInput)
	require.NoError(t, err, "a granted participant takes over")
	assert.Equal(t, trainer.AccountID, held.GetControlledBy())

	// A DIFFERENT authorized participant may hand back — the v1 single
	// attention pool: handback authority is can_participate, not holdership
	// (DD-007 D-f). The owner is not the holder here.
	released, err := clients.ChannelConversationCommand.HandBack(ctx, controlInput)
	require.NoError(t, err, "any can_participate holder may hand back")
	assert.Equal(t, agentchannelv1.ConversationControl_control_agent, released.GetControl())

	// Viewer-only is NOT enough: viewer includes participant, never the
	// reverse. This is the true negative — it fails if the authorize step
	// is ever dropped from a command pipeline.
	viewer := actors.Member()
	grantChannelRole(t, ctx, clients, channelID, viewer.AccountID, "viewer")
	viewer.RequirePermission(t, ctx, "agent_channel", channelID, "can_view", true)
	viewer.RequirePermission(t, ctx, "agent_channel", channelID, "can_participate", false)
	_, err = viewer.Clients.ChannelConversationCommand.TakeOver(ctx, controlInput)
	require.Error(t, err, "a viewer-only caller must be refused takeOver")
	require.True(t, isAccessDenied(err),
		"denial must be PERMISSION_DENIED or NOT_FOUND, got: %v", err)
}

// TestChannelConversation_ConcurrentTakeoverLoserSeesWinner pins the
// human → human non-transition (DD-007 D-f): the second taker's CAS loses
// and the answer names the FIRST holder — reassignment is out-of-scope
// routing machinery, deliberately absent in v1.
func TestChannelConversation_ConcurrentTakeoverLoserSeesWinner(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-race",
		"You are a test agent for the takeover race.")
	channelID := applyWhatsAppChannel(t, ctx, clients, agent,
		"conv-race-"+agent.GetMetadata().GetSlug()).ChannelID

	seeder := harness.NewChannelConversationSeeder(testHarness.AppPostgres)
	require.NoError(t, seeder.SeedConversation(ctx, harness.SeedConversationInput{
		AgentChannelID:  channelID,
		ConversationKey: "15550004444",
		Org:             agent.GetMetadata().GetOrg(),
		DisplayName:     "Mira",
		LastActivityAt:  time.Now(),
	}))
	controlInput := &agentchannelv1.ConversationControlInput{
		AgentChannelId:  channelID,
		ConversationKey: "15550004444",
	}

	// First taker: the owner.
	held, err := clients.ChannelConversationCommand.TakeOver(ctx, controlInput)
	require.NoError(t, err)
	require.Equal(t, harness.OwnerAccountID, held.GetControlledBy())

	// Second taker: a granted participant. The CAS loses; the answer names
	// the winner so the console can show WHO holds the conversation.
	actors := newVisibilityActors(t, ctx)
	second := actors.Stranger()
	grantChannelRole(t, ctx, clients, channelID, second.AccountID, "participant")
	answer, err := second.Clients.ChannelConversationCommand.TakeOver(ctx, controlInput)
	require.NoError(t, err, "the loser gets the fresh state, never an error")
	assert.Equal(t, agentchannelv1.ConversationControl_control_human, answer.GetControl())
	assert.Equal(t, harness.OwnerAccountID, answer.GetControlledBy(),
		"human → human is not a transition: the first holder stays (DD-007 D-f)")
}

// TestChannelConversation_SenderlessProviderRefusesTakeover pins the void
// guard: on a provider with no send lane (Slack in v1) a takeover would
// silence the agent while no human reply or acknowledgment could reach the
// customer, so it refuses FAILED_PRECONDITION — while handBack, the escape
// hatch, is deliberately never gated.
func TestChannelConversation_SenderlessProviderRefusesTakeover(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-senderless",
		"You are a test agent for the senderless takeover guard.")
	channel, err := clients.AgentChannelCommand.Apply(ctx,
		channelFor(agent, "conv-senderless-"+agent.GetMetadata().GetSlug(), true))
	require.NoError(t, err, "the Slack arm IS the senderless case")
	channelID := channel.GetMetadata().GetId()

	seeder := harness.NewChannelConversationSeeder(testHarness.AppPostgres)
	require.NoError(t, seeder.SeedConversation(ctx, harness.SeedConversationInput{
		AgentChannelID:  channelID,
		ConversationKey: "C123THREAD456",
		Org:             agent.GetMetadata().GetOrg(),
		LastActivityAt:  time.Now(),
	}))

	_, err = clients.ChannelConversationCommand.TakeOver(ctx,
		&agentchannelv1.ConversationControlInput{
			AgentChannelId:  channelID,
			ConversationKey: "C123THREAD456",
		})
	requireStatusCode(t, err, codes.FailedPrecondition)

	// handBack stays available on the same senderless channel: a lost CAS
	// on an agent-held row is an ANSWER — proof the command carries no
	// provider gate at all.
	answer, err := clients.ChannelConversationCommand.HandBack(ctx,
		&agentchannelv1.ConversationControlInput{
			AgentChannelId:  channelID,
			ConversationKey: "C123THREAD456",
		})
	require.NoError(t, err, "handBack is the escape hatch — never provider-gated")
	assert.Equal(t, agentchannelv1.ConversationControl_control_agent, answer.GetControl())
}

// TestChannelConversation_ReplyPreconditions pins the reply lane's gates
// through the front door: A8 (no conversation → NOT_FOUND, the cold-send
// hole stays closed) and A9 (a real conversation on an uninstalled channel
// → FAILED_PRECONDITION), with control untouched by every refusal. The
// happy-path reply needs a mock provider Graph API and lands with the
// webhook front-door test.
func TestChannelConversation_ReplyPreconditions(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-reply",
		"You are a test agent for reply preconditions.")
	channelID := applyWhatsAppChannel(t, ctx, clients, agent,
		"conv-reply-"+agent.GetMetadata().GetSlug()).ChannelID
	org := agent.GetMetadata().GetOrg()

	payload := &agentchannelv1.ChannelOutboundPayload{
		Kind: &agentchannelv1.ChannelOutboundPayload_Text{
			Text: &agentchannelv1.TextPayload{Body: "on my way"},
		},
	}

	// A8: replying into a conversation that does not exist is NOT_FOUND —
	// an uncapped, lever-free cold-send to an arbitrary number must be
	// unreachable through this lane.
	_, err := clients.ChannelConversationCommand.Reply(ctx,
		&agentchannelv1.ReplyToConversationInput{
			AgentChannelId:  channelID,
			ConversationKey: "15550005555",
			Payload:         payload,
		})
	requireStatusCode(t, err, codes.NotFound)

	// A9: the conversation exists but the channel was never installed —
	// the lane carries its own structural gates because it deliberately
	// never consults ChannelMessagingReach (DD-009 D-b).
	seeder := harness.NewChannelConversationSeeder(testHarness.AppPostgres)
	require.NoError(t, seeder.SeedConversation(ctx, harness.SeedConversationInput{
		AgentChannelID:  channelID,
		ConversationKey: "15550005555",
		Org:             org,
		DisplayName:     "Asha",
		LastActivityAt:  time.Now(),
	}))
	_, err = clients.ChannelConversationCommand.Reply(ctx,
		&agentchannelv1.ReplyToConversationInput{
			AgentChannelId:  channelID,
			ConversationKey: "15550005555",
			Payload:         payload,
		})
	requireStatusCode(t, err, codes.FailedPrecondition)

	// Every refusal above ran BEFORE the implicit-takeover flip: the
	// conversation must still be agent-held.
	list, err := clients.ChannelConversationQuery.ListConversations(ctx,
		&agentchannelv1.ListChannelConversationsInput{Org: org, AgentChannelId: channelID})
	require.NoError(t, err)
	require.Len(t, list.GetItems(), 1)
	assert.Equal(t, agentchannelv1.ConversationControl_control_agent,
		list.GetItems()[0].GetControl(),
		"a refused reply must never move the control token")
}

// TestChannelConversation_TakeoverSuppressionFrontDoor is the whole
// participation story through the real front door: a REAL install against
// the mock Graph, a REAL takeOver over RPC, then Meta-shaped signed
// webhooks from the customer. While a human holds the conversation the
// agent must stay silent — no execution machinery is spun up (zero
// conversation bindings), the inbound events settle ignored with the
// human_takeover reason, the customer receives EXACTLY ONE platform
// acknowledgment per takeover (DD-005 D-d), and the timeline shows that
// acknowledgment as platform-authored.
func TestChannelConversation_TakeoverSuppressionFrontDoor(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-frontdoor",
		"You are a test agent for the takeover suppression front door.")
	fx := applyWhatsAppChannel(t, ctx, clients, agent,
		"conv-frontdoor-"+agent.GetMetadata().GetSlug())

	// The REAL install flow: initiateInstall runs the Graph phone-number
	// read against the mock and stamps installed synchronously.
	installed, err := clients.AgentChannelCommand.InitiateInstall(ctx,
		&agentchannelv1.InitiateChannelInstallInput{ResourceId: fx.ChannelID})
	require.NoError(t, err, "WhatsApp install should complete against the mock Graph")
	require.True(t, installed.GetCompleted(), "WhatsApp install is direct — one RPC")

	const customer = "15550006666"
	seeder := harness.NewChannelConversationSeeder(testHarness.AppPostgres)
	require.NoError(t, seeder.SeedConversation(ctx, harness.SeedConversationInput{
		AgentChannelID:  fx.ChannelID,
		ConversationKey: customer,
		Org:             agent.GetMetadata().GetOrg(),
		DisplayName:     "Pat",
		LastActivityAt:  time.Now(),
	}))

	// The human takes over — the real RPC, which arms the once-per-takeover
	// acknowledgment claim by stamping control_changed_at.
	held, err := clients.ChannelConversationCommand.TakeOver(ctx,
		&agentchannelv1.ConversationControlInput{
			AgentChannelId:  fx.ChannelID,
			ConversationKey: customer,
		})
	require.NoError(t, err)
	require.Equal(t, agentchannelv1.ConversationControl_control_human, held.GetControl())

	// The customer writes in — a Meta-shaped, HMAC-signed webhook. The 200
	// is an ack, not a processing receipt; everything below polls durable
	// state.
	status, err := harness.PostWhatsAppWebhook(ctx, testHarness.Service.HTTPAddress(),
		fx.ChannelAppID, fx.AppSecret,
		harness.WhatsAppInboundTextPayload(fx.PhoneNumberID, customer,
			"wamid.FRONTDOOR1", "Pat", "are you there?"))
	require.NoError(t, err)
	require.Equal(t, 200, status)

	// Door 1 settles the event as ignored with the forensic reason — never
	// a failure, never dead-lettered (takeovers are counted as takeovers).
	requireEventIgnoredAsTakeover(t, ctx, fx.ChannelAppID, "wamid.FRONTDOOR1")

	// The one durable platform acknowledgment, delivered through the mock
	// Graph by the real outbound engine.
	require.Eventually(t, func() bool {
		count, queryErr := testHarness.AppPostgres.QueryScalar(ctx, fmt.Sprintf(
			`SELECT count(*) FROM s_agentic.channel_outbound_message
			  WHERE agent_channel_id = '%s' AND origin = 'platform' AND status = 'delivered'`,
			fx.ChannelID))
		return queryErr == nil && count == "1"
	}, 30*time.Second, 250*time.Millisecond,
		"exactly one delivered platform-origin acknowledgment row")

	// No execution machinery ran: a suppressed turn never reaches the
	// broker, so no session binding exists for this channel.
	bindings, err := testHarness.AppPostgres.QueryScalar(ctx, fmt.Sprintf(
		`SELECT count(*) FROM s_agentic.channel_conversation_binding
		  WHERE agent_channel_id = '%s'`, fx.ChannelID))
	require.NoError(t, err)
	assert.Equal(t, "0", bindings,
		"a suppressed inbound turn must create no session and no execution")

	// A second customer message during the SAME takeover: suppressed
	// silently — the acknowledgment is once per takeover, and the human is
	// expected to be replying.
	status, err = harness.PostWhatsAppWebhook(ctx, testHarness.Service.HTTPAddress(),
		fx.ChannelAppID, fx.AppSecret,
		harness.WhatsAppInboundTextPayload(fx.PhoneNumberID, customer,
			"wamid.FRONTDOOR2", "Pat", "hello??"))
	require.NoError(t, err)
	require.Equal(t, 200, status)
	requireEventIgnoredAsTakeover(t, ctx, fx.ChannelAppID, "wamid.FRONTDOOR2")

	ledgerCount, err := testHarness.AppPostgres.QueryScalar(ctx, fmt.Sprintf(
		`SELECT count(*) FROM s_agentic.channel_outbound_message
		  WHERE agent_channel_id = '%s' AND origin = 'platform'`, fx.ChannelID))
	require.NoError(t, err)
	assert.Equal(t, "1", ledgerCount,
		"the acknowledgment is ONCE per takeover — the second message is silent")

	// The provider saw exactly one business message, addressed to the
	// customer (the exact copy is the Java constant's to own).
	sends := mockWhatsAppGraph.SendsTo(fx.PhoneNumberID)
	require.Len(t, sends, 1, "one Graph send: the acknowledgment, nothing else")
	assert.Contains(t, sends[0].Body, fmt.Sprintf("%q:%q", "to", customer))

	// And the customer-visible record agrees: the timeline carries the
	// acknowledgment as PLATFORM-authored — rendering it as the agent
	// would be a lie (DD-004's author_platform vocabulary).
	timeline, err := clients.ChannelConversationQuery.GetTimeline(ctx,
		&agentchannelv1.GetConversationTimelineInput{
			AgentChannelId:  fx.ChannelID,
			ConversationKey: customer,
		})
	require.NoError(t, err)
	platformItems := 0
	for _, item := range timeline.GetItems() {
		if item.GetAuthor() == agentchannelv1.ConversationItemAuthor_author_platform {
			platformItems++
		}
	}
	assert.Equal(t, 1, platformItems,
		"the timeline shows the one platform acknowledgment")
}

// TestChannelConversation_StaffReplyDeliversThroughTheFrontDoor is the
// sitting's core promise end to end: a staff member replies through the
// same number the agent serves. The reply is an implicit takeover
// (DD-002 #1), rides the outbound engine as a participant-origin row, is
// delivered through the (mock) provider, renders on the timeline as
// teammate-authored — and IS the takeover acknowledgment (A10): the
// customer's next message is suppressed with NO platform copy, because
// they already saw a human's own words.
func TestChannelConversation_StaffReplyDeliversThroughTheFrontDoor(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-staff-reply",
		"You are a test agent for the staff reply front door.")
	fx := applyWhatsAppChannel(t, ctx, clients, agent,
		"conv-staff-reply-"+agent.GetMetadata().GetSlug())

	installed, err := clients.AgentChannelCommand.InitiateInstall(ctx,
		&agentchannelv1.InitiateChannelInstallInput{ResourceId: fx.ChannelID})
	require.NoError(t, err)
	require.True(t, installed.GetCompleted())

	const customer = "15550007777"
	seeder := harness.NewChannelConversationSeeder(testHarness.AppPostgres)
	require.NoError(t, seeder.SeedConversation(ctx, harness.SeedConversationInput{
		AgentChannelID:  fx.ChannelID,
		ConversationKey: customer,
		Org:             agent.GetMetadata().GetOrg(),
		DisplayName:     "Noor",
		LastActivityAt:  time.Now(),
	}))

	// The staff reply — one RPC, no explicit takeOver first. Note what is
	// deliberately ABSENT: the channel has proactive_messaging_enabled
	// false and no caps are consulted (DD-009 D-b/D-c live here).
	answer, err := clients.ChannelConversationCommand.Reply(ctx,
		&agentchannelv1.ReplyToConversationInput{
			AgentChannelId:  fx.ChannelID,
			ConversationKey: customer,
			Payload: &agentchannelv1.ChannelOutboundPayload{
				Kind: &agentchannelv1.ChannelOutboundPayload_Text{
					Text: &agentchannelv1.TextPayload{Body: "Hi, this is Sam from the team."},
				},
			},
		})
	require.NoError(t, err, "staff reply on a reply-only channel must succeed")
	require.Equal(t, agentchannelv1.ChannelSendOutcome_accepted, answer.GetOutcome(),
		"the mock provider accepts inline: %s", answer.GetDetail())
	assert.NotEmpty(t, answer.GetProviderMessageId(), "accepted carries the wamid")
	assert.NotEmpty(t, answer.GetOutboundMessageId(), "the durable audit handle")

	// The reply WAS the implicit takeover: the conversation is now
	// human-held by the caller, with no explicit takeOver ever issued.
	list, err := clients.ChannelConversationQuery.ListConversations(ctx,
		&agentchannelv1.ListChannelConversationsInput{
			Org: agent.GetMetadata().GetOrg(), AgentChannelId: fx.ChannelID})
	require.NoError(t, err)
	require.Len(t, list.GetItems(), 1)
	assert.Equal(t, agentchannelv1.ConversationControl_control_human,
		list.GetItems()[0].GetControl(), "a public staff reply flips control (DD-002 #1)")
	assert.Equal(t, harness.OwnerAccountID, list.GetItems()[0].GetControlledBy())

	// The ledger row is participant-origin — distinguishable from a
	// console cold-send and from the agent, exempt from the cap counters
	// by the V24 predicate.
	origin, err := testHarness.AppPostgres.QueryScalar(ctx, fmt.Sprintf(
		`SELECT origin FROM s_agentic.channel_outbound_message
		  WHERE outbound_message_id = '%s'`, answer.GetOutboundMessageId()))
	require.NoError(t, err)
	assert.Equal(t, "participant", origin)

	// A10, end to end: the reply consumed the acknowledgment claim, so the
	// customer's next message is suppressed SILENTLY — a platform copy
	// right after the human's own words would read as a bot talking over
	// them.
	status, err := harness.PostWhatsAppWebhook(ctx, testHarness.Service.HTTPAddress(),
		fx.ChannelAppID, fx.AppSecret,
		harness.WhatsAppInboundTextPayload(fx.PhoneNumberID, customer,
			"wamid.STAFFREPLY1", "Noor", "thanks Sam!"))
	require.NoError(t, err)
	require.Equal(t, 200, status)
	requireEventIgnoredAsTakeover(t, ctx, fx.ChannelAppID, "wamid.STAFFREPLY1")

	platformRows, err := testHarness.AppPostgres.QueryScalar(ctx, fmt.Sprintf(
		`SELECT count(*) FROM s_agentic.channel_outbound_message
		  WHERE agent_channel_id = '%s' AND origin = 'platform'`, fx.ChannelID))
	require.NoError(t, err)
	assert.Equal(t, "0", platformRows,
		"the staff reply IS the acknowledgment — no platform copy follows it (A10)")

	// The provider saw exactly one business message: the staff reply.
	sends := mockWhatsAppGraph.SendsTo(fx.PhoneNumberID)
	require.Len(t, sends, 1)
	assert.Contains(t, sends[0].Body, "Hi, this is Sam from the team.")

	// And the timeline renders it as teammate-authored — never the agent's
	// words, never the platform's.
	timeline, err := clients.ChannelConversationQuery.GetTimeline(ctx,
		&agentchannelv1.GetConversationTimelineInput{
			AgentChannelId:  fx.ChannelID,
			ConversationKey: customer,
		})
	require.NoError(t, err)
	teammateItems := 0
	for _, item := range timeline.GetItems() {
		if item.GetAuthor() == agentchannelv1.ConversationItemAuthor_author_teammate {
			teammateItems++
		}
	}
	assert.Equal(t, 1, teammateItems, "the staff reply is teammate-authored on the timeline")
}

// ─────────────────────────────────────────────────────────────────────────────
// The escalation ingest (T03 Sitting 4)
// ─────────────────────────────────────────────────────────────────────────────

// TestChannelConversation_EscalationLifecycleFrontDoor walks the whole
// attention lifecycle through the real front door (DD-008): a customer
// webhook creates the session and conversation, the AGENT'S OWN sandbox
// credential escalates (identity derived server-side from the session's
// labels — the input carries only the reason), repeated escalation is
// idempotent with the latest reason winning and history accumulating, the
// escalation renders on the timeline as an internal-lane agent-authored
// item, clearAttention dismisses in place without touching control, and a
// takeover answers a fresh escalation by clearing it in the same motion
// (A12) — every projection change leaving its event behind.
func TestChannelConversation_EscalationLifecycleFrontDoor(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-escalation",
		"You are a test agent for the escalation lifecycle.")
	fx := applyWhatsAppChannel(t, ctx, clients, agent,
		"conv-escalation-"+agent.GetMetadata().GetSlug())

	installed, err := clients.AgentChannelCommand.InitiateInstall(ctx,
		&agentchannelv1.InitiateChannelInstallInput{ResourceId: fx.ChannelID})
	require.NoError(t, err)
	require.True(t, installed.GetCompleted())

	// The customer writes in on an AGENT-HELD conversation: the routed turn
	// creates the session (labels stamped server-side), the binding, and
	// upserts the conversation row — no seeder, the true front door.
	const customer = "15550008888"
	status, err := harness.PostWhatsAppWebhook(ctx, testHarness.Service.HTTPAddress(),
		fx.ChannelAppID, fx.AppSecret,
		harness.WhatsAppInboundTextPayload(fx.PhoneNumberID, customer,
			"wamid.ESCALATE1", "Noor", "I need help with a refund"))
	require.NoError(t, err)
	require.Equal(t, 200, status)

	// The broker's binding row carries the session id — the same identity
	// the production sandbox token would be minted for.
	var sessionID string
	require.Eventually(t, func() bool {
		id, queryErr := testHarness.AppPostgres.QueryScalar(ctx, fmt.Sprintf(
			`SELECT session_id FROM s_agentic.channel_conversation_binding
			  WHERE agent_channel_id = '%s' AND conversation_key = '%s'`,
			fx.ChannelID, customer))
		sessionID = id
		return queryErr == nil && sessionID != ""
	}, 30*time.Second, 250*time.Millisecond,
		"the routed turn must create the session binding")

	// The agent's credential: a session-scoped sandbox token, exactly what
	// SandboxTokenService injects into the provisioned sandbox.
	sandboxToken, err := harness.MintSandboxToken(harness.OwnerAccountID, sessionID)
	require.NoError(t, err)
	agentClients := harness.NewClients(harness.GRPCConnWithBearer(t,
		testHarness.Service.GRPCAddress(), sandboxToken))

	// The agent escalates. Note what the input does NOT carry: no channel
	// id, no conversation key — the DD-003 identity doctrine, end to end.
	flagged, err := agentClients.ChannelConversationCommand.Escalate(ctx,
		&agentchannelv1.EscalateConversationInput{Reason: "customer needs a refund decision"})
	require.NoError(t, err, "the channel session's own credential escalates")
	assert.True(t, flagged.GetNeedsAttention())
	assert.Equal(t, "customer needs a refund decision", flagged.GetAttentionReason())
	assert.Equal(t, agentchannelv1.ConversationControl_control_agent, flagged.GetControl(),
		"escalate-and-continue: the agent keeps serving (DD-008 D-a)")

	// Repeated escalation: idempotent, latest reason wins, history grows.
	flagged, err = agentClients.ChannelConversationCommand.Escalate(ctx,
		&agentchannelv1.EscalateConversationInput{Reason: "customer is getting upset"})
	require.NoError(t, err, "repeated escalation is harmless (DD-008 D-b)")
	assert.Equal(t, "customer is getting upset", flagged.GetAttentionReason())
	requireEventCount(t, ctx, fx.ChannelID, customer, "escalation", 2)

	// The event's actor is the SESSION (A11) — the durable agent-side
	// identity the token actually carries, never a guessed execution.
	actor, err := testHarness.AppPostgres.QueryScalar(ctx, fmt.Sprintf(
		`SELECT DISTINCT actor FROM s_agentic.channel_conversation_event
		  WHERE agent_channel_id = '%s' AND conversation_key = '%s'
		    AND kind = 'escalation'`, fx.ChannelID, customer))
	require.NoError(t, err)
	assert.Equal(t, sessionID, actor)

	// The timeline carries the escalation on the INTERNAL lane, agent-
	// authored — the fourth source (DD-004 D-a), with the customer's own
	// message on the public lane beside it.
	timeline, err := clients.ChannelConversationQuery.GetTimeline(ctx,
		&agentchannelv1.GetConversationTimelineInput{
			AgentChannelId:  fx.ChannelID,
			ConversationKey: customer,
		})
	require.NoError(t, err)
	internalItems := 0
	for _, item := range timeline.GetItems() {
		if item.GetLane() == agentchannelv1.ConversationLane_lane_internal {
			internalItems++
			assert.Equal(t, agentchannelv1.ConversationItemAuthor_author_agent,
				item.GetAuthor(), "an escalation is the agent's own act")
			assert.Empty(t, item.GetAuthoredBy(),
				"a session actor never masquerades as a teammate identity")
		}
	}
	assert.Equal(t, 2, internalItems, "both escalations are timeline history")

	// The false-alarm dismissal: attention clears in place, control never
	// moves, and the clear leaves its own event (DD-008 D-f).
	controlInput := &agentchannelv1.ConversationControlInput{
		AgentChannelId:  fx.ChannelID,
		ConversationKey: customer,
	}
	dismissed, err := clients.ChannelConversationCommand.ClearAttention(ctx, controlInput)
	require.NoError(t, err, "owner clearAttention should succeed (owner ⊆ participant)")
	assert.False(t, dismissed.GetNeedsAttention())
	assert.Empty(t, dismissed.GetAttentionReason(), "the row shows current state; history keeps the words")
	assert.Equal(t, agentchannelv1.ConversationControl_control_agent, dismissed.GetControl())
	requireEventCount(t, ctx, fx.ChannelID, customer, "attention_cleared", 1)

	// A second dismissal is idempotent success — and appends NOTHING (the
	// guarded-clear rule: a projection that changed nothing owes no history).
	dismissed, err = clients.ChannelConversationCommand.ClearAttention(ctx, controlInput)
	require.NoError(t, err, "clearing an already-clear conversation is an answer")
	assert.False(t, dismissed.GetNeedsAttention())
	requireEventCount(t, ctx, fx.ChannelID, customer, "attention_cleared", 1)

	// A fresh escalation answered by a TAKEOVER: the arriving human clears
	// the flag in the same atomic motion as the CAS (A12 / DD-008 D-f).
	_, err = agentClients.ChannelConversationCommand.Escalate(ctx,
		&agentchannelv1.EscalateConversationInput{Reason: "still stuck"})
	require.NoError(t, err)
	held, err := clients.ChannelConversationCommand.TakeOver(ctx, controlInput)
	require.NoError(t, err)
	assert.Equal(t, agentchannelv1.ConversationControl_control_human, held.GetControl())
	assert.False(t, held.GetNeedsAttention(), "the human arrived — the escalation is answered")
	requireEventCount(t, ctx, fx.ChannelID, customer, "attention_cleared", 2)
}

// TestChannelConversation_EscalateRefusesNonConversationCallers pins the
// agent-audience boundary (DD-008 D-d): escalate trusts ONLY a session-
// scoped sandbox credential whose session carries the server-stamped
// channel labels. Direct principals, broken chains, and healthy console
// sessions are each refused with their own honest answer — these are the
// tests that fail if the reach is ever weakened or bypassed.
func TestChannelConversation_EscalateRefusesNonConversationCallers(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	input := &agentchannelv1.EscalateConversationInput{Reason: "should never land"}

	// A direct human principal is refused: humans escalate by taking the
	// conversation over, never by borrowing the agent's ingest.
	_, err := clients.ChannelConversationCommand.Escalate(ctx, input)
	requireStatusCode(t, err, codes.PermissionDenied)

	// A sandbox credential whose session does not exist: a broken chain.
	ghostToken, err := harness.MintSandboxToken(harness.OwnerAccountID, "ses_does_not_exist")
	require.NoError(t, err)
	ghost := harness.NewClients(harness.GRPCConnWithBearer(t,
		testHarness.Service.GRPCAddress(), ghostToken))
	_, err = ghost.ChannelConversationCommand.Escalate(ctx, input)
	requireStatusCode(t, err, codes.PermissionDenied)

	// A HEALTHY console session of a real agent — no channel labels, so
	// there is genuinely nothing to escalate: FAILED_PRECONDITION, the
	// honest structural answer the model can adapt to (stop calling the
	// tool), never an authority error.
	agent := harness.CreateAgent(t, ctx, clients, "test-conv-escalate-console",
		"You are a test agent for the console-session escalate refusal.")
	instance, err := clients.AgentInstanceCommand.Create(ctx, &agentinstancev1.AgentInstance{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "AgentInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "conv-escalate-console-inst",
			Org:  agent.GetMetadata().GetOrg(),
		},
		Spec: &agentinstancev1.AgentInstanceSpec{AgentId: agent.GetMetadata().GetId()},
	})
	require.NoError(t, err)
	session := harness.CreateTestSession(t, ctx, clients,
		instance.GetMetadata().GetId(), sessionv1.Harness_HARNESS_NATIVE)
	consoleToken, err := harness.MintSandboxToken(
		harness.OwnerAccountID, session.GetMetadata().GetId())
	require.NoError(t, err)
	console := harness.NewClients(harness.GRPCConnWithBearer(t,
		testHarness.Service.GRPCAddress(), consoleToken))
	_, err = console.ChannelConversationCommand.Escalate(ctx, input)
	requireStatusCode(t, err, codes.FailedPrecondition)
}

// requireEventCount polls until the conversation's internal-lane event
// store holds exactly want rows of the given kind — escalation writes are
// transactional but the assertion reads through a separate connection, so
// polling keeps the test calm without ever sleeping blind.
func requireEventCount(t *testing.T, ctx context.Context,
	channelID, conversationKey, kind string, want int) {
	t.Helper()
	require.Eventually(t, func() bool {
		count, err := testHarness.AppPostgres.QueryScalar(ctx, fmt.Sprintf(
			`SELECT count(*) FROM s_agentic.channel_conversation_event
			  WHERE agent_channel_id = '%s' AND conversation_key = '%s'
			    AND kind = '%s'`, channelID, conversationKey, kind))
		return err == nil && count == fmt.Sprintf("%d", want)
	}, 15*time.Second, 250*time.Millisecond,
		"expected %d %s event(s) for conversation %s", want, kind, conversationKey)
}

// requireEventIgnoredAsTakeover polls until one webhook event settles as
// ignored with the human_takeover forensic reason (DD-005 D-b's terminal
// state for a suppressed turn).
func requireEventIgnoredAsTakeover(t *testing.T, ctx context.Context,
	channelAppID, messageID string) {
	t.Helper()
	require.Eventually(t, func() bool {
		settled, err := testHarness.AppPostgres.QueryScalar(ctx, fmt.Sprintf(
			`SELECT status || ':' || coalesce(ignore_reason, '')
			   FROM s_agentic.whatsapp_webhook_event
			  WHERE message_id = '%s' AND channel_app_id = '%s'`,
			messageID, channelAppID))
		return err == nil && settled == "ignored:human_takeover"
	}, 30*time.Second, 250*time.Millisecond,
		"webhook event %s must settle ignored:human_takeover", messageID)
}
