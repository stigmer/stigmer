package stigmer

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockRunnerAdapter records all calls for verification.
type mockRunnerAdapter struct {
	sessionsCreated    []string
	sessionsTerminated []string
	executionsCreated  []string
	executionsTerminated []string
}

func (m *mockRunnerAdapter) OnSessionCreated(_ context.Context, sessionID string) error {
	m.sessionsCreated = append(m.sessionsCreated, sessionID)
	return nil
}

func (m *mockRunnerAdapter) OnSessionTerminated(_ context.Context, sessionID string) error {
	m.sessionsTerminated = append(m.sessionsTerminated, sessionID)
	return nil
}

func (m *mockRunnerAdapter) OnWorkflowExecutionCreated(_ context.Context, executionID string) error {
	m.executionsCreated = append(m.executionsCreated, executionID)
	return nil
}

func (m *mockRunnerAdapter) OnWorkflowExecutionTerminated(_ context.Context, executionID string) error {
	m.executionsTerminated = append(m.executionsTerminated, executionID)
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

	err := adapter.OnSessionCreated(ctx, "ses-1")
	require.NoError(t, err)

	err = adapter.OnSessionCreated(ctx, "ses-2")
	require.NoError(t, err)

	err = adapter.OnSessionTerminated(ctx, "ses-1")
	require.NoError(t, err)

	err = adapter.OnWorkflowExecutionCreated(ctx, "wfexec-1")
	require.NoError(t, err)

	err = adapter.OnWorkflowExecutionTerminated(ctx, "wfexec-1")
	require.NoError(t, err)

	assert.Equal(t, []string{"ses-1", "ses-2"}, adapter.sessionsCreated)
	assert.Equal(t, []string{"ses-1"}, adapter.sessionsTerminated)
	assert.Equal(t, []string{"wfexec-1"}, adapter.executionsCreated)
	assert.Equal(t, []string{"wfexec-1"}, adapter.executionsTerminated)
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
