package agent

import (
	"context"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agent/defaultagent"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// seedLabeledAgent persists an agent carrying the default-agent label directly
// through the store (bypassing the create pipeline, so ids stay test-chosen).
func seedLabeledAgent(t *testing.T, s store.Store, id string, visibility apiresource.ApiResourceVisibility) {
	t.Helper()
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:         id,
			Name:       "agent-" + id,
			Org:        "stigmer",
			Visibility: visibility,
			Labels:     map[string]string{defaultagent.Label: defaultagent.LabelValue},
		},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, id, agent); err != nil {
		t.Fatalf("failed to seed agent %s: %v", id, err)
	}
}

// TestAgentController_GetDefault pins the RPC's error-code contract and the
// deterministic resolution it delegates to defaultagent.Find (oss#356):
// NotFound when nothing carries the label, FailedPrecondition when labeled
// agents exist but none is public (a deliberate divergence from the cloud
// edition, which collapses that state into NOT_FOUND), and incumbent-wins
// (lowest id) among public candidates.
func TestAgentController_GetDefault(t *testing.T) {
	newController := func(t *testing.T) (*AgentController, store.Store) {
		t.Helper()
		s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
		if err != nil {
			t.Fatalf("failed to create store: %v", err)
		}
		t.Cleanup(func() { _ = s.Close() })
		return NewAgentController(s, nil), s
	}
	req := &agentv1.GetDefaultAgentRequest{Org: "stigmer"}

	t.Run("no labeled agent -> NotFound", func(t *testing.T) {
		controller, _ := newController(t)

		_, err := controller.GetDefault(contextWithAgentKind(), req)

		if code := status.Code(err); code != codes.NotFound {
			t.Errorf("expected NotFound, got %v (err: %v)", code, err)
		}
	})

	t.Run("only non-public labeled agent -> FailedPrecondition", func(t *testing.T) {
		controller, s := newController(t)
		seedLabeledAgent(t, s, "agt_private", apiresource.ApiResourceVisibility_visibility_private)

		_, err := controller.GetDefault(contextWithAgentKind(), req)

		if code := status.Code(err); code != codes.FailedPrecondition {
			t.Errorf("expected FailedPrecondition, got %v (err: %v)", code, err)
		}
	})

	t.Run("public labeled agent -> returned", func(t *testing.T) {
		controller, s := newController(t)
		seedLabeledAgent(t, s, "agt_default", apiresource.ApiResourceVisibility_visibility_public)

		got, err := controller.GetDefault(contextWithAgentKind(), req)
		if err != nil {
			t.Fatalf("expected resolution to succeed, got %v", err)
		}
		if got.GetMetadata().GetId() != "agt_default" {
			t.Errorf("expected agt_default, got %q", got.GetMetadata().GetId())
		}
	})

	t.Run("rotation window: two public labeled agents -> incumbent wins", func(t *testing.T) {
		controller, s := newController(t)
		// Newcomer inserted FIRST: a first-match scan would return it, so
		// this case fails against the pre-#356 lookup.
		seedLabeledAgent(t, s, "agt_1newcomer", apiresource.ApiResourceVisibility_visibility_public)
		seedLabeledAgent(t, s, "agt_0incumbent", apiresource.ApiResourceVisibility_visibility_public)

		got, err := controller.GetDefault(contextWithAgentKind(), req)
		if err != nil {
			t.Fatalf("expected resolution to succeed, got %v", err)
		}
		if got.GetMetadata().GetId() != "agt_0incumbent" {
			t.Errorf("expected the incumbent (lowest id) to win, got %q", got.GetMetadata().GetId())
		}
	})
}
