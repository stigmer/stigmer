package defaultagent

import (
	"context"
	"errors"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
)

// newStore spins up an isolated on-disk SQLite store for a single test.
func newStore(t *testing.T) store.Store {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

type seedAgent struct {
	id         string
	visibility apiresource.ApiResourceVisibility
	labels     map[string]string
}

func labeled(id string, visibility apiresource.ApiResourceVisibility) seedAgent {
	return seedAgent{id: id, visibility: visibility, labels: map[string]string{Label: LabelValue}}
}

func seed(t *testing.T, s store.Store, agents ...seedAgent) {
	t.Helper()
	for _, a := range agents {
		agent := &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         a.id,
				Name:       "agent-" + a.id,
				Org:        "stigmer",
				Visibility: a.visibility,
				Labels:     a.labels,
			},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, a.id, agent); err != nil {
			t.Fatalf("failed to seed agent %s: %v", a.id, err)
		}
	}
}

// permutations of two seeds, to prove every winner assertion is independent of
// row-insertion order — the exact nondeterminism of the pre-#356 first-match
// lookup, which these cases fail against.
func bothOrders(a, b seedAgent) map[string][]seedAgent {
	return map[string][]seedAgent{
		"insertion order " + a.id + " then " + b.id: {a, b},
		"insertion order " + b.id + " then " + a.id: {b, a},
	}
}

func TestFind_SinglePublicLabeledAgent(t *testing.T) {
	s := newStore(t)
	seed(t, s, labeled("agt_only", apiresource.ApiResourceVisibility_visibility_public))

	got, err := Find(context.Background(), s)
	if err != nil {
		t.Fatalf("expected resolution to succeed, got %v", err)
	}
	if got.GetMetadata().GetId() != "agt_only" {
		t.Errorf("expected agt_only, got %q", got.GetMetadata().GetId())
	}
}

func TestFind_TwoPublicLabeledAgents_IncumbentWins(t *testing.T) {
	// The rotation window: the new default is applied before the old label is
	// retired. The incumbent (lowest id — ULIDs are time-ordered) must win in
	// both insertion orders.
	incumbent := labeled("agt_0incumbent", apiresource.ApiResourceVisibility_visibility_public)
	newcomer := labeled("agt_1newcomer", apiresource.ApiResourceVisibility_visibility_public)

	for name, order := range bothOrders(incumbent, newcomer) {
		t.Run(name, func(t *testing.T) {
			s := newStore(t)
			seed(t, s, order...)

			got, err := Find(context.Background(), s)
			if err != nil {
				t.Fatalf("expected resolution to succeed, got %v", err)
			}
			if got.GetMetadata().GetId() != "agt_0incumbent" {
				t.Errorf("expected the incumbent (lowest id) to win, got %q", got.GetMetadata().GetId())
			}
		})
	}
}

func TestFind_PublicPreferredOverNonPublic(t *testing.T) {
	// The non-public agent has the LOWER id, so a pure id-order scan would
	// pick it and fail the visibility gate — the pre-#356 defect. Visibility
	// preference must beat id order in both insertion orders.
	private := labeled("agt_0private", apiresource.ApiResourceVisibility_visibility_private)
	public := labeled("agt_1public", apiresource.ApiResourceVisibility_visibility_public)

	for name, order := range bothOrders(private, public) {
		t.Run(name, func(t *testing.T) {
			s := newStore(t)
			seed(t, s, order...)

			got, err := Find(context.Background(), s)
			if err != nil {
				t.Fatalf("expected resolution to succeed, got %v", err)
			}
			if got.GetMetadata().GetId() != "agt_1public" {
				t.Errorf("expected the public labeled agent to win, got %q", got.GetMetadata().GetId())
			}
		})
	}
}

func TestFind_NoLabeledAgents_ErrNotConfigured(t *testing.T) {
	t.Run("empty store", func(t *testing.T) {
		s := newStore(t)

		_, err := Find(context.Background(), s)
		if !errors.Is(err, ErrNotConfigured) {
			t.Errorf("expected ErrNotConfigured, got %v", err)
		}
	})

	t.Run("agents exist but none carries the label", func(t *testing.T) {
		s := newStore(t)
		seed(t, s,
			seedAgent{id: "agt_unlabeled", visibility: apiresource.ApiResourceVisibility_visibility_public},
			seedAgent{id: "agt_otherlabel", visibility: apiresource.ApiResourceVisibility_visibility_public,
				labels: map[string]string{"stigmer.ai/system": "true"}},
		)

		_, err := Find(context.Background(), s)
		if !errors.Is(err, ErrNotConfigured) {
			t.Errorf("expected ErrNotConfigured, got %v", err)
		}
	})
}

func TestFind_OnlyNonPublicLabeledAgents_ErrNotPublic(t *testing.T) {
	s := newStore(t)
	seed(t, s,
		labeled("agt_0private", apiresource.ApiResourceVisibility_visibility_private),
		labeled("agt_1org", apiresource.ApiResourceVisibility_visibility_org),
	)

	_, err := Find(context.Background(), s)
	if !errors.Is(err, ErrNotPublic) {
		t.Errorf("expected ErrNotPublic, got %v", err)
	}
}

func TestFind_UpdatingTheIncumbentDoesNotChangeTheWinner(t *testing.T) {
	// The ordering key must be immutable under updates. spec_audit.created_at
	// was rejected as the key precisely because updates can rewrite it
	// (stigmer/stigmer#453); metadata.id cannot change for the life of the
	// row, so a re-save of the incumbent must not affect the outcome.
	s := newStore(t)
	seed(t, s,
		labeled("agt_0incumbent", apiresource.ApiResourceVisibility_visibility_public),
		labeled("agt_1newcomer", apiresource.ApiResourceVisibility_visibility_public),
	)

	// Re-save the incumbent (simulates apply/update churn after the newcomer
	// was labeled).
	updated := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:         "agt_0incumbent",
			Name:       "agent-agt_0incumbent",
			Org:        "stigmer",
			Visibility: apiresource.ApiResourceVisibility_visibility_public,
			Labels:     map[string]string{Label: LabelValue},
		},
		Spec: &agentv1.AgentSpec{Description: "updated after the newcomer appeared"},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, "agt_0incumbent", updated); err != nil {
		t.Fatalf("failed to update incumbent: %v", err)
	}

	got, err := Find(context.Background(), s)
	if err != nil {
		t.Fatalf("expected resolution to succeed, got %v", err)
	}
	if got.GetMetadata().GetId() != "agt_0incumbent" {
		t.Errorf("expected the incumbent to keep winning after an update, got %q", got.GetMetadata().GetId())
	}
	if got.GetSpec().GetDescription() != "updated after the newcomer appeared" {
		t.Errorf("expected the incumbent's latest state to be returned, got %q", got.GetSpec().GetDescription())
	}
}
