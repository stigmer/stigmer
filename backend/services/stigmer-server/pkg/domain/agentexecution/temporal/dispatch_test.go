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

func globalConfig() *Config {
	return &Config{
		StigmerQueue:           "agent_execution_stigmer",
		RunnerQueue:            DefaultActivityTaskQueue,
		ActivityRouting:        RoutingGlobal,
		DefaultExecutionTarget: DefaultExecutionTargetLocal,
	}
}

func sessionConfig() *Config {
	return &Config{
		StigmerQueue:           "agent_execution_stigmer",
		RunnerQueue:            DefaultActivityTaskQueue,
		ActivityRouting:        RoutingSession,
		DefaultExecutionTarget: DefaultExecutionTargetLocal,
	}
}

func cloudConfig() *Config {
	return &Config{
		StigmerQueue:           "agent_execution_stigmer",
		RunnerQueue:            DefaultActivityTaskQueue,
		ActivityRouting:        RoutingSession,
		DefaultExecutionTarget: DefaultExecutionTargetCloud,
	}
}

func TestFormatSessionTaskQueue(t *testing.T) {
	tests := []struct {
		sessionID string
		want      string
	}{
		{"ses_01arz3ndektsv4rrffq69g5fav", "session:ses_01arz3ndektsv4rrffq69g5fav"},
		{"ses_abc123", "session:ses_abc123"},
		{"any-arbitrary-id", "session:any-arbitrary-id"},
	}

	for _, tt := range tests {
		t.Run(tt.sessionID, func(t *testing.T) {
			got := FormatSessionTaskQueue(tt.sessionID)
			if got != tt.want {
				t.Errorf("FormatSessionTaskQueue(%q) = %q, want %q", tt.sessionID, got, tt.want)
			}
		})
	}
}

func TestResolveActivityTaskQueue_GlobalRouting(t *testing.T) {
	cfg := globalConfig()

	t.Run("no session ID — returns default queue with NATIVE harness", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		result, err := ResolveActivityTaskQueue(context.Background(), s, "", cfg, "")
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

		result, err := ResolveActivityTaskQueue(context.Background(), s, "nonexistent-session", cfg, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != DefaultActivityTaskQueue {
			t.Errorf("expected task queue %q, got %q", DefaultActivityTaskQueue, result.TaskQueue)
		}
	})

	t.Run("valid session — returns default queue even with session present", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		saveSession(t, s, "ses_global_test", sessionv1.Harness_HARNESS_CURSOR)

		result, err := ResolveActivityTaskQueue(context.Background(), s, "ses_global_test", cfg, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != DefaultActivityTaskQueue {
			t.Errorf("global routing must always return default queue, got %q", result.TaskQueue)
		}
		if result.Harness != sessionv1.Harness_HARNESS_CURSOR {
			t.Errorf("expected HARNESS_CURSOR, got %v", result.Harness)
		}
	})
}

func TestResolveActivityTaskQueue_SessionRouting(t *testing.T) {
	cfg := sessionConfig()

	t.Run("no session ID — falls back to default queue", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		result, err := ResolveActivityTaskQueue(context.Background(), s, "", cfg, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != DefaultActivityTaskQueue {
			t.Errorf("empty session ID must fall back to default queue, got %q", result.TaskQueue)
		}
		if result.Harness != sessionv1.Harness_HARNESS_NATIVE {
			t.Errorf("expected HARNESS_NATIVE, got %v", result.Harness)
		}
	})

	t.Run("valid session ID — returns per-session queue", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		sessionID := "ses_01arz3ndektsv4rrffq69g5fav"
		saveSession(t, s, sessionID, sessionv1.Harness_HARNESS_NATIVE)

		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, cfg, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		expectedQueue := "session:" + sessionID
		if result.TaskQueue != expectedQueue {
			t.Errorf("expected task queue %q, got %q", expectedQueue, result.TaskQueue)
		}
		if result.Harness != sessionv1.Harness_HARNESS_NATIVE {
			t.Errorf("expected HARNESS_NATIVE, got %v", result.Harness)
		}
	})

	t.Run("session not found — still returns per-session queue", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		sessionID := "ses_nonexistent"
		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, cfg, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		expectedQueue := "session:" + sessionID
		if result.TaskQueue != expectedQueue {
			t.Errorf("expected task queue %q, got %q", expectedQueue, result.TaskQueue)
		}
		if result.Harness != sessionv1.Harness_HARNESS_NATIVE {
			t.Errorf("expected HARNESS_NATIVE (default when session not found), got %v", result.Harness)
		}
	})

	t.Run("CURSOR harness — returns per-session queue with correct harness", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		sessionID := "ses_cursor_session"
		saveSession(t, s, sessionID, sessionv1.Harness_HARNESS_CURSOR)

		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, cfg, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		expectedQueue := "session:" + sessionID
		if result.TaskQueue != expectedQueue {
			t.Errorf("expected task queue %q, got %q", expectedQueue, result.TaskQueue)
		}
		if result.Harness != sessionv1.Harness_HARNESS_CURSOR {
			t.Errorf("expected HARNESS_CURSOR, got %v", result.Harness)
		}
	})
}

func TestResolveTaskQueue(t *testing.T) {
	tests := []struct {
		name      string
		sessionID string
		cfg       *Config
		want      string
	}{
		{
			name:      "global routing ignores session ID",
			sessionID: "ses_123",
			cfg:       globalConfig(),
			want:      DefaultActivityTaskQueue,
		},
		{
			name:      "global routing with empty session ID",
			sessionID: "",
			cfg:       globalConfig(),
			want:      DefaultActivityTaskQueue,
		},
		{
			name:      "session routing with valid ID",
			sessionID: "ses_abc",
			cfg:       sessionConfig(),
			want:      "session:ses_abc",
		},
		{
			name:      "session routing with empty ID falls back",
			sessionID: "",
			cfg:       sessionConfig(),
			want:      DefaultActivityTaskQueue,
		},
		{
			name:      "custom runner queue used as fallback",
			sessionID: "",
			cfg:       &Config{RunnerQueue: "custom_queue", ActivityRouting: RoutingSession},
			want:      "custom_queue",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveTaskQueue(tt.sessionID, tt.cfg)
			if got != tt.want {
				t.Errorf("resolveTaskQueue(%q) = %q, want %q", tt.sessionID, got, tt.want)
			}
		})
	}
}

func TestResolveExecutionTarget(t *testing.T) {
	tests := []struct {
		name   string
		target sessionv1.ExecutionTarget
		cfg    *Config
		want   sessionv1.ExecutionTarget
	}{
		{
			name:   "LOCAL target passes through",
			target: sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL,
			cfg:    globalConfig(),
			want:   sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL,
		},
		{
			name:   "CLOUD target passes through",
			target: sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD,
			cfg:    globalConfig(),
			want:   sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD,
		},
		{
			name:   "UNSPECIFIED resolves to LOCAL when default is local",
			target: sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED,
			cfg:    sessionConfig(),
			want:   sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL,
		},
		{
			name:   "UNSPECIFIED resolves to CLOUD when default is cloud",
			target: sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED,
			cfg:    cloudConfig(),
			want:   sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.cfg.ResolveExecutionTarget(tt.target)
			if got != tt.want {
				t.Errorf("Config.ResolveExecutionTarget(%v) = %v, want %v", tt.target, got, tt.want)
			}
		})
	}
}

func TestResolveActivityTaskQueue_ExecutionTarget(t *testing.T) {
	t.Run("session with LOCAL target returns LOCAL in result", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		sessionID := "ses_local"
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata:   &apiresource.ApiResourceMetadata{Id: sessionID, Name: "test", Org: "test-org"},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-instance",
				Harness:         sessionv1.Harness_HARNESS_NATIVE,
				ExecutionTarget: sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL,
			},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_session, sessionID, session); err != nil {
			t.Fatalf("failed to save session: %v", err)
		}

		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, sessionConfig(), "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL {
			t.Errorf("expected LOCAL, got %v", result.ExecutionTarget)
		}
	})

	t.Run("session with CLOUD target returns CLOUD in result", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		sessionID := "ses_cloud"
		session := &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata:   &apiresource.ApiResourceMetadata{Id: sessionID, Name: "test", Org: "test-org"},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-instance",
				Harness:         sessionv1.Harness_HARNESS_NATIVE,
				ExecutionTarget: sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD,
			},
		}
		if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_session, sessionID, session); err != nil {
			t.Fatalf("failed to save session: %v", err)
		}

		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, sessionConfig(), "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD {
			t.Errorf("expected CLOUD, got %v", result.ExecutionTarget)
		}
	})

	t.Run("session with UNSPECIFIED target resolves based on config", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		sessionID := "ses_unspecified"
		saveSession(t, s, sessionID, sessionv1.Harness_HARNESS_NATIVE)

		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, cloudConfig(), "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD {
			t.Errorf("expected CLOUD (from config default), got %v", result.ExecutionTarget)
		}
	})

	t.Run("activity_task_queue override routes to parent workflow sandbox", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		sessionID := "ses_override_test"
		saveSession(t, s, sessionID, sessionv1.Harness_HARNESS_CURSOR)

		override := "wfexec:wfx_parent_abc123"
		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, sessionConfig(), override)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != override {
			t.Errorf("expected override queue %q, got %q", override, result.TaskQueue)
		}
		if result.Harness != sessionv1.Harness_HARNESS_CURSOR {
			t.Errorf("expected session's harness CURSOR, got %v", result.Harness)
		}
		if result.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL {
			t.Errorf("expected LOCAL (no provisioning needed), got %v", result.ExecutionTarget)
		}
	})

	t.Run("activity_task_queue override with no session still works", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		override := "wfexec:wfx_no_session"
		result, err := ResolveActivityTaskQueue(context.Background(), s, "", cloudConfig(), override)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != override {
			t.Errorf("expected override queue %q, got %q", override, result.TaskQueue)
		}
		if result.Harness != sessionv1.Harness_HARNESS_NATIVE {
			t.Errorf("expected default NATIVE harness, got %v", result.Harness)
		}
		if result.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL {
			t.Errorf("expected LOCAL (sandbox already exists), got %v", result.ExecutionTarget)
		}
	})

	t.Run("empty override falls through to normal routing", func(t *testing.T) {
		s := setupTestStore(t)
		defer s.Close()

		sessionID := "ses_no_override"
		saveSession(t, s, sessionID, sessionv1.Harness_HARNESS_NATIVE)

		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, sessionConfig(), "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.TaskQueue != FormatSessionTaskQueue(sessionID) {
			t.Errorf("expected session queue %q, got %q", FormatSessionTaskQueue(sessionID), result.TaskQueue)
		}
	})
}
