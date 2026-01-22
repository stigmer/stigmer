//go:build e2e
// +build e2e

package e2e

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	// DaemonPort is the port stigmer-server runs on
	DaemonPort = 7234
)

// StigmerServerManager manages the full stigmer server stack for E2E tests
// This includes: stigmer-server, Temporal, workflow-runner, and agent-runner
type StigmerServerManager struct {
	DataDir        string
	WeStartedIt    bool // Track if we started the server (for cleanup)
	t              *testing.T
}

// EnsureStigmerServerRunning checks if stigmer server is running, and starts it if not
// Returns a manager that can be used to track and clean up the server
func EnsureStigmerServerRunning(t *testing.T) (*StigmerServerManager, error) {
	// Get data directory (default: ~/.stigmer)
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}
	dataDir := filepath.Join(homeDir, ".stigmer")

	manager := &StigmerServerManager{
		DataDir:     dataDir,
		WeStartedIt: false,
		t:           t,
	}

	// Check if stigmer server is already running
	if isServerRunning() {
		t.Log("✓ Stigmer server is already running")
		manager.WeStartedIt = false
		
		// Verify Temporal is accessible
		if WaitForPort(7233, 2*time.Second) {
			t.Log("✓ Temporal is accessible at localhost:7233")
		} else {
			t.Log("⚠️  Temporal not detected (tests requiring workflows may fail)")
		}
		
		return manager, nil
	}

	// Server not running - start it
	t.Log("Stigmer server not running, starting it automatically...")
	
	if err := startServer(); err != nil {
		return nil, fmt.Errorf("failed to start stigmer server: %w", err)
	}

	manager.WeStartedIt = true
	t.Log("✓ Stigmer server started successfully")
	
	// Wait for components to be ready
	t.Log("Waiting for services to become ready...")
	
	// Wait for stigmer-server (gRPC port 7234)
	if !WaitForPort(DaemonPort, 15*time.Second) {
		return nil, fmt.Errorf("stigmer-server failed to become ready on port %d", DaemonPort)
	}
	t.Logf("✓ Stigmer server ready on port %d", DaemonPort)
	
	// Wait for Temporal (port 7233)
	if !WaitForPort(7233, 15*time.Second) {
		t.Log("⚠️  Temporal not detected (tests requiring workflows may fail)")
	} else {
		t.Log("✓ Temporal ready at localhost:7233")
	}
	
	// Give agent-runner a moment to start
	time.Sleep(3 * time.Second)
	t.Log("✓ Agent runner startup time elapsed")
	
	return manager, nil
}

// Stop stops the stigmer server if we started it
// If the server was already running when tests started, we leave it running
func (m *StigmerServerManager) Stop() {
	if !m.WeStartedIt {
		m.t.Log("Stigmer server was already running, leaving it running")
		return
	}

	m.t.Log("Stopping stigmer server (started by E2E tests)...")
	if err := stopServer(); err != nil {
		m.t.Logf("Warning: Failed to stop stigmer server: %v", err)
	} else {
		m.t.Log("✓ Stigmer server stopped")
	}
}

// GetServerPort returns the port stigmer-server is running on
func (m *StigmerServerManager) GetServerPort() int {
	return DaemonPort // Always 7234 for stigmer server
}

// GetTemporalAddress returns the Temporal server address
func (m *StigmerServerManager) GetTemporalAddress() string {
	return "localhost:7233"
}

// IsTemporalReady checks if Temporal is accessible
func (m *StigmerServerManager) IsTemporalReady() bool {
	return WaitForPort(7233, 1*time.Second)
}

// GetStatus returns diagnostic information about the server components
func (m *StigmerServerManager) GetStatus() map[string]bool {
	status := make(map[string]bool)
	
	// Check stigmer-server
	status["stigmer-server"] = isServerRunning()
	
	// Check Temporal
	status["temporal"] = WaitForPort(7233, 1*time.Second)
	
	// Check workflow-runner and agent-runner (via stigmer server status command)
	statusOutput := getServerStatus()
	
	// Look for "Workflow Runner:" followed by "Running"
	status["workflow-runner"] = strings.Contains(statusOutput, "Workflow Runner:") && 
		strings.Contains(statusOutput, "Running")
	
	// Look for "Agent Runner" followed by "Running"
	status["agent-runner"] = strings.Contains(statusOutput, "Agent Runner") && 
		strings.Contains(statusOutput, "Running")
	
	return status
}

// GetLogPath returns the path to the log directory
func (m *StigmerServerManager) GetLogPath() string {
	return filepath.Join(m.DataDir, "logs")
}

// PrintLogs prints recent logs from a component (useful for debugging)
func (m *StigmerServerManager) PrintLogs(component string, lines int) {
	logFile := filepath.Join(m.DataDir, "logs", fmt.Sprintf("%s.log", component))
	
	data, err := os.ReadFile(logFile)
	if err != nil {
		m.t.Logf("Failed to read %s logs: %v", component, err)
		return
	}
	
	// Print last N lines (simple tail implementation)
	logLines := []byte{}
	lineCount := 0
	for i := len(data) - 1; i >= 0; i-- {
		if data[i] == '\n' {
			lineCount++
			if lineCount > lines {
				logLines = data[i+1:]
				break
			}
		}
	}
	
	if lineCount <= lines {
		logLines = data
	}
	
	m.t.Logf("=== Last %d lines of %s.log ===\n%s", lines, component, string(logLines))
}

// Helper functions that use CLI commands instead of internal packages

// isServerRunning checks if stigmer server is running
func isServerRunning() bool {
	return WaitForPort(DaemonPort, 100*time.Millisecond)
}

// startServer starts the stigmer server via CLI
func startServer() error {
	cmd := exec.Command("stigmer", "server", "start")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to start server: %w (stderr: %s)", err, stderr.String())
	}
	
	return nil
}

// stopServer stops the stigmer server via CLI
func stopServer() error {
	cmd := exec.Command("stigmer", "server", "stop")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to stop server: %w (stderr: %s)", err, stderr.String())
	}
	
	return nil
}

// getServerStatus gets server status via CLI
func getServerStatus() string {
	cmd := exec.Command("stigmer", "server", "status")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	return string(output)
}
