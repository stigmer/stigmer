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
		StigmerQueue:    "agent_execution_stigmer",
		RunnerQueue:     DefaultActivityTaskQueue,
		ActivityRouting: RoutingGlobal,
	}
}

func sessionConfig() *Config {
	return &Config{
		StigmerQueue:    "agent_execution_stigmer",
		RunnerQueue:     DefaultActivityTaskQueue,
		ActivityRouting: RoutingSession,
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

		result, err := ResolveActivityTaskQueue(context.Background(), s, "", cfg)
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

		result, err := ResolveActivityTaskQueue(context.Background(), s, "nonexistent-session", cfg)
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

		result, err := ResolveActivityTaskQueue(context.Background(), s, "ses_global_test", cfg)
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

		result, err := ResolveActivityTaskQueue(context.Background(), s, "", cfg)
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

		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, cfg)
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
		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, cfg)
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

		result, err := ResolveActivityTaskQueue(context.Background(), s, sessionID, cfg)
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
