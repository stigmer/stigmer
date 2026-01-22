//go:build e2e
// +build e2e

package e2e

import (
	"regexp"
	"strings"
	"testing"
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stretchr/testify/suite"
)

// FullExecutionSuite runs Phase 2 tests that require full stigmer server stack
// Uses the production stigmer server (with Temporal, workflow-runner, agent-runner)
type FullExecutionSuite struct {
	suite.Suite
	ServerManager *StigmerServerManager // Manages full stigmer server stack
	ServerPort    int                   // Port stigmer-server is running on
}

// SetupSuite runs once before all tests in this suite
// Ensures stigmer server is running (starts it if needed)
func (s *FullExecutionSuite) SetupSuite() {
	s.T().Log("=== Setting up Phase 2 test suite ===")

	// STEP 1: Copy SDK examples to testdata
	// This ensures that the examples we promise in SDK are what we actually test
	s.T().Log("Step 1: Copying SDK examples to testdata...")
	if err := CopyAllSDKExamples(); err != nil {
		s.T().Fatalf("Failed to copy SDK examples: %v", err)
	}
	s.T().Log("✓ SDK examples copied successfully")

	// STEP 2: Ensure stigmer server is running (starts it automatically if not)
	s.T().Log("Step 2: Ensuring stigmer server is running...")
	manager, err := EnsureStigmerServerRunning(s.T())
	if err != nil {
		s.T().Skipf("Failed to start stigmer server, skipping Phase 2 tests:\n%v", err)
	}

	s.ServerManager = manager
	s.ServerPort = manager.GetServerPort()

	// Check component status
	status := manager.GetStatus()
	s.T().Logf("Component status: stigmer-server=%v temporal=%v workflow-runner=%v agent-runner=%v",
		status["stigmer-server"],
		status["temporal"],
		status["workflow-runner"],
		status["agent-runner"],
	)

	// Skip suite if critical components are not ready
	if !status["stigmer-server"] {
		s.T().Skip("Stigmer server not ready")
	}

	if !status["temporal"] {
		s.T().Skip("Temporal not available - required for Phase 2 tests")
	}

	if !status["agent-runner"] {
		s.T().Skip("Agent runner not available - required for Phase 2 tests")
	}

	s.T().Log("✓ All components ready for Phase 2 tests")
}

// TearDownSuite runs once after all tests in this suite
// Stops stigmer server if we started it
func (s *FullExecutionSuite) TearDownSuite() {
	if s.ServerManager != nil {
		s.ServerManager.Stop()
	}
}

// SetupTest runs before each test - no setup needed now
// Tests share the same stigmer server instance
func (s *FullExecutionSuite) SetupTest() {
	// Nothing needed - using shared server
}

// TearDownTest runs after each test - no cleanup needed now
// Tests share the same stigmer server, so no per-test cleanup
func (s *FullExecutionSuite) TearDownTest() {
	// Nothing needed - server stays running for next test
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
		s.ServerPort,
		"apply",
		"--config", "testdata/examples/01-basic-agent/Stigmer.yaml",
	)
	s.Require().NoError(err, "Apply command should succeed")
	s.T().Logf("Apply output:\n%s", applyOutput)

	// Extract agent ID from output
	agentID := extractAgentID(applyOutput)
	s.Require().NotEmpty(agentID, "Should extract agent ID from apply output")
	s.T().Logf("✓ Agent deployed: %s", agentID)

	// Verify agent exists
	exists, err := AgentExistsViaAPI(s.ServerPort, agentID)
	s.Require().NoError(err, "Should be able to query agent")
	s.Require().True(exists, "Agent should exist after apply")

	// Step 2: Run the agent (use agent name, not ID)
	s.T().Log("Step 2: Running agent with test message...")
	agentName := "code-reviewer" // Use the agent name from SDK example (01_basic_agent.go)
	runOutput, err := RunCLIWithServerAddr(
		s.ServerPort,
		"run", agentName,
		"--message", "Say hello and confirm you can respond",
		"--follow=false", // Don't stream logs, just create execution
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
		s.ServerPort,
		executionID,
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		60*time.Second, // 60 seconds should be enough for a simple response
	)
	s.Require().NoError(err, "Execution should complete successfully")
	s.Require().NotNil(execution, "Should have execution object")
	s.Require().NotNil(execution.Status, "Execution should have status")
	s.T().Logf("✓ Execution completed: %s", execution.Status.Phase.String())

	// Step 4: Verify agent produced output with deterministic checks
	s.T().Log("Step 4: Verifying agent output...")

	// Create validator for this execution
	validator := NewExecutionValidator(execution)
	lastMessage := validator.GetLastMessage()
	s.T().Logf("Agent response: %s", lastMessage)

	// TIER 1: Execution Status Checks (MUST PASS)
	s.T().Log("  Running Tier 1 validation (execution status)...")

	result := validator.ValidateCompleted()
	s.Require().True(result.Passed, result.Reason)
	s.T().Logf("  ✓ %s", result.Reason)

	result = validator.ValidateNotFailed()
	s.Require().True(result.Passed, result.Reason)
	s.T().Logf("  ✓ %s", result.Reason)

	result = validator.ValidateHasMessages()
	s.Require().True(result.Passed, result.Reason)
	s.T().Logf("  ✓ %s", result.Reason)

	// TIER 2: Output Quality Checks (MUST PASS)
	s.T().Log("  Running Tier 2 validation (output quality)...")

	result = validator.ValidateOutputNotEmpty()
	s.Require().True(result.Passed, result.Reason)
	s.T().Logf("  ✓ %s", result.Reason)

	result = validator.ValidateOutputMinLength(10)
	s.Require().True(result.Passed, result.Reason)
	s.T().Logf("  ✓ %s", result.Reason)

	result = validator.ValidateNotGibberish()
	s.Require().True(result.Passed, result.Reason)
	s.T().Logf("  ✓ %s", result.Reason)

	result = validator.ValidateNotErrorMessage()
	s.Require().True(result.Passed, result.Reason)
	s.T().Logf("  ✓ %s", result.Reason)

	result = validator.ValidateHasSentenceStructure()
	s.Require().True(result.Passed, result.Reason)
	s.T().Logf("  ✓ %s", result.Reason)

	// TIER 3: Behavioral Checks (SHOULD PASS - for this specific test)
	s.T().Log("  Running Tier 3 validation (behavioral)...")

	// For a greeting test, we expect greeting-related words
	result = validator.ValidateContainsKeywords(
		[]string{"hello", "hi", "greetings", "hey", "respond", "confirm", "yes", "can"},
		"any", // At least one of these should be present
	)
	if result.Passed {
		s.T().Logf("  ✓ %s", result.Reason)
	} else {
		// This is a soft check - log warning but don't fail
		s.T().Logf("  ⚠️  Warning: %s", result.Reason)
	}

	s.T().Log("✓ All validation tiers passed")
	s.T().Log("✅ Full execution test passed")
}

// TestRunWithInvalidMessage tests error handling for invalid execution requests
func (s *FullExecutionSuite) TestRunWithInvalidMessage() {
	s.T().Log("=== Testing run with invalid message ===")

	// Try to run without deploying agent first
	output, err := RunCLIWithServerAddr(
		s.ServerPort,
		"run", "non-existent-agent-id",
		"--message", "test",
		"--follow=false",
	)

	s.T().Logf("Output: %s", output)
	s.T().Logf("Error: %v", err)

	// Should either fail with error or output should contain error message
	hasError := err != nil || strings.Contains(output, "not found") || strings.Contains(output, "Not found")
	s.True(hasError, "Running non-existent agent should produce an error")

	// Verify error message mentions the issue
	if err == nil {
		s.Contains(output, "not found", "Error message should mention agent not found")
	}

	s.T().Log("✓ Error handling works correctly")
}

// extractAgentID extracts the agent ID from apply command output
func extractAgentID(output string) string {
	// Look for pattern like "ID: agt-xxxxx" or "(ID: agt-xxxxx)"
	re := regexp.MustCompile(`\(ID:\s+(agt-[0-9]+)\)`)
	matches := re.FindStringSubmatch(output)
	if len(matches) > 1 {
		return matches[1]
	}

	// Alternative: look for "ID: agt-" pattern
	re = regexp.MustCompile(`ID:\s+(agt-[0-9]+)`)
	matches = re.FindStringSubmatch(output)
	if len(matches) > 1 {
		return matches[1]
	}

	// Fallback: look for just the ID pattern
	re = regexp.MustCompile(`agt-[0-9]+`)
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

// TestRunWithSpecificBehavior demonstrates how to validate specific agent behaviors
func (s *FullExecutionSuite) TestRunWithSpecificBehavior() {
	s.T().Log("=== Testing specific agent behavior validation ===")

	// Apply agent
	s.T().Log("Step 1: Applying agent...")
	applyOutput, err := RunCLIWithServerAddr(
		s.ServerPort,
		"apply",
		"--config", "testdata/examples/01-basic-agent/Stigmer.yaml",
	)
	s.Require().NoError(err, "Apply should succeed")

	agentID := extractAgentID(applyOutput)
	s.Require().NotEmpty(agentID, "Should extract agent ID")
	s.T().Logf("✓ Agent deployed: %s", agentID)

	// Test Case 1: Agent should respond to a greeting
	s.T().Log("\nTest Case 1: Greeting behavior")
	runOutput, err := RunCLIWithServerAddr(
		s.ServerPort,
		"run", "code-reviewer", // Use the agent name from SDK example (01_basic_agent.go)
		"--message", "Hello! Please greet me back.",
		"--follow=false",
	)
	s.Require().NoError(err, "Run should succeed")

	executionID := extractExecutionID(runOutput)
	s.Require().NotEmpty(executionID, "Should extract execution ID")

	execution, err := WaitForExecutionPhase(
		s.ServerPort,
		executionID,
		agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		60*time.Second,
	)
	s.Require().NoError(err, "Execution should complete")

	// Validate greeting-specific behavior
	validator := NewExecutionValidator(execution)

	// Must pass: Basic quality checks
	s.Require().True(validator.ValidateCompleted().Passed, "Must complete successfully")
	s.Require().True(validator.ValidateNotGibberish().Passed, "Must not be gibberish")
	s.Require().True(validator.ValidateHasSentenceStructure().Passed, "Must have sentence structure")

	// Should pass: Greeting-specific behavior
	greetingResult := validator.ValidateContainsKeywords(
		[]string{"hello", "hi", "greetings", "hey"},
		"any",
	)

	if greetingResult.Passed {
		s.T().Logf("  ✓ Agent responded with greeting: %s", greetingResult.Reason)
	} else {
		s.T().Logf("  ⚠️  Warning: %s", greetingResult.Reason)
		s.T().Logf("     Response: %s", validator.GetLastMessage())
	}

	s.T().Log("✅ Greeting test completed")
}

// TestFullExecution is the entry point that runs all Phase 2 tests
func TestFullExecution(t *testing.T) {
	suite.Run(t, new(FullExecutionSuite))
}
