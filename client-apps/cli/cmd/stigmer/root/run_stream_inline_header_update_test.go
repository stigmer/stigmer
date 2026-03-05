package root

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
)

func TestPollSessionSubject_ImmediateCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	ch := make(chan string, 1)
	pollSessionSubject(ctx, nil, "ses-test", ch)

	select {
	case <-ch:
		t.Error("should not send on channel when context is cancelled immediately")
	default:
	}
}

func TestPollSessionSubject_RespectsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan string, 1)

	done := make(chan struct{})
	go func() {
		pollSessionSubject(ctx, nil, "ses-test", ch)
		close(done)
	}()

	time.Sleep(100 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("pollSessionSubject did not exit after context cancellation")
	}

	select {
	case <-ch:
		t.Error("should not send subject when cancelled before first poll")
	default:
	}
}

func TestResolvedSubject_PendingSentinel(t *testing.T) {
	assert.Equal(t, "", session.ResolvedSubject("Auto-created session"))
}

func TestResolvedSubject_RealSubject(t *testing.T) {
	assert.Equal(t, "Fix login bug", session.ResolvedSubject("Fix login bug"))
}

func TestResolvedSubject_Empty(t *testing.T) {
	assert.Equal(t, "", session.ResolvedSubject(""))
}

func TestSubjectPollConstants(t *testing.T) {
	require.Equal(t, 3*time.Second, subjectPollInterval)
	require.Equal(t, 10, subjectPollMaxTries)
}
