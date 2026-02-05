package reconcile

import (
	"errors"
	"testing"
)

func TestNewReconciliationError(t *testing.T) {
	err := NewReconciliationError("agent:my-agent", "validation failed")

	t.Run("has correct resource key", func(t *testing.T) {
		if err.ResourceKey() != "agent:my-agent" {
			t.Errorf("expected resource key 'agent:my-agent', got %q", err.ResourceKey())
		}
	})

	t.Run("has correct message", func(t *testing.T) {
		if err.Message() != "validation failed" {
			t.Errorf("expected message 'validation failed', got %q", err.Message())
		}
	})

	t.Run("has no cause", func(t *testing.T) {
		if err.HasCause() {
			t.Error("expected no cause")
		}
	})

	t.Run("cause is nil", func(t *testing.T) {
		if err.Cause() != nil {
			t.Error("expected cause to be nil")
		}
	})
}

func TestNewReconciliationErrorWithCause(t *testing.T) {
	cause := errors.New("database connection refused")
	err := NewReconciliationErrorWithCause("workflow:pipeline", "create failed", cause)

	t.Run("has correct resource key", func(t *testing.T) {
		if err.ResourceKey() != "workflow:pipeline" {
			t.Errorf("expected resource key 'workflow:pipeline', got %q", err.ResourceKey())
		}
	})

	t.Run("has correct message", func(t *testing.T) {
		if err.Message() != "create failed" {
			t.Errorf("expected message 'create failed', got %q", err.Message())
		}
	})

	t.Run("has cause", func(t *testing.T) {
		if !err.HasCause() {
			t.Error("expected to have cause")
		}
	})

	t.Run("cause is correct", func(t *testing.T) {
		if err.Cause() != cause {
			t.Error("expected cause to be the original error")
		}
	})

	t.Run("unwrap returns cause", func(t *testing.T) {
		if err.Unwrap() != cause {
			t.Error("expected Unwrap to return cause")
		}
	})

	t.Run("works with errors.Is", func(t *testing.T) {
		if !errors.Is(err, cause) {
			t.Error("expected errors.Is to find cause")
		}
	})
}

func TestReconciliationError_Error(t *testing.T) {
	tests := []struct {
		name        string
		resourceKey string
		message     string
		cause       error
		expected    string
	}{
		{
			name:        "without cause",
			resourceKey: "agent:my-agent",
			message:     "validation failed",
			cause:       nil,
			expected:    "agent:my-agent: validation failed",
		},
		{
			name:        "with cause",
			resourceKey: "workflow:pipeline",
			message:     "create failed",
			cause:       errors.New("connection refused"),
			expected:    "workflow:pipeline: create failed: connection refused",
		},
		{
			name:        "with nested error",
			resourceKey: "mcp_server:db",
			message:     "delete failed",
			cause:       errors.New("resource in use"),
			expected:    "mcp_server:db: delete failed: resource in use",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var err ReconciliationError
			if tt.cause != nil {
				err = NewReconciliationErrorWithCause(tt.resourceKey, tt.message, tt.cause)
			} else {
				err = NewReconciliationError(tt.resourceKey, tt.message)
			}

			if err.Error() != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, err.Error())
			}
		})
	}
}

func TestReconciliationError_ImplementsError(t *testing.T) {
	var _ error = ReconciliationError{}
	var _ error = NewReconciliationError("test", "message")
}
