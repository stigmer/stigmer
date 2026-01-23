//go:build e2e
// +build e2e

package e2e

import (
	"testing"

	"github.com/stretchr/testify/suite"
)

// E2ESuite is the base test suite for E2E integration tests
// Uses a single running stigmer server instance for all tests
type E2ESuite struct {
	suite.Suite
	Harness *TestHarness
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
	
	// Check that stigmer server is running
	if err := checkStigmerServer(); err != nil {
		s.T().Fatalf(`Stigmer server is not running or not accessible.

Required for: All E2E tests

Setup:
  Start stigmer server:
    stigmer server

  Or verify server is running:
    stigmer server status

Error: %v`, err)
	}
	s.T().Log("✓ Stigmer server detected at localhost:7234")
	
	// Check Temporal (gRPC server on port 7233)
	if err := checkTemporal(); err != nil {
		s.T().Fatalf(`Temporal is not running or not accessible.

Required for: Workflow orchestration

Setup:
  Temporal is started automatically by 'stigmer server'
  
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
	
	// Create harness that connects to existing server
	s.Harness = ConnectToRunningServer(s.T())
	s.T().Logf("Connected to stigmer server on port %d", s.Harness.ServerPort)
}

// SetupTest runs before each test method
// No-op in simplified approach (no per-test isolation)
func (s *E2ESuite) SetupTest() {
	s.T().Log("Running test against shared stigmer server...")
}

// TearDownTest runs after each test method
// No-op in simplified approach (no cleanup needed)
func (s *E2ESuite) TearDownTest() {
	// Nothing to clean up - server keeps running
}

// TestE2E is the entry point that runs all E2E tests
func TestE2E(t *testing.T) {
	suite.Run(t, new(E2ESuite))
}
