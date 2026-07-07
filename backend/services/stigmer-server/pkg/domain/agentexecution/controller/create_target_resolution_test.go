package agentexecution

import (
	"context"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

// seedDefaultAgent persists an agent carrying the platform default-agent label
// with the given visibility, so resolveDefaultAgentStep can find it via FindByLabel.
func seedDefaultAgent(t *testing.T, s store.Store, id string, visibility apiresource.ApiResourceVisibility) {
	t.Helper()
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:         id,
			Name:       "assistant",
			Org:        "stigmer",
			Visibility: visibility,
			Labels:     map[string]string{"stigmer.ai/default-agent": "true"},
		},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, id, agent); err != nil {
		t.Fatalf("failed to seed default agent: %v", err)
	}
}

// newExecution builds a minimal AgentExecution with the given references.
func newExecution(sessionID, agentID string) *agentexecutionv1.AgentExecution {
	return &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "exec", Org: "test-org"},
		Spec: &agentexecutionv1.AgentExecutionSpec{
			SessionId: sessionID,
			AgentId:   agentID,
			Message:   "hi",
		},
	}
}

// TestEnsureSessionOrAgentResolvedStep verifies the post-resolution invariant guard:
// a resolved reference passes; an unresolved one is an Internal invariant violation
// (never InvalidArgument — see issue #196).
func TestEnsureSessionOrAgentResolvedStep(t *testing.T) {
	step := newEnsureSessionOrAgentResolvedStep()

	tests := []struct {
		name      string
		sessionID string
		agentID   string
		wantErr   bool
		wantCode  codes.Code
	}{
		{name: "session_id resolved -> pass", sessionID: "ses_1"},
		{name: "agent_id resolved -> pass", agentID: "agt_1"},
		{name: "both resolved -> pass", sessionID: "ses_1", agentID: "agt_1"},
		{name: "neither resolved -> Internal invariant violation", wantErr: true, wantCode: codes.Internal},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reqCtx := pipeline.NewRequestContext(context.Background(), newExecution(tt.sessionID, tt.agentID))

			err := step.Execute(reqCtx)

			if !tt.wantErr {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected an error, got nil")
			}
			if code := status.Code(err); code != tt.wantCode {
				t.Errorf("expected gRPC code %v, got %v (err: %v)", tt.wantCode, code, err)
			}
		})
	}
}

// TestResolveDefaultAgentStep exercises the reachable contract of the default-agent
// resolution: NotFound when unseeded, resolution onto newState when a public default
// exists, and FailedPrecondition when the default is not visibility_public.
func TestResolveDefaultAgentStep(t *testing.T) {
	t.Run("no default agent seeded -> NotFound", func(t *testing.T) {
		step := newResolveDefaultAgentStep(newStore(t))
		reqCtx := pipeline.NewRequestContext(context.Background(), newExecution("", ""))

		err := step.Execute(reqCtx)

		if code := status.Code(err); code != codes.NotFound {
			t.Errorf("expected gRPC code NotFound, got %v (err: %v)", code, err)
		}
	})

	t.Run("public default agent -> resolves agent_id onto newState", func(t *testing.T) {
		s := newStore(t)
		seedDefaultAgent(t, s, "agt_default", apiresource.ApiResourceVisibility_visibility_public)
		step := newResolveDefaultAgentStep(s)
		reqCtx := pipeline.NewRequestContext(context.Background(), newExecution("", ""))

		if err := step.Execute(reqCtx); err != nil {
			t.Fatalf("expected resolution to succeed, got %v", err)
		}

		if got := reqCtx.NewState().GetSpec().GetAgentId(); got != "agt_default" {
			t.Errorf("expected agent_id 'agt_default' on newState, got %q", got)
		}
		// The original request must remain immutable.
		if got := reqCtx.Input().GetSpec().GetAgentId(); got != "" {
			t.Errorf("expected input to stay immutable, but agent_id was set to %q", got)
		}
	})

	t.Run("non-public default agent -> FailedPrecondition", func(t *testing.T) {
		s := newStore(t)
		seedDefaultAgent(t, s, "agt_private", apiresource.ApiResourceVisibility_visibility_private)
		step := newResolveDefaultAgentStep(s)
		reqCtx := pipeline.NewRequestContext(context.Background(), newExecution("", ""))

		err := step.Execute(reqCtx)

		if code := status.Code(err); code != codes.FailedPrecondition {
			t.Errorf("expected gRPC code FailedPrecondition, got %v (err: %v)", code, err)
		}
	})

	t.Run("reference already provided -> no-op", func(t *testing.T) {
		step := newResolveDefaultAgentStep(newStore(t))
		reqCtx := pipeline.NewRequestContext(context.Background(), newExecution("", "agt_explicit"))

		if err := step.Execute(reqCtx); err != nil {
			t.Fatalf("expected no-op to succeed, got %v", err)
		}
		if got := reqCtx.NewState().GetSpec().GetAgentId(); got != "agt_explicit" {
			t.Errorf("expected agent_id to remain 'agt_explicit', got %q", got)
		}
	})
}
