//go:build e2e
// +build e2e

package e2e

// Generic run command tests (not tied to specific SDK examples).
// Example-specific tests are in: basic_agent_run_test.go, etc.

// TestRunWithInvalidAgent verifies error handling when agent doesn't exist
func (s *E2ESuite) TestRunWithInvalidAgent() {
	s.T().Logf("Testing run with non-existent agent...")

	// Try to run an agent that doesn't exist
	output, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"run", "non-existent-agent",
		"--follow=false",
	)

	// CLI prints error message but doesn't crash (good UX)
	// So we don't check for error, just check the output

	// Should have helpful error message
	s.Contains(output, "not found", "Output should indicate agent was not found")
	s.Contains(output, "non-existent-agent", "Output should mention the agent name")

	s.T().Logf("✓ Error handling works correctly (graceful error message)")
	s.T().Logf("Error output:\n%s", output)
	
	// If there was an error, that's okay too (both behaviors are acceptable)
	if err != nil {
		s.T().Logf("Note: Command exited with error code (also valid behavior)")
	}
}
