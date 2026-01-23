//go:build e2e
// +build e2e

package e2e

// TestApplyDryRun tests the dry-run mode of apply command
//
// Example: sdk/go/examples/01_basic_agent.go
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
func (s *E2ESuite) TestApplyDryRun() {
	s.T().Logf("=== Testing Agent Apply Dry-Run Mode ===")

	// STEP 1: Execute apply with --dry-run flag
	output := ApplyBasicAgentsDryRun(s.T(), s.Harness.ServerPort)

	// STEP 2: Verify dry-run output format
	VerifyAgentDryRunOutput(s.T(), output)

	s.T().Logf("✅ Dry-run test passed: Dry-run successful (no resources deployed)")
}
