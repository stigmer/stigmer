//go:build e2e
// +build e2e

package e2e

// TestApplyBasicAgent tests the full apply workflow:
// 1. Server is running with isolated storage
// 2. Apply command deploys agents from code (from SDK example 01_basic_agent.go)
// 3. Agents are stored in BadgerDB
// 4. Can retrieve and verify agent data
//
// The SDK example creates TWO agents:
// - code-reviewer: Basic agent with required fields only
// - code-reviewer-pro: Full agent with optional fields (description, iconURL, org)
//
// Example: sdk/go/examples/01_basic_agent.go
// Test Fixture: test/e2e/testdata/examples/01-basic-agent/
//
// This test validates the COMPLETE agent apply lifecycle.
func (s *E2ESuite) TestApplyBasicAgent() {
	s.T().Logf("=== Testing Agent Apply (from SDK example 01_basic_agent.go) ===")

	// STEP 1: Apply agents from SDK example
	result := ApplyBasicAgents(s.T(), s.Harness.ServerPort)

	// STEP 2: Verify CLI output
	VerifyAgentApplyOutputSuccess(s.T(), result.Output)

	// STEP 3: Verify basic properties
	VerifyAgentBasicProperties(s.T(), result.BasicAgent, BasicAgentName)
	VerifyAgentBasicProperties(s.T(), result.FullAgent, FullAgentName)

	// STEP 4: Verify optional fields on full agent
	VerifyFullAgentOptionalFields(s.T(), result.FullAgent)

	// STEP 5: Verify default agent instances were auto-created
	s.T().Logf("Verifying default agent instances were auto-created...")

	basicInstance := VerifyAgentDefaultInstance(s.T(), s.Harness.ServerPort, result.BasicAgent, BasicAgentDefaultInstanceName)
	fullInstance := VerifyAgentDefaultInstance(s.T(), s.Harness.ServerPort, result.FullAgent, FullAgentDefaultInstanceName)

	// STEP 6: Summary
	s.T().Logf("✅ Test passed: Both agents and their default instances were successfully created")
	s.T().Logf("   Basic agent ID: %s (Instance: %s)", result.BasicAgent.Metadata.Id, basicInstance.InstanceID)
	s.T().Logf("   Full agent ID: %s (Instance: %s)", result.FullAgent.Metadata.Id, fullInstance.InstanceID)
}
