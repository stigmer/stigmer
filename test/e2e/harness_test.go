//go:build e2e
// +build e2e

package e2e

import (
	"testing"
	"time"
)

// TestHarness provides connection information for the running stigmer server
// Simplified approach: connects to existing server instead of starting/stopping per test
type TestHarness struct {
	// Server connection
	ServerPort int // Port where stigmer server is listening (default: 8234)
	t          *testing.T

	// Infrastructure status
	TemporalAddr  string // e.g., "localhost:7233"
	TemporalReady bool

	AgentRunnerReady bool
}

// ConnectToRunningServer creates a harness that connects to an already-running stigmer server
// Assumes server is running on default port 8234 (or PORT env var)
func ConnectToRunningServer(t *testing.T) *TestHarness {
	// Default stigmer server port
	port := 8234

	// Verify server is accessible
	if !WaitForPort(port, 5*time.Second) {
		t.Fatalf("Stigmer server not accessible on port %d. Is 'stigmer server' running?", port)
	}

	harness := &TestHarness{
		ServerPort:   port,
		t:            t,
		TemporalAddr: "localhost:7233",
	}

	// Check if Temporal is available
	if WaitForPort(7233, 2*time.Second) {
		harness.TemporalReady = true
		t.Log("✓ Temporal detected at localhost:7233")
	} else {
		t.Log("⚠️  Temporal not detected (tests requiring workflows will be skipped)")
	}

	// Assume agent runner is available if Temporal is
	if harness.TemporalReady {
		harness.AgentRunnerReady = true
		t.Log("✓ Using agent-runner worker (managed by stigmer server)")
	}

	return harness
}

// Stop is a no-op in simplified approach
// Server keeps running across all tests
func (h *TestHarness) Stop() {
	// Nothing to stop - server remains running
}
