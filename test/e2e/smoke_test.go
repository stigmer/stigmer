package e2e

import (
	"fmt"
	"net"
	"time"
)

// TestServerStarts is a minimal smoke test that verifies:
// 1. Temp directory is created
// 2. stigmer-server starts successfully
// 3. Server is listening on the expected port
// 4. Server responds to connections
func (s *E2ESuite) TestServerStarts() {
	s.T().Log("=== Starting smoke test ===")
	
	// Verify temp directory exists
	s.DirExists(s.TempDir, "Temp directory should exist")
	s.T().Log("✓ Temp directory verified")

	// Verify harness was created
	s.NotNil(s.Harness, "Harness should be initialized")
	s.T().Log("✓ Harness verified")

	// Verify port is set
	s.Greater(s.Harness.ServerPort, 0, "Server port should be assigned")
	s.T().Logf("✓ Server is running on port %d", s.Harness.ServerPort)

	// Verify server is actually listening
	s.T().Log("Attempting to connect to server...")
	conn, err := net.DialTimeout("tcp",
		fmt.Sprintf("localhost:%d", s.Harness.ServerPort),
		2*time.Second)
	
	s.NoError(err, "Should be able to connect to server")
	if conn != nil {
		conn.Close()
		s.T().Log("✓ Connected and closed connection")
	}

	s.T().Log("✅ Smoke test passed: Server is running and accepting connections")
	s.T().Log("=== Smoke test complete ===")
}
