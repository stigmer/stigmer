package runner

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockDockerClient implements DockerClient for testing without a Docker daemon.
type mockDockerClient struct {
	available    bool
	availableErr error

	runID  string
	runErr error

	inspectState ContainerState
	inspectErr   error
	inspectCalls int

	stopErr error
	stopID  string

	removeErr error
	removeID  string

	waitCode int
	waitErr  error
}

func (m *mockDockerClient) IsAvailable(_ context.Context) error {
	if !m.available {
		if m.availableErr != nil {
			return m.availableErr
		}
		return fmt.Errorf("docker not available")
	}
	return nil
}

func (m *mockDockerClient) Run(_ context.Context, _ ContainerRunOpts) (string, error) {
	return m.runID, m.runErr
}

func (m *mockDockerClient) Inspect(_ context.Context, _ string) (ContainerState, error) {
	m.inspectCalls++
	return m.inspectState, m.inspectErr
}

func (m *mockDockerClient) Stop(_ context.Context, id string) error {
	m.stopID = id
	return m.stopErr
}

func (m *mockDockerClient) Remove(_ context.Context, id string) error {
	m.removeID = id
	return m.removeErr
}

func (m *mockDockerClient) Wait(_ context.Context, _ string) (int, error) {
	return m.waitCode, m.waitErr
}

func (m *mockDockerClient) Logs(_ context.Context, _ string) error {
	return nil
}

func TestDefaultImage(t *testing.T) {
	tests := []struct {
		version  string
		expected string
	}{
		{"1.2.3", "ghcr.io/stigmer/agent-runner:1.2.3"},
		{"v0.5.0", "ghcr.io/stigmer/agent-runner:v0.5.0"},
		{"dev", "ghcr.io/stigmer/agent-runner:latest"},
		{"", "ghcr.io/stigmer/agent-runner:latest"},
	}
	for _, tt := range tests {
		t.Run(tt.version, func(t *testing.T) {
			assert.Equal(t, tt.expected, DefaultImage(tt.version))
		})
	}
}

func TestWaitUntilRunning_ImmediatelyRunning(t *testing.T) {
	dc := &mockDockerClient{
		inspectState: ContainerState{Running: true},
	}
	ctx := context.Background()
	err := WaitUntilRunning(ctx, dc, "abc123", 5*time.Second)
	require.NoError(t, err)
	assert.Equal(t, 1, dc.inspectCalls)
}

func TestWaitUntilRunning_ContainerExitsBeforeRunning(t *testing.T) {
	dc := &mockDockerClient{
		inspectState: ContainerState{Running: false, ExitCode: 1},
	}
	ctx := context.Background()
	err := WaitUntilRunning(ctx, dc, "abc123", 5*time.Second)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exited with code 1")
}

func TestWaitUntilRunning_ContextCancelled(t *testing.T) {
	dc := &mockDockerClient{
		inspectState: ContainerState{Running: false, ExitCode: 0},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := WaitUntilRunning(ctx, dc, "abc123", 5*time.Second)
	require.Error(t, err)
}

func TestWaitUntilRunning_InspectError(t *testing.T) {
	dc := &mockDockerClient{
		inspectErr: fmt.Errorf("connection refused"),
	}
	ctx := context.Background()
	err := WaitUntilRunning(ctx, dc, "abc123", 5*time.Second)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to inspect container")
}

func TestIsContainerAlive_Running(t *testing.T) {
	dc := &mockDockerClient{
		inspectState: ContainerState{Running: true},
	}
	assert.True(t, IsContainerAlive(dc, "abc123def456"))
}

func TestIsContainerAlive_Stopped(t *testing.T) {
	dc := &mockDockerClient{
		inspectState: ContainerState{Running: false},
	}
	assert.False(t, IsContainerAlive(dc, "abc123def456"))
}

func TestIsContainerAlive_InspectError(t *testing.T) {
	dc := &mockDockerClient{
		inspectErr: fmt.Errorf("no such container"),
	}
	assert.False(t, IsContainerAlive(dc, "abc123def456"))
}

func TestIsContainerAlive_EmptyID(t *testing.T) {
	dc := &mockDockerClient{
		inspectState: ContainerState{Running: true},
	}
	assert.False(t, IsContainerAlive(dc, ""))
}

func TestResolveRuntime(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"", RuntimeNative},
		{"native", RuntimeNative},
		{"docker", RuntimeDocker},
		{"Docker", RuntimeDocker},
		{"DOCKER", RuntimeDocker},
		{"  docker  ", RuntimeDocker},
		{"unknown", RuntimeNative},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("%q", tt.input), func(t *testing.T) {
			assert.Equal(t, tt.expected, resolveRuntime(tt.input))
		})
	}
}

func TestTruncateID(t *testing.T) {
	assert.Equal(t, "abc123def456", truncateID("abc123def4567890"))
	assert.Equal(t, "short", truncateID("short"))
	assert.Equal(t, "", truncateID(""))
}
