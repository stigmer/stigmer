//go:build e2e
// +build e2e

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

// SetupSuite runs once before all tests in the suite
// Checks that required infrastructure is running
func (s *E2ESuite) SetupSuite() {
	s.T().Log("Checking E2E test prerequisites...")
	
	// Copy SDK examples to testdata before running tests
	s.T().Log("Copying SDK examples to testdata...")
	if err := CopyAllSDKExamples(); err != nil {
		s.T().Fatalf("Failed to copy SDK examples: %v", err)
	}
	s.T().Log("✓ SDK examples copied successfully")
	
	// Check Temporal (gRPC server on port 7233)
	if err := checkTemporal(); err != nil {
		s.T().Fatalf(`Temporal is not running or not accessible.

Required for: Workflow orchestration

Setup:
  Start stigmer server (includes Temporal):
    stigmer server

  Or verify Temporal is running:
    stigmer server status

Error: %v`, err)
	}
	s.T().Log("✓ Temporal detected at localhost:7233")
	
	// Check Ollama
	if err := checkOllama(); err != nil {
		s.T().Fatalf(`Ollama is not running or not accessible.

Required for: LLM-powered agent execution

Setup Ollama:
  1. Install: https://ollama.com/
  2. Start server: ollama serve
  3. Pull model: ollama pull qwen2.5-coder:7b

To verify Ollama is running:
  curl http://localhost:11434/api/version

Error: %v`, err)
	}
	s.T().Log("✓ Ollama detected at localhost:11434")
	
	s.T().Log("All prerequisites met, starting E2E tests...")
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
