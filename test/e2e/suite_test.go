package e2e

import (
	"os"
	"testing"

	"github.com/stretchr/testify/suite"
)

// E2ESuite is the base test suite for E2E integration tests
type E2ESuite struct {
	suite.Suite
	Harness *TestHarness
	TempDir string
}

// SetupTest runs before each test method
// Creates a fresh temporary directory and starts a stigmer-server instance
func (s *E2ESuite) SetupTest() {
	// Create fresh temp directory for this test
	var err error
	s.TempDir, err = os.MkdirTemp("", "stigmer-e2e-*")
	s.Require().NoError(err, "Failed to create temp directory")

	s.T().Logf("Test temp directory: %s", s.TempDir)

	// Start stigmer-server with isolated storage
	s.Harness = StartHarness(s.T(), s.TempDir)
}

// TearDownTest runs after each test method
// Stops the server and cleans up temporary files
func (s *E2ESuite) TearDownTest() {
	// Stop server
	if s.Harness != nil {
		s.Harness.Stop()
	}

	// Clean up temp directory
	if s.TempDir != "" {
		err := os.RemoveAll(s.TempDir)
		if err != nil {
			s.T().Logf("Warning: Failed to remove temp directory: %v", err)
		} else {
			s.T().Logf("Cleaned up temp directory: %s", s.TempDir)
		}
	}
}

// TestE2E is the entry point that runs all E2E tests
func TestE2E(t *testing.T) {
	suite.Run(t, new(E2ESuite))
}
