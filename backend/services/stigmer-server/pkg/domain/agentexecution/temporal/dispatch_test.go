package temporal

import (
	"context"
	"strings"
	"testing"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
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

func saveRunner(t *testing.T, s *sqlite.Store, id, name string, phase runnerv1.RunnerPhase, taskQueue string) {
	t.Helper()
	runner := &runnerv1.Runner{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Runner",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: name, Org: "test-org"},
		Spec:       &runnerv1.RunnerSpec{},
		Status:     &runnerv1.RunnerStatus{Phase: phase, TaskQueue: taskQueue},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_runner, id, runner); err != nil {
		t.Fatalf("failed to save runner: %v", err)
	}
}

func saveSession(t *testing.T, s *sqlite.Store, id string, runnerID string) {
	t.Helper()
	session := &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata:   &apiresource.ApiResourceMetadata{Id: id, Name: "test-session", Org: "test-org"},
		Spec:       &sessionv1.SessionSpec{AgentInstanceId: "test-instance", RunnerId: runnerID},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_session, id, session); err != nil {
		t.Fatalf("failed to save session: %v", err)
	}
}

func TestResolveActivityTaskQueue_AutoRoute(t *testing.T) {
	t.Run("no session ID — routes to sole READY runner", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_1", "my-runner", runnerv1.RunnerPhase_RUNNER_PHASE_READY, "runner:rnr_1")

		result, err := ResolveActivityTaskQueue(context.Background(), s, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != "runner:rnr_1" {
			t.Errorf("expected task queue 'runner:rnr_1', got '%s'", result.TaskQueue)
		}
		if result.RunnerID != "rnr_1" {
			t.Errorf("expected runner ID 'rnr_1', got '%s'", result.RunnerID)
		}
	})

	t.Run("session not found — routes to available runner", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_1", "my-runner", runnerv1.RunnerPhase_RUNNER_PHASE_READY, "runner:rnr_1")

		result, err := ResolveActivityTaskQueue(context.Background(), s, "nonexistent-session")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != "runner:rnr_1" {
			t.Errorf("expected task queue 'runner:rnr_1', got '%s'", result.TaskQueue)
		}
	})

	t.Run("session with no runner_id — routes to available runner", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_1", "my-runner", runnerv1.RunnerPhase_RUNNER_PHASE_READY, "runner:rnr_1")
		saveSession(t, s, "sess_1", "")

		result, err := ResolveActivityTaskQueue(context.Background(), s, "sess_1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != "runner:rnr_1" {
			t.Errorf("expected task queue 'runner:rnr_1', got '%s'", result.TaskQueue)
		}
		if result.RunnerID != "rnr_1" {
			t.Errorf("expected runner ID 'rnr_1', got '%s'", result.RunnerID)
		}
	})
}

func TestResolveActivityTaskQueue_ExplicitBinding(t *testing.T) {
	t.Run("session with explicit runner — uses per-runner queue", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_explicit", "explicit-runner", runnerv1.RunnerPhase_RUNNER_PHASE_READY, "runner:rnr_explicit")
		saveSession(t, s, "sess_1", "rnr_explicit")

		result, err := ResolveActivityTaskQueue(context.Background(), s, "sess_1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != "runner:rnr_explicit" {
			t.Errorf("expected task queue 'runner:rnr_explicit', got '%s'", result.TaskQueue)
		}
		if result.RunnerID != "rnr_explicit" {
			t.Errorf("expected runner ID 'rnr_explicit', got '%s'", result.RunnerID)
		}
	})

	t.Run("explicit runner not found — error", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveSession(t, s, "sess_1", "rnr_deleted")

		_, err := ResolveActivityTaskQueue(context.Background(), s, "sess_1")
		if err == nil {
			t.Fatal("expected error when runner is not found")
		}
		if !strings.Contains(err.Error(), "not found") {
			t.Errorf("expected 'not found' in error, got: %v", err)
		}
	})

	t.Run("explicit runner STOPPED — error", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_stopped", "stopped-runner", runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED, "runner:rnr_stopped")
		saveSession(t, s, "sess_1", "rnr_stopped")

		_, err := ResolveActivityTaskQueue(context.Background(), s, "sess_1")
		if err == nil {
			t.Fatal("expected error when runner is STOPPED")
		}
		if !strings.Contains(err.Error(), "STOPPED") {
			t.Errorf("expected 'STOPPED' in error, got: %v", err)
		}
	})
}

func TestResolveActivityTaskQueue_FailFast(t *testing.T) {
	t.Run("no runners registered — error with guidance", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		_, err := ResolveActivityTaskQueue(context.Background(), s, "")
		if err == nil {
			t.Fatal("expected error when no runners exist")
		}
		if !strings.Contains(err.Error(), "no runners registered") {
			t.Errorf("expected 'no runners registered' in error, got: %v", err)
		}
		if !strings.Contains(err.Error(), "stigmer up") {
			t.Errorf("expected guidance mentioning 'stigmer up', got: %v", err)
		}
	})

	t.Run("all runners STOPPED — error with count", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_1", "runner-1", runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED, "runner:rnr_1")
		saveRunner(t, s, "rnr_2", "runner-2", runnerv1.RunnerPhase_RUNNER_PHASE_FAILED, "runner:rnr_2")

		_, err := ResolveActivityTaskQueue(context.Background(), s, "")
		if err == nil {
			t.Fatal("expected error when all runners are inactive")
		}
		if !strings.Contains(err.Error(), "no active runners available") {
			t.Errorf("expected 'no active runners available' in error, got: %v", err)
		}
		if !strings.Contains(err.Error(), "2 runner(s)") {
			t.Errorf("expected '2 runner(s)' count in error, got: %v", err)
		}
	})

	t.Run("all runners PENDING — error", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_1", "pending-runner", runnerv1.RunnerPhase_RUNNER_PHASE_PENDING, "runner:rnr_1")

		_, err := ResolveActivityTaskQueue(context.Background(), s, "")
		if err == nil {
			t.Fatal("expected error when only PENDING runners exist")
		}
		if !strings.Contains(err.Error(), "no active runners") {
			t.Errorf("expected 'no active runners' in error, got: %v", err)
		}
	})
}

func TestResolveActivityTaskQueue_RunnerPreference(t *testing.T) {
	t.Run("prefers READY over BUSY", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_busy", "busy-runner", runnerv1.RunnerPhase_RUNNER_PHASE_BUSY, "runner:rnr_busy")
		saveRunner(t, s, "rnr_ready", "ready-runner", runnerv1.RunnerPhase_RUNNER_PHASE_READY, "runner:rnr_ready")

		result, err := ResolveActivityTaskQueue(context.Background(), s, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.RunnerID != "rnr_ready" {
			t.Errorf("expected READY runner 'rnr_ready', got '%s'", result.RunnerID)
		}
	})

	t.Run("falls back to BUSY when no READY runners", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_busy", "busy-runner", runnerv1.RunnerPhase_RUNNER_PHASE_BUSY, "runner:rnr_busy")
		saveRunner(t, s, "rnr_stopped", "stopped-runner", runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED, "runner:rnr_stopped")

		result, err := ResolveActivityTaskQueue(context.Background(), s, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.RunnerID != "rnr_busy" {
			t.Errorf("expected BUSY runner 'rnr_busy', got '%s'", result.RunnerID)
		}
		if result.TaskQueue != "runner:rnr_busy" {
			t.Errorf("expected task queue 'runner:rnr_busy', got '%s'", result.TaskQueue)
		}
	})
}

func TestResolveActivityTaskQueue_HasRunner(t *testing.T) {
	t.Run("auto-routed result has runner", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveRunner(t, s, "rnr_1", "my-runner", runnerv1.RunnerPhase_RUNNER_PHASE_READY, "runner:rnr_1")

		result, err := ResolveActivityTaskQueue(context.Background(), s, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !result.HasRunner() {
			t.Error("expected HasRunner() to be true for auto-routed result")
		}
	})
}
