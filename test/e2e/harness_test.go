package e2e

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestHarness manages the stigmer-server process and optional Docker services for testing
type TestHarness struct {
	// Server management
	ServerCmd  *exec.Cmd
	ServerPort int
	TempDir    string
	t          *testing.T
	
	// Phase 2: Docker services (optional, for full execution tests)
	DockerComposeCmd *exec.Cmd
	DockerEnabled    bool
	TemporalReady    bool
	AgentRunnerReady bool
}

// StartHarness starts a stigmer-server instance with isolated storage
// For Phase 1 (smoke tests), this is all that's needed
func StartHarness(t *testing.T, tempDir string) *TestHarness {
	return StartHarnessWithDocker(t, tempDir, false)
}

// StartHarnessWithDocker starts stigmer-server and optionally Docker services (Temporal + agent-runner)
// Set enableDocker=true for Phase 2 (full execution) tests
func StartHarnessWithDocker(t *testing.T, tempDir string, enableDocker bool) *TestHarness {
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
		"ENV=test", // Use "test" instead of "local" to disable debug HTTP server
		"LOG_LEVEL=info",
	)
	
	// Capture output for debugging
	serverCmd.Stdout = os.Stdout
	serverCmd.Stderr = os.Stderr
	
	// Set process group so we can kill all child processes
	// This ensures signals propagate to the actual Go server process
	serverCmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}

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

	harness := &TestHarness{
		ServerCmd:     serverCmd,
		ServerPort:    port,
		TempDir:       tempDir,
		t:             t,
		DockerEnabled: enableDocker,
	}

	// Start Docker services if requested
	if enableDocker {
		if err := harness.startDockerServices(); err != nil {
			// Clean up server if Docker fails
			harness.Stop()
			require.NoError(t, err, "Failed to start Docker services")
		}
	}

	return harness
}

// Stop gracefully stops the stigmer-server process and Docker services
func (h *TestHarness) Stop() {
	// Stop Docker services first (if enabled)
	if h.DockerEnabled {
		h.stopDockerServices()
	}

	// Then stop stigmer-server
	if h.ServerCmd != nil && h.ServerCmd.Process != nil {
		h.t.Logf("Stopping stigmer-server (PID: %d)", h.ServerCmd.Process.Pid)
		
		// Send SIGINT to the entire process group
		// This ensures both 'go run' and the actual Go binary receive the signal
		pgid, err := syscall.Getpgid(h.ServerCmd.Process.Pid)
		if err != nil {
			h.t.Logf("Failed to get process group: %v, falling back to direct kill", err)
			h.ServerCmd.Process.Kill()
			h.ServerCmd.Wait()
			return
		}
		
		// Send SIGINT to process group (negative PID means process group)
		if err := syscall.Kill(-pgid, syscall.SIGINT); err != nil {
			h.t.Logf("Failed to send interrupt to process group: %v, forcing kill", err)
			h.ServerCmd.Process.Kill()
			h.ServerCmd.Wait()
			return
		}
		
		h.t.Logf("Sent SIGINT to process group %d", pgid)
		
		// Wait for process to exit (with timeout)
		done := make(chan error, 1)
		go func() {
			done <- h.ServerCmd.Wait()
		}()

		select {
		case err := <-done:
			if err != nil {
				h.t.Logf("stigmer-server exited with error: %v", err)
			} else {
				h.t.Logf("stigmer-server stopped gracefully")
			}
		case <-time.After(5 * time.Second):
			h.t.Logf("stigmer-server did not stop gracefully within 5 seconds, forcing kill")
			// Force kill entire process group
			syscall.Kill(-pgid, syscall.SIGKILL)
			h.ServerCmd.Wait() // Wait for zombie process cleanup
		}
	}
}

// startDockerServices starts Temporal and agent-runner via docker-compose
func (h *TestHarness) startDockerServices() error {
	h.t.Log("Starting Docker services (Temporal + agent-runner)...")

	// Get path to docker-compose file
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to get working directory: %w", err)
	}

	composePath := filepath.Join(cwd, "docker-compose.e2e.yml")

	// Set server port as environment variable for docker-compose
	env := append(os.Environ(),
		fmt.Sprintf("STIGMER_SERVER_PORT=%d", h.ServerPort),
	)

	// Start docker-compose
	cmd := exec.Command("docker-compose", "-f", composePath, "-p", "stigmer-e2e", "up", "-d")
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to start docker-compose: %w", err)
	}

	h.t.Log("Docker containers started, waiting for services to be healthy...")

	// Wait for Temporal to be healthy
	if !h.waitForTemporal(30 * time.Second) {
		return fmt.Errorf("Temporal failed to become healthy within 30 seconds")
	}
	h.TemporalReady = true
	h.t.Log("✓ Temporal is healthy")

	// Wait for agent-runner to be healthy
	if !h.waitForAgentRunner(30 * time.Second) {
		return fmt.Errorf("agent-runner failed to become healthy within 30 seconds")
	}
	h.AgentRunnerReady = true
	h.t.Log("✓ agent-runner is healthy")

	h.t.Log("✅ All Docker services ready")
	return nil
}

// stopDockerServices stops and removes Docker containers
func (h *TestHarness) stopDockerServices() {
	if !h.DockerEnabled {
		return
	}

	h.t.Log("Stopping Docker services...")

	cwd, err := os.Getwd()
	if err != nil {
		h.t.Logf("Warning: Failed to get working directory: %v", err)
		return
	}

	composePath := filepath.Join(cwd, "docker-compose.e2e.yml")

	// Stop and remove containers
	cmd := exec.Command("docker-compose", "-f", composePath, "-p", "stigmer-e2e", "down", "-v")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		h.t.Logf("Warning: Failed to stop docker-compose: %v", err)
	} else {
		h.t.Log("Docker services stopped and removed")
	}
}

// waitForTemporal checks if Temporal is healthy
func (h *TestHarness) waitForTemporal(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		// Try to connect to Temporal's gRPC port
		if WaitForPort(7233, 100*time.Millisecond) {
			// Additional check: Try tctl command
			cmd := exec.Command("docker", "exec", "stigmer-e2e-temporal",
				"tctl", "--address", "localhost:7233", "cluster", "health")
			if err := cmd.Run(); err == nil {
				return true
			}
		}
		time.Sleep(1 * time.Second)
	}
	return false
}

// waitForAgentRunner checks if agent-runner container is running
func (h *TestHarness) waitForAgentRunner(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		// Check container status
		cmd := exec.Command("docker", "ps", "--filter", "name=stigmer-e2e-agent-runner",
			"--filter", "status=running", "--format", "{{.Names}}")
		output, err := cmd.Output()
		if err == nil && len(output) > 0 {
			// Container is running, give it a moment to initialize
			time.Sleep(2 * time.Second)
			return true
		}
		time.Sleep(1 * time.Second)
	}
	return false
}
