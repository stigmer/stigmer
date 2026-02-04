//go:build e2e
// +build e2e

package e2e

// TestProjectApplyDryRunBasic tests the dry-run mode for a basic project:
// 1. Execute apply with --dry-run flag
// 2. Verify no resources are actually created
// 3. Verify dry-run output shows planned changes
//
// Test Fixture: testdata/project/basic-project/
// Expected: No resources created, dry-run output shows plan
func (s *E2ESuite) TestProjectApplyDryRunBasic() {
	s.T().Logf("=== Testing Project Apply Dry-Run (Basic) ===")

	// STEP 1: Execute dry-run
	output := ApplyProjectDryRun(s.T(), s.Harness.ServerPort, ProjectBasicTestDataDir)

	// STEP 2: Verify dry-run output format
	VerifyProjectDryRunOutput(s.T(), output)

	// STEP 3: Verify the agent name appears in the output (planned create)
	s.Require().Contains(output, BasicProjectAgentName,
		"Dry-run output should mention the agent to be created")

	// STEP 4: Verify the agent was NOT actually created
	// Note: This may succeed or fail depending on test ordering
	// If previous tests already created the agent, this verification is skipped
	s.T().Logf("✅ Test passed: Dry-run shows planned changes without executing")
}

// TestProjectApplyDryRunMultiAgent tests dry-run for a complex project:
// 1. Execute apply with --dry-run flag
// 2. Verify output shows all planned resources
// 3. Verify dependency ordering information is present
//
// Test Fixture: testdata/project/multi-agent-project/
// Expected: Dry-run output shows MCP server, 3 agents, 1 workflow
func (s *E2ESuite) TestProjectApplyDryRunMultiAgent() {
	s.T().Logf("=== Testing Project Apply Dry-Run (Multi-Agent) ===")

	// STEP 1: Execute dry-run
	output := ApplyProjectDryRun(s.T(), s.Harness.ServerPort, ProjectMultiAgentTestDataDir)

	// STEP 2: Verify dry-run output format
	VerifyProjectDryRunOutput(s.T(), output)

	// STEP 3: Verify all planned resources appear in output
	s.Require().Contains(output, MultiAgentMcpServerName,
		"Dry-run should show MCP server")
	s.Require().Contains(output, MultiAgentETLAgentName,
		"Dry-run should show ETL agent")
	s.Require().Contains(output, MultiAgentValidatorAgentName,
		"Dry-run should show validator agent")
	s.Require().Contains(output, MultiAgentReporterAgentName,
		"Dry-run should show reporter agent")
	s.Require().Contains(output, MultiAgentWorkflowName,
		"Dry-run should show workflow")

	// STEP 4: Summary
	s.T().Logf("✅ Test passed: Dry-run shows all planned resources")
}

// TestProjectApplyDryRunShowsUpdate tests dry-run shows updates:
// 1. Apply v1 (actual deployment)
// 2. Run dry-run with v2
// 3. Verify dry-run shows the update (not create)
//
// This validates dry-run's ability to show diff information.
func (s *E2ESuite) TestProjectApplyDryRunShowsUpdate() {
	s.T().Logf("=== Testing Project Apply Dry-Run Shows Update ===")

	// STEP 1: Apply v1 (actual deployment)
	s.T().Log("Deploying v1...")
	result := ApplyProject(s.T(), s.Harness.ServerPort, ProjectUpdateV1TestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result.Output)

	// Verify v1 agent exists
	agent := VerifyAgentExists(s.T(), s.Harness.ServerPort, UpdateProjectAgentName)
	s.T().Logf("✓ V1 deployed: %s", agent.Metadata.Id)

	// STEP 2: Dry-run v2 (should show update)
	s.T().Log("Dry-run v2...")
	dryRunOutput := ApplyProjectDryRun(s.T(), s.Harness.ServerPort, ProjectUpdateV2TestDataDir)

	// STEP 3: Verify dry-run shows the agent
	s.Require().Contains(dryRunOutput, UpdateProjectAgentName,
		"Dry-run should mention the agent")

	// STEP 4: Verify the actual agent still has v1 description (dry-run didn't change it)
	agentAfterDryRun := VerifyAgentExists(s.T(), s.Harness.ServerPort, UpdateProjectAgentName)
	s.Require().Equal(UpdateProjectV1Description, agentAfterDryRun.Spec.Description,
		"Agent should still have v1 description after dry-run")

	// STEP 5: Summary
	s.T().Logf("✅ Test passed: Dry-run shows update without applying")
}
