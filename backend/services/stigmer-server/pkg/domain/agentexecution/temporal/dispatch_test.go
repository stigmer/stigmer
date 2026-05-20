package temporal

import (
	"context"
	"testing"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
)

func setupTestStore(t *testing.T) *sqlite.Store {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/dispatch_test.sqlite")
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	return s
}

func saveSession(t *testing.T, s *sqlite.Store, id string, harness sessionv1.Harness) {
	t.Helper()
	session := &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: "test-session", Org: "test-org"},
		Spec:       &sessionv1.SessionSpec{AgentInstanceId: "test-instance", Harness: harness},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_session, id, session); err != nil {
		t.Fatalf("failed to save session: %v", err)
	}
}

func TestResolveActivityTaskQueue_DefaultQueue(t *testing.T) {
	t.Run("no session ID — returns default queue with NATIVE harness", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		result, err := ResolveActivityTaskQueue(context.Background(), s, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != DefaultActivityTaskQueue {
			t.Errorf("expected task queue %q, got %q", DefaultActivityTaskQueue, result.TaskQueue)
		}
		if result.Harness != sessionv1.Harness_HARNESS_NATIVE {
			t.Errorf("expected HARNESS_NATIVE, got %v", result.Harness)
		}
	})

	t.Run("session not found — returns default queue without error", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		result, err := ResolveActivityTaskQueue(context.Background(), s, "nonexistent-session")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != DefaultActivityTaskQueue {
			t.Errorf("expected task queue %q, got %q", DefaultActivityTaskQueue, result.TaskQueue)
		}
	})

	t.Run("session with CURSOR harness — returns default queue with CURSOR harness", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveSession(t, s, "sess_1", sessionv1.Harness_HARNESS_CURSOR)

		result, err := ResolveActivityTaskQueue(context.Background(), s, "sess_1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != DefaultActivityTaskQueue {
			t.Errorf("expected task queue %q, got %q", DefaultActivityTaskQueue, result.TaskQueue)
		}
		if result.Harness != sessionv1.Harness_HARNESS_CURSOR {
			t.Errorf("expected HARNESS_CURSOR, got %v", result.Harness)
		}
	})
}
