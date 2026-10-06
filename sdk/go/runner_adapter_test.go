package stigmer

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockRunnerAdapter records all calls for verification.
type mockRunnerAdapter struct {
	sessionsOpened []string
	sessionsClosed []string
	runsCreated    []string
	runsTerminated []string
}

func (m *mockRunnerAdapter) OnSessionOpened(_ context.Context, sessionID string) error {
	m.sessionsOpened = append(m.sessionsOpened, sessionID)
	return nil
}

func (m *mockRunnerAdapter) OnSessionClosed(_ context.Context, sessionID string) error {
	m.sessionsClosed = append(m.sessionsClosed, sessionID)
	return nil
}

func (m *mockRunnerAdapter) OnWorkflowRunCreated(_ context.Context, runID string) error {
	m.runsCreated = append(m.runsCreated, runID)
	return nil
}

func (m *mockRunnerAdapter) OnWorkflowRunTerminated(_ context.Context, runID string) error {
	m.runsTerminated = append(m.runsTerminated, runID)
	return nil
}

// Compile-time interface satisfaction check.
var _ RunnerAdapter = (*mockRunnerAdapter)(nil)

func TestRunnerAdapter_InterfaceSatisfaction(t *testing.T) {
	// Verify that a struct implementing all methods satisfies the interface.
	var adapter RunnerAdapter = &mockRunnerAdapter{}
	require.NotNil(t, adapter)
}

func TestRunnerAdapter_MockRecordsCalls(t *testing.T) {
	ctx := context.Background()
	adapter := &mockRunnerAdapter{}

	err := adapter.OnSessionOpened(ctx, "ses-1")
	require.NoError(t, err)

	err = adapter.OnSessionOpened(ctx, "ses-2")
	require.NoError(t, err)

	err = adapter.OnSessionClosed(ctx, "ses-1")
	require.NoError(t, err)

	err = adapter.OnWorkflowRunCreated(ctx, "wfexec-1")
	require.NoError(t, err)

	err = adapter.OnWorkflowRunTerminated(ctx, "wfexec-1")
	require.NoError(t, err)

	assert.Equal(t, []string{"ses-1", "ses-2"}, adapter.sessionsOpened)
	assert.Equal(t, []string{"ses-1"}, adapter.sessionsClosed)
	assert.Equal(t, []string{"wfexec-1"}, adapter.runsCreated)
	assert.Equal(t, []string{"wfexec-1"}, adapter.runsTerminated)
}

func TestWithRunnerAdapter_SetsOnClient(t *testing.T) {
	adapter := &mockRunnerAdapter{}

	// Use WithInsecure to avoid needing real credentials.
	client, err := NewClient(
		WithBaseURL("localhost:7234"),
		WithInsecure(),
		WithRunnerAdapter(adapter),
	)
	require.NoError(t, err)
	defer client.Close()

	assert.Equal(t, adapter, client.RunnerAdapter)
}

func TestWithRunnerAdapter_NilIsNoOp(t *testing.T) {
	client, err := NewClient(
		WithBaseURL("localhost:7234"),
		WithInsecure(),
	)
	require.NoError(t, err)
	defer client.Close()

	assert.Nil(t, client.RunnerAdapter)
}
