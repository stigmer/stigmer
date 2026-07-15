//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	channelappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/channelapp/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// This file covers the ChannelApp resource's wire contract against the
// cloud backend (this suite boots the stigmer-service fat JAR — see
// suite_test.go): the secret round-trip (encrypted at rest, redacted in
// every response, marker-preserving re-apply), the channel binding via
// spec.app_ref, and the referential-integrity delete block. The
// edition-specific pipelines are pinned in each edition's own controller
// suites; this asserts the shared contract over the wire (T04 item 2).

const redactedMarker = "***REDACTED***"

// channelAppFor builds a Slack ChannelApp manifest as a YAML apply would
// send it.
func channelAppFor(org, name string) *channelappv1.ChannelApp {
	return &channelappv1.ChannelApp{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "ChannelApp",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  org,
		},
		Spec: &channelappv1.ChannelAppSpec{
			ProviderConfig: &channelappv1.ChannelAppSpec_Slack{
				Slack: &channelappv1.SlackChannelAppConfig{
					ClientId:      "1234.5678",
					ClientSecret:  "integration-client-secret",
					SigningSecret: "integration-signing-secret",
				},
			},
		},
	}
}

// TestChannelApp_SecretRoundTrip verifies the declarative secret
// lifecycle: apply creates the app with both secrets redacted in the
// response, get stays redacted, and re-applying the fetched (redacted)
// manifest preserves the stored secrets instead of wiping them — the
// marker convention that makes `stigmer get | stigmer apply` safe.
func TestChannelApp_SecretRoundTrip(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	org := harness.TestOrg

	created, err := clients.ChannelAppCommand.Apply(ctx, channelAppFor(org, "round-trip-app"))
	require.NoError(t, err, "apply should create the channel app")
	assert.Contains(t, created.GetMetadata().GetId(), "chapp",
		"the id must carry the chapp prefix")
	assert.Equal(t, redactedMarker, created.GetSpec().GetSlack().GetClientSecret(),
		"client_secret must be redacted in the apply response")
	assert.Equal(t, redactedMarker, created.GetSpec().GetSlack().GetSigningSecret(),
		"signing_secret must be redacted in the apply response")

	fetched, err := clients.ChannelAppQuery.Get(ctx, &apiresource.ApiResourceId{
		Value: created.GetMetadata().GetId()})
	require.NoError(t, err)
	assert.Equal(t, redactedMarker, fetched.GetSpec().GetSlack().GetClientSecret(),
		"get must redact secrets")

	// The declarative loop: re-apply the fetched manifest verbatim. The
	// markers must be accepted and preserve the stored values.
	reapplied, err := clients.ChannelAppCommand.Apply(ctx, fetched)
	require.NoError(t, err, "re-applying a fetched (redacted) manifest must succeed")
	assert.Equal(t, created.GetMetadata().GetId(), reapplied.GetMetadata().GetId(),
		"re-apply must update in place, never duplicate")

	list, err := clients.ChannelAppQuery.ListByOrg(ctx, &channelappv1.ListChannelAppsByOrgInput{Org: org})
	require.NoError(t, err)
	require.NotEmpty(t, list.GetEntries())
	for _, entry := range list.GetEntries() {
		assert.Equal(t, redactedMarker, entry.GetSpec().GetSlack().GetSigningSecret(),
			"listByOrg must redact every entry")
	}
}

// TestChannelApp_AppRefBindingAndDeleteBlock verifies the channel-side
// binding: a channel binds the app via spec.app_ref (empty ref org
// normalizes to the channel's org), a cross-org app_ref is refused, and
// the referenced app cannot be deleted until the channel releases it.
func TestChannelApp_AppRefBindingAndDeleteBlock(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-channel-app-binding",
		"You are a test agent for BYO channel app verification.")
	org := agent.GetMetadata().GetOrg()

	app, err := clients.ChannelAppCommand.Apply(ctx, channelAppFor(org, "binding-app"))
	require.NoError(t, err)

	// Bind: empty app_ref org must normalize to the channel's org.
	channel := channelFor(agent, "byo-slack-"+agent.GetMetadata().GetSlug(), true)
	channel.Spec.AppRef = &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_channel_app,
		Slug: app.GetMetadata().GetSlug(),
	}
	boundChannel, err := clients.AgentChannelCommand.Apply(ctx, channel)
	require.NoError(t, err, "apply with app_ref should succeed")
	assert.Equal(t, org, boundChannel.GetSpec().GetAppRef().GetOrg(),
		"an empty app_ref org must normalize to the channel's org")

	// Cross-org app_ref is refused (secrets never cross orgs).
	crossOrg := channelFor(agent, "cross-org-app-slack-"+agent.GetMetadata().GetSlug(), true)
	crossOrg.Spec.AppRef = &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_channel_app,
		Org:  "some-other-org",
		Slug: app.GetMetadata().GetSlug(),
	}
	_, err = clients.AgentChannelCommand.Apply(ctx, crossOrg)
	require.Error(t, err)
	assert.Equal(t, codes.FailedPrecondition, status.Code(err),
		"a cross-org app_ref must be FAILED_PRECONDITION")

	// The referenced app cannot be deleted while the channel holds it.
	_, err = clients.ChannelAppCommand.Delete(ctx, &apiresource.ApiResourceDeleteInput{
		ResourceId: app.GetMetadata().GetId()})
	require.Error(t, err)
	assert.Equal(t, codes.FailedPrecondition, status.Code(err),
		"delete must be blocked while a channel references the app")

	// Release the channel, then deletion succeeds.
	_, err = clients.AgentChannelCommand.Delete(ctx, &agentchannelv1.AgentChannelId{
		Value: boundChannel.GetMetadata().GetId()})
	require.NoError(t, err, "channel delete should succeed")

	deleted, err := clients.ChannelAppCommand.Delete(ctx, &apiresource.ApiResourceDeleteInput{
		ResourceId: app.GetMetadata().GetId()})
	require.NoError(t, err, "app delete should succeed once unreferenced")
	assert.Equal(t, redactedMarker, deleted.GetSpec().GetSlack().GetClientSecret(),
		"the delete response must be redacted like every other response")
}
