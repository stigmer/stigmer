//go:build e2e
// +build e2e

package e2e

// TestApplyAgentCount verifies that the SDK example creates exactly 2 agents
//
// Example: sdk/go/examples/01_basic_agent.go creates:
// 1. code-reviewer (basic agent)
// 2. code-reviewer-pro (full agent with optional fields)
// 3. Validation error example (invalid name) - caught and logged, not deployed
//
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestApplyAgentCount() {
	s.T().Logf("=== Testing Agent Count (SDK example creates %d agents) ===", BasicAgentCount)

	// STEP 1: Apply agents from SDK example
	result := ApplyBasicAgents(s.T(), s.Harness.ServerPort)

	// Log the apply output for reference
	s.T().Logf("Apply output:\n%s", result.Output)

	// STEP 2: Verify exactly 2 valid agents were created
	VerifyAgentCount(s.T(), s.Harness.ServerPort)

	s.T().Logf("✅ Agent count test passed: Exactly %d valid agents deployed (verified via API by slug)", BasicAgentCount)
}
