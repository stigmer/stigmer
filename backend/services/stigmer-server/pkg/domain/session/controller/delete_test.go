package session

import (
	"context"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// seedExecution writes an agent execution bound to the given session directly
// into the store, with the given lifecycle phase.
func seedExecution(t *testing.T, s store.Store, id, sessionID string, phase agentexecutionv1.ExecutionPhase) {
	t.Helper()
	execution := &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:  id,
			Org: "test-org",
		},
		Spec: &agentexecutionv1.AgentExecutionSpec{
			SessionId: sessionID,
		},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase: phase,
		},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent_execution, id, execution); err != nil {
		t.Fatalf("failed to seed execution %s: %v", id, err)
	}
}

// executionExists reports whether the execution document is still in the store.
func executionExists(t *testing.T, s store.Store, id string) bool {
	t.Helper()
	err := s.GetResource(context.Background(), apiresourcekind.ApiResourceKind_agent_execution, id, &agentexecutionv1.AgentExecution{})
	return err == nil
}

func createTestSession(t *testing.T, controller *SessionController, name string) *sessionv1.Session {
	t.Helper()
	created, err := controller.Create(contextWithSessionKind(), &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: "test-agent-instance-id",
		},
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	return created
}

func TestSessionController_Delete_CascadesExecutions(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	session := createTestSession(t, controller, "Cascade Session")
	other := createTestSession(t, controller, "Other Session")

	// Terminal executions in the target session, plus one in another session
	// that must survive the cascade.
	seedExecution(t, s, "exe-1", session.Metadata.Id, agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	seedExecution(t, s, "exe-2", session.Metadata.Id, agentexecutionv1.ExecutionPhase_EXECUTION_FAILED)
	seedExecution(t, s, "exe-other", other.Metadata.Id, agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	if _, err := controller.Delete(contextWithSessionKind(), &sessionv1.SessionId{Value: session.Metadata.Id}); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	if executionExists(t, s, "exe-1") || executionExists(t, s, "exe-2") {
		t.Error("Expected executions of the deleted session to be cascade-deleted")
	}
	if !executionExists(t, s, "exe-other") {
		t.Error("Expected executions of other sessions to survive the cascade")
	}
}

func TestSessionController_Delete_RejectsWhileExecutionsActive(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	activePhases := []agentexecutionv1.ExecutionPhase{
		agentexecutionv1.ExecutionPhase_EXECUTION_PENDING,
		agentexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
		agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL,
		agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED,
	}

	for _, phase := range activePhases {
		t.Run(phase.String(), func(t *testing.T) {
			session := createTestSession(t, controller, "Active "+phase.String())
			executionID := "exe-active-" + phase.String()
			seedExecution(t, s, executionID, session.Metadata.Id, phase)

			_, err := controller.Delete(contextWithSessionKind(), &sessionv1.SessionId{Value: session.Metadata.Id})
			if err == nil {
				t.Fatal("Expected delete to be rejected while an execution is active")
			}
			if status.Code(err) != codes.FailedPrecondition {
				t.Errorf("Expected FAILED_PRECONDITION, got %v", status.Code(err))
			}

			// Neither the session nor the execution was touched.
			if _, err := controller.Get(contextWithSessionKind(), &sessionv1.SessionId{Value: session.Metadata.Id}); err != nil {
				t.Errorf("Expected session to survive a rejected delete: %v", err)
			}
			if !executionExists(t, s, executionID) {
				t.Error("Expected active execution to survive a rejected delete")
			}
		})
	}
}

func TestSessionController_Delete_SucceedsAfterExecutionsTerminal(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	session := createTestSession(t, controller, "Terminal Session")
	seedExecution(t, s, "exe-t1", session.Metadata.Id, agentexecutionv1.ExecutionPhase_EXECUTION_CANCELLED)
	seedExecution(t, s, "exe-t2", session.Metadata.Id, agentexecutionv1.ExecutionPhase_EXECUTION_TERMINATED)

	deleted, err := controller.Delete(contextWithSessionKind(), &sessionv1.SessionId{Value: session.Metadata.Id})
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if deleted.Metadata.Id != session.Metadata.Id {
		t.Errorf("Expected deleted session ID '%s', got '%s'", session.Metadata.Id, deleted.Metadata.Id)
	}
	if executionExists(t, s, "exe-t1") || executionExists(t, s, "exe-t2") {
		t.Error("Expected terminal executions to be cascade-deleted")
	}
}
