package agentchannel

import (
	"context"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	agentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agent/controller"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// The exact error strings shared with the cloud edition (T02 Phase E
// parity contract — the backend-engineer rule: same error contracts in
// both editions). Sourced from AgentChannelDefaultsResolver and
// AgentChannelUpdateHandler.ValidateChannelUpdate in stigmer-cloud; a
// change on either side must change both.
const (
	crossOrgMessage          = "spec.agent_ref.org must match metadata.org — an agent channel must live in the referenced agent's organization (%s)"
	refImmutableMessage      = "spec.agent_ref is immutable (channel connects %s/%s) — create a new channel to connect a different agent"
	providerImmutableMessage = "spec provider is immutable (channel provider is %s) — create a new channel for a different provider"
)

// contextWithKind simulates the apiresource interceptor, which injects the
// RPC's resource kind into the request context in production.
func contextWithKind(kind apiresourcekind.ApiResourceKind) context.Context {
	return context.WithValue(context.Background(), apiresourceinterceptor.ApiResourceKindKey, kind)
}

func channelCtx() context.Context {
	return contextWithKind(apiresourcekind.ApiResourceKind_agent_channel)
}

func agentCtx() context.Context {
	return contextWithKind(apiresourcekind.ApiResourceKind_agent)
}

type testControllers struct {
	store    store.Store
	channels *AgentChannelController
	agents   *agentcontroller.AgentController
}

func newTestControllers(t *testing.T) *testControllers {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return &testControllers{
		store:    s,
		channels: NewAgentChannelController(s),
		agents:   agentcontroller.NewAgentController(s, nil),
	}
}

func createTestAgentInOrg(t *testing.T, tc *testControllers, name, org string) *agentv1.Agent {
	t.Helper()
	created, err := tc.agents.Create(agentCtx(), &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  org,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Agent for channel tests",
			Instructions: "You are a helpful agent for channel verification.",
		},
	})
	if err != nil {
		t.Fatalf("agent Create failed: %v", err)
	}
	return created
}

func createTestAgent(t *testing.T, tc *testControllers, name string) *agentv1.Agent {
	t.Helper()
	return createTestAgentInOrg(t, tc, name, "test-org")
}

// channelFor builds a named Slack channel for an agent. Unlike shares,
// channels have no canonical-slug default (P7: N-per-agent), so tests
// always provide a name for the generic derive-from-name slug.
func channelFor(agent *agentv1.Agent, name string, enabled bool) *agentchannelv1.AgentChannel {
	return &agentchannelv1.AgentChannel{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentChannel",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  agent.GetMetadata().GetOrg(),
		},
		Spec: &agentchannelv1.AgentChannelSpec{
			AgentRef: &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_agent,
				Slug: agent.GetMetadata().GetSlug(),
			},
			Enabled: enabled,
			ProviderConfig: &agentchannelv1.AgentChannelSpec_Slack{
				Slack: &agentchannelv1.SlackChannelConfig{},
			},
		},
	}
}

func createTestChannel(t *testing.T, tc *testControllers, agent *agentv1.Agent, name string, enabled bool) *agentchannelv1.AgentChannel {
	t.Helper()
	created, err := tc.channels.Create(channelCtx(), channelFor(agent, name, enabled))
	if err != nil {
		t.Fatalf("channel Create failed: %v", err)
	}
	return created
}

func TestAgentChannelController_Create(t *testing.T) {
	tc := newTestControllers(t)

	t.Run("creates with ach_ prefix, normalized ref, pending_install", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Create Basics Agent")
		channel := createTestChannel(t, tc, agent, "Slack Workspace", true)

		if !strings.HasPrefix(channel.GetMetadata().GetId(), "ach_") {
			t.Errorf("channel id should carry the ach_ prefix, got %q", channel.GetMetadata().GetId())
		}
		if got := channel.GetSpec().GetAgentRef().GetOrg(); got != agent.GetMetadata().GetOrg() {
			t.Errorf("agent_ref.org should be normalized to the channel org, got %q", got)
		}
		if got := channel.GetStatus().GetInstallState(); got != agentchannelv1.AgentChannelInstallState_pending_install {
			t.Errorf("a new channel must initialize status.install_state = pending_install, got %v", got)
		}
	})

	t.Run("no slug default from the agent — name derives the slug (P7)", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Slug Discipline Agent")
		channel := createTestChannel(t, tc, agent, "Team Slack", true)

		if got := channel.GetMetadata().GetSlug(); got != "team-slack" {
			t.Errorf("slug must derive from the channel's own name, got %q", got)
		}
		if channel.GetMetadata().GetSlug() == agent.GetMetadata().GetSlug() {
			t.Error("a channel must never default to the agent's slug (channels are N-per-agent)")
		}
	})

	t.Run("nameless and slugless channel is INVALID_ARGUMENT, never agent-slug fallback", func(t *testing.T) {
		agent := createTestAgent(t, tc, "No Name Agent")
		channel := channelFor(agent, "", true)

		_, err := tc.channels.Create(channelCtx(), channel)
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for a nameless channel, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("client-provided status is discarded, never trusted", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Status Forgery Agent")
		channel := channelFor(agent, "Forged Status Channel", true)
		channel.Status = &agentchannelv1.AgentChannelStatus{
			InstallState: agentchannelv1.AgentChannelInstallState_installed,
		}

		created, err := tc.channels.Create(channelCtx(), channel)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		if got := created.GetStatus().GetInstallState(); got != agentchannelv1.AgentChannelInstallState_pending_install {
			t.Errorf("client-provided install_state must be replaced with pending_install, got %v", got)
		}
	})

	t.Run("missing org is INVALID_ARGUMENT with the shared copy", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Orgless Channel Agent")
		channel := channelFor(agent, "Orgless Channel", true)
		channel.Metadata.Org = ""

		_, err := tc.channels.Create(channelCtx(), channel)
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected INVALID_ARGUMENT for missing org, got %s (%v)", status.Code(err), err)
		}
		if got := status.Convert(err).Message(); got != "metadata.org is required for an agent channel" {
			t.Errorf("missing-org copy must match the cloud edition, got %q", got)
		}
	})

	t.Run("missing agent_ref slug is INVALID_ARGUMENT", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Refless Channel Agent")
		channel := channelFor(agent, "Refless Channel", true)
		channel.Spec.AgentRef.Slug = ""

		// The proto constraint (buf.validate on agent_ref.slug) refuses
		// this before the resolver runs — in BOTH editions, whose
		// pipelines validate proto constraints first. The resolver's own
		// slug branch remains as defense-in-depth, mirroring the cloud
		// resolver; the wire contract at this layer is protovalidate's.
		_, err := tc.channels.Create(channelCtx(), channel)
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("expected INVALID_ARGUMENT for missing ref slug, got %s (%v)", status.Code(err), err)
		}
		if !strings.Contains(status.Convert(err).Message(), "spec.agent_ref.slug") {
			t.Errorf("the refusal should name the offending field, got %q", status.Convert(err).Message())
		}
	})

	t.Run("nonexistent agent is NOT_FOUND with the direct-lookup copy", func(t *testing.T) {
		channel := &agentchannelv1.AgentChannel{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentChannel",
			Metadata:   &apiresource.ApiResourceMetadata{Name: "Ghost Channel", Org: "test-org"},
			Spec: &agentchannelv1.AgentChannelSpec{
				AgentRef: &apiresource.ApiResourceReference{
					Kind: apiresourcekind.ApiResourceKind_agent,
					Slug: "no-such-agent",
				},
				Enabled: true,
				ProviderConfig: &agentchannelv1.AgentChannelSpec_Slack{
					Slack: &agentchannelv1.SlackChannelConfig{},
				},
			},
		}

		_, err := tc.channels.Create(channelCtx(), channel)
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND for a channel of a nonexistent agent, got %s (%v)", status.Code(err), err)
		}
		if got := status.Convert(err).Message(); got != "Agent not found: no-such-agent" {
			t.Errorf("not-found copy must be byte-identical with the direct agent lookup, got %q", got)
		}
	})

	t.Run("cross-org agent_ref is FAILED_PRECONDITION with the shared copy", func(t *testing.T) {
		agent := createTestAgentInOrg(t, tc, "Foreign Agent", "other-org")
		channel := channelFor(agent, "Cross Org Channel", true)
		channel.Metadata.Org = "test-org"
		channel.Spec.AgentRef.Org = "other-org"

		_, err := tc.channels.Create(channelCtx(), channel)
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FAILED_PRECONDITION for a cross-org ref, got %s (%v)", status.Code(err), err)
		}
		want := strings.Replace(crossOrgMessage, "%s", "other-org", 1)
		if got := status.Convert(err).Message(); got != want {
			t.Errorf("cross-org copy must match the cloud edition:\n  want %q\n  got  %q", want, got)
		}
	})

	t.Run("cross-org refusal precedes the agent load — no slug probing", func(t *testing.T) {
		// The referenced slug does NOT exist in the foreign org; the
		// refusal must still be the invariant's FAILED_PRECONDITION, not
		// NOT_FOUND — this path must never disclose whether a foreign
		// org's slug exists.
		channel := &agentchannelv1.AgentChannel{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentChannel",
			Metadata:   &apiresource.ApiResourceMetadata{Name: "Probe Channel", Org: "test-org"},
			Spec: &agentchannelv1.AgentChannelSpec{
				AgentRef: &apiresource.ApiResourceReference{
					Kind: apiresourcekind.ApiResourceKind_agent,
					Org:  "some-foreign-org",
					Slug: "possibly-private-slug",
				},
				Enabled: true,
				ProviderConfig: &agentchannelv1.AgentChannelSpec_Slack{
					Slack: &agentchannelv1.SlackChannelConfig{},
				},
			},
		}

		_, err := tc.channels.Create(channelCtx(), channel)
		if status.Code(err) != codes.FailedPrecondition {
			t.Errorf("cross-org refusal must fire before the agent load, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("duplicate org+slug is ALREADY_EXISTS", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Duplicate Channel Agent")
		createTestChannel(t, tc, agent, "Duplicate Slack", true)

		_, err := tc.channels.Create(channelCtx(), channelFor(agent, "Duplicate Slack", true))
		if status.Code(err) != codes.AlreadyExists {
			t.Errorf("expected ALREADY_EXISTS for a duplicate channel slug, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("missing provider arm is INVALID_ARGUMENT (required oneof)", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Providerless Agent")
		channel := channelFor(agent, "Providerless Channel", true)
		channel.Spec.ProviderConfig = nil

		_, err := tc.channels.Create(channelCtx(), channel)
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for a missing provider arm, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("two channels for one agent coexist under distinct slugs", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Multi Channel Agent")
		first := createTestChannel(t, tc, agent, "Sales Slack", true)
		second := createTestChannel(t, tc, agent, "Support Slack", true)

		if first.GetMetadata().GetSlug() == second.GetMetadata().GetSlug() {
			t.Error("distinct channels must carry distinct slugs")
		}
	})
}

func TestAgentChannelController_Update(t *testing.T) {
	tc := newTestControllers(t)

	t.Run("disable is a config-preserving pause; status survives", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Pause Agent")
		created := createTestChannel(t, tc, agent, "Pausable Slack", true)

		paused := created
		paused.Spec.Enabled = false
		// A manifest apply sends no status; the update must preserve the
		// stored one verbatim (the install flow is its sole writer).
		paused.Status = nil

		updated, err := tc.channels.Update(channelCtx(), paused)
		if err != nil {
			t.Fatalf("Update(disable) failed: %v", err)
		}
		if updated.GetSpec().GetEnabled() {
			t.Error("channel should be disabled after update")
		}
		if got := updated.GetStatus().GetInstallState(); got != agentchannelv1.AgentChannelInstallState_pending_install {
			t.Errorf("update must preserve status.install_state verbatim, got %v", got)
		}
	})

	t.Run("agent_ref is immutable with the shared copy", func(t *testing.T) {
		agentA := createTestAgent(t, tc, "Immutable Ref Agent A")
		agentB := createTestAgent(t, tc, "Immutable Ref Agent B")
		created := createTestChannel(t, tc, agentA, "Repoint Slack", true)

		repointed := created
		repointed.Spec.AgentRef = &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Org:  agentB.GetMetadata().GetOrg(),
			Slug: agentB.GetMetadata().GetSlug(),
		}
		_, err := tc.channels.Update(channelCtx(), repointed)
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FAILED_PRECONDITION for a re-pointed agent_ref, got %s (%v)", status.Code(err), err)
		}
		want := strings.Replace(strings.Replace(refImmutableMessage,
			"%s", agentA.GetMetadata().GetOrg(), 1),
			"%s", agentA.GetMetadata().GetSlug(), 1)
		if got := status.Convert(err).Message(); got != want {
			t.Errorf("agent_ref-immutable copy must match the cloud edition:\n  want %q\n  got  %q", want, got)
		}
	})

	t.Run("relative agent_ref org normalizes before the immutability compare", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Relative Ref Agent")
		created := createTestChannel(t, tc, agent, "Relative Ref Slack", true)

		// Same slug, empty org — means "the channel's own org"; must pass.
		relative := created
		relative.Spec.AgentRef = &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: agent.GetMetadata().GetSlug(),
		}
		if _, err := tc.channels.Update(channelCtx(), relative); err != nil {
			t.Errorf("a relative (same-org) agent_ref must not trip immutability: %v", err)
		}
	})
}

// TestValidateChannelUpdateStep_ProviderImmutability pins the provider-arm
// immutability contract at the step level. Only one provider arm (slack)
// exists in v1, so a real cross-provider flip cannot be built through the
// full pipeline yet — the step is exercised directly, bypassing proto
// validation, exactly to pin the refusal a second arm (WhatsApp, T05)
// will hit.
func TestValidateChannelUpdateStep_ProviderImmutability(t *testing.T) {
	existing := &agentchannelv1.AgentChannel{
		Metadata: &apiresource.ApiResourceMetadata{Org: "test-org", Slug: "prov-slack"},
		Spec: &agentchannelv1.AgentChannelSpec{
			AgentRef: &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_agent,
				Org:  "test-org",
				Slug: "prov-agent",
			},
			ProviderConfig: &agentchannelv1.AgentChannelSpec_Slack{
				Slack: &agentchannelv1.SlackChannelConfig{},
			},
		},
	}

	// The input keeps the agent_ref but carries NO provider arm — the
	// closest constructible stand-in for "a different provider" until a
	// second arm exists.
	input := &agentchannelv1.AgentChannel{
		Metadata: &apiresource.ApiResourceMetadata{Org: "test-org", Slug: "prov-slack"},
		Spec: &agentchannelv1.AgentChannelSpec{
			AgentRef: &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_agent,
				Org:  "test-org",
				Slug: "prov-agent",
			},
		},
	}

	reqCtx := pipeline.NewRequestContext(channelCtx(), input)
	reqCtx.Set(steps.ExistingResourceKey, existing)

	err := (&validateChannelUpdateStep{}).Execute(reqCtx)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FAILED_PRECONDITION for a provider-arm change, got %s (%v)", status.Code(err), err)
	}
	want := strings.Replace(providerImmutableMessage, "%s", "slack", 1)
	if got := status.Convert(err).Message(); got != want {
		t.Errorf("provider-immutable copy must match the cloud edition:\n  want %q\n  got  %q", want, got)
	}
}

// TestProviderFieldName pins the manifest-vocabulary derivation the error
// copy depends on: the populated oneof member's proto field name.
func TestProviderFieldName(t *testing.T) {
	slack := &agentchannelv1.AgentChannelSpec{
		ProviderConfig: &agentchannelv1.AgentChannelSpec_Slack{
			Slack: &agentchannelv1.SlackChannelConfig{},
		},
	}
	if got := providerFieldName(slack); got != "slack" {
		t.Errorf("slack arm must derive %q, got %q", "slack", got)
	}
	if got := providerFieldName(&agentchannelv1.AgentChannelSpec{}); got != "" {
		t.Errorf("an unset oneof must derive the empty string, got %q", got)
	}
	if got := providerFieldName(nil); got != "" {
		t.Errorf("a nil spec must derive the empty string, got %q", got)
	}
}

func TestAgentChannelController_Apply(t *testing.T) {
	tc := newTestControllers(t)

	agent := createTestAgent(t, tc, "Apply Semantics Agent")

	created, err := tc.channels.Apply(channelCtx(), channelFor(agent, "Apply Slack", true))
	if err != nil {
		t.Fatalf("Apply(create) failed: %v", err)
	}
	if created.GetMetadata().GetId() == "" {
		t.Fatal("apply-as-create must assign an id")
	}
	if got := created.GetStatus().GetInstallState(); got != agentchannelv1.AgentChannelInstallState_pending_install {
		t.Errorf("apply-as-create must initialize pending_install, got %v", got)
	}

	// Re-apply with a config change: must update in place, not duplicate,
	// and must preserve status verbatim.
	again := channelFor(agent, "Apply Slack", false)
	updated, err := tc.channels.Apply(channelCtx(), again)
	if err != nil {
		t.Fatalf("Apply(update) failed: %v", err)
	}
	if updated.GetMetadata().GetId() != created.GetMetadata().GetId() {
		t.Errorf("apply must update the existing channel, not create a new one: %q vs %q",
			updated.GetMetadata().GetId(), created.GetMetadata().GetId())
	}
	if updated.GetSpec().GetEnabled() {
		t.Error("apply-as-update must carry the new configuration (enabled=false)")
	}
	if got := updated.GetStatus().GetInstallState(); got != agentchannelv1.AgentChannelInstallState_pending_install {
		t.Errorf("apply-as-update must preserve status verbatim, got %v", got)
	}

	list, err := tc.channels.List(channelCtx(), &agentchannelv1.ListAgentChannelsRequest{Org: "test-org"})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if list.GetTotalCount() != 1 {
		t.Errorf("expected exactly one channel after apply+apply, got %d", list.GetTotalCount())
	}
}

func TestAgentChannelController_Delete(t *testing.T) {
	tc := newTestControllers(t)

	agent := createTestAgent(t, tc, "Delete Agent")
	created := createTestChannel(t, tc, agent, "Doomed Slack", true)

	deleted, err := tc.channels.Delete(channelCtx(), &agentchannelv1.AgentChannelId{Value: created.GetMetadata().GetId()})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if deleted.GetMetadata().GetId() != created.GetMetadata().GetId() {
		t.Errorf("delete must return the deleted channel, got %q", deleted.GetMetadata().GetId())
	}

	_, err = tc.channels.Get(channelCtx(), &agentchannelv1.AgentChannelId{Value: created.GetMetadata().GetId()})
	if status.Code(err) != codes.NotFound {
		t.Errorf("expected NOT_FOUND after delete, got %s (%v)", status.Code(err), err)
	}

	t.Run("nonexistent channel is NOT_FOUND", func(t *testing.T) {
		_, err := tc.channels.Delete(channelCtx(), &agentchannelv1.AgentChannelId{Value: "ach_does_not_exist"})
		if status.Code(err) != codes.NotFound {
			t.Errorf("expected NOT_FOUND, got %s (%v)", status.Code(err), err)
		}
	})
}

func TestAgentChannelController_Queries(t *testing.T) {
	tc := newTestControllers(t)

	agent := createTestAgent(t, tc, "Query Agent")
	created := createTestChannel(t, tc, agent, "Query Slack", true)

	t.Run("get by id round-trips", func(t *testing.T) {
		fetched, err := tc.channels.Get(channelCtx(), &agentchannelv1.AgentChannelId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if fetched.GetMetadata().GetSlug() != created.GetMetadata().GetSlug() {
			t.Errorf("get should return the created channel, got slug %q", fetched.GetMetadata().GetSlug())
		}
	})

	t.Run("get by reference resolves org+slug", func(t *testing.T) {
		fetched, err := tc.channels.GetByReference(channelCtx(), &apiresource.ApiResourceReference{
			Kind: apiresourcekind.ApiResourceKind_agent_channel,
			Org:  created.GetMetadata().GetOrg(),
			Slug: created.GetMetadata().GetSlug(),
		})
		if err != nil {
			t.Fatalf("GetByReference failed: %v", err)
		}
		if fetched.GetMetadata().GetId() != created.GetMetadata().GetId() {
			t.Errorf("getByReference should resolve the created channel, got %q", fetched.GetMetadata().GetId())
		}
	})

	t.Run("list scopes to the requested org and filters labels", func(t *testing.T) {
		labeled := channelFor(agent, "Labeled Slack", true)
		labeled.Metadata.Labels = map[string]string{"team": "sales"}
		if _, err := tc.channels.Create(channelCtx(), labeled); err != nil {
			t.Fatalf("labeled Create failed: %v", err)
		}

		all, err := tc.channels.List(channelCtx(), &agentchannelv1.ListAgentChannelsRequest{Org: "test-org"})
		if err != nil {
			t.Fatalf("List failed: %v", err)
		}
		if all.GetTotalCount() != 2 {
			t.Fatalf("expected both channels in test-org, got %d", all.GetTotalCount())
		}

		filtered, err := tc.channels.List(channelCtx(), &agentchannelv1.ListAgentChannelsRequest{
			Org:    "test-org",
			Labels: map[string]string{"team": "sales"},
		})
		if err != nil {
			t.Fatalf("List(labels) failed: %v", err)
		}
		if filtered.GetTotalCount() != 1 {
			t.Errorf("expected exactly the labeled channel, got %d", filtered.GetTotalCount())
		}

		foreign, err := tc.channels.List(channelCtx(), &agentchannelv1.ListAgentChannelsRequest{Org: "bystander-org"})
		if err != nil {
			t.Fatalf("List(foreign org) failed: %v", err)
		}
		if foreign.GetTotalCount() != 0 {
			t.Errorf("a foreign org must see no channels, got %d", foreign.GetTotalCount())
		}
	})
}

func TestAgentChannelController_GetByAgent(t *testing.T) {
	tc := newTestControllers(t)

	t.Run("finds every channel of the agent regardless of slug", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Get By Agent Agent")
		first := createTestChannel(t, tc, agent, "Primary Slack", true)
		second := createTestChannel(t, tc, agent, "Secondary Slack", false)

		list, err := tc.channels.GetByAgent(channelCtx(), &agentchannelv1.GetAgentChannelsByAgentRequest{
			AgentId: agent.GetMetadata().GetId(),
		})
		if err != nil {
			t.Fatalf("GetByAgent failed: %v", err)
		}
		if list.GetTotalCount() != 2 {
			t.Fatalf("expected both channels, got %d", list.GetTotalCount())
		}
		slugs := map[string]bool{}
		for _, item := range list.GetItems() {
			slugs[item.GetMetadata().GetSlug()] = true
		}
		if !slugs[first.GetMetadata().GetSlug()] || !slugs[second.GetMetadata().GetSlug()] {
			t.Errorf("expected both channel slugs, got %v", slugs)
		}
	})

	t.Run("nonexistent agent yields an empty list", func(t *testing.T) {
		list, err := tc.channels.GetByAgent(channelCtx(), &agentchannelv1.GetAgentChannelsByAgentRequest{
			AgentId: "agt-does-not-exist",
		})
		if err != nil {
			t.Fatalf("GetByAgent failed: %v", err)
		}
		if list.GetTotalCount() != 0 {
			t.Errorf("expected an empty list for a nonexistent agent, got %d", list.GetTotalCount())
		}
	})

	t.Run("org scope filters the result set", func(t *testing.T) {
		agent := createTestAgent(t, tc, "Org Scoped Channels Agent")
		createTestChannel(t, tc, agent, "Scoped Slack", true)

		matching, err := tc.channels.GetByAgent(channelCtx(), &agentchannelv1.GetAgentChannelsByAgentRequest{
			AgentId: agent.GetMetadata().GetId(),
			Org:     "test-org",
		})
		if err != nil {
			t.Fatalf("GetByAgent(org) failed: %v", err)
		}
		if matching.GetTotalCount() != 1 {
			t.Errorf("the agent's own org must see its channel, got %d", matching.GetTotalCount())
		}

		foreign, err := tc.channels.GetByAgent(channelCtx(), &agentchannelv1.GetAgentChannelsByAgentRequest{
			AgentId: agent.GetMetadata().GetId(),
			Org:     "bystander-org",
		})
		if err != nil {
			t.Fatalf("GetByAgent(foreign org) failed: %v", err)
		}
		if foreign.GetTotalCount() != 0 {
			t.Errorf("a foreign org scope must see nothing, got %d", foreign.GetTotalCount())
		}
	})
}

// TestAgentChannelController_InstallPosture pins the §0-b contract: the
// OSS edition stores channel resources but cannot install them (no
// webhook receiver, no delivery runtime). The NOT_FOUND half of the
// contract is byte-identical with the cloud edition's LoadChannel step,
// so only the final refusal diverges — the documented one.
func TestAgentChannelController_InstallPosture(t *testing.T) {
	tc := newTestControllers(t)

	agent := createTestAgent(t, tc, "Install Posture Agent")
	created := createTestChannel(t, tc, agent, "Installable Slack", true)

	t.Run("initiateInstall on a nonexistent channel is NOT_FOUND with the cloud copy", func(t *testing.T) {
		_, err := tc.channels.InitiateInstall(channelCtx(), &agentchannelv1.InitiateChannelInstallInput{
			ResourceId: "ach_does_not_exist",
		})
		if status.Code(err) != codes.NotFound {
			t.Fatalf("expected NOT_FOUND, got %s (%v)", status.Code(err), err)
		}
		if got := status.Convert(err).Message(); got != "AgentChannel not found: ach_does_not_exist" {
			t.Errorf("not-found copy must match the cloud LoadChannel step, got %q", got)
		}
	})

	t.Run("initiateInstall on an existing channel is FAILED_PRECONDITION", func(t *testing.T) {
		_, err := tc.channels.InitiateInstall(channelCtx(), &agentchannelv1.InitiateChannelInstallInput{
			ResourceId: created.GetMetadata().GetId(),
		})
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FAILED_PRECONDITION, got %s (%v)", status.Code(err), err)
		}
		if got := status.Convert(err).Message(); got != installUnavailableMessage {
			t.Errorf("install refusal must carry the documented §0-b copy, got %q", got)
		}
	})

	t.Run("completeInstall mirrors the same contract", func(t *testing.T) {
		_, err := tc.channels.CompleteInstall(channelCtx(), &agentchannelv1.CompleteChannelInstallInput{
			ResourceId: "ach_does_not_exist",
			State:      "some-state",
			Code:       "some-code",
		})
		if status.Code(err) != codes.NotFound {
			t.Errorf("expected NOT_FOUND for a nonexistent channel, got %s (%v)", status.Code(err), err)
		}

		_, err = tc.channels.CompleteInstall(channelCtx(), &agentchannelv1.CompleteChannelInstallInput{
			ResourceId: created.GetMetadata().GetId(),
			State:      "some-state",
			Code:       "some-code",
		})
		if status.Code(err) != codes.FailedPrecondition {
			t.Errorf("expected FAILED_PRECONDITION, got %s (%v)", status.Code(err), err)
		}
	})

	t.Run("missing input fields are INVALID_ARGUMENT before any load", func(t *testing.T) {
		if _, err := tc.channels.InitiateInstall(channelCtx(), &agentchannelv1.InitiateChannelInstallInput{}); status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for an empty initiate input, got %v", err)
		}
		if _, err := tc.channels.CompleteInstall(channelCtx(), &agentchannelv1.CompleteChannelInstallInput{
			ResourceId: created.GetMetadata().GetId(),
		}); status.Code(err) != codes.InvalidArgument {
			t.Errorf("expected INVALID_ARGUMENT for a completion without state/code, got %v", err)
		}
	})

	t.Run("the refused install persists nothing", func(t *testing.T) {
		fetched, err := tc.channels.Get(channelCtx(), &agentchannelv1.AgentChannelId{Value: created.GetMetadata().GetId()})
		if err != nil {
			t.Fatalf("Get failed: %v", err)
		}
		if got := fetched.GetStatus().GetInstallState(); got != agentchannelv1.AgentChannelInstallState_pending_install {
			t.Errorf("a refused install must leave install_state untouched, got %v", got)
		}
	})
}
