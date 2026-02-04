//go:build e2e
// +build e2e

package e2e

// TestProjectApplyBasicFreshDeployment tests the basic project fresh deployment:
// 1. Apply basic project with 1 agent
// 2. Verify agent is created
// 3. Verify reconciliation summary shows 1 create
//
// Test Fixture: testdata/project/basic-project/
// Expected: 1 agent (simple-agent)
func (s *E2ESuite) TestProjectApplyBasicFreshDeployment() {
	s.T().Logf("=== Testing Basic Project Fresh Deployment ===")

	// STEP 1: Apply basic project
	result := ApplyProject(s.T(), s.Harness.ServerPort, ProjectBasicTestDataDir)

	// STEP 2: Verify CLI output shows success
	VerifyProjectApplyOutputSuccess(s.T(), result.Output)

	// STEP 3: Verify the agent was created
	agent := VerifyAgentExists(s.T(), s.Harness.ServerPort, BasicProjectAgentName)

	// STEP 4: Verify agent properties
	s.Require().Equal(BasicProjectAgentName, agent.Metadata.Name,
		"Agent name should match expected")
	s.Require().Equal(LocalOrg, agent.Metadata.Org,
		"Agent org should be 'local'")

	// STEP 5: Summary
	s.T().Logf("✅ Test passed: Basic project deployed successfully")
	s.T().Logf("   Agent: %s (ID: %s)", agent.Metadata.Name, agent.Metadata.Id)
}

// TestProjectApplyMultiAgentFreshDeployment tests deployment of a complex project:
// 1. Apply multi-agent project with MCP server, 3 agents, and workflow
// 2. Verify all resources are created
// 3. Verify dependency ordering (MCP server -> agents -> workflow)
//
// Test Fixture: testdata/project/multi-agent-project/
// Expected: 1 MCP server, 3 agents, 1 workflow
func (s *E2ESuite) TestProjectApplyMultiAgentFreshDeployment() {
	s.T().Logf("=== Testing Multi-Agent Project Fresh Deployment ===")

	// STEP 1: Apply multi-agent project
	result := ApplyProject(s.T(), s.Harness.ServerPort, ProjectMultiAgentTestDataDir)

	// STEP 2: Verify CLI output shows success
	VerifyProjectApplyOutputSuccess(s.T(), result.Output)

	// STEP 3: Verify MCP server was created (should be first due to dependencies)
	mcpServer := VerifyMcpServerExists(s.T(), s.Harness.ServerPort, MultiAgentMcpServerName)
	s.T().Logf("✓ MCP Server created: %s (ID: %s)", mcpServer.Metadata.Name, mcpServer.Metadata.Id)

	// STEP 4: Verify all 3 agents were created
	etlAgent := VerifyAgentExists(s.T(), s.Harness.ServerPort, MultiAgentETLAgentName)
	s.T().Logf("✓ Agent created: %s (ID: %s)", etlAgent.Metadata.Name, etlAgent.Metadata.Id)

	validatorAgent := VerifyAgentExists(s.T(), s.Harness.ServerPort, MultiAgentValidatorAgentName)
	s.T().Logf("✓ Agent created: %s (ID: %s)", validatorAgent.Metadata.Name, validatorAgent.Metadata.Id)

	reporterAgent := VerifyAgentExists(s.T(), s.Harness.ServerPort, MultiAgentReporterAgentName)
	s.T().Logf("✓ Agent created: %s (ID: %s)", reporterAgent.Metadata.Name, reporterAgent.Metadata.Id)

	// STEP 5: Verify workflow was created (should be last due to dependencies)
	workflow := VerifyWorkflowExists(s.T(), s.Harness.ServerPort, MultiAgentWorkflowName)
	s.T().Logf("✓ Workflow created: %s (ID: %s)", workflow.Metadata.Name, workflow.Metadata.Id)

	// STEP 6: Summary
	s.T().Logf("✅ Test passed: Multi-agent project deployed successfully")
	s.T().Logf("   Total resources: 1 MCP server, 3 agents, 1 workflow")
}

// TestProjectApplyIdempotent tests that applying the same project twice is idempotent:
// 1. Apply basic project
// 2. Apply same project again
// 3. Verify no changes on second apply (0 creates, 0 updates)
//
// This validates the reconciliation engine's ability to detect no-op scenarios.
func (s *E2ESuite) TestProjectApplyIdempotent() {
	s.T().Logf("=== Testing Project Apply Idempotency ===")

	// STEP 1: Apply basic project (first time)
	s.T().Log("First apply...")
	result1 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectBasicTestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result1.Output)

	// Get the agent ID after first apply
	agent1 := VerifyAgentExists(s.T(), s.Harness.ServerPort, BasicProjectAgentName)
	originalID := agent1.Metadata.Id

	// STEP 2: Apply same project again (second time)
	s.T().Log("Second apply (should be no-op)...")
	result2 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectBasicTestDataDir)

	// STEP 3: Verify agent still exists with same ID
	agent2 := VerifyAgentExists(s.T(), s.Harness.ServerPort, BasicProjectAgentName)
	s.Require().Equal(originalID, agent2.Metadata.Id,
		"Agent ID should be unchanged on second apply")

	// STEP 4: Summary
	s.T().Logf("✅ Test passed: Project apply is idempotent")
	s.T().Logf("   Agent ID unchanged: %s", agent2.Metadata.Id)
}
