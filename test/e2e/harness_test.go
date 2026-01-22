package e2e

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestHarness manages the stigmer-server process for testing
type TestHarness struct {
	ServerCmd  *exec.Cmd
	ServerPort int
	TempDir    string
	t          *testing.T
}

// StartHarness starts a stigmer-server instance with isolated storage
func StartHarness(t *testing.T, tempDir string) *TestHarness {
	// Get free port
	port, err := GetFreePort()
	require.NoError(t, err, "Failed to get free port")

	// Resolve path to stigmer-server main.go
	// We're in test/e2e, server is at ../../backend/services/stigmer-server/cmd/server/main.go
	cwd, err := os.Getwd()
	require.NoError(t, err, "Failed to get working directory")

	serverPath := filepath.Join(cwd, "..", "..", "backend", "services", "stigmer-server", "cmd", "server", "main.go")

	// Start stigmer-server using go run
	serverCmd := exec.Command("go", "run", serverPath)
	
	// Set database path to a file inside the temp directory
	dbPath := filepath.Join(tempDir, "stigmer.db")
	
	serverCmd.Env = append(os.Environ(),
		fmt.Sprintf("DB_PATH=%s", dbPath),
		fmt.Sprintf("GRPC_PORT=%d", port),
		"ENV=local",
		"LOG_LEVEL=info",
	)
	
	// Capture output for debugging
	serverCmd.Stdout = os.Stdout
	serverCmd.Stderr = os.Stderr

	err = serverCmd.Start()
	require.NoError(t, err, "Failed to start stigmer-server")

	t.Logf("Started stigmer-server on port %d with DB_PATH=%s", port, dbPath)

	// Wait for server to become healthy
	healthy := WaitForPort(port, 10*time.Second)
	if !healthy {
		// Clean up if server failed to start
		if serverCmd.Process != nil {
			serverCmd.Process.Kill()
		}
		require.True(t, healthy, "Server failed to become healthy within 10 seconds")
	}

	t.Logf("stigmer-server is healthy and accepting connections")

	return &TestHarness{
		ServerCmd:  serverCmd,
		ServerPort: port,
		TempDir:    tempDir,
		t:          t,
	}
}

// Stop gracefully stops the stigmer-server process
func (h *TestHarness) Stop() {
	if h.ServerCmd != nil && h.ServerCmd.Process != nil {
		h.t.Logf("Stopping stigmer-server (PID: %d)", h.ServerCmd.Process.Pid)
		
		// Try graceful termination first
		h.ServerCmd.Process.Kill()
		
		// Wait for process to exit (with timeout)
		done := make(chan error, 1)
		go func() {
			done <- h.ServerCmd.Wait()
		}()

		select {
		case <-done:
			h.t.Logf("stigmer-server stopped successfully")
		case <-time.After(5 * time.Second):
			h.t.Logf("stigmer-server did not stop gracefully, forcing kill")
			// Force kill if it doesn't stop
			h.ServerCmd.Process.Kill()
		}
	}
}
