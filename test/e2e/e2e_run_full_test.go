//go:build e2e
// +build e2e

package e2e

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stretchr/testify/suite"
)

// FullExecutionSuite runs Phase 2 tests that require Docker services (Temporal + agent-runner)
type FullExecutionSuite struct {
	suite.Suite
	Harness *TestHarness
	TempDir string
}

// SetupSuite runs once before all tests in this suite
// Checks prerequisites and prepares the environment
func (s *FullExecutionSuite) SetupSuite() {
	// Check prerequisites (Docker, Ollama)
	if err := CheckPrerequisites(); err != nil {
		s.T().Skip(fmt.Sprintf("Prerequisites not met, skipping Phase 2 tests:\n%v", err))
	}
}

// SetupTest runs before each test method
// Creates a fresh temporary directory and starts stigmer-server + Docker services
func (s *FullExecutionSuite) SetupTest() {
	// Create fresh temp directory for this test
	var err error
	s.TempDir, err = os.MkdirTemp("", "stigmer-e2e-full-*")
	s.Require().NoError(err, "Failed to create temp directory")

	s.T().Logf("Test temp directory: %s", s.TempDir)

	// Start stigmer-server with Docker services enabled
	s.Harness = StartHarnessWithDocker(s.T(), s.TempDir, true)
	
	// Verify Docker services are ready
	s.Require().True(s.Harness.TemporalReady, "Temporal should be ready")
	s.Require().True(s.Harness.AgentRunnerReady, "Agent runner should be ready")
}

// TearDownTest runs after each test method
// Stops services and cleans up temporary files
func (s *FullExecutionSuite) TearDownTest() {
	// Stop services
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

// TestRunWithFullExecution tests a complete agent execution lifecycle:
// 1. Apply agent
// 2. Run agent with a message
// 3. Wait for execution to complete
// 4. Verify agent produced output
func (s *FullExecutionSuite) TestRunWithFullExecution() {
	s.T().Log("=== Testing full agent execution ===")

	// Step 1: Apply the agent
	s.T().Log("Step 1: Applying basic agent...")
	applyOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"apply",
		"--config", "testdata/Stigmer.yaml",
	)
	s.Require().NoError(err, "Apply command should succeed")
	s.T().Logf("Apply output:\n%s", applyOutput)

	// Extract agent ID from output
	agentID := extractAgentID(applyOutput)
	s.Require().NotEmpty(agentID, "Should extract agent ID from apply output")
	s.T().Logf("✓ Agent deployed: %s", agentID)

	// Verify agent exists
	exists, err := AgentExistsViaAPI(s.Harness.ServerPort, agentID)
	s.Require().NoError(err, "Should be able to query agent")
	s.Require().True(exists, "Agent should exist after apply")

	// Step 2: Run the agent
	s.T().Log("Step 2: Running agent with test message...")
	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", agentID,
		"--message", "Say hello and confirm you can respond",
		"--no-follow", // Don't stream logs, just create execution
	)
	s.Require().NoError(err, "Run command should succeed")
	s.T().Logf("Run output:\n%s", runOutput)

	// Extract execution ID from output
	executionID := extractExecutionID(runOutput)
	s.Require().NotEmpty(executionID, "Should extract execution ID from run output")
	s.T().Logf("✓ Execution created: %s", executionID)

	// Step 3: Wait for execution to complete
	s.T().Log("Step 3: Waiting for execution to complete...")
	execution, err := WaitForExecutionPhase(
		s.Harness.ServerPort,
		executionID,
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		60*time.Second, // 60 seconds should be enough for a simple response
	)
	s.Require().NoError(err, "Execution should complete successfully")
	s.Require().NotNil(execution, "Should have execution object")
	s.Require().NotNil(execution.Status, "Execution should have status")
	s.T().Logf("✓ Execution completed: %s", execution.Status.Phase.String())

	// Step 4: Verify agent produced output
	s.T().Log("Step 4: Verifying agent output...")
	messages, err := GetExecutionMessages(s.Harness.ServerPort, executionID)
	s.Require().NoError(err, "Should be able to get execution messages")
	s.Require().NotEmpty(messages, "Execution should have at least one message")

	// Check that the agent's response contains expected keywords
	lastMessage := messages[len(messages)-1]
	s.T().Logf("Agent response: %s", lastMessage)
	
	// Verify response is non-empty and contains relevant content
	s.NotEmpty(lastMessage, "Agent should produce a response")
	
	// Check for common greeting words (case-insensitive)
	lowerMessage := strings.ToLower(lastMessage)
	hasGreeting := strings.Contains(lowerMessage, "hello") ||
		strings.Contains(lowerMessage, "hi") ||
		strings.Contains(lowerMessage, "greetings")
	
	s.True(hasGreeting, "Agent response should contain a greeting")
	s.T().Log("✓ Agent produced valid response")

	s.T().Log("✅ Full execution test passed")
}

// TestRunWithInvalidMessage tests error handling for invalid execution requests
func (s *FullExecutionSuite) TestRunWithInvalidMessage() {
	s.T().Log("=== Testing run with invalid message ===")

	// Try to run without deploying agent first
	output, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "non-existent-agent-id",
		"--message", "test",
		"--no-follow",
	)

	// Should fail
	s.Error(err, "Running non-existent agent should fail")
	s.Contains(output, "not found", "Error should mention agent not found")
	
	s.T().Log("✓ Error handling works correctly")
}

// extractAgentID extracts the agent ID from apply command output
func extractAgentID(output string) string {
	// Look for pattern like "Agent ID: agent-xxxxx"
	re := regexp.MustCompile(`Agent ID:\s+([a-zA-Z0-9-]+)`)
	matches := re.FindStringSubmatch(output)
	if len(matches) > 1 {
		return matches[1]
	}

	// Alternative: look for just the ID pattern
	re = regexp.MustCompile(`agent-[a-zA-Z0-9-]+`)
	matches = re.FindStringSubmatch(output)
	if len(matches) > 0 {
		return matches[0]
	}

	return ""
}

// extractExecutionID extracts the execution ID from run command output
func extractExecutionID(output string) string {
	// Look for pattern like "Execution ID: execution-xxxxx"
	re := regexp.MustCompile(`Execution ID:\s+([a-zA-Z0-9-]+)`)
	matches := re.FindStringSubmatch(output)
	if len(matches) > 1 {
		return matches[1]
	}

	// Alternative: look for just the ID pattern
	re = regexp.MustCompile(`execution-[a-zA-Z0-9-]+`)
	matches = re.FindStringSubmatch(output)
	if len(matches) > 0 {
		return matches[0]
	}

	return ""
}

// TestFullExecution is the entry point that runs all Phase 2 tests
func TestFullExecution(t *testing.T) {
	suite.Run(t, new(FullExecutionSuite))
}
