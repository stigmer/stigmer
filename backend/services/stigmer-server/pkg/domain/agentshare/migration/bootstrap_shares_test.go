package migration

import (
	"context"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

func newTestStore(t *testing.T) *sqlite.Store {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

// legacySharingBytes synthesizes the wire bytes of the removed AgentSharing
// message exactly as a pre-promotion server persisted them: field numbers
// from the reserved declarations in agent/v1/spec.proto.
func legacySharingBytes(t *testing.T, enabled bool, origins []string, messages *agentsharev1.AgentShareMessages, audience int32) []byte {
	t.Helper()
	var b []byte
	if enabled {
		b = protowire.AppendTag(b, legacySharingEnabledField, protowire.VarintType)
		b = protowire.AppendVarint(b, 1)
	}
	for _, origin := range origins {
		b = protowire.AppendTag(b, legacySharingOriginsField, protowire.BytesType)
		b = protowire.AppendString(b, origin)
	}
	if messages != nil {
		payload, err := proto.Marshal(messages)
		if err != nil {
			t.Fatalf("marshal messages: %v", err)
		}
		b = protowire.AppendTag(b, legacySharingMessagesField, protowire.BytesType)
		b = protowire.AppendBytes(b, payload)
	}
	if audience != 0 {
		b = protowire.AppendTag(b, legacySharingAudienceField, protowire.VarintType)
		b = protowire.AppendVarint(b, uint64(audience))
	}
	return b
}

// persistLegacyAgent stores an agent carrying pre-promotion sharing bytes:
// the sharing message under spec field 8 and the link token under status
// field 2, both injected as unknown fields — byte-for-byte what a database
// written before the wire break contains.
func persistLegacyAgent(t *testing.T, s *sqlite.Store, id, org, slug string, sharing []byte, linkToken string) {
	t.Helper()

	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Org:  org,
			Slug: slug,
			Name: slug,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Legacy shared agent",
			Instructions: "You are a helpful legacy agent.",
			IconUrl:      "https://example.com/icon.svg",
		},
		Status: &agentv1.AgentStatus{
			DefaultInstanceId: "ain_default",
		},
	}

	if sharing != nil {
		var specUnknown []byte
		specUnknown = protowire.AppendTag(specUnknown, legacySpecSharingField, protowire.BytesType)
		specUnknown = protowire.AppendBytes(specUnknown, sharing)
		agent.GetSpec().ProtoReflect().SetUnknown(specUnknown)
	}
	if linkToken != "" {
		var statusUnknown []byte
		statusUnknown = protowire.AppendTag(statusUnknown, legacyStatusLinkTokenField, protowire.BytesType)
		statusUnknown = protowire.AppendString(statusUnknown, linkToken)
		agent.GetStatus().ProtoReflect().SetUnknown(statusUnknown)
	}

	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, id, agent); err != nil {
		t.Fatalf("save legacy agent: %v", err)
	}
}

func loadShares(t *testing.T, s *sqlite.Store) []*agentsharev1.AgentShare {
	t.Helper()
	records, err := s.ListResources(context.Background(), apiresourcekind.ApiResourceKind_agent_share)
	if err != nil {
		t.Fatalf("list shares: %v", err)
	}
	shares := make([]*agentsharev1.AgentShare, 0, len(records))
	for _, data := range records {
		share := &agentsharev1.AgentShare{}
		if err := proto.Unmarshal(data, share); err != nil {
			t.Fatalf("unmarshal share: %v", err)
		}
		shares = append(shares, share)
	}
	return shares
}

func TestBootstrapAgentShares_ConvertsLegacyConfig(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	messages := &agentsharev1.AgentShareMessages{
		RateLimited: "Slow down please",
		Unavailable: "Come back later",
	}
	sharing := legacySharingBytes(t, true,
		[]string{"https://docs.example.com", "http://localhost:3000"},
		messages,
		2, // legacy agent_sharing_audience_org
	)
	persistLegacyAgent(t, s, "agt_legacy1", "test-org", "legacy-agent", sharing, "live-link-token-27chars")

	result, err := BootstrapAgentShares(ctx, s)
	if err != nil {
		t.Fatalf("BootstrapAgentShares failed: %v", err)
	}
	if result.Converted != 1 {
		t.Fatalf("expected 1 conversion, got %s", result)
	}

	shares := loadShares(t, s)
	if len(shares) != 1 {
		t.Fatalf("expected 1 share row, got %d", len(shares))
	}
	share := shares[0]

	if share.GetMetadata().GetOrg() != "test-org" || share.GetMetadata().GetSlug() != "legacy-agent" {
		t.Errorf("share must keep the agent's URL identity, got %s/%s",
			share.GetMetadata().GetOrg(), share.GetMetadata().GetSlug())
	}
	if ref := share.GetSpec().GetAgentRef(); ref.GetOrg() != "test-org" || ref.GetSlug() != "legacy-agent" ||
		ref.GetKind() != apiresourcekind.ApiResourceKind_agent {
		t.Errorf("agent_ref did not convert: %+v", ref)
	}
	if !share.GetSpec().GetEnabled() {
		t.Error("enabled did not convert")
	}
	if share.GetSpec().GetAudience() != agentsharev1.AgentShareAudience_agent_share_audience_org {
		t.Errorf("audience did not convert, got %v", share.GetSpec().GetAudience())
	}
	if got := share.GetSpec().GetAllowedOrigins(); len(got) != 2 || got[0] != "https://docs.example.com" {
		t.Errorf("allowed_origins did not convert: %v", got)
	}
	if share.GetSpec().GetMessages().GetRateLimited() != "Slow down please" ||
		share.GetSpec().GetMessages().GetUnavailable() != "Come back later" {
		t.Errorf("messages did not convert: %+v", share.GetSpec().GetMessages())
	}
	// The critical guarantee: a live link token survives the conversion.
	// Dropping it would silently unlock a deliberately locked link.
	if share.GetStatus().GetShareLinkToken() != "live-link-token-27chars" {
		t.Errorf("share_link_token did not convert, got %q", share.GetStatus().GetShareLinkToken())
	}

	// The agent's legacy bytes are stripped (conversion is self-marking).
	converted := &agentv1.Agent{}
	if err := s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, "agt_legacy1", converted); err != nil {
		t.Fatalf("load converted agent: %v", err)
	}
	if len(converted.GetSpec().ProtoReflect().GetUnknown()) != 0 {
		t.Error("legacy spec sharing bytes must be stripped after conversion")
	}
	if len(converted.GetStatus().ProtoReflect().GetUnknown()) != 0 {
		t.Error("legacy status token bytes must be stripped after conversion")
	}
	if converted.GetSpec().GetInstructions() != "You are a helpful legacy agent." {
		t.Error("conversion must not touch the agent's real spec")
	}
}

func TestBootstrapAgentShares_SkipsUnsharedAgents(t *testing.T) {
	s := newTestStore(t)

	persistLegacyAgent(t, s, "agt_plain", "test-org", "plain-agent", nil, "")

	result, err := BootstrapAgentShares(context.Background(), s)
	if err != nil {
		t.Fatalf("BootstrapAgentShares failed: %v", err)
	}
	if result.Converted != 0 || result.Skipped != 1 {
		t.Errorf("expected 0 converted / 1 skipped, got %s", result)
	}
	if shares := loadShares(t, s); len(shares) != 0 {
		t.Errorf("no share rows expected, got %d", len(shares))
	}
}

func TestBootstrapAgentShares_DisabledShareConvertsAsPause(t *testing.T) {
	s := newTestStore(t)

	// enabled=false but with config: the config-preserving pause must
	// survive as a disabled share row, not be dropped.
	sharing := legacySharingBytes(t, false, []string{"https://docs.example.com"}, nil, 0)
	persistLegacyAgent(t, s, "agt_paused", "test-org", "paused-agent", sharing, "")

	result, err := BootstrapAgentShares(context.Background(), s)
	if err != nil {
		t.Fatalf("BootstrapAgentShares failed: %v", err)
	}
	if result.Converted != 1 {
		t.Fatalf("expected 1 conversion, got %s", result)
	}

	shares := loadShares(t, s)
	if len(shares) != 1 {
		t.Fatalf("expected 1 share row, got %d", len(shares))
	}
	if shares[0].GetSpec().GetEnabled() {
		t.Error("a disabled legacy share must convert as disabled")
	}
	if len(shares[0].GetSpec().GetAllowedOrigins()) != 1 {
		t.Error("a disabled legacy share must keep its config")
	}
}

func TestBootstrapAgentShares_Idempotent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	sharing := legacySharingBytes(t, true, nil, nil, 0)
	persistLegacyAgent(t, s, "agt_idem", "test-org", "idem-agent", sharing, "")

	if _, err := BootstrapAgentShares(ctx, s); err != nil {
		t.Fatalf("first run failed: %v", err)
	}

	// Second run: gated off by bootstrap_state — nothing converted, no
	// duplicate rows.
	result, err := BootstrapAgentShares(ctx, s)
	if err != nil {
		t.Fatalf("second run failed: %v", err)
	}
	if result.Converted != 0 || result.Skipped != 0 {
		t.Errorf("second run must be a no-op, got %s", result)
	}
	if shares := loadShares(t, s); len(shares) != 1 {
		t.Errorf("expected exactly 1 share row after re-run, got %d", len(shares))
	}
}

func TestBootstrapAgentShares_RowLevelIdempotency(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Simulate an interrupted first run: the share row exists but the
	// bootstrap flag was never written and the agent still carries legacy
	// bytes. The re-run must not duplicate the share.
	sharing := legacySharingBytes(t, true, nil, nil, 0)
	persistLegacyAgent(t, s, "agt_partial", "test-org", "partial-agent", sharing, "")

	if _, err := BootstrapAgentShares(ctx, s); err != nil {
		t.Fatalf("first run failed: %v", err)
	}
	// Restore the legacy state on the agent and clear the gate, as if the
	// first run had crashed between the share write and the flag write.
	persistLegacyAgent(t, s, "agt_partial", "test-org", "partial-agent", sharing, "")
	if err := s.DeleteBootstrapState(ctx, bootstrapStateKey); err != nil {
		t.Fatalf("clear bootstrap state: %v", err)
	}

	if _, err := BootstrapAgentShares(ctx, s); err != nil {
		t.Fatalf("re-run failed: %v", err)
	}
	if shares := loadShares(t, s); len(shares) != 1 {
		t.Errorf("re-run must not duplicate the share, got %d rows", len(shares))
	}
}
