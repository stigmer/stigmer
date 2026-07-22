package agentshare

import (
	"context"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// These tests pin the DD-010 SD-6 no-public-exposure guard end to end,
// in both directions, across both controllers: a datastore-attached
// agent can never be public (visibility) or served to anonymous guests
// (public-audience share), and neither switch can be reached in either
// order. Every refusal message asserted here is cross-edition contract
// text (T04 mirrors byte-for-byte).

// saveDatastore writes a minimal datastore fixture directly to the
// store (the established cross-domain fixture pattern — these tests
// exercise the agent/share guards, not the datastore lifecycle).
func saveDatastore(t *testing.T, tc *testControllers, id, org, slug string) {
	t.Helper()
	ds := &datastorev1.Datastore{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Datastore",
		Metadata: &apiresource.ApiResourceMetadata{
			Id: id, Name: slug, Slug: slug, Org: org,
		},
	}
	if err := tc.store.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_datastore, id, ds); err != nil {
		t.Fatalf("failed to save datastore %s: %v", id, err)
	}
}

// withClinicUsage returns the agent's spec with a clinic datastore usage
// attached (for update calls, which replace the spec wholesale).
func withClinicUsage(agent *agentv1.Agent) *agentv1.Agent {
	agent.Spec.DatastoreUsages = []*agentv1.DatastoreUsage{{
		DatastoreRef: &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_datastore, Slug: "clinic",
		},
	}}
	return agent
}

func TestDatastoreExposureGuard_PublicAudienceShareRefused(t *testing.T) {
	tc := newTestControllers(t)
	saveDatastore(t, tc, "dst_guard1", "test-org", "clinic")

	agent := createTestAgent(t, tc, "Clinic Assistant")
	agent, err := tc.agents.Update(agentCtx(), withClinicUsage(agent))
	require.NoError(t, err, "attaching a datastore to a private agent is fine")

	t.Run("public-audience share refused with the contract message", func(t *testing.T) {
		_, err := tc.shares.Create(shareCtx(), shareFor(agent, true)) // audience omitted = public
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Equal(t,
			"agent test-org/clinic-assistant uses datastores (clinic): a public-audience share would expose them to anonymous guests — set spec.audience to agent_share_audience_org",
			st.Message())
	})

	t.Run("org-audience share allowed", func(t *testing.T) {
		share := shareFor(agent, true)
		share.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
		created, err := tc.shares.Create(shareCtx(), share)
		require.NoError(t, err, "org members are inside the datastore's trust boundary")

		t.Run("flipping the share to public on update is refused", func(t *testing.T) {
			created.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_public
			_, err := tc.shares.Update(shareCtx(), created)
			require.Error(t, err)
			st := status.Convert(err)
			assert.Equal(t, codes.FailedPrecondition, st.Code())
			assert.Contains(t, st.Message(), "a public-audience share would expose them to anonymous guests")
		})
	})
}

func TestDatastoreExposureGuard_VisibilityDirection(t *testing.T) {
	tc := newTestControllers(t)
	saveDatastore(t, tc, "dst_guard2", "test-org", "clinic")

	t.Run("datastore-attached agent cannot be made public", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Records Agent")
		agent, err := tc.agents.Update(agentCtx(), withClinicUsage(agent))
		require.NoError(t, err)

		_, err = tc.agents.UpdateVisibility(agentCtx(), &apiresource.UpdateVisibilityInput{
			ResourceId: agent.GetMetadata().GetId(),
			Visibility: apiresource.ApiResourceVisibility_visibility_public,
		})
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Equal(t,
			`agent "records-agent" cannot be public while it uses datastores (clinic): multi-tenant datastore sharing is not supported — keep the agent private or org-visible, or remove its datastore_usages`,
			st.Message())

		t.Run("org visibility stays allowed", func(t *testing.T) {
			_, err := tc.agents.UpdateVisibility(agentCtx(), &apiresource.UpdateVisibilityInput{
				ResourceId: agent.GetMetadata().GetId(),
				Visibility: apiresource.ApiResourceVisibility_visibility_org,
			})
			require.NoError(t, err)
		})
	})

	t.Run("reverse: attaching a datastore to a public agent is refused", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Marketplace Agent")
		agent = makeAgentPublic(t, tc, agent)

		_, err := tc.agents.Update(agentCtx(), withClinicUsage(agent))
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Contains(t, st.Message(), "cannot be public while it uses datastores (clinic)")
	})

	t.Run("creating a public agent with datastores is refused", func(t *testing.T) {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "Born Public", Org: "test-org",
				Visibility: apiresource.ApiResourceVisibility_visibility_public,
			},
			Spec: &agentv1.AgentSpec{
				Description:  "agent for guard tests",
				Instructions: "You are a helpful agent.",
			},
		}
		withClinicUsage(agent)

		_, err := tc.agents.Create(agentCtx(), agent)
		require.Error(t, err)
		assert.Equal(t, codes.FailedPrecondition, status.Convert(err).Code())
	})
}

func TestDatastoreExposureGuard_ReverseShareDirection(t *testing.T) {
	tc := newTestControllers(t)
	saveDatastore(t, tc, "dst_guard3", "test-org", "clinic")

	// A public-audience share of a datastore-free agent is legitimate...
	agent := createTestAgent(t, tc, "Shared Helper")
	share := createTestShare(t, tc, agent, true) // audience omitted = public

	// ...but then attaching a datastore must be refused, naming the
	// blocking share.
	_, err := tc.agents.Update(agentCtx(), withClinicUsage(agent))
	require.Error(t, err)
	st := status.Convert(err)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Equal(t,
		`agent "shared-helper" uses datastores (clinic) and is referenced by public-audience shares (shared-helper): datastores cannot be exposed to anonymous guests — set those shares to org audience first`,
		st.Message())

	// Setting the share to org audience unblocks the attachment.
	share.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
	_, err = tc.shares.Update(shareCtx(), share)
	require.NoError(t, err)

	_, err = tc.agents.Update(agentCtx(), withClinicUsage(agent))
	require.NoError(t, err, "org-audience shares are inside the trust boundary")
}
