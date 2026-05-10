package controlsock

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testState implements StateProvider for tests.
type testState struct {
	mu     sync.Mutex
	status StatusResponse
}

func (s *testState) Status() StatusResponse {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func newTestState() *testState {
	return &testState{
		status: StatusResponse{
			OK:              true,
			RunnerID:        "rnr-test-123",
			Name:            "test-runner",
			MachineID:       "mach_aabbccdd11223344aabbccdd11223344",
			Org:             "acme",
			BackendEndpoint: "api.stigmer.ai:443",
			TaskQueue:       "runner:rnr-test-123",
			PID:             os.Getpid(),
			StartedAt:       time.Date(2026, 5, 9, 12, 0, 0, 0, time.UTC),
			Uptime:          "2h30m",
			Runtime:         "native",
			Version:         "0.5.0",
		},
	}
}

// testSocketPath returns a short, unique socket path under /tmp.
// t.TempDir() paths exceed macOS's 104-byte sun_path limit when
// combined with long test function names. Using /tmp directly
// keeps paths well within bounds.
func testSocketPath(t *testing.T) string {
	t.Helper()
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	sockPath := fmt.Sprintf("/tmp/stgm-test-%s.sock", hex.EncodeToString(b))
	t.Cleanup(func() { os.Remove(sockPath) })
	return sockPath
}

func startTestServer(t *testing.T, state StateProvider, stopFn context.CancelFunc) *Server {
	t.Helper()
	sockPath := testSocketPath(t)
	srv := NewServer(sockPath, state, stopFn)
	require.NoError(t, srv.Start())
	t.Cleanup(func() {
		_ = srv.Shutdown(context.Background())
	})
	return srv
}

// --- Server Tests ---

func TestServer_StartsAndRespondsToStatus(t *testing.T) {
	state := newTestState()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := startTestServer(t, state, cancel)

	status, err := Ping(srv.SocketPath())
	require.NoError(t, err)
	assert.True(t, status.OK)
	assert.Equal(t, "rnr-test-123", status.RunnerID)
	assert.Equal(t, "test-runner", status.Name)
	assert.Equal(t, "mach_aabbccdd11223344aabbccdd11223344", status.MachineID)
	assert.Equal(t, "acme", status.Org)
	assert.Equal(t, "api.stigmer.ai:443", status.BackendEndpoint)
	assert.Equal(t, os.Getpid(), status.PID)
	assert.Equal(t, "native", status.Runtime)
	assert.Equal(t, "0.5.0", status.Version)
}

func TestServer_CleansUpStaleSocket(t *testing.T) {
	sockPath := testSocketPath(t)

	// Create a stale socket file (regular file, not a real socket).
	require.NoError(t, os.WriteFile(sockPath, []byte("stale"), 0600))

	state := newTestState()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := NewServer(sockPath, state, cancel)
	require.NoError(t, srv.Start())
	defer func() { _ = srv.Shutdown(context.Background()) }()

	// Server should have removed the stale file and bound successfully.
	status, err := Ping(sockPath)
	require.NoError(t, err)
	assert.True(t, status.OK)
}

func TestServer_StopTriggersCancelFunc(t *testing.T) {
	state := newTestState()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := startTestServer(t, state, cancel)

	err := Stop(srv.SocketPath())
	require.NoError(t, err)

	// The cancel function should have been called.
	select {
	case <-ctx.Done():
		// Expected: context was cancelled by the stop handler.
	case <-time.After(2 * time.Second):
		t.Fatal("stop did not trigger context cancellation within timeout")
	}
}

func TestServer_UnknownRouteReturns404(t *testing.T) {
	state := newTestState()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := startTestServer(t, state, cancel)

	client := newHTTPClient(srv.SocketPath())
	defer client.CloseIdleConnections()

	resp, err := client.Get("http://localhost/nonexistent")
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, 404, resp.StatusCode)
}

func TestServer_ConcurrentStatusRequests(t *testing.T) {
	state := newTestState()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := startTestServer(t, state, cancel)

	const goroutines = 10
	var wg sync.WaitGroup
	var successCount atomic.Int32

	wg.Add(goroutines)
	for range goroutines {
		go func() {
			defer wg.Done()
			status, err := Ping(srv.SocketPath())
			if err == nil && status.OK {
				successCount.Add(1)
			}
		}()
	}
	wg.Wait()

	assert.Equal(t, int32(goroutines), successCount.Load())
}

func TestServer_ShutdownRemovesSocket(t *testing.T) {
	sockPath := testSocketPath(t)
	state := newTestState()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := NewServer(sockPath, state, cancel)
	require.NoError(t, srv.Start())

	// Socket file should exist after start.
	_, err := os.Stat(sockPath)
	require.NoError(t, err)

	require.NoError(t, srv.Shutdown(context.Background()))

	// Socket file should be gone after shutdown.
	_, err = os.Stat(sockPath)
	assert.True(t, os.IsNotExist(err))
}

func TestServer_SocketPermissions(t *testing.T) {
	sockPath := testSocketPath(t)
	state := newTestState()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := NewServer(sockPath, state, cancel)
	require.NoError(t, srv.Start())
	defer func() { _ = srv.Shutdown(context.Background()) }()

	info, err := os.Stat(sockPath)
	require.NoError(t, err)
	// Owner-only read/write (0600). The socket type bit is also set by
	// the OS, so mask to permission bits only.
	assert.Equal(t, os.FileMode(0600), info.Mode().Perm())
}

// --- Client Tests ---

func TestPing_NonexistentSocket(t *testing.T) {
	_, err := Ping("/tmp/nonexistent-stigmer-test.sock")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "control socket unreachable")
}

func TestPing_StaleSocketFile(t *testing.T) {
	// Create a real socket file but don't listen on it.
	sockPath := testSocketPath(t)

	ln, err := net.Listen("unix", sockPath)
	require.NoError(t, err)
	ln.Close() // Close immediately — socket file remains but no listener.

	_, err = Ping(sockPath)
	assert.Error(t, err)
}

func TestStop_NonexistentSocket(t *testing.T) {
	err := Stop("/tmp/nonexistent-stigmer-test.sock")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "control socket unreachable")
}

func TestIsHealthy_RunningServer(t *testing.T) {
	state := newTestState()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := startTestServer(t, state, cancel)

	assert.True(t, IsHealthy(srv.SocketPath()))
}

func TestIsHealthy_DeadSocket(t *testing.T) {
	assert.False(t, IsHealthy("/tmp/nonexistent-stigmer-test.sock"))
}

func TestIsHealthy_StaleSocketFile(t *testing.T) {
	sockPath := testSocketPath(t)

	ln, err := net.Listen("unix", sockPath)
	require.NoError(t, err)
	ln.Close()

	assert.False(t, IsHealthy(sockPath))
}

func TestPing_SucceedsAgainstRunningServer(t *testing.T) {
	state := newTestState()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := startTestServer(t, state, cancel)

	status, err := Ping(srv.SocketPath())
	require.NoError(t, err)

	assert.True(t, status.OK)
	assert.Equal(t, "rnr-test-123", status.RunnerID)
	assert.Equal(t, "acme", status.Org)
}

func TestStop_SucceedsAndReturnsBeforeShutdown(t *testing.T) {
	state := newTestState()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	srv := startTestServer(t, state, cancel)

	// Stop should return successfully before the server shuts down.
	err := Stop(srv.SocketPath())
	require.NoError(t, err)

	// Context should be cancelled shortly after.
	select {
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("context was not cancelled after stop")
	}
}
